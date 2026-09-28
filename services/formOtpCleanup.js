/**
 * services/formOtpCleanup.js
 *
 * Housekeeping for the 'formOtps' collection (services/formOtpService.js's
 * public email-verification records for the Admission Form and Career/
 * Faculty Recruitment Form). Modeled directly on the existing
 * services/reviewOtpCleanup.js for the feedback form's OTP flow — same
 * reasoning applies here: every send-otp call is public/unauthenticated
 * (bot probes included), so records need a real cleanup path or the
 * collection grows forever.
 *
 * `used: true` records (an actual admission/application was submitted
 * with this record) are NEVER cleaned up — see
 * services/formOtpService.js#findRecentDuplicate, which reads exactly
 * these to help populate the duplicateEmail/duplicateMobile admin flags.
 * `used: false` records (OTP requested but never completed) get a
 * `cleanupAt` Date at creation and are removed via a MongoDB TTL index.
 */

"use strict";

const logger = require("../utils/logger");

// Generous relative to the 10-min OTP window / 30-min verify-token window
// (config/index.js's FORM_OTP_EXPIRY_MS / FORM_OTP_VERIFY_TOKEN_MS) — this
// only clears out records that were genuinely abandoned mid-flow.
const FORM_OTP_CLEANUP_GRACE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

function formOtpCleanupDate() {
  return new Date(Date.now() + FORM_OTP_CLEANUP_GRACE_MS);
}

// Idempotent — safe to call on every boot (see server.js).
async function ensureFormOtpTtlIndex(mongoDb) {
  try {
    await mongoDb.collection("formOtps").createIndex(
      { cleanupAt: 1 },
      { expireAfterSeconds: 0, name: "formOtps_cleanupAt_ttl" }
    );
    logger.info("formOtps TTL index ready (auto-removes abandoned admission/career OTP records after 2 days; used/submitted records are exempt).");
  } catch (err) {
    // Non-fatal: cleanup housekeeping, not a request-path dependency.
    logger.error(`Could not create formOtps TTL index: ${err.message}`, { stack: err.stack });
  }
}

module.exports = { ensureFormOtpTtlIndex, formOtpCleanupDate, FORM_OTP_CLEANUP_GRACE_MS };
