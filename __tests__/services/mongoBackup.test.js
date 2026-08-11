/**
 * Tests for services/mongoBackup.js.
 *
 * services/jsonDb is auto-mocked (its own tests already cover its real
 * MongoDB driver behavior — see jsonDb-status.test.js). What's mocked
 * here is jsonDb's `.db` property, replaced with a small in-memory fake
 * that implements just the Collection API surface mongoBackup.js
 * actually calls (find/insertMany/insertOne/findOne/deleteOne/
 * countDocuments/drop/rename/listIndexes/createIndexes), each behaving
 * the way the real MongoDB driver documents it. This is deliberately a
 * fake with real semantics rather than jest.fn() call-assertions — it
 * lets these tests check the actual END STATE after a restore (does the
 * live collection really contain exactly the backed-up documents?),
 * not just "was insertMany called". See PHASE_2_REPORT.md for what this
 * still can't prove (renameCollection's atomicity on a real server,
 * exact ObjectId type preservation through the real driver).
 */

'use strict';

jest.mock('../../services/jsonDb');

const db = require('../../services/jsonDb');

function makeCursor(initialDocs) {
  let docs = initialDocs.slice();
  let idx = 0;
  return {
    sort(spec) {
      const [field, dir] = Object.entries(spec)[0];
      docs = docs.slice().sort((a, b) => {
        if (a[field] < b[field]) return -1 * dir;
        if (a[field] > b[field]) return 1 * dir;
        return 0;
      });
      return this;
    },
    async toArray() {
      return docs.slice(idx);
    },
    async hasNext() {
      return idx < docs.length;
    },
    async next() {
      return docs[idx++];
    },
  };
}

class FakeMongoDb {
  constructor() {
    this.store = new Map();
    this.indexes = new Map();
  }

  _docs(name) {
    if (!this.store.has(name)) this.store.set(name, []);
    return this.store.get(name);
  }

  collection(name) {
    const self = this;
    return {
      find(query = {}) {
        const docs = self
          ._docs(name)
          .filter((d) => Object.entries(query).every(([k, v]) => d[k] === v));
        return makeCursor(docs.map((d) => ({ ...d })));
      },
      async insertMany(docs) {
        if (self._insertManyShouldThrow && self._insertManyShouldThrow(name)) {
          throw new Error(`simulated insertMany failure for ${name}`);
        }
        self._docs(name).push(...docs.map((d) => ({ ...d })));
        return { insertedCount: docs.length };
      },
      async insertOne(doc) {
        self._docs(name).push({ ...doc });
        return { insertedId: doc._id };
      },
      async findOne(query = {}) {
        const found = self
          ._docs(name)
          .find((d) => Object.entries(query).every(([k, v]) => d[k] === v));
        return found ? { ...found } : null;
      },
      async deleteOne(query = {}) {
        const arr = self._docs(name);
        const i = arr.findIndex((d) => Object.entries(query).every(([k, v]) => d[k] === v));
        if (i >= 0) arr.splice(i, 1);
        return { deletedCount: i >= 0 ? 1 : 0 };
      },
      async countDocuments() {
        return self._docs(name).length;
      },
      async drop() {
        if (!self.store.has(name)) {
          throw new Error('ns not found');
        }
        self.store.delete(name);
        self.indexes.delete(name);
        return true;
      },
      async rename(newName, opts = {}) {
        if (self.store.has(newName)) {
          if (!opts.dropTarget) throw new Error('target namespace exists');
          self.store.delete(newName);
        }
        self.store.set(newName, self.store.get(name) || []);
        self.store.delete(name);
        self.indexes.set(newName, self.indexes.get(name) || []);
        self.indexes.delete(name);
        return { ok: 1 };
      },
      listIndexes() {
        const idx = [{ key: { _id: 1 }, name: '_id_' }, ...(self.indexes.get(name) || [])];
        return { toArray: async () => idx };
      },
      async createIndexes(specs) {
        const existing = self.indexes.get(name) || [];
        self.indexes.set(name, [...existing, ...specs]);
        return specs.map((s) => s.name);
      },
    };
  }
}

