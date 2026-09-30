/**
 * routes/appVersion.js
 *
 * GET /api/app/version — FIX (connections audit 2026-09): the Flutter
 * app's UpdateCheckerService (lib/services/update_checker_service.dart)
 * calls ApiConstants.appVersion on every launch to decide whether to show
 * the Update Dialog, but this endpoint didn't exist anywhere on the
 * backend — every check silently failed (by design on the app side, see
 * that file's doc comment), so the in-app update prompt could never fire.
 *
 * Deliberately env-driven rather than a new admin-panel/DB feature: bump
 * APP_LATEST_VERSION (and APP_MIN_SUPPORTED_VERSION for a forced update)
 * in the environment when a new build ships, no code change needed. Public
 * (no auth) since it's asked before login too, same trust level as
 * routes/health.js.
 */

"use strict";

const express = require("express");
const router = express.Router();
const mobileApp = require("../services/mobileApp");
const appDownloadService = require("../services/appDownload");

router.get("/version", (req, res) => {
  const platform = (req.query.platform || "android").toString().toLowerCase();
  const defaultUrl = platform === "ios"
    ? "https://apps.apple.com/app/chawla-classes"
    : "https://play.google.com/store/apps/details?id=com.chawlaclasses.student";

  // Admin -> System -> Mobile App is the source of truth (see
  // services/mobileApp.js). This legacy endpoint stays so app builds that
  // still call /api/app/version keep working: forceUpdate maps to
  // minSupportedVersion = latest version, i.e. "everyone older must update".
  // The env vars below are only a fallback if the settings can't be read.
  try {
    const s = mobileApp.getMobileAppSettings();
    return res.json({
      success: true,
      data: {
        latestVersion: s.version,
        minSupportedVersion: s.forceUpdate ? s.version : (process.env.APP_MIN_SUPPORTED_VERSION || "1.0.0"),
        updateUrl: platform === "ios" ? defaultUrl : s.apkUrl,
        releaseNotes: s.releaseNotes || null,
      },
    });
  } catch (_) { /* fall through to env-based values */ }

  res.json({
    success: true,
    data: {
      latestVersion: process.env.APP_LATEST_VERSION || "1.0.0",
      minSupportedVersion: process.env.APP_MIN_SUPPORTED_VERSION || "1.0.0",
      updateUrl: process.env.APP_UPDATE_URL || defaultUrl,
      releaseNotes: process.env.APP_RELEASE_NOTES || null,
    },
  });
});

module.exports = router;
