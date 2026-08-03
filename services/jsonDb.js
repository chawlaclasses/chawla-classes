const fs = require('fs');
const path = require('path');
// FIX (code quality audit): jsonDb.js was the one file in the project still
// using raw console.log/console.error instead of the shared winston logger
// every other service uses — switching so its output goes through the same
// log levels/transports/log file as the rest of the app.
const logger = require('../utils/logger');
const { generateUUID } = require('../utils/helpers');

class JsonDB {
  constructor() {
    // FIX: was '../data' (lowercase) — the real seeded database lives in
    // '../Data' (capital D). See config/index.js for the full explanation;
    // this hardcoded path needs the same fix since it doesn't read DATA_DIR
    // from config at all.
    this.dataDir = path.join(__dirname, '../Data');
    this.collections = {};
    // PERF: id -> document index per collection, keyed by `_id`, so
    // findById() (called on ~every authenticated request via
    // middleware/apiAuth.js) is an O(1) Map lookup instead of an O(n) array
    // scan. Rebuilt on load, kept in sync incrementally on every
    // insert/update/delete below. Purely additive — does not change what
    // any method returns, only how fast it finds it.
    this._idIndex = {};
    // PERF: per-collection queue of pending async writes, so saveCollection()
    // no longer blocks the event loop with a synchronous fs.writeFileSync of
    // the entire collection on every single insert/update/delete. Writes to
    // the same collection are still applied strictly in call order (chained
    // promises), so on-disk state never goes out of order; writes to
    // *different* collections proceed independently/in parallel.
    this._saveQueue = {};
    this.ensureDataDirectory();
    this.loadAllCollections();
  }

  _buildIndex(collectionName) {
    const map = new Map();
    for (const doc of this.collections[collectionName] || []) {
      if (doc && doc._id !== undefined) map.set(doc._id, doc);
    }
    this._idIndex[collectionName] = map;
  }

  ensureDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info('📁 Created data directory');
    }
  }

  loadAllCollections() {
    const files = fs.readdirSync(this.dataDir);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const collectionName = path.basename(file, '.json');
        const filePath = path.join(this.dataDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          this.collections[collectionName] = data;
          this._buildIndex(collectionName);
          logger.info(`✅ Loaded ${collectionName}: ${data.length} records`);
        } catch (error) {
          logger.error(`❌ Error loading ${file}: ${error.message}`);
          this.collections[collectionName] = [];
          this._buildIndex(collectionName);
          this.saveCollection(collectionName);
        }
      }
    });
  }

  // PERF: previously fs.writeFileSync'd the WHOLE collection on every call,
  // synchronously, on the request-handling thread — meaning e.g. saving one
  // updated question blocked every other in-flight request (auth, results,
  // dashboards, everything) until the entire questions.json file finished
  // writing to disk. Now: the JSON payload is still serialized synchronously
  // right here (so it captures the exact in-memory state at call time, same
  // as before), but the actual disk write happens async and is queued behind
  // any earlier still-in-flight write for the *same* collection, so writes
  // to one collection can never land out of order or interleave/corrupt each
  // other. Writes to different collections still run concurrently. Callers
  // never read this collection back from disk (they always read
  // this.collections in memory), so none of them can observe the write
  // still being in flight — behaviorally identical, just non-blocking.
  saveCollection(collectionName) {
    const filePath = path.join(this.dataDir, `${collectionName}.json`);
    const payload = JSON.stringify(this.collections[collectionName] || [], null, 2);
    const previous = this._saveQueue[collectionName] || Promise.resolve();
    const next = previous
      .catch(() => {}) // a prior failed write must not permanently jam this collection's queue
      .then(() => this._writeFileAtomic(filePath, payload))
      .catch(error => {
        logger.error(`❌ Error saving ${collectionName}: ${error.message}`);
      });
    this._saveQueue[collectionName] = next;
    return true;
  }

  // Write to a temp file then rename, so a crash/restart mid-write can never
  // leave a collection file half-written/corrupted — the rename is atomic,
  // so the file on disk is always either the old complete version or the
  // new complete version, never a partial one.
  async _writeFileAtomic(filePath, payload) {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmpPath, payload, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  }

  generateId() {
    // FIX (audit): was Date.now().toString(36) + Math.random().toString(36) —
    // not collision-resistant and inconsistent with the rest of the app,
    // which already depends on the uuid package and utils/helpers.js's own
    // crypto-based generateUUID(). Verified no code anywhere parses/expects
    // this ID's old format (length, base36 pattern, etc.), so this is a safe
    // drop-in swap.
    return generateUUID();
  }

  // Find with query
  // FIX: services/*.js (notifications, bookmarks, ai, practice) call this
  // with a 3rd options argument like { sort: 'createdAt:desc', limit: 10 }
  // expecting it to actually sort/paginate — previously this parameter
  // didn't exist at all and was silently dropped. Still returns a plain
  // array (not {data: [...]}) so every existing caller elsewhere in the
  // app that already treats the result as an array keeps working.
  find(collectionName, query = {}, options = {}) {
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
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
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
    const collection = this.collections[collectionName];
    return collection.find(doc => this.matchesQuery(doc, query)) || null;
  }

  // Find by ID
  // PERF: was a full array scan (collection.find(...)) on every call — this
  // is the method middleware/apiAuth.js calls to look up the logged-in user
  // on essentially every authenticated request, so it's the single hottest
  // read path in the app. Now an O(1) Map lookup. Same return value
  // (`doc` or `null`) as before.
  findById(collectionName, id) {
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
    if (!this._idIndex[collectionName]) this._buildIndex(collectionName);
    return this._idIndex[collectionName].get(id) || null;
  }

  // FIX: `insert()` was called from 8 places across services/ (notifications,
  // practice, bookmarks, gamification) but was never defined on this class —
  // only insertOne/insertMany existed. Every call to db.insert(...) was
  // throwing "db.insert is not a function" at runtime, breaking
  // notification/bookmark/achievement/practice-session creation. Adding it
  // as a plain alias for insertOne (same behavior those call-sites expect).
  insert(collectionName, data) {
    return this.insertOne(collectionName, data);
  }

  // Insert one
  insertOne(collectionName, data) {
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
    const collection = this.collections[collectionName];
    const newDoc = {
      _id: this.generateId(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    collection.push(newDoc);
    if (!this._idIndex[collectionName]) this._buildIndex(collectionName);
    this._idIndex[collectionName].set(newDoc._id, newDoc);
    this.saveCollection(collectionName);
    return newDoc;
  }

  // Insert many
  insertMany(collectionName, dataArray) {
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
    const collection = this.collections[collectionName];
    const newDocs = dataArray.map(data => ({
      _id: this.generateId(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    collection.push(...newDocs);
    if (!this._idIndex[collectionName]) this._buildIndex(collectionName);
    for (const doc of newDocs) this._idIndex[collectionName].set(doc._id, doc);
    this.saveCollection(collectionName);
    return newDocs;
  }

  // FIX: `findAll`, `updateById`, and `deleteById` were called from many
  // active, mounted routes (routes/students.js, routes/results.js,
  // routes/questions.js, routes/notes.js, routes/pdf.js) and from the
  // notifications/bookmarks/practice/gamification services, but none of
  // these three methods were ever defined on this class — only find,
  // insertOne, updateOne, findByIdAndUpdate, deleteOne, and
  // findByIdAndDelete existed. Every call was throwing
  // "db.<method> is not a function" at runtime.
  //
  // Note: some collections key their documents by the auto-generated `_id`
  // (e.g. students, users — via insertOne with no custom id), while others
  // self-assign a uuid into an `id` field (e.g. notifications, bookmarks,
  // practice_sessions). updateById/deleteById match on whichever field
  // the record actually has, and only when a real id was passed in — the
  // `id === undefined` guard stops a bug elsewhere (someone accidentally
  // passing `doc.id` on a collection that only has `_id`) from silently
  // matching the wrong document.
  findAll(collectionName, query = {}) {
    return this.find(collectionName, query);
  }

  updateById(collectionName, id, update, options = {}) {
    if (id === undefined || id === null) return null;
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
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
    this.saveCollection(collectionName);
    return options.new !== false ? updatedDoc : collection[index];
  }

  deleteById(collectionName, id) {
    if (id === undefined || id === null) return { deletedCount: 0 };
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
    const collection = this.collections[collectionName];
    const index = collection.findIndex(doc => doc._id === id || doc.id === id);
    if (index === -1) return { deletedCount: 0 };

    const [removed] = collection.splice(index, 1);
    if (removed && removed._id !== undefined) this._idIndex[collectionName]?.delete(removed._id);
    this.saveCollection(collectionName);
    return { deletedCount: 1 };
  }

  // Update one
  updateOne(collectionName, filter, update) {
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
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
    this.saveCollection(collectionName);
    return updatedDoc;
  }

  // Update by ID
  findByIdAndUpdate(collectionName, id, update, options = {}) {
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
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
    this.saveCollection(collectionName);
    return options.new !== false ? updatedDoc : collection[index];
  }

  // Delete one
  deleteOne(collectionName, filter) {
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
    const collection = this.collections[collectionName];
    const index = collection.findIndex(doc => this.matchesQuery(doc, filter));
    if (index === -1) return { deletedCount: 0 };
    
    const [removed] = collection.splice(index, 1);
    if (removed && removed._id !== undefined) this._idIndex[collectionName]?.delete(removed._id);
    this.saveCollection(collectionName);
    return { deletedCount: 1 };
  }

  // Delete by ID
  findByIdAndDelete(collectionName, id) {
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
    const collection = this.collections[collectionName];
    const index = collection.findIndex(doc => doc._id === id);
    if (index === -1) return null;
    
    const deletedDoc = collection[index];
    collection.splice(index, 1);
    if (deletedDoc && deletedDoc._id !== undefined) this._idIndex[collectionName]?.delete(deletedDoc._id);
    this.saveCollection(collectionName);
    return deletedDoc;
  }

  // Count documents
  countDocuments(collectionName, query = {}) {
    if (!this.collections[collectionName]) this.collections[collectionName] = [];
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