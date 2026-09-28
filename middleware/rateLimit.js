"use strict";

const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_ATTEMPTS } = require("../config");

// Simple in-memory rate limiter
class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000;
    this.maxRequests = options.maxRequests || 100;
    this.message = options.message || "Too many requests, please try again later";
    this.store = new Map();
    this.statusCode = options.statusCode || 429;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      if (now - data.timestamp > this.windowMs) {
        this.store.delete(key);
      }
    }
  }

  getClientId(req) {
    const userId = req.tokenPayload?.id || req.user?.id;
    const ip = req.ip || req.connection?.remoteAddress;
    return `${userId || ip || 'anonymous'}`;
  }

  middleware() {
    return (req, res, next) => {
      if (Math.random() < 0.1) {
        this.cleanup();
      }

      const clientId = this.getClientId(req);
      const now = Date.now();
      const clientData = this.store.get(clientId);

      if (!clientData) {
        this.store.set(clientId, {
          count: 1,
          timestamp: now
        });
        return next();
      }

      if (now - clientData.timestamp > this.windowMs) {
        this.store.set(clientId, {
          count: 1,
          timestamp: now
        });
        return next();
      }

      if (clientData.count >= this.maxRequests) {
        return res.status(this.statusCode).json({
          success: false,
          message: this.message,
          retryAfter: Math.ceil((clientData.timestamp + this.windowMs - now) / 1000)
        });
      }

      clientData.count += 1;
      this.store.set(clientId, clientData);
      next();
    };
  }
}

// Rate limiter factories
function createTestRateLimiter(maxRequests = 50) {
  return new RateLimiter({
    windowMs: 60000,
    maxRequests,
    message: "Too many test requests. Please slow down."
  }).middleware();
}

function createSubmissionRateLimiter(maxRequests = 10) {
  return new RateLimiter({
    windowMs: 60000,
    maxRequests,
    message: "Too many submissions. Please wait before submitting again."
  }).middleware();
}

// SECURITY: hourly cap for the two public lead-capture forms (Admission,
// Career/Faculty Recruitment) — see routes/publicEnquiry.js and
// routes/recruitment.js. Separate factory from createSubmissionRateLimiter
// (per-minute) since these need a much longer, per-hour window; reuses the
// same RateLimiter class/store so behavior (429 + retryAfter) is identical
// to every other rate limiter in this file.
function createHourlyRateLimiter(maxRequests, message) {
  return new RateLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests,
    message: message || "Too many submissions from this device this hour. Please try again later.",
  }).middleware();
}

function createQuestionRateLimiter(maxRequests = 20) {
  return new RateLimiter({
    windowMs: 60000,
    maxRequests,
    message: "Too many question requests. Please slow down."
  }).middleware();
}

// SECURITY: RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX_ATTEMPTS were already
// defined in config/index.js (env-overridable, default 10 attempts per 15
// minutes) but were never actually used anywhere in the app — login had no
// IP-based rate limiting at all. The per-account lockout in
// utils/accountLock.js only stops repeated guesses against one *known*
// email; it does nothing to stop an attacker trying many different emails
// from the same IP. This closes that gap using the config values that were
// clearly built for it. Keyed by IP here since login requests are
// unauthenticated (no req.user yet), same as getClientId()'s existing
// fallback behavior above.
function createAuthRateLimiter() {
  return new RateLimiter({
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: RATE_LIMIT_MAX_ATTEMPTS,
    message: "Too many login attempts from this device. Please try again later.",
  }).middleware();
}

module.exports = {
  RateLimiter,
  createTestRateLimiter,
  createSubmissionRateLimiter,
  createHourlyRateLimiter,
  createQuestionRateLimiter,
  createAuthRateLimiter
};