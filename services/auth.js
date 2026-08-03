/**
 * services/auth.js
 *
 * Manages JWT secret and admin password hash lifecycle.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { DATA_DIR, ADMIN_EMAIL, ADMIN_PASSWORD_RAW, BCRYPT_ROUNDS, JWT_EXPIRY, IS_PROD } = require("../config");
const logger = require("../utils/logger");
const { STAFF_ROLES } = require("../config/permissions");

// ── File paths ────────────────────────────────────────────────────────────────

const SECRET_FILE = path.join(DATA_DIR, ".jwt-secret");
const ADMIN_HASH_FILE = path.join(DATA_DIR, ".admin-hash");

// FIX: this file loads before services/jsonDb.js in app.js's require order
// (app.js requires services/auth.js directly, then only pulls in
// services/jsonDb.js indirectly via the route files further down). On a
// completely fresh checkout/deploy where Data/ doesn't exist at all yet,
// writeFileSync below used to throw ENOENT and crash the boot before
// jsonDb ever got a chance to create the directory itself. Mirrors
// jsonDb.js's own ensureDataDirectory().
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// SECURITY: config/index.js already fails fast in production if
// ADMIN_PASSWORD is under 12 characters, but nothing equivalent existed for
// JWT_SECRET — an env var of any length/strength was trusted outright, so a
// deploy setting e.g. JWT_SECRET=secret123 would silently sign every login
// token with a trivially guessable key, no warning at all. The
// auto-generated fallback below already uses crypto.randomBytes(32) (64 hex
// chars); this holds an explicitly-provided secret to a comparable bar.
const MIN_JWT_SECRET_LENGTH = 32;

// ── JWT Secret ────────────────────────────────────────────────────────────────

function loadJwtSecret() {
  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
      if (IS_PROD) {
        logger.error(`❌ FATAL: JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long!`);
        process.exit(1);
      }
      logger.warn(`⚠️  JWT_SECRET is shorter than the recommended ${MIN_JWT_SECRET_LENGTH} characters — fine for local dev, but set a longer one before deploying to production.`);
    }
    logger.info("🔐 JWT secret loaded from env");
    return process.env.JWT_SECRET;
  }

  if (fs.existsSync(SECRET_FILE)) {
    logger.info("🔐 JWT secret loaded from file");
    return fs.readFileSync(SECRET_FILE, "utf8").trim();
  }

  logger.info("🔐 Generating new JWT secret");
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

const JWT_SECRET = loadJwtSecret();

// ── Admin hash ────────────────────────────────────────────────────────────────

const DUMMY_HASH = "$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

let _adminHash = null;
let _adminHashReady = false;

function fingerprint(value) {
  return crypto.createHash("sha256").update(JWT_SECRET + ":" + value).digest("hex");
}

async function initAdminHash() {
  if (process.env.ADMIN_PASSWORD_HASH) {
    _adminHash = process.env.ADMIN_PASSWORD_HASH;
    _adminHashReady = true;
    logger.info("🔐 Admin hash loaded from env");
    return;
  }

  const currentFP = fingerprint(ADMIN_PASSWORD_RAW);

  if (fs.existsSync(ADMIN_HASH_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(ADMIN_HASH_FILE, "utf8"));
      if (cached.fingerprint === currentFP && cached.hash) {
        _adminHash = cached.hash;
        _adminHashReady = true;
        logger.info("🔐 Admin hash loaded from cache");
        return;
      }
    } catch (_) {}
  }

  logger.info("🔐 Hashing admin password (first run or password change)…");
  _adminHash = await bcrypt.hash(ADMIN_PASSWORD_RAW, BCRYPT_ROUNDS);
  fs.writeFileSync(
    ADMIN_HASH_FILE,
    JSON.stringify({ fingerprint: currentFP, hash: _adminHash }),
    { mode: 0o600 }
  );
  _adminHashReady = true;
  logger.info("🔐 Admin hash ready");
}

function getAdminHash() {
  return _adminHash;
}

function isAdminHashReady() {
  return _adminHashReady;
}

function getDummyHash() {
  return DUMMY_HASH;
}

// ── Ensure admin account (self-heal on boot) ───────────────────────────────
//
// FIX (login self-heal, Aug 2026): /api/admin/login only ever checks the
// 'users' collection in Data/users.json — it never looked at
// ADMIN_USERNAME/ADMIN_PASSWORD at all. Those env vars only fed
// initAdminHash() above, whose output (_adminHash) was never read by any
// route. Net effect: setting ADMIN_PASSWORD in production had *zero* effect
// on what password actually logged an admin in, and if Data/users.json was
// ever empty, wiped (e.g. a redeploy on a host without a persistent disk),
// or the admin record got locked/deactivated, there was no way to recover
// without hand-editing the JSON or SSHing in — which isn't available on
// every hosting plan (e.g. Render's free tier has no Shell/Disk access).
//
// This function makes ADMIN_EMAIL/ADMIN_PASSWORD the actual source of truth
// for the admin account, self-healing it on every boot:
//   - missing  -> creates it
//   - locked / deactivated -> unlocks / reactivates it
//   - password differs from current ADMIN_PASSWORD -> resets it
//
// Trade-off, by design: if someone changes the admin password from inside
// the admin panel UI (not via the ADMIN_PASSWORD env var), that change will
// be overwritten back to ADMIN_PASSWORD on the next restart/redeploy. For
// this app's single always-on admin account that's the safer default —
// guaranteed access beats a silently-diverged, unrecoverable password — but
// it's worth knowing. To change the login permanently, update
// ADMIN_PASSWORD in the hosting env vars, not just in the UI.
async function ensureAdminAccount() {
  try {
    await initAdminHash();
    if (!_adminHash) {
      logger.error("❌ ensureAdminAccount: admin hash not available, skipping");
      return;
    }

    // Lazy require to avoid any risk of a require-order cycle at module
    // load time (services/jsonDb.js does not require this file, so this
    // is just defensive).
    const db = require("./jsonDb");

    const existing = db.findOne("users", { email: ADMIN_EMAIL });

    if (!existing) {
      db.insertOne("users", {
        name: "Admin",
        email: ADMIN_EMAIL,
        password: _adminHash,
        role: "admin",
        isActive: true,
        loginAttempts: 0,
        lockUntil: null,
      });
      logger.info(`🔐 Admin account created for ${ADMIN_EMAIL} (from ADMIN_EMAIL/ADMIN_PASSWORD)`);
      return;
    }

    const needsUpdate =
      existing.password !== _adminHash ||
      existing.isActive === false ||
      !!existing.lockUntil ||
      !STAFF_ROLES.includes(existing.role);

    if (needsUpdate) {
      db.updateById("users", existing._id, {
        password: _adminHash,
        role: STAFF_ROLES.includes(existing.role) ? existing.role : "admin",
        isActive: true,
        loginAttempts: 0,
        lockUntil: null,
      });
      logger.info(`🔐 Admin account for ${ADMIN_EMAIL} synced with ADMIN_PASSWORD (reset/unlocked/reactivated)`);
    } else {
      logger.info(`🔐 Admin account for ${ADMIN_EMAIL} already up to date`);
    }
  } catch (err) {
    // Never let this take the server down — worst case, login stays broken
    // and gets fixed on the next boot, same as before this fix existed.
    logger.error(`❌ ensureAdminAccount failed: ${err.message}`, { stack: err.stack });
  }
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_) {
    return null;
  }
}

function extractToken(req) {
  const h = req.headers["authorization"];
  if (!h || typeof h !== "string") return null;
  return h.startsWith("Bearer ") ? h.slice(7).trim() : h.trim();
}

module.exports = {
  JWT_SECRET,
  initAdminHash,
  getAdminHash,
  isAdminHashReady,
  getDummyHash,
  ensureAdminAccount,
  signToken,
  verifyToken,
  extractToken,
};
