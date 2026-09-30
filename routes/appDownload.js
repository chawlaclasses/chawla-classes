/**
 * routes/appDownload.js
 *
 * Public side of Admin -> App Download.
 *   GET /api/app-download  what the website needs to render the button
 *                          (on/off, label, where to show it) — no file keys.
 *   GET /download-app      what the button links to: streams the uploaded APK,
 *                          or redirects to the admin-set link, or (if nothing
 *                          is configured yet) to APP_DOWNLOAD_URL / APP_UPDATE_URL /
 *                          the Play Store listing.
 */

"use strict";

const express = require("express");
const router = express.Router();

const logger = require("../utils/logger");
const r2Service = require("../services/r2Service");
const svc = require("../services/appDownload");
const mobileApp = require("../services/mobileApp");

const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.chawlaclasses.student";

router.get("/", (_req, res) => {
  try {
    const s = svc.getAppDownload();
    res.set("Cache-Control", "no-cache");
    res.json({
      success: true,
      data: {
        enabled: Boolean(s.enabled),
        buttonLabel: s.buttonLabel,
        footerText: s.footerText,
        versionLabel: s.versionLabel,
        placements: s.placements,
      },
    });
  } catch (error) {
    logger.error(`GET /api/app-download failed: ${error.message}`, { stack: error.stack });
    res.json({ success: true, data: { enabled: false } });
  }
});

async function downloadHandler(req, res) {
  try {
    const s = svc.getAppDownload();

    if (s.source === "upload" && s.file && s.file.key) {
      try {
        svc.updateAppDownload({ downloadCount: (s.downloadCount || 0) + 1 });
      } catch (_) { /* counter is best-effort */ }
      const safeName = (s.file.name || "chawla-classes.apk").replace(/[^a-zA-Z0-9._-]/g, "_");
      return await r2Service.streamToResponse(s.file.key, res, { downloadName: safeName });
    }

    if (s.source === "link" && s.externalUrl) {
      try {
        svc.updateAppDownload({ downloadCount: (s.downloadCount || 0) + 1 });
      } catch (_) { /* best-effort */ }
      return res.redirect(302, s.externalUrl);
    }

    // Nothing set in Admin -> App Download: use the APK link from Admin ->
    // Mobile App, then env / Play Store as the last resort.
    let mobileApk = "";
    try { mobileApk = mobileApp.getMobileAppSettings().apkUrl || ""; } catch (_) { /* ignore */ }
    return res.redirect(302, mobileApk || process.env.APP_DOWNLOAD_URL || process.env.APP_UPDATE_URL || PLAY_STORE);
  } catch (error) {
    logger.error(`GET /download-app failed: ${error.message}`, { stack: error.stack });
    if (!res.headersSent) res.status(500).send("Download is temporarily unavailable. Please try again later.");
  }
}

module.exports = { router, downloadHandler };
