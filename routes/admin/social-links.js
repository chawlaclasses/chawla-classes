/**
 * routes/admin/social-links.js
 *
 * Admin-side CRUD for the footer's Social Links (Admin -> Footer
 * Management -> Social Links). An admin picks a platform from the fixed
 * list in config/socialPlatforms.js, provides a URL, and can override the
 * default icon. Public read is separate and unauthenticated
 * (routes/footer.js — GET /api/footer), same split as categories/
 * website-sections.
 *
 * Mounted at '/social-links' by routes/adminRoutes.js, under app.js's
 * '/api/admin' + requireApiAdmin. Final URLs: /api/admin/social-links,
 * /api/admin/social-links/:id, /api/admin/social-links/:id/status,
 * /api/admin/social-links/reorder.
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
const { DEFAULT_SOCIAL_ICONS } = require("../../config/socialPlatforms");

const EDITABLE_FIELDS = ["platform", "url", "icon", "order", "isActive"];

// List — admin view includes disabled links too, unlike the public
// endpoint, so they can be re-enabled/edited.
router.get("/", requirePermission("footer:view"), (req, res) => {
  try {
    const links = db
      .find("socialLinks", {})
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    res.json({ success: true, data: links });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.post("/", requirePermission("footer:create"), validators.createSocialLink, validate, (req, res) => {
  try {
    const { platform, url, icon, order, isActive } = req.body;

    // Default the icon to the platform's standard Font Awesome class
    // unless the admin explicitly typed a custom one.
    const resolvedIcon = (icon && icon.trim()) || DEFAULT_SOCIAL_ICONS[platform] || "";

    const allLinks = db.find("socialLinks", {});
    const nextOrder = allLinks.length ? Math.max(...allLinks.map((l) => l.order ?? 0)) + 1 : 0;

    const link = db.insertOne("socialLinks", {
      platform,
      url: url.trim(),
      icon: resolvedIcon,
      order: order !== undefined ? order : nextOrder,
      isActive: isActive !== undefined ? !!isActive : true,
      createdBy: req.userData.name,
    });

    logAudit(req, "create", "social-link", link._id, `Added ${platform} social link`);
    res.status(201).json({ success: true, data: link, message: "Social link added" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Reorder — must stay ABOVE PUT /:id (Express matches route definitions
// in file order; see the identical note in routes/admin/categories.js).
router.put("/reorder", requirePermission("footer:edit"), validators.reorderSocialLinks, validate, (req, res) => {
  try {
    const { orderedIds } = req.body;
    orderedIds.forEach((id, index) => {
      db.findByIdAndUpdate("socialLinks", id, { order: index });
    });
    logAudit(req, "edit", "social-link", null, `Reordered ${orderedIds.length} social link${orderedIds.length === 1 ? "" : "s"}`);
    res.json({ success: true, message: "Social links reordered" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.put("/:id", requirePermission("footer:edit"), validators.updateSocialLink, validate, (req, res) => {
  try {
    const link = db.findById("socialLinks", req.params.id);
    if (!link) return res.status(404).json({ success: false, message: "Social link not found" });

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] === undefined) continue;
      updates[field] = typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
    }
    // If the platform changed but no explicit icon was given in this same
    // request, refresh the icon to match the new platform's default —
    // otherwise a Facebook icon would silently stick around after
    // switching the platform to Instagram.
    if (updates.platform && req.body.icon === undefined) {
      updates.icon = DEFAULT_SOCIAL_ICONS[updates.platform] || link.icon;
    }

    const updated = db.findByIdAndUpdate("socialLinks", req.params.id, updates);
    logAudit(req, "edit", "social-link", req.params.id, `Updated ${link.platform} social link`);
    res.json({ success: true, data: updated, message: "Social link updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Enable/Disable toggle — separate from the general PUT /:id so the admin
// UI's toggle switch can flip just isActive without resending the whole
// form (same pattern as routes/admin/categories.js's PATCH /:id/status).
router.patch("/:id/status", requirePermission("footer:edit"), validators.updateSocialLinkStatus, validate, (req, res) => {
  try {
    const link = db.findById("socialLinks", req.params.id);
    if (!link) return res.status(404).json({ success: false, message: "Social link not found" });

    const updated = db.findByIdAndUpdate("socialLinks", req.params.id, { isActive: !!req.body.isActive });
    logAudit(req, "edit", "social-link", req.params.id, `${req.body.isActive ? "Enabled" : "Disabled"} ${link.platform} social link`);
    res.json({ success: true, data: updated, message: "Status updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.delete("/:id", requirePermission("footer:delete"), (req, res) => {
  try {
    const link = db.findById("socialLinks", req.params.id);
    if (!link) return res.status(404).json({ success: false, message: "Social link not found" });

    db.findByIdAndDelete("socialLinks", req.params.id);
    logAudit(req, "delete", "social-link", req.params.id, `Deleted ${link.platform} social link`);
    res.json({ success: true, message: "Social link deleted" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
