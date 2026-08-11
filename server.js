/**
 * server.js
 *
 * Application entry point.
 *
 * FIX: This file used to be a disconnected placeholder — it built its own
 * tiny Express app with hard-coded fake login/dashboard data and never
 * touched the real application defined in app.js (all real routes,
 * controllers, services, static file serving, security middleware, etc.
 * live there via `createApp()`). Because nothing ever called
 * `createApp()`, the entire real backend was unreachable: `/` returned
 * 404, none of the routes in routes/*.js worked, and every controller /
 * service in controllers/ and services/ was dead code.
 *
 * This file now boots the real app.
 */

"use strict";

require("dotenv").config();

const cron = require("node-cron");
const { createApp } = require("./app");
const { PORT, validateConfig } = require("./config");
const logger = require("./utils/logger");
const settingsService = require("./services/settings");
const { ensureAdminAccount } = require("./services/auth");
const db = require("./services/jsonDb");
const mongoBackup = require("./services/mongoBackup");
const { createGracefulShutdown } = require("./utils/gracefulShutdown");

// Fail fast on bad/missing critical configuration.
validateConfig();

const app = createApp();

// Set once app.listen() below succeeds — needed by the SIGTERM/SIGINT
// handlers further down, which must be registered up front (not nested
// inside the .then() below) so a signal arriving during the brief window
// before the server is up still gets handled instead of silently killing
// the process.
let httpServer = null;

// FIX (jsonDb -> MongoDB migration): db.connect() opens the MongoDB
// connection and hydrates the in-memory cache every controller/route/
// service reads from synchronously (see services/jsonDb.js for the full
// explanation). This has to happen — and finish — before the app accepts
// any requests, unlike ensureAdminAccount() below, so unlike that call
// this one is NOT allowed to fail silently: if the DB is unreachable at
// boot, every request would 500 or read empty collections one at a time
// instead, which is worse than refusing to start.
db.connect()
  .then(() => {
    // FIX (login self-heal): guarantees the ADMIN_EMAIL/ADMIN_PASSWORD
    // account exists, is unlocked, and is active on every boot — see
    // services/auth.js#ensureAdminAccount for the full reasoning. Runs
    // before the server starts accepting requests; any failure here is
    // logged but never blocks startup (same behavior as before this
    // existed, just self-healing when it can) — this part is unrelated to
    // the MongoDB connection itself being up.
    ensureAdminAccount().finally(() => {
      httpServer = app.listen(PORT, () => {
        logger.info(`🚀 Server running on port ${PORT}`);
        logger.info(`📍 http://localhost:${PORT}`);
      });
    });
  })
  .catch(error => {
    logger.error(`❌ FATAL: could not connect to MongoDB: ${error.message}`, { stack: error.stack });
    process.exit(1);
  });

// FIX: node-cron was already a listed dependency in package.json but was
// never required or scheduled anywhere in the codebase — the "Backup
// Settings" auto-backup toggle in the Settings module had nothing behind
// it. These two fixed schedules each check the live settings at trigger
// time, so turning auto-backup on/off (or switching daily/weekly) from
// the admin UI takes effect on the next tick without a server restart.
//
// FIX (production hardening, Phase 2, issue #1/#10): this used to
// fs-copy the Data/ folder, which has been stale/empty since the jsonDb
// -> MongoDB migration — every scheduled "backup" was silently backing
// up nothing. Now delegates to services/mongoBackup.js, which snapshots
// every real MongoDB collection into MongoDB itself.
async function runScheduledBackup(scheduleType) {
  try {
    const settings = settingsService.getSettings();
    if (!settings.backup.autoBackupEnabled) return;
    if (settings.backup.schedule !== scheduleType) return;

    const backup = await mongoBackup.createBackup({ kind: "scheduled" });
    logger.info(`✅ Scheduled ${scheduleType} backup created: ${backup.name} (${backup.collections.length} collections, ${backup.totalDocs} documents)`);
  } catch (err) {
    logger.error("Scheduled backup failed", { message: err.message });
  }
}

cron.schedule("0 2 * * *", () => runScheduledBackup("daily"));   // 2 AM every day
cron.schedule("0 2 * * 0", () => runScheduledBackup("weekly"));  // 2 AM every Sunday

// Surface anything that slips past Express's own handlers instead of
// crashing silently / leaving the process in a bad state.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason });
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { message: err.message, stack: err.stack });
  process.exit(1);
});

// FIX (production hardening, Phase 3, issue #3): SIGTERM (what Render and
// most container platforms send before killing a process — on every
// deploy, restart, or scale-down) and SIGINT (Ctrl+C locally) were
// previously not handled at all — the process just died immediately,
// mid-request and mid-write, on every single deploy. See
// utils/gracefulShutdown.js for the full sequence (stop accepting new
// requests, drain in-flight MongoDB writes, close the connection, exit).
//
// `shutdownDeps` is a plain mutable object, not a destructured value —
// gracefulShutdown.js reads shutdownDeps.httpServer fresh at shutdown
// time, because httpServer above is assigned asynchronously (after
// app.listen() succeeds) and a signal could in principle arrive before
// that happens; it's handled the same as "no server yet" either way.
const shutdownDeps = { db, logger };
Object.defineProperty(shutdownDeps, "httpServer", { get: () => httpServer });
const gracefulShutdown = createGracefulShutdown(shutdownDeps);

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