function loadMongoBackupWithFreshEnv(envOverrides = {}) {
  let mod;
  jest.isolateModules(() => {
    const prev = { ...process.env };
    Object.assign(process.env, envOverrides);
    mod = require('../../services/mongoBackup');
    process.env = prev;
  });
  return mod;
}

describe('services/mongoBackup.js', () => {
  let fakeMongoDb;
  let mongoBackup;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeMongoDb = new FakeMongoDb();
    db.db = fakeMongoDb;
    db.reloadCollections = jest.fn().mockResolvedValue(undefined);
    mongoBackup = loadMongoBackupWithFreshEnv();
  });

  test('createBackup snapshots every real collection and records metadata', async () => {
    fakeMongoDb.store.set('students', [{ _id: 's1', name: 'Amit' }, { _id: 's2', name: 'Priya' }]);
    fakeMongoDb.store.set('questions', [{ _id: 'q1', text: '2+2?' }]);
    db.listRealCollectionNames = jest.fn().mockResolvedValue(['students', 'questions']);

    const backup = await mongoBackup.createBackup({ kind: 'manual' });

    expect(backup.totalDocs).toBe(3);
    expect(backup.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'students', docCount: 2 }),
        expect.objectContaining({ name: 'questions', docCount: 1 }),
      ])
    );

    const snapshotDocs = fakeMongoDb.store.get(mongoBackup.backupCollectionName(backup.name, 'students'));
    expect(snapshotDocs).toEqual([{ _id: 's1', name: 'Amit' }, { _id: 's2', name: 'Priya' }]);

    const metaDocs = fakeMongoDb.store.get('_backupMeta');
    expect(metaDocs).toHaveLength(1);
    expect(metaDocs[0].name).toBe(backup.name);
  });

  test('createBackup captures non-default indexes for later restore', async () => {
    fakeMongoDb.store.set('students', [{ _id: 's1' }]);
    fakeMongoDb.indexes.set('students', [{ key: { email: 1 }, name: 'email_1', unique: true }]);
    db.listRealCollectionNames = jest.fn().mockResolvedValue(['students']);

    const backup = await mongoBackup.createBackup({ kind: 'manual' });

    const studentsMeta = backup.collections.find((c) => c.name === 'students');
    expect(studentsMeta.indexes).toEqual([{ key: { email: 1 }, name: 'email_1', unique: true, sparse: false }]);
  });

  test('listBackups returns backups newest first', async () => {
    db.listRealCollectionNames = jest.fn().mockResolvedValue([]);
    const b1 = await mongoBackup.createBackup({ kind: 'manual' });
    await new Promise((r) => setTimeout(r, 5));
    const b2 = await mongoBackup.createBackup({ kind: 'manual' });

    const list = await mongoBackup.listBackups();
    expect(list.map((b) => b.name)).toEqual([b2.name, b1.name]);
  });

  test('restoreBackup replaces live collections with the backup content, preserving document identity', async () => {
    const objectIdLike = { toString: () => 'fake-object-id-abc' }; // stand-in for a real ObjectId
    fakeMongoDb.store.set('students', [{ _id: objectIdLike, name: 'Original' }]);
    db.listRealCollectionNames = jest.fn().mockResolvedValue(['students']);
    const backup = await mongoBackup.createBackup({ kind: 'manual' });

    // Live data changes after the backup was taken — restore should undo this.
    fakeMongoDb.store.set('students', [{ _id: 'new1', name: 'Someone else entirely' }]);

    const result = await mongoBackup.restoreBackup(backup.name);

    expect(result.success).toBe(true);
    expect(result.results).toEqual([{ name: 'students', success: true, docCount: 1 }]);
    const live = fakeMongoDb.store.get('students');
    expect(live).toHaveLength(1);
    expect(live[0].name).toBe('Original');
    expect(live[0]._id).toBe(objectIdLike); // same identity, not a stringified copy
    expect(db.reloadCollections).toHaveBeenCalledWith(['students']);
  });

  test('restoreBackup creates a pre-restore safety-net backup automatically', async () => {
    fakeMongoDb.store.set('students', [{ _id: 's1' }]);
    db.listRealCollectionNames = jest.fn().mockResolvedValue(['students']);
    const backup = await mongoBackup.createBackup({ kind: 'manual' });

    const result = await mongoBackup.restoreBackup(backup.name);

    expect(result.preRestoreBackupName).toMatch(/^pre-restore-/);
    const preRestoreMeta = await mongoBackup.getBackupMeta(result.preRestoreBackupName);
    expect(preRestoreMeta).not.toBeNull();
    expect(preRestoreMeta.kind).toBe('pre-restore');
  });

  test('restoreBackup on an unknown name throws a NOT_FOUND error and touches nothing', async () => {
    fakeMongoDb.store.set('students', [{ _id: 's1', name: 'Untouched' }]);

    await expect(mongoBackup.restoreBackup('backup-does-not-exist')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fakeMongoDb.store.get('students')).toEqual([{ _id: 's1', name: 'Untouched' }]);
  });

  test('restoreBackup stops at the first failing collection and never reports success', async () => {
    fakeMongoDb.store.set('students', [{ _id: 's1' }]);
    fakeMongoDb.store.set('questions', [{ _id: 'q1' }]);
    db.listRealCollectionNames = jest.fn().mockResolvedValue(['students', 'questions']);
    const backup = await mongoBackup.createBackup({ kind: 'manual' });

    // Live data changes, so we can tell afterward whether "questions" got left alone.
    fakeMongoDb.store.set('questions', [{ _id: 'q1', text: 'still the live version' }]);

    // Fail specifically when restoring into questions' temp collection.
    fakeMongoDb._insertManyShouldThrow = (name) => name.includes('_restore_tmp__') && name.includes('__questions');

    const result = await mongoBackup.restoreBackup(backup.name);

    expect(result.success).toBe(false);
    expect(result.results.find((r) => r.name === 'questions')).toMatchObject({ success: false });
    // "questions" live data was never touched since its swap never happened.
    expect(fakeMongoDb.store.get('questions')).toEqual([{ _id: 'q1', text: 'still the live version' }]);
    // No orphaned temp collection left behind after the failure.
    const leftoverTmp = [...fakeMongoDb.store.keys()].filter((k) => k.startsWith('_restore_tmp__'));
    expect(leftoverTmp).toHaveLength(0);
  });

  test('deleteBackup removes the snapshot collections and the metadata doc; returns false for unknown names', async () => {
    fakeMongoDb.store.set('students', [{ _id: 's1' }]);
    db.listRealCollectionNames = jest.fn().mockResolvedValue(['students']);
    const backup = await mongoBackup.createBackup({ kind: 'manual' });

    expect(await mongoBackup.deleteBackup('nope')).toBe(false);

    const deleted = await mongoBackup.deleteBackup(backup.name);
    expect(deleted).toBe(true);
    expect(fakeMongoDb.store.has(mongoBackup.backupCollectionName(backup.name, 'students'))).toBe(false);
    expect(await mongoBackup.getBackupMeta(backup.name)).toBeNull();
  });

  test('pruneScheduledBackups keeps only the most recent N scheduled backups, and never touches manual ones', async () => {
    mongoBackup = loadMongoBackupWithFreshEnv({ BACKUP_RETENTION_COUNT: '2' });
    db.listRealCollectionNames = jest.fn().mockResolvedValue([]);

    const manual = await mongoBackup.createBackup({ kind: 'manual' });
    const s1 = await mongoBackup.createBackup({ kind: 'scheduled' });
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await mongoBackup.createBackup({ kind: 'scheduled' });
    await new Promise((r) => setTimeout(r, 5));
    const s3 = await mongoBackup.createBackup({ kind: 'scheduled' }); // triggers pruning, retention = 2

    const remaining = (await mongoBackup.listBackups()).map((b) => b.name);
    expect(remaining).toEqual(expect.arrayContaining([manual.name, s2.name, s3.name]));
    expect(remaining).not.toContain(s1.name);
  });
});
