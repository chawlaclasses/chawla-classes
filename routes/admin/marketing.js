/**
 * routes/admin/marketing.js
 *
 * Admin-side Marketing Banners — CRUD for the promotional banners/offers
 * that show on the public website. Public read is separate and
 * unauthenticated (routes/marketing.js — GET /api/marketing/banners),
 * same split as recruitment/admissions/enquiries.
 *
 * Two placements a banner can target:
 *   'top_bar'  — thin sticky strip at the top of every page (one urgent
 *                message, e.g. "Admissions open for 2027 batch")
 *   'homepage' — a promo card in a dedicated section on index.html
 *                (offers, new batch launches, etc.), several can be active
 *                at once, ordered by `priority` (lower shows first)
 *
 * Mounted at '/marketing' by routes/adminRoutes.js, under app.js's
 * '/api/admin' + requireApiAdmin. Campaign sending lives in the sibling
 * routes/admin/marketing-campaigns.js, mounted at '/marketing/campaigns'.
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

const EDITABLE_FIELDS = ["title", "message", "placement", "ctaText", "ctaLink", "imageUrl", "startDate", "endDate", "priority", "isActive"];

// List — admin view includes inactive/expired banners too, unlike the
// public endpoint, so Rohit can see and re-activate/edit old offers.
router.get("/banners", requirePermission("marketing:view"), (req, res) => {
  try {
    const banners = db
      .find("marketingBanners", {})
      .slice()
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, data: banners });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.post("/banners", requirePermission("marketing:create"), validators.createMarketingBanner, validate, (req, res) => {
  try {
    const { title, message, placement, ctaText, ctaLink, imageUrl, startDate, endDate, priority } = req.body;

    const banner = db.insertOne("marketingBanners", {
      title: title.trim(),
      message: message.trim(),
      placement: placement || "homepage",
      ctaText: (ctaText || "").trim(),
      ctaLink: (ctaLink || "").trim(),
      imageUrl: (imageUrl || "").trim(),
      startDate: startDate || "",
      endDate: endDate || "",
      priority: priority !== undefined ? priority : 0,
      isActive: true,
      createdBy: req.userData.name,
    });

    logAudit(req, "create", "marketing-banner", banner._id, `Created banner "${title}"`);
    res.status(201).json({ success: true, data: banner, message: "Banner created" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.put("/banners/:id", requirePermission("marketing:edit"), validators.updateMarketingBanner, validate, (req, res) => {
  try {
    const banner = db.findById("marketingBanners", req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: "Banner not found" });

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] === undefined) continue;
      updates[field] = typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
    }

    const updated = db.findByIdAndUpdate("marketingBanners", req.params.id, updates);
    logAudit(req, "edit", "marketing-banner", req.params.id, `Updated banner "${banner.title}"`);
    res.json({ success: true, data: updated, message: "Banner updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.delete("/banners/:id", requirePermission("marketing:delete"), (req, res) => {
  try {
    const banner = db.findById("marketingBanners", req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: "Banner not found" });

    db.findByIdAndDelete("marketingBanners", req.params.id);
    logAudit(req, "delete", "marketing-banner", req.params.id, `Deleted banner "${banner.title}"`);
    res.json({ success: true, message: "Banner deleted" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
