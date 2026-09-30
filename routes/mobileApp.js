/**
 * routes/mobileApp.js -- PUBLIC, read-only.
 *   GET /api/mobile-app          all app settings (website banner reads this)
 *   GET /api/mobile-app/version  { latestVersion, apkUrl, forceUpdate, releaseNotes }
 *                                (Flutter app update check)
 * No auth on purpose: the website and the app (before login) need it.
 * Writes live in routes/admin/mobile-app.js behind requireApiAdmin.
 */

"use strict";

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/mobileAppController");

router.get("/", ctrl.getSettings);
router.get("/version", ctrl.getVersion);

module.exports = router;
