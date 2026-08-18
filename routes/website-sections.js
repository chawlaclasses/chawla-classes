/**
 * routes/website-sections.js
 *
 * Public, unauthenticated read of active Website Builder sections —
 * powers index.html's homepage section renderer. Only active sections,
 * sorted by `order`, and no admin-only metadata (createdBy, etc.). Admin
 * CRUD is separate (routes/admin/website-sections.js).
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const logger = require("../utils/logger");

router.get("/", (req, res) => {
  try {
    // "home" is the default so every section created before this
    // multi-page feature existed (no `page` field at all) still shows up
    // on the homepage exactly as before — see the matching DEFAULT_PAGE
    // note in routes/admin/website-sections.js.
    const page = (req.query.page || "home").toString().trim().toLowerCase();
    const sections = db
      .find("websiteSections", { isActive: true })
      .filter((s) => (s.page || "home") === page)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s) => ({ _id: s._id, type: s.type, data: s.data, anchor: s.anchor || "end", order: s.order }));
    res.json({ success: true, data: sections });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;