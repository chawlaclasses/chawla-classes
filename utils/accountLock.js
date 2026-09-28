/**
 * utils/accountLock.js
 *
 * Brute-force lockout, shared by both admin and student login (routes/apiAuth.js).
 * Independent of any IP-based rate limiting — this locks the *account*, so
 * grinding through passwords from many IPs (or just being patient) doesn't
 * help an attacker either.
 *
 * Adds two fields to a user record in the 'users' collection:
 *   loginAttempts (number) — consecutive failed attempts since the last success
 *   lockUntil (ISO string | null) — set once the threshold is hit
 */

"use strict";

const db = require("../services/jsonDb");

const MAX_ATTEMPTS = parseInt(process.env.ACCOUNT_LOCK_MAX_ATTEMPTS, 10) || 5;
const LOCK_DURATION_MS = parseInt(process.env.ACCOUNT_LOCK_DURATION_MS, 10) || 15 * 60 * 1000; // 15 min

const isAccountLocked = (user) => {
  if (!user?.lockUntil) return false;
  return new Date(user.lockUntil).getTime() > Date.now();
};

const minutesUntilUnlock = (user) => {
  if (!isAccountLocked(user)) return 0;
  return Math.ceil((new Date(user.lockUntil).getTime() - Date.now()) / 60000);
};

// Call after a wrong password. Increments the counter and locks the account
// once MAX_ATTEMPTS is reached. If a previous lock already expired, the
// counter restarts from zero first. Returns the updated user record.
const registerFailedAttempt = (user) => {
  let attempts = user.loginAttempts || 0;

  // A previous lock that has since expired doesn't carry over — start fresh.
  if (user.lockUntil && new Date(user.lockUntil).getTime() <= Date.now()) {
    attempts = 0;
  }

  attempts += 1;
  const update = { loginAttempts: attempts };
  if (attempts >= MAX_ATTEMPTS) {
    update.lockUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
  }

  return db.updateById("users", user._id, update);
};

// Call after a successful login. No-op write skipped if there's nothing to clear.
const clearFailedAttempts = (user) => {
  if (!user.loginAttempts && !user.lockUntil) return user;
  return db.updateById("users", user._id, { loginAttempts: 0, lockUntil: null });
};

module.exports = {
  MAX_LOGIN_ATTEMPTS: MAX_ATTEMPTS,
  LOCK_DURATION_MINUTES: Math.round(LOCK_DURATION_MS / 60000),
  isAccountLocked,
  minutesUntilUnlock,
  registerFailedAttempt,
  clearFailedAttempts,
};
