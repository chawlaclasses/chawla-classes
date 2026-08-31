/**
 * routes/admin/footer-settings.js
 *
 * Admin GET/PUT for the footer's About column, Contact Info column, and
 * Bottom Bar text — the singleton record in services/footerSettings.js.
 * Public read is separate and unauthenticated (routes/footer.js — GET
 * /api/footer), same split as the rest of Footer Management.
 *
 * Mounted at '/footer-settings' by routes/adminRoutes.js, under
 * app.js's '/api/admin' + requireApiAdmin. Final URLs:
 * GET/PUT /api/admin/footer-settings.
 */

"use strict";

const express = require("express");
const router = express.Router();

const logger = require("../../utils/logger");
const { logAudit } = require("../../utils/auditLog");
const { requirePermission } = require("../../middleware/permissions");
const { validate } = require("../../middleware/validation");
const validators = require("../../utils/validators");
const footerSettingsService = require("../../services/footerSettings");

router.get("/", requirePermission("footer:view"), (req, res) => {
  try {
    res.json({ success: true, data: footerSettingsService.getFooterSettings() });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.put("/", requirePermission("footer:edit"), validators.updateFooterSettings, validate, (req, res) => {
  try {
    const patch = {};
    if (req.body.about) patch.about = req.body.about;
    if (req.body.contact) patch.contact = req.body.contact;
    if (req.body.bottomBar) patch.bottomBar = req.body.bottomBar;

    const updated = footerSettingsService.updateFooterSettings(patch);
    logAudit(req, "edit", "footer-settings", null, "Updated footer settings");
    res.json({ success: true, data: updated, message: "Footer settings saved" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
