/**
 * services/mongoBackup.js
 *
 * NEW (production hardening audit, Phase 2, issue #1/#10). Replaces the
 * old file-based backup/restore system (routes/settings.js used to
 * fs.copyFileSync the Data/ folder — which has been stale/empty since the
 * jsonDb -> MongoDB migration, so backups had silently stopped containing
 * any real data). Backups now live entirely inside MongoDB itself:
 *
 * - A backup snapshots every "real" application collection (see
 *   services/jsonDb.js#listRealCollectionNames) by copying its documents,
 *   as-is, into a sibling collection named `_backup__<name>__<original>`.
 *   Copying documents directly through the driver (never through
 *   JSON.stringify/parse) preserves ObjectIds and every other BSON type
 *   exactly — nothing is serialized to a format that could lose them.
 * - One metadata document per backup lives in `_backupMeta`, recording
 *   which collections it covers, how many documents each had, and their
 *   (non-default) index definitions, so they can be rebuilt on restore.
 * - Collections and documents living inside MongoDB itself don't depend
 *   on Render's (or any host's) local disk at all, so a backup survives a
 *   redeploy — directly addressing issue #10 for backups specifically
 *   (see PHASE_2_REPORT.md for why application logs are a separate,
 *   not-yet-addressed piece of #10).
 *
 * Restore uses a safe-swap per collection: copy the backup's documents
 * into a temporary collection, verify the count, atomically rename it
 * into the live collection's name (MongoDB's renameCollection with
 * dropTarget:true is a single atomic operation), verify again. The live
 * collection is never touched until that final rename, so a failure at
 * any earlier step leaves production data exactly as it was. Restore
 * stops at the first collection that fails rather than plowing on, and
 * never reports success unless every collection in the backup actually
 * made it into place — see restoreBackup()'s return shape.
 *
 * All collection names here are internal (prefixed with "_") on purpose
 * — see jsonDb.js#_isInternalCollectionName — so none of this ever gets
 * pulled into the app's in-memory mirror or shows up to the ~700 call
 * sites that read through jsonDb.
 *
 * IMPORTANT — sandbox testing limitation: this was developed and unit-
 * tested with the MongoDB driver's methods mocked (see
 * __tests__/services/mongoBackup.test.js), verifying the orchestration
 * logic — call order, stop-on-failure, count verification, retention
 * pruning — but there is no live MongoDB reachable in this environment
 * to prove renameCollection's atomicity or ObjectId preservation against
 * a real server. Both are standard, well-documented driver/server
 * behavior, but please run the smoke test in PHASE_2_REPORT.md against a
 * real (ideally non-production) database before relying on this.
 */

"use strict";

const logger = require("../utils/logger");
const db = require("./jsonDb");

const META_COLLECTION = "_backupMeta";
const BACKUP_PREFIX = "_backup__";
const RESTORE_TMP_PREFIX = "_restore_tmp__";

// How many documents to copy per insertMany() call. Keeps memory/network
// usage bounded on a large collection instead of loading everything into
// one array — even though jsonDb already keeps every collection fully in
// memory anyway (see _loadAllCollections), there's no reason for backup/
// restore to be worse than it has to be.
const COPY_BATCH_SIZE = 500;

// Only applied to kind:'scheduled' backups (the nightly/weekly cron job)
// — manual and pre-restore-safety-net backups are left for the admin to
// manage via the existing delete endpoint, same as the old system never
// auto-deleted anything either. Env-overridable.
//
// IMPORTANT — default chosen for MongoDB Atlas Free (M0) tier safety,
// verified against MongoDB's own docs (2026-08): a Free cluster has a
// HARD cap of 500 collections total and 512 MB of total storage across
// every collection and index combined. Each backup here creates one new
// collection PER real application collection, containing a full copy of
// its data — so retained backups multiply storage roughly linearly
// (5 retained backups of a full dataset ≈ 6x that dataset's live size,
// once the live copy is counted too). 14 was tempting as a "two weeks
// of dailies" default but risks silently hitting either Atlas cap on a
// Free tier long before two weeks are up. If you're on M10+ with real
// headroom, raise BACKUP_RETENTION_COUNT accordingly — see
// PHASE_2_REPORT.md for the full sizing discussion, including that
// manual/pre-restore backups are NOT covered by this pruning at all and
// need occasional manual cleanup via the existing delete endpoint.
const SCHEDULED_RETENTION_COUNT = parseInt(process.env.BACKUP_RETENTION_COUNT, 10) || 5;

