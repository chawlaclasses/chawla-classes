/**
 * routes/admin/website-sections.js
 *
 * Admin-side "Website Builder" — a GoDaddy/Wix-style section library for
 * the homepage. An admin picks a section TYPE (hero banner, text, image,
 * image+text, gallery, testimonials, FAQ, video, CTA banner, contact) and
 * fills in a fixed, per-type form (see utils/validators.js's
 * SECTION_FIELD_VALIDATORS for the exact field list per type). There is
 * deliberately no free-text HTML/rich-text field anywhere in this module
 * — public/admin/js/website-builder.js renders plain form inputs only,
 * and index.html's public renderer builds each section with DOM APIs
 * (createElement + textContent), never innerHTML of admin-entered text.
 * An admin literally cannot inject markup through this feature by design,
 * not just by convention.
 *
 * This replaces the earlier "Pages" module (routes/admin/pages.js /
 * routes/pages.js / public/page-template.html / Quill editor), which was
 * removed rather than kept alongside this — that module allowed raw
 * HTML/rich-text content, which is exactly what this feature exists to
 * NOT need.
 *
 * Public read is separate and unauthenticated (routes/website-sections.js
 * — GET /api/website-sections), same split as marketing banners/
 * categories. Mounted at '/website-sections' by routes/adminRoutes.js,
 * under app.js's '/api/admin' + requireApiAdmin.
 */

"use strict";

const path = require("path");
const multer = require("multer");
const express = require("express");
const router = express.Router();

const db = require("../../services/jsonDb");
const logger = require("../../utils/logger");
const { logAudit } = require("../../utils/auditLog");
const { requirePermission } = require("../../middleware/permissions");
const { validate } = require("../../middleware/validation");
const validators = require("../../utils/validators");
const { uploadFileToR2 } = require("../../middleware/upload");
const { validateBufferContent } = require("../../utils/helpers");
const r2Service = require("../../services/r2Service");

const EDITABLE_FIELDS = ["type", "data", "page", "anchor", "order", "isActive"];

const SECTION_TYPES = [
  "hero", "text", "image", "image_text", "gallery",
  "testimonials", "faq", "video", "cta", "contact",
];

// Sections with no `page` at all (every one created before this
// multi-page feature existed) are treated as belonging to the homepage —
// see routes/website-sections.js's public GET, which filters on this same
// default.
const DEFAULT_PAGE = "home";

// ── Section image upload ────────────────────────────────────────────────
// Same "memoryStorage -> validate magic bytes -> uploadFileToR2()" pattern
// as routes/admin/marketing.js's banner image upload. One shared endpoint
// for every image field across every section type (hero background,
// image/image+text, gallery — one call per file, testimonial photos) —
// the admin form uploads a file here first and stores the returned URL in
// the section's `data`, same two-step flow as the marketing banner form.
const ALLOWED_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const uploadSectionImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMAGE_EXT.has(ext)) {
      return cb(new Error(`Unsupported image type: ${ext}. Use JPG, PNG, or WEBP.`));
    }
    cb(null, true);
  },
});

// Same reasoning as marketing.js's handleBannerImageUpload — multer's
// fileFilter/limits errors bypass the route handler's own try/catch, so
// they're caught here and turned into a clean 400 instead of the global
// error handler's generic 500.
function handleSectionImageUpload(req, res, next) {
  uploadSectionImage.single("image")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, message: "Image is too large. Max size is 5MB." });
    }
    return res.status(400).json({ success: false, message: err.message || "Upload failed" });
  });
}

