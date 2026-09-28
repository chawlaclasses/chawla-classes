/**
 * services/reviewOtpCleanup.js
 *
 * Housekeeping for the 'reviewOtps' collection (routes/reviews.js's public
 * email/mobile verification records for the review-submission flow).
 * Flagged in the 2026-08-21 production-readiness audit (Data Integrity
 * section): every send-otp call — including abandoned attempts and bot
 * probes, since it's a public unauthenticated endpoint — used to create a
 * record with no cleanup path, growing forever.
 *
 * Two different lifetimes apply to a reviewOtps record:
 *
 *   - used: true  (a review was actually submitted with this record) —
 *     NEVER cleaned up. This is load-bearing: routes/reviews.js's
 *     findExistingReviewId() reads exactly these records to enforce "one
 *     review per email/phone, forever" and to route repeat attempts to
 *     the existing review's edit link instead of creating a duplicate.
 *     Deleting a used record would silently re-open that identity to a
 *     second review.
 *   - used: false (OTP never verified, or verified but the form was
 *     abandoned before final submit) — genuinely dead weight once the
 *     OTP/verify-token windows (10 min / 30 min, see routes/reviews.js)
 *     have long passed. These get a `cleanupAt` Date set at creation and
 *     are removed via a MongoDB TTL index (ensureReviewOtpTtlIndex below).
 *
 * `cleanupAt` is intentionally a separate field from the existing
 * `expiresAt` on the same collection — expiresAt is business logic (how
 * long the 6-digit code itself stays valid, checked in verify-otp) and is
 * stored as an ISO *string*; a Mongo TTL index only fires on a real BSON
 * Date field, so reusing expiresAt would either do nothing (wrong type)
 * or, if it happened to work, delete the record 10 minutes after
 * creation — before the person even finishes entering their code.
 * cleanupAt is stored as an actual Date object for exactly this reason.
 *
 * routes/reviews.js is responsible for clearing cleanupAt (setting it to
 * null) the moment a record's `used` flips to true, so the TTL index
 * never touches a record that's actually in use — a null/missing value
 * on a TTL-indexed field is simply skipped by MongoDB's TTL monitor, it
 * does not error or delete early.
 */

"use strict";

const logger = require("../utils/logger");

// Grace period before an UNUSED reviewOtps record becomes eligible for
// cleanup. Deliberately generous relative to the 10-min OTP window and
// 30-min verify-token window in routes/reviews.js — this only cleans up
// records that were truly abandoned, not ones mid-flow.
const REVIEW_OTP_CLEANUP_GRACE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

function reviewOtpCleanupDate() {
  return new Date(Date.now() + REVIEW_OTP_CLEANUP_GRACE_MS);
}

// Creates the TTL index once at boot. createIndex is idempotent — calling
// it again with the same key/options on every server start is a safe
// no-op, so this doesn't need its own "already ran" check.
async function ensureReviewOtpTtlIndex(mongoDb) {
  try {
    await mongoDb.collection("reviewOtps").createIndex(
      { cleanupAt: 1 },
      { expireAfterSeconds: 0, name: "reviewOtps_cleanupAt_ttl" }
    );
    logger.info("reviewOtps TTL index ready (auto-removes abandoned OTP/verification records after 2 days; submitted-review records are exempt).");
  } catch (err) {
    // Non-fatal: this is housekeeping, not a request-path dependency — the
    // app should still start even if index creation fails (e.g. an Atlas
    // tier/permissions issue).
    logger.error(`Could not create reviewOtps TTL index: ${err.message}`, { stack: err.stack });
  }
}

module.exports = { ensureReviewOtpTtlIndex, reviewOtpCleanupDate, REVIEW_OTP_CLEANUP_GRACE_MS };