function makeBackupName(kind) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = kind === "scheduled" ? "auto" : kind === "pre-restore" ? "pre-restore" : "backup";
  return `${prefix}-${ts}`;
}

function backupCollectionName(backupName, originalName) {
  return `${BACKUP_PREFIX}${backupName}__${originalName}`;
}

function tmpRestoreCollectionName(originalName) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${RESTORE_TMP_PREFIX}${Date.now()}_${rand}__${originalName}`;
}

function requireConnectedDb() {
  if (!db.db) throw new Error("MongoDB is not connected");
  return db.db;
}

// Copies every document from sourceName to destName via a cursor, in
// batches — see COPY_BATCH_SIZE. Returns the number of documents copied.
async function copyCollection(mongoDb, sourceName, destName) {
  const cursor = mongoDb.collection(sourceName).find({});
  let batch = [];
  let total = 0;
  while (await cursor.hasNext()) {
    batch.push(await cursor.next());
    if (batch.length >= COPY_BATCH_SIZE) {
      await mongoDb.collection(destName).insertMany(batch, { ordered: true });
      total += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await mongoDb.collection(destName).insertMany(batch, { ordered: true });
    total += batch.length;
  }
  return total;
}

// Captures a collection's non-default indexes so they can be rebuilt on
// restore. Every collection gets an automatic _id_ index; recreating it
// explicitly would error, so it's excluded.
async function captureIndexes(mongoDb, collectionName) {
  const indexes = await mongoDb.collection(collectionName).listIndexes().toArray();
  return indexes
    .filter((ix) => ix.name !== "_id_")
    .map((ix) => ({ key: ix.key, name: ix.name, unique: !!ix.unique, sparse: !!ix.sparse }));
}

async function applyIndexes(mongoDb, collectionName, indexes) {
  if (!indexes || !indexes.length) return;
  await mongoDb.collection(collectionName).createIndexes(
    indexes.map((ix) => ({ key: ix.key, name: ix.name, unique: ix.unique, sparse: ix.sparse }))
  );
}

// Creates a full backup: every real application collection, snapshotted
// as-is into sibling `_backup__` collections, recorded in one
// `_backupMeta` document. kind is 'manual' (admin-triggered), 'scheduled'
// (cron job), or 'pre-restore' (restoreBackup's own safety-net snapshot).
async function createBackup({ kind = "manual" } = {}) {
  const mongoDb = requireConnectedDb();
  const name = makeBackupName(kind);
  const realCollections = await db.listRealCollectionNames();

  const collectionsMeta = [];
  for (const collName of realCollections) {
    const destName = backupCollectionName(name, collName);
    const docCount = await copyCollection(mongoDb, collName, destName);
    const indexes = await captureIndexes(mongoDb, collName);
    collectionsMeta.push({ name: collName, docCount, indexes });
  }

  const totalDocs = collectionsMeta.reduce((sum, c) => sum + c.docCount, 0);
  const metaDoc = {
    name,
    kind,
    createdAt: new Date(),
    collections: collectionsMeta,
    totalDocs,
  };
  await mongoDb.collection(META_COLLECTION).insertOne(metaDoc);
  logger.info(`✅ Backup created: ${name} (${collectionsMeta.length} collections, ${totalDocs} documents)`);

  if (kind === "scheduled") {
    await pruneScheduledBackups();
  }

  return metaDoc;
}

async function listBackups() {
  const mongoDb = requireConnectedDb();
  return mongoDb.collection(META_COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
}

async function getBackupMeta(name) {
  const mongoDb = requireConnectedDb();
  return mongoDb.collection(META_COLLECTION).findOne({ name });
}

async function deleteBackup(name) {
  const mongoDb = requireConnectedDb();
  const meta = await getBackupMeta(name);
  if (!meta) return false;

  for (const c of meta.collections) {
    await mongoDb.collection(backupCollectionName(name, c.name)).drop().catch((err) => {
      // "ns not found" just means it's already gone (or had zero
      // documents, which some server versions treat as never having
      // been created) — the end state we want either way, not a real
      // failure.
      if (!/ns not found/i.test(err.message)) throw err;
    });
  }
  await mongoDb.collection(META_COLLECTION).deleteOne({ name });
  logger.info(`🗑️  Backup deleted: ${name}`);
  return true;
}

async function pruneScheduledBackups() {
  const mongoDb = requireConnectedDb();
  const scheduled = await mongoDb
    .collection(META_COLLECTION)
    .find({ kind: "scheduled" })
    .sort({ createdAt: -1 })
    .toArray();
  const toRemove = scheduled.slice(SCHEDULED_RETENTION_COUNT);
  for (const b of toRemove) {
    await deleteBackup(b.name);
  }
  if (toRemove.length) {
    logger.info(`🧹 Pruned ${toRemove.length} scheduled backup(s) beyond retention (${SCHEDULED_RETENTION_COUNT})`);
  }
  return toRemove.length;
}

// Restores a named backup. See file header for the safe-swap approach.
// Returns { success, backupName, preRestoreBackupName, results,
// attempted, totalCollections } — success is only true if every
// collection in the backup was actually restored; a partial failure is
// always reported honestly, never as success.
async function restoreBackup(name) {
  const mongoDb = requireConnectedDb();
  const meta = await getBackupMeta(name);
  if (!meta) {
    const err = new Error(`Backup not found: ${name}`);
    err.code = "NOT_FOUND";
    throw err;
  }

  // Safety net: snapshot current state before touching anything, same
  // as the old file-based restore's "back up current state before
  // overwriting" step.
  const preRestore = await createBackup({ kind: "pre-restore" });

  const results = [];
  let stoppedEarly = false;

  for (const c of meta.collections) {
    const tmpName = tmpRestoreCollectionName(c.name);
    try {
      const sourceName = backupCollectionName(name, c.name);
      const copied = await copyCollection(mongoDb, sourceName, tmpName);
      if (copied !== c.docCount) {
        throw new Error(`Copied ${copied} documents, expected ${c.docCount}`);
      }
      await applyIndexes(mongoDb, tmpName, c.indexes);

      // Atomic: replaces the live collection with the restored one in a
      // single operation. The live collection is untouched by anything
      // above this line.
      await mongoDb.collection(tmpName).rename(c.name, { dropTarget: true });

      const finalCount = await mongoDb.collection(c.name).countDocuments();
      if (finalCount !== c.docCount) {
        throw new Error(`Live collection has ${finalCount} documents after restore, expected ${c.docCount}`);
      }

      results.push({ name: c.name, success: true, docCount: finalCount });
      logger.info(`✅ Restored collection ${c.name}: ${finalCount} documents`);
    } catch (error) {
      logger.error(`❌ Restore failed for collection ${c.name}: ${error.message}`);
      results.push({ name: c.name, success: false, error: error.message });
      // Best-effort cleanup so a failed attempt doesn't leave an orphaned
      // staging collection behind.
      await mongoDb.collection(tmpName).drop().catch(() => {});
      stoppedEarly = true;
      break;
    }
  }

  const restoredNames = results.filter((r) => r.success).map((r) => r.name);
  if (restoredNames.length) {
    // Makes the restore visible immediately — no "restart the server"
    // required (the old file-based restore's response literally said
    // that; it no longer applies).
    await db.reloadCollections(restoredNames);
  }

  const allSucceeded =
    !stoppedEarly && results.length === meta.collections.length && results.every((r) => r.success);

  return {
    success: allSucceeded,
    backupName: name,
    preRestoreBackupName: preRestore.name,
    results,
    attempted: results.length,
    totalCollections: meta.collections.length,
  };
}

module.exports = {
  createBackup,
  listBackups,
  getBackupMeta,
  deleteBackup,
  restoreBackup,
  pruneScheduledBackups,
  // Exported for tests / diagnostics, not meant for other app code to
  // depend on.
  backupCollectionName,
  makeBackupName,
};
