/**
 * utils/logShipper.js
 *
 * NEW (production hardening audit, Phase 4, issue #10 remainder — Rohit
 * chose an external logging service over pointing LOGS_DIR at the
 * Persistent Disk from Phase 3). Ships structured log entries to an
 * external HTTP log-ingestion endpoint, so logs survive a Render
 * redeploy and are browsable/alertable somewhere that isn't this app's
 * own (still-ephemeral) local disk.
 *
 * Deliberately provider-agnostic rather than wired to one vendor's SDK:
 * this sandbox has no credentials for any specific logging service to
 * test against (same constraint as Phase 3's S3/Cloudinary work — see
 * PHASE_3_REPORT.md), so rather than guess a vendor and ship an
 * integration nobody can verify, this speaks plain HTTP POST + JSON,
 * which is how most log-ingestion services actually accept data
 * (Logtail/BetterStack, Datadog's HTTP intake, Papertrail, a generic
 * webhook/collector, etc. all take a JSON POST — they mostly differ only
 * in the auth header shape, which is configurable here, not hardcoded).
 *
 * Off by default: if LOG_SHIP_URL isn't set, every function here is a
 * no-op — zero behavior or performance change for anyone not using this.
 * Local file logging (utils/logger.js, Phase 1's rotation fix) is
 * unaffected either way and keeps working as a fallback if the external
 * service is unreachable.
 *
 * Config (all via env, all optional except LOG_SHIP_URL):
 *   LOG_SHIP_URL              - POST target. Unset = disabled entirely.
 *   LOG_SHIP_AUTH_HEADER_NAME - default "Authorization"
 *   LOG_SHIP_AUTH_HEADER_VALUE- e.g. "Bearer <token>", or a raw API key,
 *                               depending what your provider expects
 *   LOG_SHIP_MIN_LEVEL        - default "info" (skips "debug" — most
 *                               log services price by volume; shipping
 *                               every debug line by default could be an
 *                               unpleasant surprise on the bill)
 *   LOG_SHIP_BATCH_SIZE       - default 20 (flush once this many are queued)
 *   LOG_SHIP_FLUSH_INTERVAL_MS- default 5000 (flush on this cadence regardless)
 *   LOG_SHIP_MAX_QUEUE_SIZE   - default 1000 (oldest entries dropped beyond
 *                               this, so a prolonged outage of the external
 *                               service can't grow this app's memory
 *                               unboundedly — a dropped-entry count is
 *                               shipped as extra context on the next
 *                               successful flush, so it's visible, not silent)
 */

"use strict";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const LOG_SHIP_URL = process.env.LOG_SHIP_URL || null;
const ENABLED = !!LOG_SHIP_URL;

const AUTH_HEADER_NAME = process.env.LOG_SHIP_AUTH_HEADER_NAME || "Authorization";
const AUTH_HEADER_VALUE = process.env.LOG_SHIP_AUTH_HEADER_VALUE || null;
const MIN_LEVEL = LEVELS[process.env.LOG_SHIP_MIN_LEVEL] !== undefined ? process.env.LOG_SHIP_MIN_LEVEL : "info";
const BATCH_SIZE = parseInt(process.env.LOG_SHIP_BATCH_SIZE, 10) || 20;
const FLUSH_INTERVAL_MS = parseInt(process.env.LOG_SHIP_FLUSH_INTERVAL_MS, 10) || 5000;
const MAX_QUEUE_SIZE = parseInt(process.env.LOG_SHIP_MAX_QUEUE_SIZE, 10) || 1000;
const FETCH_TIMEOUT_MS = 5000;

let queue = [];
let droppedSinceLastFlush = 0;
let flushTimer = null;

// Diagnostics about the shipper itself go straight to stderr, never
// through logger.js's write() — routing them through the logger could
// re-enqueue them here on a failure, which is an easy way to build an
// infinite loop out of "the log shipper is failing to ship logs."
function diagnostic(message) {
  process.stderr.write(`[logShipper] ${message}\n`);
}

function enqueue(entry) {
  if (!ENABLED) return;
  if ((LEVELS[entry.level] ?? 0) < LEVELS[MIN_LEVEL]) return;

  queue.push(entry);
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.shift();
    droppedSinceLastFlush += 1;
  }
  if (queue.length >= BATCH_SIZE) {
    // Fire-and-forget — enqueue() is called from logger.js's write(),
    // which is used all over this app synchronously; it must never block
    // on a network call.
    flush().catch(() => {}); // flush() already handles/logs its own errors; this just guards the fire-and-forget call itself
  }
}

async function sendBatch(entries) {
  const headers = { "Content-Type": "application/json" };
  if (AUTH_HEADER_VALUE) headers[AUTH_HEADER_NAME] = AUTH_HEADER_VALUE;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LOG_SHIP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(entries),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// Sends whatever is currently queued. Safe to call concurrently/rapidly
// (e.g. from both the size trigger and the interval timer) — each call
// only takes and clears what's in the queue at that moment, so entries
// are never sent twice or lost between two overlapping flushes.
async function flush() {
  if (!ENABLED || queue.length === 0) return;

  const batch = queue;
  queue = [];
  const dropped = droppedSinceLastFlush;
  droppedSinceLastFlush = 0;

  if (dropped > 0) {
    batch.push({
      ts: new Date().toISOString(),
      level: "warn",
      message: `logShipper dropped ${dropped} log entr${dropped === 1 ? "y" : "ies"} — local queue exceeded LOG_SHIP_MAX_QUEUE_SIZE (${MAX_QUEUE_SIZE}), likely because the external logging service was unreachable for a while`,
    });
  }

  try {
    await sendBatch(batch);
  } catch (firstError) {
    // One retry after a short pause — covers a single transient blip
    // (a redeploy of the logging service itself, a brief network hiccup)
    // without holding up the caller indefinitely or retrying forever.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      await sendBatch(batch);
    } catch (secondError) {
      diagnostic(`failed to ship ${batch.length} log entries after retry: ${secondError.message}`);
      // Deliberately not re-queuing `batch` here: on a prolonged outage,
      // retrying the same entries forever would just recreate the
      // unbounded-growth problem MAX_QUEUE_SIZE exists to prevent. Local
      // file logging (utils/logger.js) already captured everything in
      // this batch independently, so nothing is silently lost — it's
      // just not *also* in the external service for this window.
    }
  }
}

function startTimer() {
  if (!ENABLED || flushTimer) return;
  flushTimer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  // Never keeps the process alive on its own — graceful shutdown
  // (utils/gracefulShutdown.js) calls flush() explicitly and directly
  // during its own sequence instead of relying on this timer.
  flushTimer.unref();
}

startTimer();

module.exports = {
  enqueue,
  flush,
  isEnabled: () => ENABLED,
};
