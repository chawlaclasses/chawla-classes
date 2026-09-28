/**
 * config/socialPlatforms.js
 *
 * Single source of truth for the "Social Links" feature (Admin -> Footer
 * Management -> Social Links). Kept as one small config file — rather than
 * duplicating the platform list in utils/validators.js AND
 * public/admin/js/footer-management.js — the same way config/permissions.js
 * is the one place role rules live.
 *
 * Icons use Font Awesome (fab), matching every other icon already on the
 * public site (index.html's <i class="fab fa-whatsapp">, etc.) — the spec
 * example used a Remix Icon class ("ri-instagram-fill"), but this project
 * never loads remixicon anywhere, so Font Awesome equivalents are used
 * instead to avoid pulling in a second icon library just for this.
 *
 * An admin can still override the icon class per-link (see
 * routes/admin/social-links.js) — this map only supplies the DEFAULT icon
 * that's pre-filled when a platform is picked.
 */

"use strict";

const SOCIAL_PLATFORMS = [
  "Facebook",
  "Instagram",
  "WhatsApp",
  "YouTube",
  "LinkedIn",
  "Telegram",
  "Twitter/X",
];

const DEFAULT_SOCIAL_ICONS = {
  Facebook: "fab fa-facebook-f",
  Instagram: "fab fa-instagram",
  WhatsApp: "fab fa-whatsapp",
  YouTube: "fab fa-youtube",
  LinkedIn: "fab fa-linkedin-in",
  Telegram: "fab fa-telegram-plane",
  "Twitter/X": "fab fa-x-twitter",
};

module.exports = { SOCIAL_PLATFORMS, DEFAULT_SOCIAL_ICONS };
