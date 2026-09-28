/**
 * routes/marketing.js
 *
 * PUBLIC Marketing endpoint — feeds index.html's promo bar / offers
 * section. Read-only (GET), no auth needed, so this stays separate from
 * routes/admin/marketing.js (the authenticated banner CRUD, mounted under
 * adminRoutes.js) the same way routes/recruitment.js is kept separate
 * from routes/admin/recruitment.js.
 *
 * Only ever returns banners that are isActive AND currently within their
 * date window — an admin can create/schedule a banner ahead of time (or
 * leave an old offer sitting in the list) without it showing on the site
 * before/after its intended dates.
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const logger = require("../utils/logger");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isBannerCurrentlyActive(banner) {
  if (!banner.isActive) return false;
  const now = Date.now();
  if (banner.startDate && now < new Date(banner.startDate).getTime()) return false;
  // endDate is inclusive of the whole calendar day it's set to.
  if (banner.endDate && now >= new Date(banner.endDate).getTime() + ONE_DAY_MS) return false;
  return true;
}

router.get("/banners", (req, res) => {
  try {
    const banners = db
      .find("marketingBanners", {})
      .filter(isBannerCurrentlyActive)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || new Date(b.createdAt) - new Date(a.createdAt))
      .map(b => ({
        _id: b._id,
        title: b.title,
        message: b.message,
        placement: b.placement,
        ctaText: b.ctaText,
        ctaLink: b.ctaLink,
        ctaPosition: b.ctaPosition,
        imageUrl: b.imageUrl,
      }));
    res.json({ success: true, data: banners });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
