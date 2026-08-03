/**
 * utils/loginHistory.js
 *
 * Records every login attempt (success, wrong password, or blocked by the
 * account lockout) to its own 'login-history' collection — separate from
 * the general 'audit-logs' collection (utils/auditLog.js), which only ever
 * covered admin actions. This one covers *every* role (admin, teacher,
 * reception, accountant, student) so both the admin "Login History" page
 * and each student's own "Login Activity" view can read from one place.
 *
 * Also does light User-Agent parsing so entries can show something a human
 * can actually recognize ("Chrome on Windows") instead of a raw UA string.
 * This is intentionally a small hand-rolled parser, not a new dependency —
 * good enough to flag "is this a device I don't recognize?", not meant to
 * be a precise analytics-grade UA database.
 */

"use strict";

const db = require("../services/jsonDb");

const parseDevice = (userAgentString) => {
  const ua = userAgentString || "";
  if (!ua) return "Unknown device";

  // Non-browser clients (Postman, curl, mobile app webviews hitting the API
  // directly) — worth calling out explicitly since a "login" with no
  // browser at all is exactly the kind of thing this feature exists to surface.
  if (/curl|Postman|python-requests|axios\/|okhttp/i.test(ua)) {
    const toolMatch = ua.match(/^(curl|Postman|python-requests|axios|okhttp)[^\s/]*/i);
    return `${toolMatch ? toolMatch[0] : "API client"} (no browser)`;
  }

  let os = "Unknown OS";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/iPhone/.test(ua)) os = "iPhone";
  else if (/iPad/.test(ua)) os = "iPad";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(ua)) os = "Linux";

  let browser = "Unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/CriOS/.test(ua)) browser = "Chrome"; // Chrome on iOS
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";

  return `${browser} on ${os}`;
};

const getClientIp = (req) =>
  req.ip ||
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  "unknown";

/**
 * @param {object} req
 * @param {object} params
 * @param {string} params.status - 'success' | 'failed' | 'locked'
 * @param {string} [params.userId]
 * @param {string} [params.name]
 * @param {string} params.email
 * @param {string} [params.role]
 * @param {string} [params.reason] - short human-readable reason (shown for failed/locked)
 */
const recordLogin = (req, { status, userId, name, email, role, reason }) => {
  try {
    db.insertOne("login-history", {
      userId: userId || null,
      name: name || null,
      email,
      role: role || null,
      status, // success | failed | locked
      reason: reason || null,
      ip: getClientIp(req),
      userAgent: req.headers["user-agent"] || "",
      device: parseDevice(req.headers["user-agent"]),
    });
  } catch (_) {
    // Login-history logging must never break the login flow it's observing.
  }
};

module.exports = { recordLogin, parseDevice, getClientIp };
