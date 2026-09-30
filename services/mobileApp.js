// services/mobileApp.js
//
// Persistence for the `mobile_app_settings` singleton (see
// models/MobileAppSettings.js). Same jsonDb pattern as
// services/footerSettings.js / services/appDownload.js: seeded with the
// defaults on first read, deep-merged with DEFAULTS on every read so a
// field added later shows up for older saved documents.

"use strict";

const db = require("./jsonDb");
const { COLLECTION, DOC_ID, DEFAULTS } = require("../models/MobileAppSettings");

function getMobileAppSettings() {
  const existing = db.findById(COLLECTION, DOC_ID);
  if (!existing) {
    const seeded = { _id: DOC_ID, ...DEFAULTS };
    db.insert(COLLECTION, seeded);
    return seeded;
  }
  return { ...DEFAULTS, ...existing };
}

function updateMobileAppSettings(patch, updatedBy) {
  const merged = {
    ...getMobileAppSettings(),
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || null,
  };
  delete merged._id;
  if (db.findById(COLLECTION, DOC_ID)) return db.updateById(COLLECTION, DOC_ID, merged);
  return db.insert(COLLECTION, { _id: DOC_ID, ...merged });
}

module.exports = { getMobileAppSettings, updateMobileAppSettings };
