/**
 * utils/spamDetection.js
 *
 * Shared anti-spam helpers for the two public, unauthenticated write
 * endpoints that accept a mobile number + email from anyone on the
 * internet: the Admission Form (routes/publicEnquiry.js) and the Faculty
 * Recruitment / Career Form (routes/recruitment.js).
 *
 * Deliberately framework-agnostic (no express-validator/req/res here) so
 * these same checks can be used both inside an express-validator custom
 * validator AND inside a plain route handler (e.g. to compute the
 * `flags` object stored on the record for admin review) without
 * duplicating the logic in two places.
 */

"use strict";

const { BLOCKED_EMAIL_DOMAINS } = require("../config");

// ── Phone ──────────────────────────────────────────────────────────────────

// Indian mobile: 10 digits, starting 6-9.
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

// Catches "1234567890"/"0123456789"-style fully sequential runs (either
// direction) in addition to the plain all-repeated-digit case
// (9999999999, 1111111111, 0000000000) explicitly called out in the spec.
function isSequentialDigits(digits) {
  let ascending = true;
  let descending = true;
  for (let i = 1; i < digits.length; i++) {
    const prev = Number(digits[i - 1]);
    const curr = Number(digits[i]);
    if (curr !== (prev + 1) % 10) ascending = false;
    if (curr !== (prev + 9) % 10) descending = false;
  }
  return ascending || descending;
}

function isRepeatedDigits(digits) {
  return new Set(digits.split("")).size === 1;
}

/**
 * Returns true only for a genuine, plausible Indian mobile number: matches
 * the 6-9 leading digit format AND isn't an obviously fake repeated/
 * sequential pattern (1234567890, 9999999999, 1111111111, 0000000000, etc).
 */
function isValidIndianMobile(phone) {
  const value = String(phone || "").trim();
  if (!INDIAN_MOBILE_REGEX.test(value)) return false;
  if (isRepeatedDigits(value)) return false;
  if (isSequentialDigits(value)) return false;
  return true;
}

// ── Email ────────────────────────────────────────────────────────────────

function getEmailDomain(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  return at === -1 ? "" : value.slice(at + 1);
}

/**
 * True if the email's domain is (or is a subdomain of) a known disposable/
 * temporary-email provider. BLOCKED_EMAIL_DOMAINS is configurable —
 * see config/index.js (FORM_BLOCKED_EMAIL_DOMAINS env var).
 */
function isBlockedEmailDomain(email) {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return BLOCKED_EMAIL_DOMAINS.some(blocked => domain === blocked || domain.endsWith(`.${blocked}`));
}

module.exports = {
  INDIAN_MOBILE_REGEX,
  isValidIndianMobile,
  isBlockedEmailDomain,
  getEmailDomain,
};
