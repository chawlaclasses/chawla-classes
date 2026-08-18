/**
 * routes/categories.js
 *
 * Public, unauthenticated read of the homepage navbar categories —
 * powers index.html's navbar + mobile drawer, which used to be a
 * hardcoded <ul> of Home/About/Courses/.../Contact links. Admin CRUD is
 * separate (routes/admin/categories.js — /api/admin/categories/*), same
 * split as marketing banners (routes/marketing.js vs
 * routes/admin/marketing.js).
 *
 * Only returns active categories, sorted by `order` ascending, and only
 * the fields the navbar actually renders — no createdBy/timestamps/etc.
 * leaking to a public, unauthenticated endpoint.
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const logger = require("../utils/logger");

router.get("/", (req, res) => {
  try {
    const categories = db
      .find("categories", { isActive: true })
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        url: c.url,
        icon: c.icon,
        order: c.order,
      }));
    res.json({ success: true, data: categories });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
