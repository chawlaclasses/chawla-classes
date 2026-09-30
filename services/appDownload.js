// services/appDownload.js
//
// Singleton settings for the website's "Download App" button (Admin ->
// App Download). Same pattern as services/footerSettings.js: one record in
// the 'app-download' collection, deep-merged with DEFAULTS on read so newly
// added fields show up for older saved documents.
//
// The APK itself lives in Cloudflare R2 (key stored in `file.key`); it is
// streamed to visitors through GET /download-app (routes/appDownload.js),
// so the public never needs R2_PUBLIC_URL to be configured correctly.

"use strict";

const db = require("./jsonDb");

const COLLECTION = "app-download";
const DOC_ID = "app-download";

const DEFAULTS = {
  enabled: true,
  // 'upload' -> serve the APK uploaded from admin; 'link' -> redirect to externalUrl
  source: "link",
  externalUrl: "",
  buttonLabel: "Get App",
  footerText: "Chawla Classes Student App",
  versionLabel: "",
  releaseNotes: "",
  // Where the button appears on the public website.
  placements: {
    header: true,
    mobileMenu: true,
    footer: true,
    floating: false,
  },
  file: null, // { key, name, size, uploadedAt }
  downloadCount: 0,
};

function getAppDownload() {
  const existing = db.findById(COLLECTION, DOC_ID);
  if (!existing) {
    const seeded = { _id: DOC_ID, ...DEFAULTS, placements: { ...DEFAULTS.placements } };
    db.insert(COLLECTION, seeded);
    return seeded;
  }
  return {
    ...DEFAULTS,
    ...existing,
    placements: { ...DEFAULTS.placements, ...(existing.placements || {}) },
  };
}

function updateAppDownload(patch) {
  const current = getAppDownload();
  const merged = {
    ...current,
    ...patch,
    placements: { ...current.placements, ...(patch.placements || {}) },
  };
  delete merged._id;
  if (db.findById(COLLECTION, DOC_ID)) {
    return db.updateById(COLLECTION, DOC_ID, merged);
  }
  return db.insert(COLLECTION, { _id: DOC_ID, ...merged });
}

/** True when there's something admin-configured for /download-app to serve. */
function hasTarget(s) {
  return s.source === "upload" ? Boolean(s.file && s.file.key) : Boolean(s.externalUrl);
}

module.exports = { getAppDownload, updateAppDownload, hasTarget, DEFAULTS };
