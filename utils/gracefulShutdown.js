/**
 * utils/gracefulShutdown.js
 *
 * NEW (production hardening audit, Phase 3, issue #3). Handles SIGTERM
 * (what Render/most container platforms send before killing a process —
 * on deploy, restart, or scale-down) and SIGINT (Ctrl+C locally). Before
 * this, neither was handled at all: the process just died immediately,
 * mid-request and mid-write, on every deploy.
 *
 * Shutdown sequence:
 *   1. Stop accepting new HTTP connections (server.close()), then
 *      proactively drop idle keep-alive sockets (server.closeIdleConnections()
 *      — Node 18.2+) so already-idle connections don't block step 1's
 *      completion; requests actively being handled are still allowed to
 *      finish naturally.
 *   2. Wait for jsonDb's in-flight MongoDB writes to drain to zero (the
 *      `_pendingWrites` counter Phase 1 added for GET /health, reused
 *      here for its intended purpose).
 *   3. Close the MongoDB connection.
 *   4. Exit 0.
 *
 * A single overall timeout guards the whole sequence — if anything hangs
 * (a stuck request, a write that never resolves, a network partition to
 * MongoDB), the process force-exits(1) rather than hanging forever on a
 * platform that's trying to replace it anyway.
 *
 * Extracted into its own module (rather than living inline in server.js)
 * specifically so it's unit-testable with fake httpServer/db objects —
 * server.js itself can't be required in isolation without triggering a
 * real MongoDB connection attempt at module-load time. See
 * __tests__/utils/gracefulShutdown.test.js.
 */

"use strict";

/**
 * @param {object} deps
 * @param {import('http').Server | null} [deps.httpServer] - read fresh at
 *   shutdown time (not destructured eagerly), since server.js assigns
 *   this asynchronously after app.listen() succeeds — a signal could in
 *   principle arrive before that happens. Pass an object whose
 *   `.httpServer` property may still be null/undefined when this
 *   function runs; that's handled the same as "no server yet".
 * @param {{getStatus: () => {pendingWrites: number}, close: () => Promise<void>}} deps.db
 * @param {{info: Function, warn: Function, error: Function}} deps.logger
 * @param {number} [deps.timeoutMs] - overall deadline before force-exiting
 * @param {(code: number) => void} [deps.exit] - injectable for tests; defaults to process.exit
 * @returns {(signal: string) => Promise<void>}
 */
function createGracefulShutdown(deps) {
  const { db, logger, timeoutMs = 15000, exit = (code) => process.exit(code) } = deps;
  let shuttingDown = false;

  function closeHttpServer() {
    // Read deps.httpServer fresh here, NOT via destructuring in the
    // function signature above — destructuring a plain property (or even
    // a getter) evaluates it once, immediately, at call time. server.js
    // assigns deps.httpServer after this factory has already returned
    // (app.listen() resolves asynchronously), so an eager read would
    // permanently capture null.
    const httpServer = deps.httpServer;
    if (!httpServer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
      // Drop idle keep-alive sockets right away — server.close()'s callback
      // otherwise waits for them to time out on their own, which can take
      // a long time and isn't what "stop accepting new requests" should
      // mean. Requests currently being handled are unaffected: this only
      // targets sockets with no in-flight request.
      if (typeof httpServer.closeIdleConnections === "function") {
        httpServer.closeIdleConnections();
      }
    });
  }

  async function drainPendingWrites(deadline) {
    while (db.getStatus().pendingWrites > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return db.getStatus().pendingWrites;
  }

  return async function gracefulShutdown(signal) {
    // A second SIGTERM/SIGINT while already shutting down (Render/Ctrl+C
    // both commonly send more than one) shouldn't restart the sequence
    // or double-close anything — just let the first one finish.
    if (shuttingDown) {
      logger.warn(`⚠️  ${signal} received again — shutdown already in progress, ignoring`);
      return;
    }
    shuttingDown = true;
    logger.info(`🛑 ${signal} received — starting graceful shutdown (deadline ${timeoutMs}ms)`);

    const deadline = Date.now() + timeoutMs;
    const forceExitTimer = setTimeout(() => {
      logger.error(`⏱️  Graceful shutdown exceeded ${timeoutMs}ms — forcing exit`);
      exit(1);
    }, timeoutMs);

    try {
      await closeHttpServer();
      logger.info("✅ HTTP server closed — no longer accepting new requests");

      // Leave a slice of the overall deadline for steps 3+4 (closing the
      // Mongo connection) rather than spending the entire budget on
      // draining writes. Capped at a third of timeoutMs (not a flat
      // 2000ms) so a short timeoutMs — a fast test, or an operator
      // deliberately configuring a tight one — doesn't degenerate into
      // "reserve more time than actually exists, so drain immediately
      // gives up with 0ms spent waiting."
      const closeBufferMs = Math.min(2000, Math.floor(timeoutMs / 3));
      const remaining = await drainPendingWrites(Math.max(Date.now(), deadline - closeBufferMs));
      if (remaining > 0) {
        logger.error(`⚠️  Shutting down with ${remaining} MongoDB write(s) still in flight after waiting — see saveCollection's transaction fix (Phase 2) for what protects the collections it covers even so`);
      } else {
        logger.info("✅ All queued MongoDB writes completed");
      }

      await db.close();
      logger.info("✅ MongoDB connection closed");

      // NEW (Phase 4, issue #10): best-effort final flush of any log
      // entries still queued for external shipping (utils/logShipper.js)
      // — otherwise the last few seconds of logs before a deploy,
      // sometimes the most useful ones for diagnosing why a restart
      // happened, would never make it out. Defensive `typeof` check
      // rather than assuming logger.flush exists: this module is also
      // exercised by tests with minimal fake logger objects that don't
      // need a flush method to be valid for what they're testing.
      if (typeof logger.flush === "function") {
        await logger.flush().catch((err) => {
          logger.warn(`⚠️  Final log flush failed: ${err.message}`);
        });
      }

      clearTimeout(forceExitTimer);
      logger.info("👋 Graceful shutdown complete");
      exit(0);
    } catch (error) {
      logger.error(`❌ Error during graceful shutdown: ${error.message}`);
      clearTimeout(forceExitTimer);
      exit(1);
    }
  };
}

module.exports = { createGracefulShutdown };
