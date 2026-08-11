/**
 * config/index.js
 *
 * Single source of truth for every runtime constant.
 * Validates critical env vars at startup so bad config fails fast.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { validateR2Config } = require("./r2");

// ─── Directory layout ────────────────────────────────────────────────────────
const ROOT_DIR    = path.resolve(__dirname, "..");

// FIX (production hardening, Phase 3, issue #4): every uploaded file
// (notes, homework, student documents, doubt attachments, faculty
// applications, branding images) used to be written under ROOT_DIR —
// which on Render (and most PaaS hosts) is the app's ephemeral
// filesystem, wiped on every deploy, restart, or scale event. Every
// uploaded file was silently gone the next time the app redeployed.
//
// PERSISTENT_ROOT_DIR is where all of that now actually lives.
// PERSISTENT_DATA_DIR, if set, points it at a real persistent volume —
// e.g. a Render Persistent Disk's mount path (set this to whatever path
// you configure the disk to mount at, e.g. "/var/data" — see Render's
// dashboard when attaching a disk to this service). If unset, it
// defaults to ROOT_DIR, which is exactly today's behavior — so this is a
// no-op until PERSISTENT_DATA_DIR is actually configured; nothing about
// existing local/dev behavior changes.
//
// Deliberately NOT moved here: DATA_DIR (legacy, effectively unused
// since the jsonDb -> MongoDB migration), LOGS_DIR (issue #10's
// still-open piece — see PHASE_3_REPORT.md for why that's a separate
// decision), PUBLIC_DIR/STATIC_DIR (application code/assets, which
// SHOULD come fresh from every deploy, not persist across them).
const PERSISTENT_ROOT_DIR = process.env.PERSISTENT_DATA_DIR
  ? path.resolve(process.env.PERSISTENT_DATA_DIR)
  : ROOT_DIR;

// FIX: this pointed at "data" (lowercase), but the actual, populated JSON
// database on disk lives in "Data" (capital D). On a case-sensitive
// filesystem (Linux — i.e. everywhere this actually runs) that meant the
// app was silently creating and using a brand-new, empty "data" directory
// on every boot, while the real seeded content (admin account, students,
// questions, tests, classes, subjects...) in "Data" was never read. Admin
// login, question banks, everything appeared to be missing.
const DATA_DIR    = path.join(ROOT_DIR, "Data");
const NOTES_DIR   = path.join(PERSISTENT_ROOT_DIR, "notes");
const UPLOADS_DIR = path.join(PERSISTENT_ROOT_DIR, "uploads");
const LOGS_DIR    = path.join(ROOT_DIR, "logs");
const PUBLIC_DIR  = path.join(ROOT_DIR, "public");
const STATIC_DIR  = ROOT_DIR;

// Branding assets (logo/favicon) uploaded via Settings — used to be
// computed inline in routes/settings.js from ROOT_DIR directly; centralized
// here (this file's whole job is being "single source of truth for every
// runtime constant" — see header) and moved onto PERSISTENT_ROOT_DIR for
// the same redeploy-durability reason as everything else in this section.
const IMAGES_DIR = path.join(PERSISTENT_ROOT_DIR, "images");

// Admin-attached homework material (question PDF/image) — public-servable,
// same trust level as NOTES_DIR (study material, not personal data).
const HOMEWORK_DIR = path.join(PERSISTENT_ROOT_DIR, "homework");
// Student-submitted homework answers — kept private like STUDENT_DOCS_DIR,
// never mounted with express.static; only reachable via an authenticated
// download route so one student can't fetch another's submitted work.
const HOMEWORK_SUBMISSIONS_DIR = path.join(PERSISTENT_ROOT_DIR, "homework-submissions");
// Doubt attachments (photo of the question + optional voice note) — same
// private treatment as homework submissions, since these are personal
// student uploads, not shared study material.
const DOUBTS_DIR = path.join(PERSISTENT_ROOT_DIR, "doubts");
// Faculty (teacher) job application uploads — resume, certificates, photo,
// optional demo video. Private like STUDENT_DOCS_DIR/DOUBTS_DIR: never
// mounted with express.static, only reachable via an authenticated admin
// download route, since these are candidates' personal documents.
const FACULTY_APPLICATIONS_DIR = path.join(PERSISTENT_ROOT_DIR, "faculty-applications");

// ─── Admin credentials ───────────────────────────────────────────────────────
const ADMIN_USERNAME     = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD_RAW = process.env.ADMIN_PASSWORD || "admin123";
// FIX (login self-heal): the actual admin login (/api/admin/login) matches
// against an *email* in the 'users' collection — ADMIN_USERNAME was never
// used to look that record up, which is how the ADMIN_USERNAME/ADMIN_PASSWORD
// env vars ended up completely disconnected from real login (see
// services/auth.js#ensureAdminAccount). ADMIN_EMAIL closes that gap; default
// matches the email this app has always seeded/documented as the admin login.
const ADMIN_EMAIL        = process.env.ADMIN_EMAIL || "admin@chawlaclasses.com";

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

// ─── Database (MongoDB) ──────────────────────────────────────────────────────
// FIX (jsonDb -> MongoDB migration): the app used to persist every
// collection as a flat Data/*.json file (services/jsonDb.js). It now
// persists to MongoDB instead — MONGODB_URI is the only required new piece
// of config (an Atlas SRV string or any standard mongodb:// URI). The
// in-memory read API every controller/route/service already calls
// (db.find/findOne/findById/...) is unchanged; see services/jsonDb.js for
// how that cache is now hydrated from and written back to Mongo instead of
// disk. MONGODB_DB_NAME is optional — Atlas connection strings normally
// already encode the target database in the URI path, so this only needs
// to be set if you want to override that.
const MONGODB_URI     = process.env.MONGODB_URI || "";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || undefined;

// ─── Startup validation ──────────────────────────────────────────────────────
function validateConfig() {
  // FIX (jsonDb -> MongoDB migration): fail fast at boot, same philosophy
  // as the admin-credential checks below — a missing connection string
  // used to mean the app would silently create empty Data/*.json files;
  // now there's no local fallback, so we exit immediately with a clear
  // message instead of letting every route 500 one request at a time.
  if (!MONGODB_URI) {
    console.error("❌ FATAL: MONGODB_URI env var must be set (see .env.example). The app now persists to MongoDB, not Data/*.json.");
    process.exit(1);
  }

  // FIX (local storage -> Cloudflare R2 migration): student documents,
  // homework attachments/submissions, doubt attachments and faculty
  // application files are now uploaded straight to R2 instead of local
  // disk (see middleware/upload.js, services/r2Service.js) — a missing
  // R2 config used to mean every single upload endpoint would 500 the
  // first time someone actually used it. Fail loudly at boot instead.
  validateR2Config({ required: false });

  // FIX (production hardening, Phase 3, issue #4): if PERSISTENT_DATA_DIR
  // is set (pointing uploads at a Render Persistent Disk or similar), fail
  // clearly at boot if that path isn't actually usable — a typo'd mount
  // path or a disk that failed to attach should be a loud, immediate
  // failure, not a confusing multer stack trace the first time someone
  // uploads a file.
  if (process.env.PERSISTENT_DATA_DIR) {
    try {
      fs.mkdirSync(PERSISTENT_ROOT_DIR, { recursive: true });
      fs.accessSync(PERSISTENT_ROOT_DIR, fs.constants.W_OK);
      console.log(`📁 Persistent storage: ${PERSISTENT_ROOT_DIR}`);
    } catch (error) {
      console.error(`❌ FATAL: PERSISTENT_DATA_DIR ("${process.env.PERSISTENT_DATA_DIR}") is not writable: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.warn(`⚠️  PERSISTENT_DATA_DIR is not set — uploads are stored under the app directory and WILL BE LOST on the next deploy/restart. Set PERSISTENT_DATA_DIR to a Render Persistent Disk's mount path (or equivalent) before relying on uploads in production. See PHASE_3_REPORT.md.`);
  }

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
  // Database
  MONGODB_URI,
  MONGODB_DB_NAME,

  // Paths
  ROOT_DIR,
  PERSISTENT_ROOT_DIR,
  DATA_DIR,
  NOTES_DIR,
  UPLOADS_DIR,
  HOMEWORK_DIR,
  HOMEWORK_SUBMISSIONS_DIR,
  DOUBTS_DIR,
  FACULTY_APPLICATIONS_DIR,
  IMAGES_DIR,
  LOGS_DIR,
  PUBLIC_DIR,
  STATIC_DIR,

  // Admin
  ADMIN_USERNAME,
  ADMIN_PASSWORD_RAW,
  ADMIN_EMAIL,

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
