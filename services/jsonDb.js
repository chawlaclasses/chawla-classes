const { MongoClient } = require('mongodb');
const logger = require('../utils/logger');
const { generateUUID } = require('../utils/helpers');

// ============================================================================
// MIGRATION NOTE (jsonDb -> MongoDB)
// ============================================================================
// This file used to read/write Data/*.json on disk directly. It's kept named
// `jsonDb.js` (and still exported as a singleton with the exact same method
// names) on purpose: 76 files across controllers/, routes/, services/,
// middleware/, and scripts/ do `const db = require('./jsonDb')` and then
// call db.find/findOne/findById/insert/updateById/... *synchronously*
// (most call sites don't `await` these calls at all). Rewriting every one
// of those ~700 call sites to be fully async against MongoDB directly would
// have been a much larger, riskier change.
//
// Instead, MongoDB is now the actual persistent store, but this class keeps
// an in-memory mirror of every collection (this.collections) plus the same
// _id -> doc Map index it already had. All READ methods (find, findOne,
// findById, findAll, countDocuments, populate, matchesQuery, getStats) are
// completely unchanged — they still run synchronously against that
// in-memory mirror, so every existing caller keeps working with zero edits.
//
// All WRITE methods (insertOne, insertMany, updateById, updateOne,
// findByIdAndUpdate, deleteById, deleteOne, findByIdAndDelete,
// saveCollection) still apply the change to the in-memory mirror
// immediately (so a read that happens right after a write — even without
// awaiting it — sees the new state, exactly like before), and *also* queue
// the equivalent operation against MongoDB, chained per-collection so
// writes to the same collection can never land out of order (this reuses
// the same _saveQueue pattern the old file-based version used for the same
// reason).
//
// The one real behavior change: connect() is async (has to be — it opens a
// real network connection to MongoDB), so it must be awaited once at boot,
// before the app starts accepting requests. See server.js.
// ============================================================================

class JsonDB {
  constructor() {
    this.collections = {};
    // PERF: id -> document index per collection, keyed by `_id`, so
    // findById() (called on ~every authenticated request via
    // middleware/apiAuth.js) is an O(1) Map lookup instead of an O(n) array
    // scan. Rebuilt on load, kept in sync incrementally on every
    // insert/update/delete below. Unchanged from the jsonDb-file version.
    this._idIndex = {};
    // Per-collection queue of pending async MongoDB writes, so a write
    // never overtakes an earlier still-in-flight write to the *same*
    // collection. Writes to different collections still run concurrently.
    // (Same role _saveQueue played when writes went to Data/*.json.)
    this._saveQueue = {};

    this.client = null;
    this.db = null;
    this._ready = null;

    // FIX (audit 2026-08): connection state was never tracked after the
    // initial connect() — the driver reconnects to a healthy replica-set/
    // Atlas member on its own (that's built into the MongoDB Node driver's
    // connection pool + server monitoring; there was never a missing
    // "reconnect loop" to write), but nothing surfaced whether it currently
    // WAS connected, or logged when it dropped/came back. _connected +
    // the event wiring in _doConnect() below close that visibility gap;
    // see getStatus() and GET /health in app.js.
    this._connected = false;
    // Count of writes currently queued/in-flight against MongoDB (see
    // _queueWrite below) — also exposed via getStatus() / GET /health, and
    // groundwork for graceful shutdown (draining this to 0 before exit).
    this._pendingWrites = 0;
  }

  // Opens the MongoDB connection and hydrates the in-memory cache from it.
  // Must be awaited once at boot (see server.js) before the app starts
  // accepting requests — every read method below assumes this.collections
  // is already populated. Safe to call more than once; subsequent calls
  // just return the same in-flight/completed connection promise.
  connect() {
    if (!this._ready) {
      this._ready = this._doConnect();
    }
    return this._ready;
  }

