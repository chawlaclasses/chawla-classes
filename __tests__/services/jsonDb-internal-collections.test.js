/**
 * Tests for jsonDb.js's exclusion of internal ("_"-prefixed) collections
 * from the in-memory mirror — see _isInternalCollectionName's comment.
 * Without this, every historical backup snapshot (services/mongoBackup.js)
 * would get loaded into memory on every boot and grow unbounded over
 * time.
 */

'use strict';

const JsonDB = Object.getPrototypeOf(require('../../services/jsonDb')).constructor;

function fakeMongoWith(collectionNames, docsByName = {}) {
  return {
    listCollections: () => ({
      toArray: async () => collectionNames.map((name) => ({ name })),
    }),
    collection: (name) => ({
      find: () => ({
        toArray: async () => docsByName[name] || [],
      }),
    }),
  };
}

describe('jsonDb internal-collection exclusion (issue #1/#2 groundwork)', () => {
  test('_loadAllCollections skips "_"-prefixed collections', async () => {
    const db = new JsonDB();
    db.db = fakeMongoWith(
      ['students', '_backupMeta', '_backup__backup-1__students', 'questions'],
      { students: [{ _id: 's1' }], questions: [{ _id: 'q1' }] }
    );

    await db._loadAllCollections();

    expect(Object.keys(db.collections).sort()).toEqual(['questions', 'students']);
  });

  test('listRealCollectionNames excludes internal collections, in whatever order Mongo returns them', async () => {
    const db = new JsonDB();
    db.db = fakeMongoWith(['_backupMeta', 'students', '_restore_tmp__123__students', 'fees']);

    const names = await db.listRealCollectionNames();

    expect(names.sort()).toEqual(['fees', 'students']);
  });

  test('reloadCollections re-hydrates only the requested (non-internal) collections', async () => {
    const db = new JsonDB();
    db.collections.students = [{ _id: 'old', name: 'stale' }];
    db._buildIndex('students');
    db.db = fakeMongoWith(['students'], { students: [{ _id: 'new', name: 'fresh from restore' }] });

    await db.reloadCollections(['students', '_backupMeta']); // internal name should be a no-op

    expect(db.collections.students).toEqual([{ _id: 'new', name: 'fresh from restore' }]);
    expect(db.collections._backupMeta).toBeUndefined();
  });
});
