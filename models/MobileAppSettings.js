// models/MobileAppSettings.js
//
// Schema, defaults and validation for the `mobile_app_settings` collection
// (Admin -> System -> Mobile App). One singleton document.
//
// Why not a mongoose model: nothing in this app opens a mongoose
// connection at runtime (only the one-off scripts/ do) -- every other
// feature goes through services/jsonDb.js, the MongoDB-backed store that
// keeps an in-memory mirror. A mongoose model here would sit in
// "buffering" forever and every request would time out. So this file
// keeps the model definition (fields, defaults, rules) and
// services/mobileApp.js persists it through jsonDb like all the rest.
//
// Stored document shape (collection: mobile_app_settings):
// {
//   _id: "mobile-app",
//   appName, version, apkUrl, releaseNotes,
//   forceUpdate, showBanner, bannerTitle, bannerDescription, buttonText,
//   updatedAt, updatedBy
// }

"use strict";

const COLLECTION = "mobile_app_settings";
const DOC_ID = "mobile-app";

const DEFAULTS = Object.freeze({
  appName: "Chawla Classes Student App",
  version: "1.0.0",
  apkUrl: "https://pub-e1f612d8c73941168d01e013c961810f.r2.dev/app/app-release.apk",
  releaseNotes: "Bug fixes and improvements",
  forceUpdate: false,
  showBanner: true,
  bannerTitle: "Download Chawla Classes Student App",
  bannerDescription: "Notes, Attendance, Online Tests and Notifications.",
  buttonText: "Download App",
});

const LIMITS = Object.freeze({
  appName: 80,
  version: 20,
  apkUrl: 500,
  releaseNotes: 1000,
  bannerTitle: 100,
  bannerDescription: 300,
  buttonText: 30,
});

const VERSION_RE = /^\d+(\.\d+){1,3}$/; // 1.0 / 1.0.0 / 1.0.0.1
const BOOLEAN_FIELDS = ["forceUpdate", "showBanner"];
const TEXT_FIELDS = ["appName", "releaseNotes", "bannerTitle", "bannerDescription", "buttonText"];

/** https only: the Android app has cleartext traffic disabled, so an http APK link could never download. */
function isHttpsUrl(v) {
  try {
    return new URL(v).protocol === "https:";
  } catch (_) {
    return false;
  }
}

/**
 * Validates a (partial) update coming from the admin form.
 * Returns { errors: string[], patch: object } -- patch only ever contains
 * known fields, trimmed and length-checked; unknown keys are dropped.
 */
function sanitize(input) {
  const body = input && typeof input === "object" ? input : {};
  const errors = [];
  const patch = {};

  for (const f of TEXT_FIELDS) {
    if (body[f] === undefined) continue;
    if (typeof body[f] !== "string") { errors.push(`${f} must be text`); continue; }
    const v = body[f].trim();
    if (v.length > LIMITS[f]) { errors.push(`${f} must be at most ${LIMITS[f]} characters`); continue; }
    if (["appName", "buttonText"].includes(f) && !v) { errors.push(`${f} cannot be empty`); continue; }
    patch[f] = v;
  }

  if (body.version !== undefined) {
    const v = typeof body.version === "string" ? body.version.trim() : "";
    if (!VERSION_RE.test(v) || v.length > LIMITS.version) errors.push("version must look like 1.0.0");
    else patch.version = v;
  }

  if (body.apkUrl !== undefined) {
    const v = typeof body.apkUrl === "string" ? body.apkUrl.trim() : "";
    if (v.length > LIMITS.apkUrl) errors.push(`apkUrl must be at most ${LIMITS.apkUrl} characters`);
    else if (!isHttpsUrl(v)) errors.push("apkUrl must be a valid https:// link");
    else patch.apkUrl = v;
  }

  for (const f of BOOLEAN_FIELDS) {
    if (body[f] === undefined) continue;
    if (typeof body[f] !== "boolean") errors.push(`${f} must be true or false`);
    else patch[f] = body[f];
  }

  return { errors, patch };
}

/** Numeric compare of "1.2.10" vs "1.2.9" (missing/non-numeric segments = 0; "+build" ignored). */
function compareVersions(a, b) {
  const seg = (v) => String(v || "").split("+")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pa = seg(a);
  const pb = seg(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

module.exports = { COLLECTION, DOC_ID, DEFAULTS, LIMITS, sanitize, compareVersions, isHttpsUrl };
