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
const fs = require("fs");
const path = require("path");
const { createApp } = require("./app");
const { PORT, validateConfig, ROOT_DIR, DATA_DIR } = require("./config");
const logger = require("./utils/logger");
const settingsService = require("./services/settings");
const { ensureAdminAccount } = require("./services/auth");

// Fail fast on bad/missing critical configuration.
validateConfig();

const app = createApp();

// FIX (login self-heal): guarantees the ADMIN_EMAIL/ADMIN_PASSWORD account
// exists, is unlocked, and is active on every boot — see
// services/auth.js#ensureAdminAccount for the full reasoning. Runs before
// the server starts accepting requests; any failure is logged but never
// blocks startup (same behavior as before this existed, just self-healing
// when it can).
ensureAdminAccount().finally(() => {
  app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📍 http://localhost:${PORT}`);
  });
});

// FIX: node-cron was already a listed dependency in package.json but was
// never required or scheduled anywhere in the codebase — the "Backup
// Settings" auto-backup toggle in the Settings module had nothing behind
// it. These two fixed schedules each check the live settings at trigger
// time, so turning auto-backup on/off (or switching daily/weekly) from
// the admin UI takes effect on the next tick without a server restart.
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function runScheduledBackup(scheduleType) {
  try {
    const settings = settingsService.getSettings();
    if (!settings.backup.autoBackupEnabled) return;
    if (settings.backup.schedule !== scheduleType) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(ROOT_DIR, "backups", `auto-${scheduleType}-${timestamp}`);
    copyDirRecursive(DATA_DIR, backupPath);
    logger.info(`✅ Scheduled ${scheduleType} backup created: ${backupPath}`);
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
