// controllers/mobileAppController.js
//
// Request handlers for the Mobile App module. Public reads
// (routes/mobileApp.js) and admin read/update (routes/admin/mobile-app.js)
// share this file; auth/permission gating is done by the routers, not here.

"use strict";

const logger = require("../utils/logger");
const { logAudit } = require("../utils/auditLog");
const service = require("../services/mobileApp");
const { sanitize } = require("../models/MobileAppSettings");

// The public payload: every setting an end user / the app may see, minus
// internal fields (_id). Nothing here is secret -- the APK link is public
// by definition.
function publicShape(s) {
  return {
    appName: s.appName,
    version: s.version,
    apkUrl: s.apkUrl,
    releaseNotes: s.releaseNotes,
    forceUpdate: Boolean(s.forceUpdate),
    showBanner: Boolean(s.showBanner),
    bannerTitle: s.bannerTitle,
    bannerDescription: s.bannerDescription,
    buttonText: s.buttonText,
    updatedAt: s.updatedAt || null,
  };
}

function serverError(req, res, error) {
  logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
  res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

// GET /api/mobile-app  (public)
function getSettings(req, res) {
  try {
    res.set("Cache-Control", "no-cache");
    res.json({ success: true, ...publicShape(service.getMobileAppSettings()) });
  } catch (e) { serverError(req, res, e); }
}

// GET /api/mobile-app/version  (public; polled by the Flutter app on launch)
function getVersion(req, res) {
  try {
    const s = service.getMobileAppSettings();
    res.set("Cache-Control", "no-cache");
    res.json({
      success: true,
      latestVersion: s.version,
      apkUrl: s.apkUrl,
      forceUpdate: Boolean(s.forceUpdate),
      releaseNotes: s.releaseNotes,
    });
  } catch (e) { serverError(req, res, e); }
}

// GET /api/admin/mobile-app
function adminGet(req, res) {
  try {
    res.json({ success: true, data: service.getMobileAppSettings() });
  } catch (e) { serverError(req, res, e); }
}

// PUT /api/admin/mobile-app
function adminUpdate(req, res) {
  try {
    const { errors, patch } = sanitize(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }
    const who = req.userData && (req.userData.email || req.userData.name || req.userData._id);
    const updated = service.updateMobileAppSettings(patch, who);
    logAudit(req, "edit", "mobile-app", null, `Updated mobile app settings (${Object.keys(patch).join(", ")})`);
    res.json({ success: true, data: updated, message: "Mobile app settings saved" });
  } catch (e) { serverError(req, res, e); }
}

module.exports = { getSettings, getVersion, adminGet, adminUpdate, publicShape };
