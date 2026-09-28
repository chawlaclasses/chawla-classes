// services/footerSettings.js
//
// Single-document footer content: the "About Chawla Classes" column, the
// "Contact Info" column, and the bottom bar (copyright / developed-by /
// note). Stored as one record in the 'footer-settings' collection —
// exact same singleton pattern as services/settings.js's app-settings.
//
// Deliberately separate from services/settings.js: that file already has
// a small ad-hoc `socialLinks: { instagram, googlePhotos }` field used by
// public/reviews.html and public/gallery.html — that's a different,
// older feature and is left untouched. This module (plus
// services/jsonDb.js's 'socialLinks' and 'footerLinks' collections) is
// the new, dedicated Footer Management feature described in
// Admin -> Footer Management.
//
// Footer nav links (Quick Links / Student Resources) are NOT part of this
// singleton — they're their own collection ('footerLinks', one document
// per link) so they can be individually added/edited/reordered. See
// routes/admin/footer-links.js.

"use strict";

const db = require("./jsonDb");

const FOOTER_SETTINGS_ID = "footer-settings";

const DEFAULTS = {
  about: {
    title: "Chawla Classes",
    content: "Providing quality education and academic guidance since 2002.",
  },
  contact: {
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    workingHours: "",
  },
  bottomBar: {
    copyrightText: `© ${new Date().getFullYear()} Chawla Classes. All Rights Reserved.`,
    developedByText: "",
    footerNote: "",
  },
};

function getFooterSettings() {
  const existing = db.findById("footer-settings", FOOTER_SETTINGS_ID);
  if (!existing) {
    const seeded = { _id: FOOTER_SETTINGS_ID, ...DEFAULTS };
    db.insert("footer-settings", seeded);
    return seeded;
  }
  // Deep-merge so newly-added default fields show up for older saved
  // settings, same reasoning as services/settings.js's getSettings().
  return {
    ...DEFAULTS,
    ...existing,
    about: { ...DEFAULTS.about, ...(existing.about || {}) },
    contact: { ...DEFAULTS.contact, ...(existing.contact || {}) },
    bottomBar: { ...DEFAULTS.bottomBar, ...(existing.bottomBar || {}) },
  };
}

function updateFooterSettings(patch) {
  const current = getFooterSettings();
  const merged = {
    ...current,
    about: { ...current.about, ...(patch.about || {}) },
    contact: { ...current.contact, ...(patch.contact || {}) },
    bottomBar: { ...current.bottomBar, ...(patch.bottomBar || {}) },
  };
  delete merged._id;

  const existing = db.findById("footer-settings", FOOTER_SETTINGS_ID);
  if (existing) {
    return db.updateById("footer-settings", FOOTER_SETTINGS_ID, merged);
  }
  return db.insert("footer-settings", { _id: FOOTER_SETTINGS_ID, ...merged });
}

module.exports = { getFooterSettings, updateFooterSettings, FOOTER_SETTINGS_ID };
