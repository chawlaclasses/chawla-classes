/**
 * config/index.js
 *
 * Single source of truth for every runtime constant.
 * Validates critical env vars at startup so bad config fails fast.
 */

"use strict";

const path = require("path");

// ─── Directory layout ────────────────────────────────────────────────────────
const ROOT_DIR    = path.resolve(__dirname, "..");
// FIX: this pointed at "data" (lowercase), but the actual, populated JSON
// database on disk lives in "Data" (capital D). On a case-sensitive
// filesystem (Linux — i.e. everywhere this actually runs) that meant the
// app was silently creating and using a brand-new, empty "data" directory
// on every boot, while the real seeded content (admin account, students,
// questions, tests, classes, subjects...) in "Data" was never read. Admin
// login, question banks, everything appeared to be missing.
const DATA_DIR    = path.join(ROOT_DIR, "Data");
const NOTES_DIR   = path.join(ROOT_DIR, "notes");
const UPLOADS_DIR = path.join(ROOT_DIR, "uploads");
const LOGS_DIR    = path.join(ROOT_DIR, "logs");
const PUBLIC_DIR  = path.join(ROOT_DIR, "public");
const STATIC_DIR  = ROOT_DIR;

// Admin-attached homework material (question PDF/image) — public-servable,
// same trust level as NOTES_DIR (study material, not personal data).
const HOMEWORK_DIR = path.join(ROOT_DIR, "homework");
// Student-submitted homework answers — kept private like STUDENT_DOCS_DIR,
// never mounted with express.static; only reachable via an authenticated
// download route so one student can't fetch another's submitted work.
const HOMEWORK_SUBMISSIONS_DIR = path.join(ROOT_DIR, "homework-submissions");
// Doubt attachments (photo of the question + optional voice note) — same
// private treatment as homework submissions, since these are personal
// student uploads, not shared study material.
const DOUBTS_DIR = path.join(ROOT_DIR, "doubts");
// Faculty (teacher) job application uploads — resume, certificates, photo,
// optional demo video. Private like STUDENT_DOCS_DIR/DOUBTS_DIR: never
// mounted with express.static, only reachable via an authenticated admin
// download route, since these are candidates' personal documents.
const FACULTY_APPLICATIONS_DIR = path.join(ROOT_DIR, "faculty-applications");

// ─── Admin credentials ───────────────────────────────────────────────────────
const ADMIN_USERNAME     = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD_RAW = process.env.ADMIN_PASSWORD || "admin123";

// ─── JWT ─────────────────────────────────────────────────────────────────────
const JWT_EXPIRY = process.env.JWT_EXPIRY || "24h";

// ─── bcrypt ──────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

// ─── Rate limiting ───────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS    = (parseInt(process.env.RATE_LIMIT_WINDOW_MIN, 10) || 15) * 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS, 10) || 10;

// ─── File size limits ────────────────────────────────────────────────────────
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB,  10) || 25) * 1024 * 1024;
const MAX_PDF_SIZE  = (parseInt(process.env.MAX_PDF_SIZE_MB,   10) || 28) * 1024 * 1024;

// ─── OCR ─────────────────────────────────────────────────────────────────────
const MAX_OCR_PAGES   = parseInt(process.env.MAX_OCR_PAGES,   10) || 50;
const OCR_CONCURRENCY = Math.max(1, parseInt(process.env.OCR_CONCURRENCY, 10) || 3);

// ─── Environment flags ────────────────────────────────────────────────────────
const IS_PROD  = process.env.NODE_ENV === "production";
const DEBUG_PDF = process.env.DEBUG_PDF === "true";
const PORT     = parseInt(process.env.PORT, 10) || 3000;

// ─── Allowed CORS origins ────────────────────────────────────────────────────
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:3001"];

// ─── Startup validation ──────────────────────────────────────────────────────
function validateConfig() {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    // FIX (security audit): this used to only warn, even in production — so a
    // careless deploy with no ADMIN_PASSWORD set would silently boot with the
    // "admin"/"admin123" default. IS_PROD now makes this a hard failure in
    // production, same as the weak-password check below; local/dev runs are
    // unaffected so `npm run dev` without a .env still works as before.
    if (IS_PROD) {
      console.error("❌ FATAL: ADMIN_USERNAME and ADMIN_PASSWORD env vars must be set in production!");
      process.exit(1);
    }
    console.warn("⚠️  WARNING: Using default admin credentials (admin/admin123)");
    console.warn("⚠️  Set ADMIN_USERNAME and ADMIN_PASSWORD env vars for production!");
  }

  if (process.env.ADMIN_PASSWORD && ADMIN_PASSWORD_RAW.length < 12) {
    console.error("❌ FATAL: ADMIN_PASSWORD must be at least 12 characters long!");
    process.exit(1);
  }
}

module.exports = {
  // Paths
  ROOT_DIR,
  DATA_DIR,
  NOTES_DIR,
  UPLOADS_DIR,
  HOMEWORK_DIR,
  HOMEWORK_SUBMISSIONS_DIR,
  DOUBTS_DIR,
  FACULTY_APPLICATIONS_DIR,
  LOGS_DIR,
  PUBLIC_DIR,
  STATIC_DIR,

  // Admin
  ADMIN_USERNAME,
  ADMIN_PASSWORD_RAW,

  // Auth
  JWT_EXPIRY,
  BCRYPT_ROUNDS,

  // Rate limiting
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_ATTEMPTS,

  // File limits
  MAX_FILE_SIZE,
  MAX_PDF_SIZE,

  // OCR
  MAX_OCR_PAGES,
  OCR_CONCURRENCY,

  // Flags
  IS_PROD,
  DEBUG_PDF,
  PORT,
  ALLOWED_ORIGINS,

  // Validate at boot
  validateConfig,
};