/**
 * utils/logger.js
 *
 * Minimal structured logger. Writes JSON lines to logs/app.log and
 * human-readable output to stdout/stderr. No external dependencies.
 *
 * Levels: debug < info < warn < error
 *
 * Console output rules:
 *   - Production : info + warn + error  (debug suppressed unless DEBUG_PDF=true)
 *   - Development: all levels
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { IS_PROD, DEBUG_PDF, LOGS_DIR } = require("../config");

// ── Ensure logs directory exists ──────────────────────────────────────────────
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const LOG_FILE = path.join(LOGS_DIR, "app.log");

// ── Log rotation: rename if > 10 MB ──────────────────────────────────────────
try {
  if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 10 * 1024 * 1024) {
    fs.renameSync(LOG_FILE, `${LOG_FILE}.${Date.now()}.bak`);
  }
} catch (_) {}

// ── Log stream with error handling ───────────────────────────────────────────
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

// FIX: Silent stream errors can crash the process in some Node versions.
//      Attach an error handler to prevent unhandled 'error' event crashes.
logStream.on("error", (err) => {
  // Fall back to stderr so we at least see the problem
  process.stderr.write(`[logger] Log stream error: ${err.message}\n`);
});

// ── Level ordering (for future min-level filtering if needed) ─────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// ── Core write helper ─────────────────────────────────────────────────────────
function write(level, message, meta = {}) {
  const entry = {
    ts:      new Date().toISOString(),
    level,
    message: typeof message === "string" ? message : JSON.stringify(message),
    ...meta,
  };

  // Always persist structured JSON line to file
  if (logStream.writable) {
    logStream.write(JSON.stringify(entry) + "\n");
  }

  // ── Console output filter ────────────────────────────────────────────────
  // FIX: Previous logic `!IS_PROD || (level === "debug" && DEBUG_PDF)` was
  //      broken — in production it suppressed info/warn unless DEBUG_PDF was set.
  //
  // Corrected rules:
  //   error  → always stderr
  //   warn   → always console.warn
  //   info   → always console.log  (useful in prod for request summaries etc.)
  //   debug  → dev only, OR when DEBUG_PDF=true regardless of env

  const line = `[${entry.ts}] ${level.toUpperCase().padEnd(5)} ${entry.message}`;

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "info") {
    console.log(line);
  } else if (level === "debug") {
    // debug: show in dev, or when DEBUG_PDF flag is on
    if (!IS_PROD || DEBUG_PDF) {
      console.log(line);
    }
  }
}

// ── Public logger interface ───────────────────────────────────────────────────
const logger = {
  debug: (msg, meta) => write("debug", msg, meta),
  info:  (msg, meta) => write("info",  msg, meta),
  warn:  (msg, meta) => write("warn",  msg, meta),
  error: (msg, meta) => write("error", msg, meta),

  /** Convenience: log an HTTP request summary */
  http: (req, statusCode) =>
    write("info", `${req.method} ${req.path} → ${statusCode}`, {
      ip:     req.ip || "unknown",
      status: statusCode,
    }),
};

module.exports = logger;