  async _doConnect() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI is not set. See .env.example.');
    }

    this.client = new MongoClient(uri, {
      // Fail fast instead of hanging silently if the Atlas/hosted URI is
      // wrong or unreachable at boot.
      serverSelectionTimeoutMS: 10000,
    });

    // FIX (audit 2026-08 — Mongo reconnect/status): the driver's own SDAM
    // (Server Discovery and Monitoring) heartbeats already detect a lost
    // connection and re-establish it against a healthy topology member
    // with zero code from us — that part was never actually broken. What
    // was missing was surfacing that as a state anyone could check
    // (getStatus() / GET /health) and logging the transitions instead of
    // failing silently mid-flight. Listeners are attached before connect()
    // so we don't miss a heartbeat failure that happens during the very
    // first connection attempt.
    this.client.on('serverHeartbeatSucceeded', () => {
      if (!this._connected) {
        this._connected = true;
        logger.info('✅ MongoDB connection (re)established');
      }
    });
    this.client.on('serverHeartbeatFailed', (event) => {
      if (this._connected) {
        this._connected = false;
        const reason = event && event.failure ? event.failure.message : 'unknown error';
        logger.error(`❌ MongoDB heartbeat failed — connection lost: ${reason}`);
      }
    });
    this.client.on('close', () => {
      if (this._connected) {
        this._connected = false;
        logger.warn('⚠️  MongoDB client connection closed');
      }
    });

    await this.client.connect();
    this._connected = true;
    this.db = this.client.db(process.env.MONGODB_DB_NAME || undefined);

    await this._loadAllCollections();
    logger.info('✅ Connected to MongoDB and hydrated in-memory cache');
  }

  // Snapshot of connection + write-queue health, consumed by GET /health
  // (app.js). Safe to call before connect() finishes — reports the
  // not-yet-connected state truthfully rather than throwing.
  getStatus() {
    return {
      connected: this._connected === true,
      pendingWrites: this._pendingWrites || 0,
    };
  }

  // NEW (production audit, 2026-08-21): generic, reusable way for a
  // caller (see server.js) to assert a collection's indexes exist at
  // boot. Used for the reviews.email/reviews.phone uniqueness backstop —
  // "one review per identity" previously lived only in application code
  // (routes/reviews.js), safe within a single process but with no guard
  // at all the moment this app ever runs more than one instance.
  // createIndexes() is idempotent (a no-op if an identically-named/
  // specced index already exists), so this is safe to call on every
  // boot. Deliberately does NOT throw: if a unique index fails to build
  // because existing data already violates it, that must not crash
  // server startup — the caller logs the failure and the app keeps
  // running on its existing app-level guard, same as before this
  // existed.
  async ensureIndexes(collectionName, indexSpecs) {
    try {
      await this.db.collection(collectionName).createIndexes(indexSpecs);
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  // FIX (audit 2026-08, issues #1/#2): collections whose name starts with
  // "_" are reserved for this app's own internal bookkeeping (backup
  // snapshots, backup metadata, restore staging — see
  // services/mongoBackup.js) and must never be pulled into the in-memory
  // mirror: (a) nothing in the other ~700 call sites expects them there,
  // and (b) backups accumulate over time, so loading every historical
  // snapshot into RAM on every boot would grow unbounded. Real
  // application collections never start with "_", so this is a safe,
  // simple convention rather than a hardcoded exclusion list.
  _isInternalCollectionName(name) {
    return name.startsWith('_');
  }

  // Names of "real" application collections (excludes this app's own
  // internal backup/restore/meta collections — see
  // _isInternalCollectionName). Used by services/mongoBackup.js so both
  // the in-memory loader and the backup system agree on what counts as
  // "every collection" without duplicating the exclusion rule in two
  // places.
  async listRealCollectionNames() {
    const collInfos = await this.db.listCollections().toArray();
    return collInfos
      .map(c => c.name)
      .filter(name => !this._isInternalCollectionName(name));
  }

  async _loadAllCollections() {
    const collInfos = await this.db.listCollections().toArray();
    for (const { name } of collInfos) {
      if (this._isInternalCollectionName(name)) continue;
      const docs = await this.db.collection(name).find({}).toArray();
      this.collections[name] = docs;
      this._buildIndex(name);
      logger.info(`✅ Loaded ${name}: ${docs.length} records`);
    }
  }

  // Re-hydrates specific collections' in-memory mirror from MongoDB
  // without a full restart. NEW (audit 2026-08, issue #1): a restore used
  // to require "restart the server to load the restored data" — this
  // makes a restore actually take effect immediately. Safe to call at
  // any time; a collection not yet known locally is picked up too (same
  // as _loadAllCollections would on boot).
  async reloadCollections(names) {
    for (const name of names) {
      if (this._isInternalCollectionName(name)) continue;
      const docs = await this.db.collection(name).find({}).toArray();
      this.collections[name] = docs;
      this._buildIndex(name);
      logger.info(`🔄 Reloaded ${name}: ${docs.length} records`);
    }
  }

  // FIX (2026-08-14): previously closed the MongoClient immediately,
  // without waiting for any writes still in flight via _queueWrite. That's
  // invisible in the long-running server process (the connection just
  // stays open until process exit), but every one-off script that follows
  // the documented `db.connect().then(fn).finally(() => db.close())`
  // pattern (scripts/seed-categories.js, seed-marketing-banners.js,
  // create-admin.js, etc.) calls close() right after its work function
  // resolves -- and insertOne/insertMany/updateById/etc. all queue their
  // actual MongoDB write and return before that write has necessarily
  // completed (that's the whole point of _queueWrite: the in-memory
  // mirror is updated synchronously so callers don't have to await it).
  // Closing the client while one of those writes is still in flight fails
  // it with "Cannot use a session that has ended" -- the in-memory state
  // was already correct, but the write never actually reached MongoDB, so
  // the process exits believing it succeeded (seed script prints
  // "Seeded...") while nothing landed in the real database. Draining
  // every collection's queue first (each is a promise chain that already
  // swallows its own errors, per _queueWrite's comment, so this can't
  // reject) closes that gap.
  async close() {
    await Promise.allSettled(Object.values(this._saveQueue));
    if (this.client) await this.client.close();
  }

  _buildIndex(collectionName) {
    const map = new Map();
    for (const doc of this.collections[collectionName] || []) {
      if (doc && doc._id !== undefined) map.set(doc._id, doc);
    }
    this._idIndex[collectionName] = map;
  }

  _ensureCollection(collectionName) {
    if (!this.collections[collectionName]) {
      this.collections[collectionName] = [];
      this._buildIndex(collectionName);
    }
  }

  // Chains `opFn` (a function returning a Mongo Promise) behind any
  // still-in-flight write to the same collection, so writes to one
  // collection can never land out of order/interleave. A prior failed
  // write must not permanently jam the queue for later writes, so errors
  // are swallowed here (and logged) rather than propagated — matches the
  // old fire-and-forget saveCollection() semantics: the in-memory state
  // (already updated by the caller before this is invoked) is the source
  // of truth for the rest of the running process either way.
  _queueWrite(collectionName, opFn) {
    const previous = this._saveQueue[collectionName] || Promise.resolve();
    this._pendingWrites += 1;
    const next = previous
      .catch(() => {})
      .then(opFn)
      .catch(error => {
        logger.error(`❌ Error saving ${collectionName} to MongoDB: ${error.message}`);
      })
      .finally(() => {
        this._pendingWrites = Math.max(0, this._pendingWrites - 1);
      });
    this._saveQueue[collectionName] = next;
    return next;
  }

  // Filter that matches how updateById/deleteById below look a doc up
  // in-memory: by `_id` OR by a self-assigned `id` field, since not every
  // collection's documents use the auto-generated `_id` as their logical
  // key (see updateById for the full explanation).
  _idOrIdFilter(id) {
    return { $or: [{ _id: id }, { id }] };
  }

  // Full resync of one collection from the in-memory mirror to MongoDB.
  // Kept for the handful of call sites (e.g.
  // routes/admin/question-bank.js bulk-edit/bulk-delete) that mutate
  // db.collections[name] directly and then call this instead of going
  // through insert/update/delete — same role it played when this wrote
  // the whole Data/<name>.json file in one shot.
  //
  // FIX (audit 2026-08, issue #2): the deleteMany-then-insertMany below
  // used to run as two independent operations. If the process crashed or
  // lost its Mongo connection between them, the collection was left
  // empty on MongoDB (the in-memory mirror is unaffected either way,
  // since it was already updated by the caller before this runs — see
  // _queueWrite's comment — but the next boot's _loadAllCollections()
  // would hydrate from that now-empty Mongo collection and silently lose
  // every document in it). Both operations now run inside a single
  // MongoDB session/transaction: either both apply or neither does. Note
  // this requires MongoDB to be a replica set (Atlas always is; a bare
  // standalone local mongod is not — transactions error clearly in that
  // case rather than silently behaving non-atomically, which is the
  // correct failure mode here). Kept inside the existing _queueWrite
  // chain unchanged — still fire-and-forget from the caller's
  // perspective, still ordered per-collection, still logs (not throws)
  // on failure, exactly like every other write method here.
  saveCollection(collectionName) {
    this._ensureCollection(collectionName);
    const snapshot = this.collections[collectionName].map(doc => ({ ...doc }));
    this._queueWrite(collectionName, async () => {
      const coll = this.db.collection(collectionName);
      const session = this.client.startSession();
      try {
        await session.withTransaction(async () => {
          await coll.deleteMany({}, { session });
          if (snapshot.length) await coll.insertMany(snapshot, { ordered: true, session });
        });
      } finally {
        await session.endSession();
      }
    });
    return true;
  }

  generateId() {
    return generateUUID();
  }

  // Find with query
  find(collectionName, query = {}, options = {}) {
    this._ensureCollection(collectionName);
    const collection = this.collections[collectionName];
    let results = collection.filter(doc => this.matchesQuery(doc, query));

    if (options.sort) {
      const [field, dir] = options.sort.split(':');
      const direction = dir === 'desc' ? -1 : 1;
      results = results.slice().sort((a, b) => {
        if (a[field] < b[field]) return -1 * direction;
        if (a[field] > b[field]) return 1 * direction;
        return 0;
      });
    }

    if (options.page && options.limit) {
      const start = (options.page - 1) * options.limit;
      results = results.slice(start, start + options.limit);
    } else if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  // Find one
  findOne(collectionName, query = {}) {
    this._ensureCollection(collectionName);
    const collection = this.collections[collectionName];
    return collection.find(doc => this.matchesQuery(doc, query)) || null;
  }

  // Find by ID — O(1) Map lookup via the in-memory index.
  findById(collectionName, id) {
    this._ensureCollection(collectionName);
    if (!this._idIndex[collectionName]) this._buildIndex(collectionName);
    return this._idIndex[collectionName].get(id) || null;
  }

  // Alias for insertOne — some services (notifications, practice,
  // bookmarks, gamification) call db.insert(...) directly.
  insert(collectionName, data) {
    return this.insertOne(collectionName, data);
  }

  // Insert one
  insertOne(collectionName, data) {
    this._ensureCollection(collectionName);
    const newDoc = {
      _id: this.generateId(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.collections[collectionName].push(newDoc);
    this._idIndex[collectionName].set(newDoc._id, newDoc);
    this._queueWrite(collectionName, () =>
      this.db.collection(collectionName).insertOne({ ...newDoc })
    );
    return newDoc;
  }

  // Insert many
  insertMany(collectionName, dataArray) {
    this._ensureCollection(collectionName);
    const newDocs = dataArray.map(data => ({
      _id: this.generateId(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    this.collections[collectionName].push(...newDocs);
    for (const doc of newDocs) this._idIndex[collectionName].set(doc._id, doc);
    this._queueWrite(collectionName, () =>
      newDocs.length
        ? this.db.collection(collectionName).insertMany(newDocs.map(d => ({ ...d })), { ordered: true })
        : Promise.resolve()
    );
    return newDocs;
  }

  findAll(collectionName, query = {}) {
    return this.find(collectionName, query);
  }

  // Note: some collections key their documents by the auto-generated `_id`
  // (e.g. students, users — via insertOne with no custom id), while others
  // self-assign a uuid into an `id` field (e.g. notifications, bookmarks,
  // practice_sessions). updateById/deleteById match on whichever field
  // the record actually has, and only when a real id was passed in — the
  // `id === undefined` guard stops a bug elsewhere (someone accidentally
  // passing `doc.id` on a collection that only has `_id`) from silently
  // matching the wrong document.
  updateById(collectionName, id, update, options = {}) {
    if (id === undefined || id === null) return null;
    this._ensureCollection(collectionName);
    const collection = this.collections[collectionName];
    const index = collection.findIndex(doc => doc._id === id || doc.id === id);
    if (index === -1) return null;

    const updatedDoc = {
      ...collection[index],
      ...update,
      updatedAt: new Date().toISOString()
    };
    collection[index] = updatedDoc;
    if (updatedDoc._id !== undefined) {
      if (!this._idIndex[collectionName]) this._buildIndex(collectionName);
      this._idIndex[collectionName].set(updatedDoc._id, updatedDoc);
    }
    this._queueWrite(collectionName, () =>
      this.db.collection(collectionName).replaceOne(this._idOrIdFilter(id), { ...updatedDoc }, { upsert: true })
    );
    return options.new !== false ? updatedDoc : collection[index];
  }

  deleteById(collectionName, id) {
    if (id === undefined || id === null) return { deletedCount: 0 };
    this._ensureCollection(collectionName);
    const collection = this.collections[collectionName];
    const index = collection.findIndex(doc => doc._id === id || doc.id === id);
    if (index === -1) return { deletedCount: 0 };

    const [removed] = collection.splice(index, 1);
    if (removed && removed._id !== undefined) this._idIndex[collectionName]?.delete(removed._id);
    this._queueWrite(collectionName, () =>
      this.db.collection(collectionName).deleteOne(this._idOrIdFilter(id))
    );
    return { deletedCount: 1 };
  }

  // Update one
  updateOne(collectionName, filter, update) {
    this._ensureCollection(collectionName);
    const collection = this.collections[collectionName];
    const index = collection.findIndex(doc => this.matchesQuery(doc, filter));
    if (index === -1) return null;

    const updatedDoc = {
      ...collection[index],
      ...update,
      updatedAt: new Date().toISOString()
    };
    collection[index] = updatedDoc;
    if (updatedDoc._id !== undefined) {
      if (!this._idIndex[collectionName]) this._buildIndex(collectionName);
      this._idIndex[collectionName].set(updatedDoc._id, updatedDoc);
    }
    const mongoFilter = updatedDoc._id !== undefined
      ? { _id: updatedDoc._id }
      : filter;
    this._queueWrite(collectionName, () =>
      this.db.collection(collectionName).replaceOne(mongoFilter, { ...updatedDoc }, { upsert: true })
    );
    return updatedDoc;
  }

  // Update by ID (matches only `_id`, unlike updateById above)
  findByIdAndUpdate(collectionName, id, update, options = {}) {
    this._ensureCollection(collectionName);
    const collection = this.collections[collectionName];
    const index = collection.findIndex(doc => doc._id === id);
    if (index === -1) return null;

    const updatedDoc = {
      ...collection[index],
      ...update,
      updatedAt: new Date().toISOString()
    };
    collection[index] = updatedDoc;
    if (updatedDoc._id !== undefined) {
      if (!this._idIndex[collectionName]) this._buildIndex(collectionName);
      this._idIndex[collectionName].set(updatedDoc._id, updatedDoc);
    }
    this._queueWrite(collectionName, () =>
      this.db.collection(collectionName).replaceOne({ _id: id }, { ...updatedDoc }, { upsert: true })
    );
    return options.new !== false ? updatedDoc : collection[index];
  }

  // Delete one
  deleteOne(collectionName, filter) {
    this._ensureCollection(collectionName);
    const collection = this.collections[collectionName];
    const index = collection.findIndex(doc => this.matchesQuery(doc, filter));
    if (index === -1) return { deletedCount: 0 };

    const [removed] = collection.splice(index, 1);
    if (removed && removed._id !== undefined) this._idIndex[collectionName]?.delete(removed._id);
    const mongoFilter = removed && removed._id !== undefined ? { _id: removed._id } : filter;
    this._queueWrite(collectionName, () =>
      this.db.collection(collectionName).deleteOne(mongoFilter)
    );
    return { deletedCount: 1 };
  }

  // Alias for deleteOne — controllers/authController.js calls db.delete(...)
  // directly (this method never existed on the old jsonDb.js either; adding
  // it here since it's a one-line fix and otherwise that call site throws).
  delete(collectionName, filter) {
    return this.deleteOne(collectionName, filter);
  }

  // Delete by ID (matches only `_id`, unlike deleteById above)
  findByIdAndDelete(collectionName, id) {
    this._ensureCollection(collectionName);
    const collection = this.collections[collectionName];
    const index = collection.findIndex(doc => doc._id === id);
    if (index === -1) return null;

    const deletedDoc = collection[index];
    collection.splice(index, 1);
    if (deletedDoc && deletedDoc._id !== undefined) this._idIndex[collectionName]?.delete(deletedDoc._id);
    this._queueWrite(collectionName, () =>
      this.db.collection(collectionName).deleteOne({ _id: id })
    );
    return deletedDoc;
  }

  // Count documents
  countDocuments(collectionName, query = {}) {
    this._ensureCollection(collectionName);
    const collection = this.collections[collectionName];
    if (Object.keys(query).length === 0) return collection.length;
    return this.find(collectionName, query).length;
  }

  // Populate
  populate(doc, field, refCollection, select = null) {
    if (!doc) return null;
    const refId = doc[field];
    if (!refId) return doc;

    let referenced = this.findById(refCollection, refId);
    if (select && referenced) {
      const selected = {};
      select.split(' ').forEach(f => {
        if (referenced[f] !== undefined) selected[f] = referenced[f];
      });
      referenced = selected;
    }
    return {
      ...doc,
      [field]: referenced
    };
  }

  matchesQuery(doc, query) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [op, opValue] of Object.entries(value)) {
          if (op === '$in') {
            if (!opValue.includes(doc[key])) return false;
          } else if (op === '$gt') {
            if (doc[key] <= opValue) return false;
          } else if (op === '$gte') {
            if (doc[key] < opValue) return false;
          } else if (op === '$lt') {
            if (doc[key] >= opValue) return false;
          } else if (op === '$lte') {
            if (doc[key] > opValue) return false;
          } else if (op === '$ne') {
            if (doc[key] === opValue) return false;
          } else if (op === '$regex') {
            if (!new RegExp(opValue, 'i').test(doc[key])) return false;
          }
        }
      } else if (doc[key] !== value) {
        return false;
      }
    }
    return true;
  }

  getStats() {
    const stats = {};
    for (const [name, collection] of Object.entries(this.collections)) {
      stats[name] = {
        total: collection.length,
        active: collection.filter(doc => doc.isActive !== false).length,
        deleted: collection.filter(doc => doc.isDeleted === true).length
      };
    }
    return stats;
  }
}

module.exports = new JsonDB();