/**
 * routes/admin/footer-links.js
 *
 * Admin-side CRUD for the footer's "Quick Links" and "Student Resources"
 * columns (Admin -> Footer Management). Both columns share one
 * collection ('footerLinks'), scoped by a `column` field
 * ('quick_links' | 'student_resources') — same idea as
 * routes/admin/website-sections.js scoping sections by `page`. Order is
 * scoped per-column (each column has its own 0,1,2... sequence), same
 * reasoning as website-sections.js's per-page ordering.
 *
 * Public read is separate and unauthenticated (routes/footer.js — GET
 * /api/footer). Mounted at '/footer-links' by routes/adminRoutes.js,
 * under app.js's '/api/admin' + requireApiAdmin. Final URLs:
 * /api/admin/footer-links, /api/admin/footer-links/:id,
 * /api/admin/footer-links/:id/status, /api/admin/footer-links/reorder.
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../../services/jsonDb");
const logger = require("../../utils/logger");
const { logAudit } = require("../../utils/auditLog");
const { requirePermission } = require("../../middleware/permissions");
const { validate } = require("../../middleware/validation");
const validators = require("../../utils/validators");

const EDITABLE_FIELDS = ["column", "label", "url", "order", "isActive"];

const COLUMN_LABELS = {
  quick_links: "Quick Links",
  student_resources: "Student Resources",
};

// List — optionally filtered by ?column=quick_links|student_resources.
// Admin view includes disabled links too, unlike the public endpoint.
router.get("/", requirePermission("footer:view"), (req, res) => {
  try {
    const query = {};
    if (req.query.column) query.column = req.query.column;
    const links = db
      .find("footerLinks", query)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    res.json({ success: true, data: links });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.post("/", requirePermission("footer:create"), validators.createFooterLink, validate, (req, res) => {
  try {
    const { column, label, url, order, isActive } = req.body;

    const columnLinks = db.find("footerLinks", { column });
    const nextOrder = columnLinks.length ? Math.max(...columnLinks.map((l) => l.order ?? 0)) + 1 : 0;

    const link = db.insertOne("footerLinks", {
      column,
      label: label.trim(),
      url: url.trim(),
      order: order !== undefined ? order : nextOrder,
      isActive: isActive !== undefined ? !!isActive : true,
      createdBy: req.userData.name,
    });

    logAudit(req, "create", "footer-link", link._id, `Added "${label}" to ${COLUMN_LABELS[column] || column}`);
    res.status(201).json({ success: true, data: link, message: "Link added" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Reorder — must stay ABOVE PUT /:id (Express matches route definitions
// in file order; see the identical note in routes/admin/categories.js).
// The list of orderedIds sent by the admin UI is always scoped to a
// single column already (each column has its own reorder call), so
// re-indexing 0..n here per the given order is safe without needing the
// column itself in the request body.
router.put("/reorder", requirePermission("footer:edit"), validators.reorderFooterLinks, validate, (req, res) => {
  try {
    const { orderedIds } = req.body;
    orderedIds.forEach((id, index) => {
      db.findByIdAndUpdate("footerLinks", id, { order: index });
    });
    logAudit(req, "edit", "footer-link", null, `Reordered ${orderedIds.length} footer link${orderedIds.length === 1 ? "" : "s"}`);
    res.json({ success: true, message: "Links reordered" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.put("/:id", requirePermission("footer:edit"), validators.updateFooterLink, validate, (req, res) => {
  try {
    const link = db.findById("footerLinks", req.params.id);
    if (!link) return res.status(404).json({ success: false, message: "Link not found" });

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] === undefined) continue;
      updates[field] = typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
    }

    const updated = db.findByIdAndUpdate("footerLinks", req.params.id, updates);
    logAudit(req, "edit", "footer-link", req.params.id, `Updated "${link.label}"`);
    res.json({ success: true, data: updated, message: "Link updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Enable/Disable toggle — separate from the general PUT /:id so the admin
// UI's toggle switch can flip just isActive without resending the whole
// form (same pattern as routes/admin/categories.js's PATCH /:id/status).
router.patch("/:id/status", requirePermission("footer:edit"), validators.updateFooterLinkStatus, validate, (req, res) => {
  try {
    const link = db.findById("footerLinks", req.params.id);
    if (!link) return res.status(404).json({ success: false, message: "Link not found" });

    const updated = db.findByIdAndUpdate("footerLinks", req.params.id, { isActive: !!req.body.isActive });
    logAudit(req, "edit", "footer-link", req.params.id, `${req.body.isActive ? "Enabled" : "Disabled"} "${link.label}"`);
    res.json({ success: true, data: updated, message: "Status updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.delete("/:id", requirePermission("footer:delete"), (req, res) => {
  try {
    const link = db.findById("footerLinks", req.params.id);
    if (!link) return res.status(404).json({ success: false, message: "Link not found" });

    db.findByIdAndDelete("footerLinks", req.params.id);
    logAudit(req, "delete", "footer-link", req.params.id, `Deleted "${link.label}"`);
    res.json({ success: true, message: "Link deleted" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
module.exports.COLUMN_LABELS = COLUMN_LABELS;
