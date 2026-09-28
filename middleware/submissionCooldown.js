/**
 * middleware/submissionCooldown.js
 *
 * Enforces a minimum gap between two SUCCESSFUL submissions from the same
 * IP on a given public form. Deliberately separate from
 * middleware/rateLimit.js's hourly limiter: the hourly limiter caps total
 * attempts (successful or not) over an hour; this stops a rapid-fire
 * double/triple submit (e.g. an impatient double-click, or a simple
 * flood script) within the same minute, regardless of the hourly count.
 *
 * In-memory only (a Map, like RateLimiter in middleware/rateLimit.js) —
 * consistent with this app's existing rate-limiting approach, and fine
 * for the single-instance deployment this app runs on. Resets on
 * restart/redeploy, same trade-off the existing rate limiter already has.
 *
 * Usage:
 *   const { admissionCooldown } = require("../middleware/submissionCooldown");
 *   router.post("/admission", admissionCooldown.check, ...otherMiddleware, (req, res) => {
 *     ...
 *     db.insertOne(...);
 *     admissionCooldown.markSuccess(req);
 *     res.status(201).json(...);
 *   });
 */

"use strict";

const { FORM_SUBMIT_COOLDOWN_MS } = require("../config");

class SubmissionCooldown {
  constructor(cooldownMs) {
    this.cooldownMs = cooldownMs;
    this.lastSuccessByIp = new Map();
  }

  _cleanup() {
    const now = Date.now();
    for (const [ip, ts] of this.lastSuccessByIp.entries()) {
      if (now - ts > this.cooldownMs) this.lastSuccessByIp.delete(ip);
    }
  }

  // Express middleware — blocks with 429 if this IP's last SUCCESSFUL
  // submission on this form was too recent. Placed early in the chain
  // (before validation/OTP checks) so a cooling-down IP gets a fast,
  // cheap rejection instead of doing OTP/validation work for nothing.
  check = (req, res, next) => {
    if (Math.random() < 0.1) this._cleanup();

    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const last = this.lastSuccessByIp.get(ip);
    if (last) {
      const msSince = Date.now() - last;
      if (msSince < this.cooldownMs) {
        const waitSec = Math.ceil((this.cooldownMs - msSince) / 1000);
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSec}s before submitting again.`,
        });
      }
    }
    next();
  };

  // Call once a submission actually succeeds (record saved) — NOT on
  // validation/OTP failures, so a genuine visitor correcting a typo isn't
  // penalized, only actual back-to-back successful submissions are capped.
  markSuccess(req) {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    this.lastSuccessByIp.set(ip, Date.now());
  }
}

// One instance per form so the Admission Form's cooldown and the Career
// Form's cooldown never interfere with each other for a shared IP (e.g.
// office/NAT connections, or someone reasonably submitting both forms
// back to back).
const admissionCooldown = new SubmissionCooldown(FORM_SUBMIT_COOLDOWN_MS);
const careerCooldown = new SubmissionCooldown(FORM_SUBMIT_COOLDOWN_MS);

module.exports = { SubmissionCooldown, admissionCooldown, careerCooldown };
