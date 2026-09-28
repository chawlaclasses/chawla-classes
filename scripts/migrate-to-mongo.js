/**
 * scripts/migrate-to-mongo.js
 *
 * One-off migration: reads the existing flat-file JSON "database"
 * (Data/*.json, or — if that doesn't exist — the most recent backup
 * snapshot under backups/) and imports every collection into MongoDB at
 * MONGODB_URI, so the app (now backed by services/jsonDb.js's
 * MongoDB-backed adapter) has real data to serve.
 *
 * Safe to re-run: by default it SKIPS any collection that already has
 * documents in MongoDB (so you can't accidentally double-import). Pass
 * --force to wipe and re-import a collection anyway.
 *
 * Usage:
 *   node scripts/migrate-to-mongo.js
 *   node scripts/migrate-to-mongo.js --from ./backups/backup-2026-07-03T19-53-10-495Z
 *   node scripts/migrate-to-mongo.js --force
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const fromFlagIndex = args.indexOf('--from');
const explicitSource = fromFlagIndex !== -1 ? args[fromFlagIndex + 1] : null;

function resolveSourceDir() {
  if (explicitSource) return path.resolve(explicitSource);

  const dataDir = path.join(ROOT_DIR, 'Data');
  if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).some(f => f.endsWith('.json'))) {
    return dataDir;
  }

  // Fall back to the most recent backups/backup-*/ snapshot.
  const backupsDir = path.join(ROOT_DIR, 'backups');
  if (fs.existsSync(backupsDir)) {
    const snapshots = fs.readdirSync(backupsDir)
      .filter(name => name.startsWith('backup-'))
      .sort() // ISO timestamps in the folder name sort chronologically
      .reverse();
    if (snapshots.length) return path.join(backupsDir, snapshots[0]);
  }

  return null;
}

// Some seed/backup documents (see backups/*/users.json) only carry a
// self-assigned `id` field and no `_id` at all. If we let MongoDB
// auto-generate an ObjectId `_id` for those, the app's in-memory _id index
// (services/jsonDb.js#_buildIndex) — and every updateById/deleteById call
// site that matches by `_id` OR `id` — would silently stop finding them by
// their existing `id`. Using the doc's own `id` as its Mongo `_id` when
// present keeps `_id` a predictable string everywhere, exactly like every
// document insertOne()/insertMany() creates going forward.
function normalizeDoc(doc) {
  if (doc._id !== undefined) return doc;
  if (doc.id !== undefined) return { _id: doc.id, ...doc };
  return doc;
}

async function migrate() {
  const sourceDir = resolveSourceDir();
  if (!sourceDir) {
    console.log('ℹ️  No Data/*.json directory and no backups/backup-*/ snapshot found — nothing to migrate.');
    console.log('   (This is expected on a fresh install; the app will just start with empty collections.)');
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not set. See .env.example.');
    process.exitCode = 1;
    return;
  }

  const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.json') && f !== 'metadata.json');
  if (!files.length) {
    console.log(`ℹ️  No .json collection files found in ${sourceDir} — nothing to migrate.`);
    return;
  }

  console.log(`📦 Migrating from ${sourceDir}`);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || undefined);

  try {
    for (const file of files) {
      const collectionName = path.basename(file, '.json');
      const raw = fs.readFileSync(path.join(sourceDir, file), 'utf8');

      let docs;
      try {
        docs = JSON.parse(raw);
      } catch (err) {
        console.error(`   ⚠️  Skipping ${file} — not valid JSON (${err.message})`);
        continue;
      }
      if (!Array.isArray(docs)) {
        console.error(`   ⚠️  Skipping ${file} — expected an array of documents, got ${typeof docs}`);
        continue;
      }
      if (!docs.length) {
        console.log(`   ⏭️  ${collectionName}: 0 records in source, skipping`);
        continue;
      }

      const coll = db.collection(collectionName);
      const existingCount = await coll.countDocuments({});
      if (existingCount > 0 && !FORCE) {
        console.log(`   ⏭️  ${collectionName}: already has ${existingCount} document(s) in MongoDB, skipping (use --force to overwrite)`);
        continue;
      }

      if (existingCount > 0 && FORCE) {
        await coll.deleteMany({});
      }

      const normalized = docs.map(normalizeDoc);
      await coll.insertMany(normalized, { ordered: true });
      console.log(`   ✅ ${collectionName}: imported ${normalized.length} record(s)`);
    }
  } finally {
    await client.close();
  }

  console.log('🎉 Migration complete.');
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exitCode = 1;
});
