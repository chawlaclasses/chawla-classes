/**
 * services/formOtpService.js
 *
 * Shared email-OTP verification for the two public lead-capture forms
 * that this anti-spam pass covers: the Admission Form
 * (routes/publicEnquiry.js) and the Faculty Recruitment / Career Form
 * (routes/recruitment.js). Generalized from the existing, already-in-
 * production OTP flow in routes/reviews.js (feedback form) — same shape
 * (send-otp -> verify-otp -> verifyToken -> submit), same 10-min OTP /
 * 30-min verify-token windows, same "used OTP can't be reused" rule.
 *
 * Records live in the 'formOtps' collection, one document per send-otp
 * call, tagged with `formType` ('admission' | 'career') so the two forms'
 * OTP attempts never interfere with each other even if the same person
 * (understandably) uses the same email for both. No paid SMS/mobile OTP
 * involved anywhere here — verification is email-only, reusing the
 * existing utils/mailer.js (Brevo API / SMTP, whichever is configured).
 *
 * Cleanup: services/formOtpCleanup.js's TTL index removes abandoned
 * (used:false) records after 2 days; `used: true` records are kept
 * forever (needed for the recruitment form's existing duplicate-
 * application guard in routes/recruitment.js).
 */

"use strict";

const crypto = require("crypto");

const db = require("./jsonDb");
const logger = require("../utils/logger");
const { sendMail } = require("../utils/mailer");
const { formOtpCleanupDate } = require("./formOtpCleanup");
const {
  FORM_OTP_EXPIRY_MS,
  FORM_OTP_VERIFY_TOKEN_MS,
  FORM_OTP_MAX_RESEND,
  FORM_OTP_RESEND_WINDOW_MS,
  FORM_OTP_RESEND_COOLDOWN_MS,
  FORM_OTP_MAX_VERIFY_ATTEMPTS,
} = require("../config");

const FORM_LABELS = {
  admission: "Admission Form",
  career: "Faculty Application",
};

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000)); // 6-digit
}

