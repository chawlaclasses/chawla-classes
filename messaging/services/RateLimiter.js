"use strict";
/** Paces calls to N per second within one process. (Multi-instance: divide the vendor limit by instance count.) */
class RateLimiter {
  constructor(perSecond) { this.interval = perSecond > 0 ? 1000 / perSecond : 0; this.next = 0; }
  async acquire() {
    if (!this.interval) return;
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.interval;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}
module.exports = RateLimiter;
