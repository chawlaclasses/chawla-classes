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
 *
 * Also here: POST /banners/upload-image (R2 image upload for the banner
 * form — JPG/PNG/WEBP, 5MB max) and PUT /banners/reorder (drag-reorder from
 * the admin UI, bulk rewrites `priority`).
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

const EDITABLE_FIELDS = ["title", "message", "placement", "ctaText", "ctaLink", "imageUrl", "startDate", "endDate", "priority", "isActive"];

// ── Banner image upload (optional) ─────────────────────────────────────────
// Same "memoryStorage -> validate magic bytes -> uploadFileToR2()" pattern
// as routes/settings.js's branding logo/favicon upload. Kept as its own
// endpoint (rather than accepting multipart on POST/PUT /banners) so the
// admin banner form can upload the image first and just send the resulting
// URL as a normal JSON field, same as it already does for a pasted image
// URL — the form doesn't need two different code paths.
const ALLOWED_BANNER_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ALLOWED_BANNER_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BANNER_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const uploadBannerImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BANNER_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_BANNER_IMAGE_EXT.has(ext)) {
      return cb(new Error(`Unsupported image type: ${ext}. Use JPG, PNG, or WEBP.`));
    }
    cb(null, true);
  },
});

// FIX: multer's fileFilter/limits errors (wrong type, LIMIT_FILE_SIZE) arrive
// as a plain Error with no .status/.statusCode set, thrown from inside
// upload middleware, BEFORE the route handler's own try/catch ever runs.
// Left as-is, the app's global error handler (middleware/errors.js) treats
// any error without a status as a 500 and returns the generic "Internal
// server error" — hiding the actual, useful reason ("File too large" /
// "Unsupported image type") from the admin UI. Wrapping .single() in a
// plain callback here (instead of using it directly as route middleware)
// lets us catch that error ourselves and send back a clean, specific 400.
// Scoped to just this endpoint — no other upload route in the app is
// touched by this change.
function handleBannerImageUpload(req, res, next) {
  uploadBannerImage.single("image")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, message: "Image is too large. Max size is 5MB." });
    }
    return res.status(400).json({ success: false, message: err.message || "Upload failed" });
  });
}

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
    // LOGGING (2026-08-12 fix): the exact imageUrl string persisted to
    // MongoDB for this banner, so a bad URL is visible in logs right at
    // save time instead of only being discovered later on the homepage.
    logger.info(`Marketing banner saved: id=${banner._id} imageUrl="${banner.imageUrl || "(none)"}"`);
    res.status(201).json({ success: true, data: banner, message: "Banner created" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Upload a banner image to R2 and hand back its public URL — used by the
// Add/Edit Banner form before create/update; NOT mounted under /:id so it
// works for a banner that doesn't exist yet.
router.post("/banners/upload-image", requirePermission("marketing:create"), handleBannerImageUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const isValid = await validateBufferContent(req.file.buffer, ALLOWED_BANNER_IMAGE_MIMES);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "File content does not match its extension. Upload rejected." });
    }
    await uploadFileToR2(req.file, "marketing-banners");
    // LOGGING (2026-08-12 fix): uploaded key + generated public URL, right
    // where the admin form receives the URL it's about to send back on
    // POST/PUT /banners for MongoDB save — makes it obvious in logs if the
    // URL handed to the frontend doesn't look like a real R2 public URL.
    logger.info(`Marketing banner image uploaded: key="${req.file.r2Key}" publicUrl=${req.file.r2Url}`);
    res.json({ success: true, data: { imageUrl: req.file.r2Url }, message: "Image uploaded" });
  } catch (error) {
    if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key);
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Reorder — bulk-writes `priority` to match the given ID order (index in
// the array becomes the new priority, lower shows first). Must stay ABOVE
// the PUT /banners/:id route below: both are PUT under /banners/..., and
// Express matches route definitions in file order, so /banners/:id would
// otherwise swallow a /banners/reorder request with id="reorder".
router.put("/banners/reorder", requirePermission("marketing:edit"), validators.reorderMarketingBanners, validate, (req, res) => {
  try {
    const { orderedIds } = req.body;
    orderedIds.forEach((id, index) => {
      db.findByIdAndUpdate("marketingBanners", id, { priority: index });
    });
    logAudit(req, "edit", "marketing-banner", null, `Reordered ${orderedIds.length} banner(s)`);
    res.json({ success: true, message: "Banners reordered" });
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
    if (updates.imageUrl !== undefined) {
      // LOGGING (2026-08-12 fix): same as the create path above.
      logger.info(`Marketing banner updated: id=${req.params.id} imageUrl="${updated.imageUrl || "(none)"}"`);
    }
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
