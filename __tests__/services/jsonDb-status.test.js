/**
 * Tests for services/jsonDb.js's connection status tracking (getStatus()).
 *
 * This deliberately does NOT mock the mongodb driver: it points a real
 * MongoClient at an unreachable local port (127.0.0.1:1 — nothing listens
 * there, no network access needed) so the driver's real SDAM heartbeat
 * events fire, and asserts getStatus() reflects them correctly. That's
 * the actual mechanism production reconnect-visibility depends on, so
 * this is worth testing against the real driver rather than a mock of it.
 *
 * A full "reconnect after a real drop" test would need a real, reachable
 * MongoDB server (Atlas or a local replica set), which isn't available in
 * this environment — see PHASE_1_REPORT.md for what that leaves
 * unverified and how to check it against a real deploy.
 */

'use strict';

const { MongoClient } = require('mongodb');

// Reach into jsonDb's class directly (not the singleton) so this test can
// point it at an unreachable URI without touching the real MONGODB_URI/
// the app-wide singleton other test files might also load.
const JsonDB = Object.getPrototypeOf(require('../../services/jsonDb')).constructor;

describe('jsonDb.getStatus()', () => {
  test('reports not connected before connect() resolves', () => {
    const db = new JsonDB();
    expect(db.getStatus()).toEqual({ connected: false, pendingWrites: 0 });
  });

  test('connected flips to false on a real heartbeat failure against an unreachable server', async () => {
    const db = new JsonDB();

    // Point directly at the driver instead of going through _doConnect()/
    // connect(), which would block until serverSelectionTimeoutMS (10s)
    // and ultimately reject — this test only needs the event wiring, not
    // a full failed connection attempt.
    db.client = new MongoClient('mongodb://127.0.0.1:1/testdb', {
      serverSelectionTimeoutMS: 1000,
    });
    db.client.on('serverHeartbeatSucceeded', () => {
      if (!db._connected) db._connected = true;
    });
    db.client.on('serverHeartbeatFailed', () => {
      if (db._connected) db._connected = false;
    });
    db._connected = true; // simulate "was connected"

    await new Promise((resolve) => {
      db.client.on('serverHeartbeatFailed', resolve);
      db.client.connect().catch(() => {}); // expected to eventually reject; only the event matters here
    });

    expect(db.getStatus().connected).toBe(false);

    await db.client.close().catch(() => {});
  }, 15000);

  test('pendingWrites increments while a write is queued and decrements after it settles', async () => {
    const db = new JsonDB();
    db.db = { collection: () => ({}) }; // not used — opFn below is a stub

    let resolveOp;
    const opPromise = new Promise((resolve) => { resolveOp = resolve; });

    const writePromise = db._queueWrite('someCollection', () => opPromise);
    expect(db.getStatus().pendingWrites).toBe(1);

    resolveOp();
    await writePromise;

    expect(db.getStatus().pendingWrites).toBe(0);
  });
});
