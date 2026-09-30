/**
 * routes/admin/mobile-app.js -- Admin -> System -> Mobile App
 *   GET /api/admin/mobile-app
 *   PUT /api/admin/mobile-app
 *
 * Mounted from routes/adminRoutes.js, i.e. already behind app.js's
 * requireApiAdmin (valid staff login). On top of that, the
 * mobile_app:view / mobile_app:edit permissions (config/permissions.js)
 * limit it to admin and super_admin -- teachers and other staff get 403.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { requirePermission } = require("../../middleware/permissions");
const ctrl = require("../../controllers/mobileAppController");

router.get("/", requirePermission("mobile_app:view"), ctrl.adminGet);
router.put("/", requirePermission("mobile_app:edit"), ctrl.adminUpdate);

module.exports = router;
