"use strict";
const os = require("os");
const NotificationLog = require("../models/NotificationLog");
const RateLimiter = require("../services/RateLimiter");
const { STATUS } = require("../constants");
const log = require("../utils/log");

/**
 * Mongo-backed worker. Safe to run in N web instances / a dedicated worker dyno:
 * jobs are claimed with an atomic findOneAndUpdate (queued -> processing + lock), so two workers never
 * send the same message. Crashed workers' jobs are reclaimed after MESSAGING_LOCK_TIMEOUT_MS.
 *
 * Scaling path: when volume outgrows Mongo polling, replace this class with a BullMQ consumer that calls
 * the same messaging.dispatch(row) — nothing else changes.
 */
class DispatchWorker {
  constructor({ config, messaging, bulk }) {
    this.cfg = config.queue;
    this.messaging = messaging;
    this.bulk = bulk;
    this.id = `${os.hostname()}:${process.pid}`;
    this.limiters = Object.fromEntries(Object.entries(this.cfg.ratePerSecond).map(([ch, n]) => [ch, new RateLimiter(n)]));
    this.timer = null;
    this.running = false;
    this.lastFinalize = 0;
  }

  start() {
    if (this.timer || !this.cfg.workerEnabled) return;
    log.info(`dispatch worker ${this.id} started (poll ${this.cfg.pollIntervalMs}ms, batch ${this.cfg.batchSize}, concurrency ${this.cfg.concurrency})`);
    this.timer = setInterval(() => this.tick().catch((e) => log.error(`worker tick: ${e.message}`)), this.cfg.pollIntervalMs);
    this.timer.unref();
  }

  async stop() {
    clearInterval(this.timer); this.timer = null;
    while (this.running) await new Promise((r) => setTimeout(r, 50));   // drain in-flight batch (graceful shutdown)
  }

  async _claim() {
    return NotificationLog.findOneAndUpdate(
      { status: STATUS.QUEUED, nextAttemptAt: { $lte: new Date() } },
      { $set: { status: STATUS.PROCESSING, lockedAt: new Date(), lockedBy: this.id } },
      { sort: { priority: 1, nextAttemptAt: 1 }, new: true });
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // 1) reclaim jobs abandoned by crashed workers
      await NotificationLog.updateMany(
        { status: STATUS.PROCESSING, lockedAt: { $lt: new Date(Date.now() - this.cfg.lockTimeoutMs) } },
        { $set: { status: STATUS.QUEUED }, $unset: { lockedAt: 1, lockedBy: 1 } });

      // 2) claim a batch, process with bounded concurrency
      const batch = [];
      while (batch.length < this.cfg.batchSize) {
        const job = await this._claim();
        if (!job) break;
        batch.push(job);
      }
      let idx = 0;
      const lane = async () => {
        while (idx < batch.length) {
          const job = batch[idx++];
          await this.limiters[job.channel]?.acquire();
          try { await this.messaging.dispatch(job); }
          catch (e) { log.error(`dispatch ${job.messageId}: ${e.message}`); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.cfg.concurrency, batch.length) }, lane));

      // 3) mark finished campaigns (every ~10s)
      if (Date.now() - this.lastFinalize > 10_000) { this.lastFinalize = Date.now(); await this.bulk.finalizeFinished(); }
    } finally { this.running = false; }
  }
}

module.exports = DispatchWorker;
