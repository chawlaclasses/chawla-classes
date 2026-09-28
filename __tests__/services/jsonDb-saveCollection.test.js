/**
 * Tests for jsonDb.js#saveCollection's transaction fix (issue #2).
 *
 * Drives the real JsonDB class (not the singleton) with a fake `client`/
 * `db` whose session object records exactly what was called, so this
 * verifies the actual sequencing — deleteMany and insertMany run inside
 * the same session, and the session is committed on success / aborted
 * (implicitly, by session.withTransaction rethrowing) and always ended.
 *
 * This cannot exercise real MongoDB transaction semantics (needs a
 * replica set — see PHASE_2_REPORT.md), but it does prove
 * saveCollection asks the driver for a transaction in the right way
 * rather than silently falling back to two independent operations.
 */

'use strict';

const JsonDB = Object.getPrototypeOf(require('../../services/jsonDb')).constructor;

function makeFakeSession({ throwOnDeleteMany = false, throwOnInsertMany = false } = {}) {
  const calls = [];
  const session = {
    calls,
    ended: false,
    async withTransaction(fn) {
      calls.push('startTransaction');
      try {
        await fn();
        calls.push('commitTransaction');
      } catch (err) {
        calls.push('abortTransaction');
        throw err;
      }
    },
    async endSession() {
      this.ended = true;
      calls.push('endSession');
    },
  };
  return session;
}

describe('jsonDb.saveCollection() — transactional write (issue #2)', () => {
  test('runs deleteMany and insertMany inside the same session, then commits', async () => {
    const db = new JsonDB();
    const session = makeFakeSession();
    const deleteManyCalls = [];
    const insertManyCalls = [];

    db.client = { startSession: () => session };
    db.db = {
      collection: () => ({
        deleteMany: async (filter, opts) => {
          deleteManyCalls.push({ filter, opts });
        },
        insertMany: async (docs, opts) => {
          insertManyCalls.push({ docs, opts });
        },
      }),
    };
    db.collections.students = [{ _id: '1', name: 'Amit' }];
    db._buildIndex('students');

    db.saveCollection('students');
    await db._saveQueue.students;

    expect(session.calls).toEqual(['startTransaction', 'commitTransaction', 'endSession']);
    expect(deleteManyCalls).toHaveLength(1);
    expect(deleteManyCalls[0].opts.session).toBe(session);
    expect(insertManyCalls).toHaveLength(1);
    expect(insertManyCalls[0].opts.session).toBe(session);
    expect(insertManyCalls[0].docs).toEqual([{ _id: '1', name: 'Amit' }]);
  });

  test('an error mid-transaction aborts rather than leaving a partial write, and always ends the session', async () => {
    const db = new JsonDB();
    const session = makeFakeSession();

    db.client = { startSession: () => session };
    db.db = {
      collection: () => ({
        deleteMany: async () => {},
        insertMany: async () => {
          throw new Error('simulated network drop mid-write');
        },
      }),
    };
    db.collections.students = [{ _id: '1' }];
    db._buildIndex('students');

    db.saveCollection('students');
    // saveCollection's queued op error is caught and logged by
    // _queueWrite (matches every other write method's behavior — see
    // its own comment) rather than rejecting the caller, so this just
    // awaits the settled queue entry.
    await db._saveQueue.students;

    expect(session.calls).toEqual(['startTransaction', 'abortTransaction', 'endSession']);
    expect(session.ended).toBe(true);
  });

  test('skips insertMany when the collection is empty, but still runs it inside the transaction', async () => {
    const db = new JsonDB();
    const session = makeFakeSession();
    const insertManyCalls = [];

    db.client = { startSession: () => session };
    db.db = {
      collection: () => ({
        deleteMany: async () => {},
        insertMany: async (docs, opts) => insertManyCalls.push({ docs, opts }),
      }),
    };
    db.collections.students = [];
    db._buildIndex('students');

    db.saveCollection('students');
    await db._saveQueue.students;

    expect(session.calls).toEqual(['startTransaction', 'commitTransaction', 'endSession']);
    expect(insertManyCalls).toHaveLength(0);
  });
});