router.post("/upload-image", requirePermission("website_builder:create"), handleSectionImageUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const isValid = await validateBufferContent(req.file.buffer, ALLOWED_IMAGE_MIMES);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "File content does not match its extension. Upload rejected." });
    }
    await uploadFileToR2(req.file, "website-sections");
    res.json({ success: true, data: { imageUrl: req.file.r2Url }, message: "Image uploaded" });
  } catch (error) {
    if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key);
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.get("/", requirePermission("website_builder:view"), (req, res) => {
  try {
    const sections = db
      .find("websiteSections", {})
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    res.json({ success: true, data: sections });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.post("/", requirePermission("website_builder:create"), validators.createSection, validate, (req, res) => {
  try {
    const { type, data, page, anchor, order, isActive } = req.body;
    const targetPage = (page || DEFAULT_PAGE).trim().toLowerCase();

    // Order is scoped per-page (each page has its own 0,1,2... sequence),
    // not global -- otherwise every new page's first section would start
    // at whatever the homepage's section count happened to be.
    const pageSections = db.find("websiteSections", { page: targetPage });
    const homeUngroupedSections = targetPage === DEFAULT_PAGE
      ? db.find("websiteSections", {}).filter((s) => !s.page) // pre-migration sections with no `page` field at all
      : [];
    const allInPage = [...pageSections, ...homeUngroupedSections];
    const nextOrder = allInPage.length ? Math.max(...allInPage.map((s) => s.order ?? 0)) + 1 : 0;

    const section = db.insertOne("websiteSections", {
      type,
      data,
      page: targetPage,
      anchor: anchor || "end",
      order: order !== undefined ? order : nextOrder,
      isActive: isActive !== undefined ? !!isActive : true,
      createdBy: req.userData.name,
    });

    logAudit(req, "create", "website-section", section._id, `Added ${type} section to "${targetPage}"`);
    res.status(201).json({ success: true, data: section, message: "Section added" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Must stay ABOVE PUT /:id — see the identical note in
// routes/admin/categories.js (Express matches route definitions in file
// order, so /:id would otherwise swallow a /reorder request).
router.put("/reorder", requirePermission("website_builder:edit"), validators.reorderSections, validate, (req, res) => {
  try {
    const { orderedIds } = req.body;
    orderedIds.forEach((id, index) => {
      db.findByIdAndUpdate("websiteSections", id, { order: index });
    });
    logAudit(req, "edit", "website-section", null, `Reordered ${orderedIds.length} section${orderedIds.length === 1 ? "" : "s"}`);
    res.json({ success: true, message: "Sections reordered" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.put("/:id", requirePermission("website_builder:edit"), validators.updateSection, validate, (req, res) => {
  try {
    const section = db.findById("websiteSections", req.params.id);
    if (!section) return res.status(404).json({ success: false, message: "Section not found" });

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] === undefined) continue;
      updates[field] = field === "page" ? req.body.page.trim().toLowerCase() : req.body[field];
    }

    // See the comment on validators.validateSectionData's export: when
    // `data` changes without `type` in the same request, the express-
    // validator chain couldn't check field shape against the record's
    // real type (no DB access there). Re-validate here, against
    // whichever type will actually be saved, before it touches MongoDB.
    if (updates.data !== undefined) {
      try {
        validators.validateSectionData(updates.type || section.type, updates.data);
      } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
    }

    const updated = db.findByIdAndUpdate("websiteSections", req.params.id, updates);
    logAudit(req, "edit", "website-section", req.params.id, `Updated ${section.type} section`);
    res.json({ success: true, data: updated, message: "Saved" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.patch("/:id/status", requirePermission("website_builder:edit"), validators.updateSectionStatus, validate, (req, res) => {
  try {
    const section = db.findById("websiteSections", req.params.id);
    if (!section) return res.status(404).json({ success: false, message: "Section not found" });

    const updated = db.findByIdAndUpdate("websiteSections", req.params.id, { isActive: !!req.body.isActive });
    logAudit(req, "edit", "website-section", req.params.id, `${req.body.isActive ? "Showed" : "Hid"} ${section.type} section`);
    res.json({ success: true, data: updated, message: "Status updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Must stay ABOVE DELETE /:id — same file-order note as PUT /reorder
// above (Express matches route definitions in order, so /:id would
// otherwise swallow a /page/:pageSlug request as if "page" were itself a
// section id).
router.delete("/page/:pageSlug", requirePermission("website_builder:delete"), (req, res) => {
  try {
    const pageSlug = req.params.pageSlug.trim().toLowerCase();
    if (pageSlug === DEFAULT_PAGE) {
      // "home" isn't a standalone page an admin created (it's the
      // homepage's own dynamicHomepageSections container) -- deleting it
      // outright makes no sense the way deleting a real page does, and
      // there's no page tab to remove afterward. Clearing home sections
      // individually is what the per-section Delete button is for.
      return res.status(400).json({ success: false, message: "The homepage can't be deleted. Remove its sections individually instead." });
    }

    const sections = db.find("websiteSections", { page: pageSlug });
    if (sections.length === 0) return res.status(404).json({ success: false, message: "Page not found" });

    sections.forEach((s) => db.findByIdAndDelete("websiteSections", s._id));
    logAudit(req, "delete", "website-section", null, `Deleted page "${pageSlug}" (${sections.length} section${sections.length === 1 ? "" : "s"})`);
    res.json({ success: true, message: `Page deleted (${sections.length} section${sections.length === 1 ? "" : "s"} removed)` });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.delete("/:id", requirePermission("website_builder:delete"), (req, res) => {
  try {
    const section = db.findById("websiteSections", req.params.id);
    if (!section) return res.status(404).json({ success: false, message: "Section not found" });

    db.findByIdAndDelete("websiteSections", req.params.id);
    logAudit(req, "delete", "website-section", req.params.id, `Deleted ${section.type} section`);
    res.json({ success: true, message: "Section deleted" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
module.exports.SECTION_TYPES = SECTION_TYPES;