/**
 * routes/footer.js
 *
 * Public, unauthenticated read of everything the footer needs — active
 * social links, active Quick Links / Student Resources nav links, and
 * the About/Contact/Bottom-Bar settings — combined into ONE response.
 * Powers public/js/footer.js, which every public page includes so the
 * footer renders the same way everywhere without duplicating content in
 * 12 separate HTML files.
 *
 * One combined endpoint instead of three separate ones (contrast with
 * categories/website-sections, which are single-purpose) deliberately —
 * the footer is a single visual unit rendered on EVERY page, so one
 * request per page load beats three.
 *
 * Admin CRUD is separate: routes/admin/social-links.js,
 * routes/admin/footer-links.js, routes/admin/footer-settings.js.
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const logger = require("../utils/logger");
const footerSettingsService = require("../services/footerSettings");

router.get("/", (req, res) => {
  try {
    const socialLinks = db
      .find("socialLinks", { isActive: true })
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((l) => ({ _id: l._id, platform: l.platform, url: l.url, icon: l.icon }));

    const activeFooterLinks = db
      .find("footerLinks", { isActive: true })
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const toPublicLink = (l) => ({ _id: l._id, label: l.label, url: l.url });
    const quickLinks = activeFooterLinks.filter((l) => l.column === "quick_links").map(toPublicLink);
    const studentResources = activeFooterLinks.filter((l) => l.column === "student_resources").map(toPublicLink);

    const settings = footerSettingsService.getFooterSettings();

    res.json({
      success: true,
      data: {
        socialLinks,
        quickLinks,
        studentResources,
        settings: {
          about: settings.about,
          contact: settings.contact,
          bottomBar: settings.bottomBar,
        },
      },
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