// Every OTP record for this email+formType created within the resend
// window, newest first — used both to enforce the resend cap and to find
// the "current" record to verify against.
function recordsForIdentity(email, formType) {
  return db.find("formOtps", { email, formType })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Step 1 — email a 6-digit code. Enforces the per-identity resend cap
 * (default 3 sends per rolling hour) and the short cooldown between two
 * consecutive sends (default 60s) so a single click-happy visitor (or a
 * bot) can't turn this into an email flood against someone's inbox.
 */
async function sendOtp({ email, formType, req }) {
  const label = FORM_LABELS[formType] || "verification";
  const now = Date.now();

  const recent = recordsForIdentity(email, formType);
  const windowStart = now - FORM_OTP_RESEND_WINDOW_MS;
  const sentInWindow = recent.filter(r => new Date(r.createdAt).getTime() >= windowStart);

  if (sentInWindow.length > 0) {
    const lastSentAt = new Date(sentInWindow[0].createdAt).getTime();
    const msSinceLast = now - lastSentAt;
    if (msSinceLast < FORM_OTP_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((FORM_OTP_RESEND_COOLDOWN_MS - msSinceLast) / 1000);
      return { ok: false, statusCode: 429, message: `Please wait ${waitSec}s before requesting another code.` };
    }
    if (sentInWindow.length >= FORM_OTP_MAX_RESEND) {
      return {
        ok: false,
        statusCode: 429,
        message: "Too many verification code requests for this email. Please try again after some time.",
      };
    }
  }

  const otp = generateOtp();
  db.insertOne("formOtps", {
    email,
    formType,
    otp,
    attempts: 0,
    expiresAt: new Date(now + FORM_OTP_EXPIRY_MS).toISOString(),
    verified: false,
    verifiedAt: null,
    verifyToken: null,
    tokenExpiresAt: null,
    used: false,
    usedAt: null,
    // Housekeeping only (services/formOtpCleanup.js) — cleared to null the
    // moment `used` flips true so the TTL index never touches a record
    // that's actually load-bearing (recruitment's duplicate-application
    // guard reads used:true records — see routes/recruitment.js).
    cleanupAt: formOtpCleanupDate(),
  });

  const mailResult = await sendMail({
    to: email,
    subject: "Your Chawla Classes verification code",
    html: `<p>Your verification code for the Chawla Classes ${label} is:</p><h2 style="letter-spacing:6px;">${otp}</h2><p>This code expires in ${Math.round(FORM_OTP_EXPIRY_MS / 60000)} minutes. If you didn't request this, you can safely ignore this email.</p>`,
    text: `Your Chawla Classes ${label} verification code is ${otp}. It expires in ${Math.round(FORM_OTP_EXPIRY_MS / 60000)} minutes.`,
  });

  if (!mailResult || mailResult.sent === false) {
    logger.error(`Form OTP (${formType}) email to ${email} failed to send: ${mailResult?.reason || "unknown reason"}`);
    return { ok: false, statusCode: 500, message: "Couldn't send the verification email right now. Please try again in a moment." };
  }

  logger.info(`Form OTP (${formType}) sent to ${email}${req ? ` from ${req.ip}` : ""}`);
  return { ok: true, statusCode: 200, message: "Verification code sent — please check your email." };
}

/**
 * Step 2 — confirm the 6-digit code. Returns a short-lived verifyToken
 * (30 min) the route handler requires on the actual submit endpoint.
 * Max 5 wrong attempts (config: FORM_OTP_MAX_VERIFY_ATTEMPTS) before that
 * OTP is locked out and a fresh one must be requested.
 */
function verifyOtp({ email, otp, formType }) {
  const record = recordsForIdentity(email, formType).find(r => !r.used);
  if (!record) {
    return { ok: false, statusCode: 400, message: "No verification code found for this email. Please request a new one." };
  }
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    return { ok: false, statusCode: 400, message: "This code has expired. Please request a new one." };
  }
  if (record.attempts >= FORM_OTP_MAX_VERIFY_ATTEMPTS) {
    return { ok: false, statusCode: 429, message: "Too many incorrect attempts. Please request a new code." };
  }
  if (record.otp !== otp) {
    db.findByIdAndUpdate("formOtps", record._id, { attempts: record.attempts + 1 });
    const remaining = FORM_OTP_MAX_VERIFY_ATTEMPTS - (record.attempts + 1);
    return {
      ok: false,
      statusCode: 400,
      message: remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : "Incorrect code. Please request a new one.",
    };
  }

  const verifyToken = crypto.randomBytes(24).toString("hex");
  db.findByIdAndUpdate("formOtps", record._id, {
    verified: true,
    verifiedAt: new Date().toISOString(),
    verifyToken,
    tokenExpiresAt: new Date(Date.now() + FORM_OTP_VERIFY_TOKEN_MS).toISOString(),
  });

  return { ok: true, statusCode: 200, message: "Email verified.", verifyToken };
}

/**
 * Step 3 (called from the actual submit route, not exposed as its own
 * endpoint) — looks up a verified, unused, unexpired token for this
 * email/formType. Returns the record (so the caller can mark it used
 * after a successful save) or null if the token doesn't check out.
 */
function findValidVerifiedRecord({ email, verifyToken, formType }) {
  const record = db.find("formOtps", { email, formType, verifyToken, verified: true, used: false })[0];
  if (!record) return null;
  if (new Date(record.tokenExpiresAt).getTime() < Date.now()) return null;
  return record;
}

// Marks a verified OTP record as consumed once the actual admission/
// application record has been saved, so the same code/token can never be
// replayed for a second submission. Exempts it from the TTL cleanup index
// at the same time (see services/formOtpCleanup.js header comment).
function markUsed(recordId, extra = {}) {
  db.findByIdAndUpdate("formOtps", recordId, {
    used: true,
    usedAt: new Date().toISOString(),
    cleanupAt: null,
    ...extra,
  });
}

module.exports = { sendOtp, verifyOtp, findValidVerifiedRecord, markUsed };
