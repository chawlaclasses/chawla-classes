/**
 * utils/auditLog.js
 *
 * Records admin actions (login, edit, delete, import, export) to the
 * 'audit-logs' jsonDb collection so they can be reviewed later from the
 * Audit Logs page. This is intentionally a plain insert, not middleware —
 * call it explicitly at the point in each route where the action actually
 * happened (and succeeded), so the log reflects what was really done, not
 * just what was requested.
 */

"use strict";

const db = require("../services/jsonDb");

/**
 * @param {object} req - Express request (used for admin identity + IP)
 * @param {string} action - one of: 'login', 'login_failed', 'create', 'edit', 'delete', 'import', 'export'
 * @param {string} targetType - e.g. 'student', 'class', 'question', 'fee'
 * @param {string} [targetId] - id of the affected record, if any
 * @param {string} [details] - short human-readable description
 */
function logAudit(req, action, targetType, targetId, details) {
  try {
    let adminName = req.user?.name;
    if (!adminName && req.user?.id) {
      const admin = db.findById('users', req.user.id);
      adminName = admin?.name;
    }
    db.insertOne("audit-logs", {
      adminId: req.user?.id || null,
      adminName: adminName || req.user?.email || req.body?.email || "unknown",
      action,
      targetType,
      targetId: targetId || null,
      details: details || "",
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown"
    });
  } catch (_) {
    // Audit logging must never break the actual request it's observing.
  }
}

module.exports = { logAudit };
