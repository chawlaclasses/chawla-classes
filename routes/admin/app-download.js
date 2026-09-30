/**
 * routes/admin/app-download.js
 *
 * Admin controls for the website's "Download App" button:
 *   GET    /api/admin/app-download          current settings
 *   PUT    /api/admin/app-download          text, source, placements, on/off
 *   POST   /api/admin/app-download/upload   upload the APK (multipart, field "apk")
 *   DELETE /api/admin/app-download/file     remove the uploaded APK
 *
 * Reuses the footer:view / footer:edit permissions (Admin -> App Download
 * sits next to Footer Management) so no role config changes are needed.
 */

"use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const router = express.Router();

const logger = require("../../utils/logger");
const { logAudit } = require("../../utils/auditLog");
const { requirePermission } = require("../../middleware/permissions");
const r2Service = require("../../services/r2Service");
const svc = require("../../services/appDownload");

const MAX_APK_MB = parseInt(process.env.APP_APK_MAX_MB, 10) || 150;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_APK_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== ".apk") {
      return cb(new Error("Only .apk files can be uploaded"));
    }
    cb(null, true);
  },
});

function fail(req, res, error) {
  logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
  res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const isHttpUrl = (v) => {
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; }
  catch (_) { return false; }
};

router.get("/", requirePermission("footer:view"), (req, res) => {
  try {
    res.json({ success: true, data: svc.getAppDownload() });
  } catch (e) { fail(req, res, e); }
});

router.put("/", requirePermission("footer:edit"), (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};

    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;

    if (b.source !== undefined) {
      if (!["upload", "link"].includes(b.source)) {
        return res.status(400).json({ success: false, message: "Invalid source" });
      }
      patch.source = b.source;
    }

    if (b.externalUrl !== undefined) {
      const url = str(b.externalUrl, 500) || "";
      if (url && !isHttpUrl(url)) {
        return res.status(400).json({ success: false, message: "Link must start with http:// or https://" });
      }
      patch.externalUrl = url;
    }

    const label = str(b.buttonLabel, 40);
    if (label !== undefined) {
      if (!label) return res.status(400).json({ success: false, message: "Button text cannot be empty" });
      patch.buttonLabel = label;
    }
    const footerText = str(b.footerText, 100);
    if (footerText !== undefined) patch.footerText = footerText;
    const versionLabel = str(b.versionLabel, 20);
    if (versionLabel !== undefined) {
      if (versionLabel && !/^\d+(\.\d+){0,3}$/.test(versionLabel)) {
        return res.status(400).json({ success: false, message: "Version should look like 1.0.1" });
      }
      patch.versionLabel = versionLabel;
    }
    const notes = str(b.releaseNotes, 500);
    if (notes !== undefined) patch.releaseNotes = notes;

    if (b.placements && typeof b.placements === "object") {
      patch.placements = {};
      for (const k of ["header", "mobileMenu", "footer", "floating"]) {
        if (typeof b.placements[k] === "boolean") patch.placements[k] = b.placements[k];
      }
    }

    const merged = { ...svc.getAppDownload(), ...patch };
    if (merged.enabled && merged.source === "upload" && !(merged.file && merged.file.key)) {
      return res.status(400).json({ success: false, message: "Upload an APK first, or switch source to Link" });
    }

    const updated = svc.updateAppDownload(patch);
    logAudit(req, "edit", "app-download", null, "Updated app download settings");
    res.json({ success: true, data: updated, message: "App download settings saved" });
  } catch (e) { fail(req, res, e); }
});

router.post("/upload", requirePermission("footer:edit"), (req, res) => {
  upload.single("apk")(req, res, async (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? `APK is too large (max ${MAX_APK_MB} MB)` : err.message;
      return res.status(400).json({ success: false, message: msg });
    }
    try {
      if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

      // An APK is a ZIP container: real files start with "PK\x03\x04".
      const b = req.file.buffer;
      if (b.length < 4 || b[0] !== 0x50 || b[1] !== 0x4b || b[2] !== 0x03 || b[3] !== 0x04) {
        return res.status(400).json({ success: false, message: "This doesn't look like a valid APK file" });
      }

      const previous = svc.getAppDownload().file;
      const key = r2Service.generateKey("app-releases", req.file.originalname);
      await r2Service.uploadBuffer({
        buffer: b,
        key,
        contentType: "application/vnd.android.package-archive",
      });

      const file = {
        key,
        name: path.basename(req.file.originalname),
        size: req.file.size,
        uploadedAt: new Date().toISOString(),
      };
      const patch = { file, source: "upload" };
      const version = str(req.body && req.body.versionLabel, 20);
      if (version && /^\d+(\.\d+){0,3}$/.test(version)) patch.versionLabel = version;
      const updated = svc.updateAppDownload(patch);

      if (previous && previous.key && previous.key !== key) await r2Service.deleteObject(previous.key);

      logAudit(req, "edit", "app-download", null, `Uploaded APK ${file.name} (${file.size} bytes)`);
      res.json({ success: true, data: updated, message: "APK uploaded" });
    } catch (e) {
      logger.error(`APK upload failed: ${e.message}`, { stack: e.stack });
      res.status(502).json({ success: false, message: "File storage upload failed. Please try again." });
    }
  });
});

router.delete("/file", requirePermission("footer:edit"), async (req, res) => {
  try {
    const current = svc.getAppDownload();
    if (current.file && current.file.key) await r2Service.deleteObject(current.file.key);
    const updated = svc.updateAppDownload({
      file: null,
      source: "link",
    });
    logAudit(req, "delete", "app-download", null, "Removed uploaded APK");
    res.json({ success: true, data: updated, message: "APK removed" });
  } catch (e) { fail(req, res, e); }
});

module.exports = router;
