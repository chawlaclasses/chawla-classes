/**
 * middleware/permissions.js
 *
 * requirePermission(permission) — route-level gate on top of
 * requireApiAdmin. requireApiAdmin only confirms "this is some logged-in
 * staff member"; this checks whether THIS staff member's role is allowed
 * to do THIS specific thing, per config/permissions.js.
 *
 * Must run after requireApiAdmin (or anything that sets req.userData),
 * since it reads req.userData.role.
 */

"use strict";

const { hasPermission } = require('../config/permissions');

function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.userData?.role;
    if (!role || !hasPermission(role, permission)) {
      return res.status(403).json({
        success: false,
        message: `Your role (${role || 'unknown'}) doesn't have permission to do this.`,
      });
    }
    next();
  };
}

module.exports = { requirePermission };
