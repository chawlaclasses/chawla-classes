/**
 * Tests for utils/gracefulShutdown.js.
 *
 * Uses fake httpServer/db objects rather than a real server or MongoDB
 * connection — server.js itself can't be required in isolation (it
 * attempts a real db.connect() at module-load time), so the shutdown
 * logic was deliberately extracted into this standalone, dependency-
 * injected module specifically to make this level of testing possible.
 * See PHASE_3_REPORT.md for what this still can't prove (a real process
 * actually receiving a real SIGTERM from Render).
 */

'use strict';

const { createGracefulShutdown } = require('../../utils/gracefulShutdown');

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeHttpServer({ closeDelayMs = 0, closeError = null } = {}) {
  return {
    closeIdleConnections: jest.fn(),
    close: jest.fn((cb) => {
      if (closeDelayMs > 0) {
        setTimeout(() => cb(closeError), closeDelayMs);
      } else {
        cb(closeError);
      }
    }),
  };
}

function makeDb({ pendingWrites = 0, closeError = null } = {}) {
  return {
    getStatus: jest.fn(() => ({ pendingWrites })),
    close: jest.fn(async () => {
      if (closeError) throw closeError;
    }),
  };
}

describe('utils/gracefulShutdown.js', () => {
  test('happy path: closes the HTTP server, drains writes, closes Mongo, exits 0 — in that order', async () => {
    const httpServer = makeHttpServer();
    const db = makeDb({ pendingWrites: 0 });
    const logger = makeLogger();
    const exit = jest.fn();
    const callOrder = [];
    httpServer.close.mockImplementation((cb) => { callOrder.push('httpServer.close'); cb(); });
    db.close.mockImplementation(async () => { callOrder.push('db.close'); });
    exit.mockImplementation(() => callOrder.push('exit'));

    const shutdown = createGracefulShutdown({ httpServer, db, logger, exit });
    await shutdown('SIGTERM');

    expect(callOrder).toEqual(['httpServer.close', 'db.close', 'exit']);
    expect(httpServer.closeIdleConnections).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('drains in-flight writes before closing the Mongo connection', async () => {
    let pending = 3;
    const httpServer = makeHttpServer();
    const db = {
      getStatus: jest.fn(() => ({ pendingWrites: pending })),
      close: jest.fn(async () => {
        expect(pending).toBe(0); // must have drained BEFORE close() is called
      }),
    };
    const logger = makeLogger();
    const exit = jest.fn();

    // Simulate writes finishing over time.
    const drainTimer = setInterval(() => {
      pending = Math.max(0, pending - 1);
    }, 30);

    const shutdown = createGracefulShutdown({ httpServer, db, logger, exit, timeoutMs: 5000 });
    await shutdown('SIGTERM');
    clearInterval(drainTimer);

    expect(db.close).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('a second signal while shutdown is already in progress is ignored, not restarted', async () => {
    const httpServer = makeHttpServer({ closeDelayMs: 50 });
    const db = makeDb();
    const logger = makeLogger();
    const exit = jest.fn();

    const shutdown = createGracefulShutdown({ httpServer, db, logger, exit });
    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT'); // arrives while the first is still in its close() delay

    await Promise.all([first, second]);

    expect(httpServer.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/already in progress/));
  });

  test('gives up waiting for writes to drain once its budget is exhausted, and still shuts down cleanly (does not hang)', async () => {
    const httpServer = makeHttpServer();
    const db = makeDb({ pendingWrites: 1 }); // never reaches 0
    const logger = makeLogger();
    const exit = jest.fn();

    const shutdown = createGracefulShutdown({ httpServer, db, logger, exit, timeoutMs: 300 });
    await shutdown('SIGTERM');

    expect(db.close).toHaveBeenCalled(); // proceeded anyway rather than hanging forever
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/still in flight/));
  });

  test('force-exits(1) if a step genuinely hangs past the overall timeout (e.g. httpServer.close never calls back)', async () => {
    jest.useFakeTimers();
    try {
      const httpServer = { closeIdleConnections: jest.fn(), close: jest.fn(() => {}) }; // never invokes its callback
      const db = makeDb();
      const logger = makeLogger();
      const exit = jest.fn();

      const shutdown = createGracefulShutdown({ httpServer, db, logger, exit, timeoutMs: 1000 });
      const shutdownPromise = shutdown('SIGTERM');

      await jest.advanceTimersByTimeAsync(1000);

      expect(exit).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/exceeded.*forcing exit/i));
      expect(db.close).not.toHaveBeenCalled(); // never got past the hung close() call

      // The outer shutdown() promise itself never resolves in this
      // scenario (closeHttpServer()'s promise is still pending) — that's
      // fine in the real process, since exit() actually terminates it;
      // here just don't let it hang the test.
      await Promise.race([shutdownPromise, Promise.resolve()]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('handles no httpServer yet (signal arrives before app.listen() has run) without throwing', async () => {
    const deps = { db: makeDb(), logger: makeLogger(), exit: jest.fn() };
    Object.defineProperty(deps, 'httpServer', { get: () => null }); // never assigned

    const shutdown = createGracefulShutdown(deps);
    await shutdown('SIGTERM');

    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  test('reads httpServer freshly at shutdown time, not at construction time', async () => {
    // Regression test for a real bug caught during development: object
    // destructuring (or a spread) evaluates a getter once, immediately —
    // server.js assigns its httpServer variable asynchronously (after
    // app.listen() resolves), strictly after createGracefulShutdown() has
    // already been called, so an eager read would permanently capture
    // null/undefined and this app's shutdown would silently skip closing
    // the HTTP server on every real deploy.
    let httpServer = null;
    const deps = { db: makeDb(), logger: makeLogger(), exit: jest.fn() };
    Object.defineProperty(deps, 'httpServer', { get: () => httpServer });

    const shutdown = createGracefulShutdown(deps); // httpServer is still null here

    httpServer = makeHttpServer(); // assigned AFTER construction, like the real app.listen() callback

    await shutdown('SIGTERM');

    expect(httpServer.close).toHaveBeenCalled();
  });

  test('logs and exits 1 if db.close() throws', async () => {
    const httpServer = makeHttpServer();
    const db = makeDb({ closeError: new Error('connection already terminated') });
    const logger = makeLogger();
    const exit = jest.fn();

    const shutdown = createGracefulShutdown({ httpServer, db, logger, exit });
    await shutdown('SIGTERM');

    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/connection already terminated/));
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('flushes any queued external-log-shipper entries before exiting, if logger.flush exists (Phase 4)', async () => {
    const httpServer = makeHttpServer();
    const db = makeDb();
    const logger = makeLogger();
    logger.flush = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    const shutdown = createGracefulShutdown({ httpServer, db, logger, exit });
    await shutdown('SIGTERM');

    expect(logger.flush).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('does not throw if logger has no flush method (older/minimal logger fakes used elsewhere in this suite)', async () => {
    const httpServer = makeHttpServer();
    const db = makeDb();
    const logger = makeLogger(); // no .flush property at all
    const exit = jest.fn();

    const shutdown = createGracefulShutdown({ httpServer, db, logger, exit });
    await shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledWith(0);
  });
});
