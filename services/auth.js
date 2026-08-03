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

const { DATA_DIR, ADMIN_PASSWORD_RAW, BCRYPT_ROUNDS, JWT_EXPIRY, IS_PROD } = require("../config");
const logger = require("../utils/logger");

// ── File paths ────────────────────────────────────────────────────────────────

const SECRET_FILE = path.join(DATA_DIR, ".jwt-secret");
const ADMIN_HASH_FILE = path.join(DATA_DIR, ".admin-hash");

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
  signToken,
  verifyToken,
  extractToken,
};