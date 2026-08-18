/**
 * routes/admin/categories.js
 *
 * Admin-side CRUD for homepage navbar categories (replaces the previously
 * hardcoded Home/About/Courses/Leadership/Results/Fees & Timings/Classes/
 * Admission/Careers/Feedback/Contact links in index.html's navbar + mobile
 * drawer). Public read is separate and unauthenticated
 * (routes/categories.js — GET /api/categories), same split as marketing
 * banners.
 *
 * Mounted at '/categories' by routes/adminRoutes.js, under app.js's
 * '/api/admin' + requireApiAdmin.
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

const EDITABLE_FIELDS = ["name", "slug", "url", "icon", "order", "isActive"];

// List — admin view includes inactive categories too, unlike the public
// endpoint, so they can be edited/re-activated.
router.get("/", requirePermission("categories:view"), (req, res) => {
  try {
    const categories = db
      .find("categories", {})
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    res.json({ success: true, data: categories });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.post("/", requirePermission("categories:create"), validators.createCategory, validate, (req, res) => {
  try {
    const { name, slug, url, icon, order, isActive } = req.body;

    const existing = db.find("categories", {}).find((c) => c.slug === slug.trim().toLowerCase());
    if (existing) {
      return res.status(400).json({ success: false, message: `A category with slug "${slug}" already exists.` });
    }

    // Default a new category's order to the end of the list (max existing
    // order + 1) unless the admin explicitly picked one, so it doesn't
    // silently jump ahead of everything by defaulting to 0.
    const allCategories = db.find("categories", {});
    const nextOrder = allCategories.length
      ? Math.max(...allCategories.map((c) => c.order ?? 0)) + 1
      : 0;

    const category = db.insertOne("categories", {
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      url: url.trim(),
      icon: (icon || "").trim(),
      order: order !== undefined ? order : nextOrder,
      isActive: isActive !== undefined ? !!isActive : true,
      createdBy: req.userData.name,
    });

    logAudit(req, "create", "category", category._id, `Created category "${name}"`);
    res.status(201).json({ success: true, data: category, message: "Category created" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Reorder — bulk-writes `order` to match the given ID order (index in the
// array becomes the new order, lower shows first). Must stay ABOVE the PUT
// /:id route below: both are PUT under /..., and Express matches route
// definitions in file order, so /:id would otherwise swallow a
// /reorder request with id="reorder".
router.put("/reorder", requirePermission("categories:edit"), validators.reorderCategories, validate, (req, res) => {
  try {
    const { orderedIds } = req.body;
    orderedIds.forEach((id, index) => {
      db.findByIdAndUpdate("categories", id, { order: index });
    });
    logAudit(req, "edit", "category", null, `Reordered ${orderedIds.length} categor${orderedIds.length === 1 ? "y" : "ies"}`);
    res.json({ success: true, message: "Categories reordered" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.put("/:id", requirePermission("categories:edit"), validators.updateCategory, validate, (req, res) => {
  try {
    const category = db.findById("categories", req.params.id);
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });

    if (req.body.slug !== undefined) {
      const slug = req.body.slug.trim().toLowerCase();
      const clash = db.find("categories", {}).find((c) => c.slug === slug && c._id !== req.params.id);
      if (clash) {
        return res.status(400).json({ success: false, message: `A category with slug "${slug}" already exists.` });
      }
    }

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] === undefined) continue;
      if (field === "slug") { updates.slug = req.body.slug.trim().toLowerCase(); continue; }
      updates[field] = typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
    }

    const updated = db.findByIdAndUpdate("categories", req.params.id, updates);
    logAudit(req, "edit", "category", req.params.id, `Updated category "${category.name}"`);
    res.json({ success: true, data: updated, message: "Category updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Enable/Disable toggle — separate from the general PUT /:id so the admin
// UI's toggle switch can flip just isActive without resending the whole
// form (same pattern as PATCH /banners/:id/status would follow, mirrored
// here per the spec's FEATURE 5 + FEATURE 10 API list).
router.patch("/:id/status", requirePermission("categories:edit"), validators.updateCategoryStatus, validate, (req, res) => {
  try {
    const category = db.findById("categories", req.params.id);
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });

    const updated = db.findByIdAndUpdate("categories", req.params.id, { isActive: !!req.body.isActive });
    logAudit(req, "edit", "category", req.params.id, `${req.body.isActive ? "Activated" : "Deactivated"} category "${category.name}"`);
    res.json({ success: true, data: updated, message: "Category status updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.delete("/:id", requirePermission("categories:delete"), (req, res) => {
  try {
    const category = db.findById("categories", req.params.id);
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });

    db.findByIdAndDelete("categories", req.params.id);
    logAudit(req, "delete", "category", req.params.id, `Deleted category "${category.name}"`);
    res.json({ success: true, message: "Category deleted" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
