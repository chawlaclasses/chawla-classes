"use strict";
const { MessagingError } = require("../utils/errors");
const log = require("../utils/log");

/** Wrap async handlers; map MessagingError -> clean JSON, everything else -> 500 (no internals leaked). */
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (e) {
    if (e instanceof MessagingError || e.code === "TEMPLATE_VARS_MISSING") {
      const status = e.status || 400;
      if (e.details?.retryAfterSeconds) res.set("Retry-After", String(e.details.retryAfterSeconds));
      return res.status(status).json({ success: false, code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });
    }
    log.error(`${req.method} ${req.originalUrl} failed: ${e.message}`, { stack: e.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

function need(body, ...fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body[f] === null || body[f] === "");
  if (missing.length) throw new MessagingError(`Missing: ${missing.join(", ")}`, { code: "VALIDATION" });
}

const adminId = (req) => String(req.user?.id || req.user?._id || req.userData?._id || "admin");

module.exports = { handle, need, adminId };
