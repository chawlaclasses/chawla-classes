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
const logShipper = require("./logShipper");

// ── Ensure logs directory exists ──────────────────────────────────────────────
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const LOG_FILE = path.join(LOGS_DIR, "app.log");

// ── Log rotation ──────────────────────────────────────────────────────────────
// FIX (audit 2026-08): the old rotation check only ran ONCE, at module load
// (process boot) — it renamed app.log if it was *already* over 10MB at
// that instant, then never checked again for the rest of that process's
// life. On a long-running server that never restarts, app.log just grew
// forever after that one-time check. Rotation now happens continuously:
// `currentSize` is tracked in memory and checked on every write, so the
// file actually gets rotated once it crosses the threshold instead of
// only at the next reboot. Old .bak files are also capped (oldest
// deleted beyond LOG_MAX_BACKUPS) so rotation can't itself fill the disk.
// Both knobs are env-overridable for testing; defaults match the old
// hardcoded 10MB.
const LOG_MAX_BYTES   = (parseInt(process.env.LOG_MAX_BYTES,   10) || 10 * 1024 * 1024);
const LOG_MAX_BACKUPS = (parseInt(process.env.LOG_MAX_BACKUPS, 10) || 5);

let currentSize = 0;
try {
  if (fs.existsSync(LOG_FILE)) currentSize = fs.statSync(LOG_FILE).size;
} catch (_) {}

// FIX (audit 2026-08 — found via a burst-write test, not just review): the
// first version of this fix kept the old fs.createWriteStream + stream.end()
// approach and just added the size tracking above. Under a fast synchronous
// burst of writes (many log lines with no I/O in between — an error storm,
// a bulk import logging per row, exactly the kind of moment rotation most
// needs to hold up), fs.createWriteStream's underlying open()+flush() is
// asynchronous, so a rotation could fire and call fs.renameSync() on
// app.log before Node had actually flushed anything to it — ENOENT,
// rotation silently failed (caught and logged, but nothing rotated).
// Switching the actual file write to fs.appendFileSync makes every log
// line synchronously durable on disk before the size check/rotation ever
// runs, which removes that race outright. Trade-off: log writes now block
// briefly on disk I/O instead of going through an async stream — a
// deliberate, reasonable trade for a logger at this app's traffic volume;
// flag if this ever needs to become fully async under much higher load.
function writeLogLine(line) {
  try {
    fs.appendFileSync(LOG_FILE, line);
    currentSize += Buffer.byteLength(line);
    if (currentSize >= LOG_MAX_BYTES) rotateLogFile();
  } catch (err) {
    // Fall back to stderr so we at least see the problem instead of
    // crashing the process over a logging failure (disk full, permissions).
    process.stderr.write(`[logger] Log write error: ${err.message}\n`);
  }
}

// Deletes the oldest rotated backups beyond LOG_MAX_BACKUPS so rotation
// itself can't accumulate unbounded .bak files.
function pruneOldBackups() {
  try {
    const dir = path.dirname(LOG_FILE);
    const base = path.basename(LOG_FILE);
    const backups = fs.readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.`) && f.endsWith(".bak"))
      .sort(); // filenames embed Date.now() with a fixed prefix, so lexical sort == chronological
    while (backups.length > LOG_MAX_BACKUPS) {
      const oldest = backups.shift();
      fs.unlinkSync(path.join(dir, oldest));
    }
  } catch (err) {
    process.stderr.write(`[logger] backup prune failed: ${err.message}\n`);
  }
}

function rotateLogFile() {
  try {
    fs.renameSync(LOG_FILE, `${LOG_FILE}.${Date.now()}.bak`);
    pruneOldBackups();
  } catch (err) {
    process.stderr.write(`[logger] rotation failed: ${err.message}\n`);
  } finally {
    // Whether or not the rename succeeded, reset the counter: on success
    // the next appendFileSync recreates app.log from empty; on failure
    // (e.g. permissions) we don't want to retry every subsequent line.
    currentSize = 0;
  }
}


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
  const fileLine = JSON.stringify(entry) + "\n";
  writeLogLine(fileLine);

  // NEW (Phase 4, issue #10): also forward to an external logging
  // service if LOG_SHIP_URL is configured — see utils/logShipper.js.
  // No-op (and effectively free — one boolean check) when it isn't.
  logShipper.enqueue(entry);

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

  // NEW (Phase 4, issue #10): best-effort final flush of any log entries
  // still queued for the external logging service, for graceful shutdown
  // to call before the process exits. No-op if log shipping isn't
  // configured, or if nothing is queued.
  flush: () => logShipper.flush(),
};

module.exports = logger;