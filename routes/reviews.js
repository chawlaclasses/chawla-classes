/**
 * routes/reviews.js
 *
 * PUBLIC Reviews endpoint — public/feedback.html's "Student Feedback &
 * Rating" form (studentName, studentClass, rating, feedback, email,
 * phone) posts here, and the homepage's "Student Reviews" section reads
 * back only the approved ones. Previously this form/section talked only
 * to an external Google Sheet with no moderation at all (anyone's
 * submission appeared immediately); this gives Rohit an actual
 * approve/reject step from the admin panel before anything shows on the
 * site. See routes/admin/reviews.js for the moderation side, and
 * routes/admin/review-verifications.js for the one-review-per-person
 * identity records this file creates below.
 *
 * ONE REVIEW PER EMAIL/PHONE, FOREVER (like a Google review): the
 * feedback form requires verifying an email via a one-time 6-digit code
 * before the "Submit Feedback" button will work — mirroring the
 * admission/enquiry duplicate-guard in routes/publicEnquiry.js. Flow:
 *   1. POST /send-otp   { email, phone } -> emails a 6-digit code
 *   2. POST /verify-otp { email, phone, otp } -> returns a verifyToken
 *   3. POST /            (this file's existing submit route) now also
 *      requires { email, phone, verifyToken } and burns the token so it
 *      can't be reused for a second review.
 * Records live in the 'reviewOtps' collection; routes/admin/review-
 * verifications.js is where Rohit can see/reset them if someone
 * genuinely needs to submit a brand new review (e.g. mistyped email the
 * first time — the "reset" there deletes the reviewOtps record, which
 * is what this file's block-check reads).
 *
 * A hard, permanent one-submission-forever block turned out to be too
 * strict on its own: a genuine change of opinion, a typo the reviewer
 * doesn't notice for months, wanting to review again a year later, etc.
 * had no path except emailing Rohit. So a second review is never
 * created for an identity that already has one — instead, every path
 * that would have blocked them (send-otp, submit) auto-emails them
 * their existing review's private EDIT link, and says so:
 *   - EDIT: every submission mails the reviewer a permanent, private
 *     edit link (GET/PUT /edit/:token below) — it never expires and
 *     stays valid for as long as the review exists, so it works whether
 *     they come back after a week or after two years. No
 *     re-verification needed: the emailed token itself (a
 *     crypto.randomBytes(32) value — 256 bits, not guessable) is the
 *     credential. Editing pushes the review back to 'pending' so it
 *     goes through moderation again, same as a fresh submission.
 *   - RESEND: POST /resend-edit-link lets a reviewer who lost/deleted
 *     that email ask for it again, by re-entering their verified
 *     email/phone (public/feedback.html's "Lost your edit link?").
 *     send-otp/submit also trigger this same resend automatically when
 *     they hit the one-review block, so "review already exists" always
 *     comes with "we just emailed you the way to change it" — see
 *     maybeSendEditLink below, shared by all three trigger points, with
 *     its own short per-review cooldown so it can't be used to spam
 *     someone's inbox.
 *
 * Mirrors the security posture of routes/publicEnquiry.js: its own rate
 * limiters (no login on any route in this file) and the strictest
 * validators in utils/validators.js.
 */

"use strict";

const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const db = require("../services/jsonDb");
const logger = require("../utils/logger");
const { sendMail } = require("../utils/mailer");
const { validate } = require("../middleware/validation");
const validators = require("../utils/validators");
const { createSubmissionRateLimiter } = require("../middleware/rateLimit");
const { reviewOtpCleanupDate } = require("../services/reviewOtpCleanup");

const OTP_EXPIRY_MS           = 10 * 60 * 1000; // 10 min to enter the code
const VERIFY_TOKEN_EXPIRY_MS  = 30 * 60 * 1000; // 30 min to finish + submit the form after verifying
const MAX_OTP_ATTEMPTS        = 5;
const OTP_RESEND_COOLDOWN_MS  = 60 * 1000;      // 1 min between resend requests for the same email

// Minimum gap between edit-link emails for the SAME review, so repeatedly
// hitting send-otp/submit/resend-edit-link for an identity that already
// has a review can't be used to spam that person's inbox. Shared by
// maybeSendEditLink below, whichever of the three routes triggers it.
const EDIT_LINK_RESEND_COOLDOWN_MS = 60 * 1000;

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000)); // 6-digit, zero-padding not needed at this range
}

// Does this email OR phone already have a completed, non-deleted review?
// Returns that review's _id, or null if there isn't one (fresh
// submission allowed) -- including when the only prior review was
// soft-deleted by an admin, since a deleted review no longer counts as
// "active" for the one-review-per-identity rule. Sourced from
// 'reviewOtps' (not 'reviews' directly) so it stays in sync with
// routes/admin/review-verifications.js's reset action, which deletes the
// reviewOtps record to let someone submit a genuinely new review.
function findExistingReviewId(email, phone) {
  const used = db.find("reviewOtps", {}).filter(r => r.used && (r.email === email || r.phone === phone));
  if (used.length === 0) return null;
  const latest = used.sort((a, b) => new Date(b.usedAt) - new Date(a.usedAt))[0];
  if (!latest.reviewId) return null;
  const review = db.findById("reviews", latest.reviewId);
  return (review && !review.deleted) ? latest.reviewId : null;
}

// Emails the reviewer their permanent edit link, unless one was already
// sent for this review within EDIT_LINK_RESEND_COOLDOWN_MS. Returns
// true if an email actually went out just now, false if skipped
// (cooldown still active, no email on the review, or the send failed).
async function maybeSendEditLink(review, req) {
  if (!review || !review.editToken || !review.email) return false;

  const lastSent = review.lastEditLinkSentAt ? new Date(review.lastEditLinkSentAt).getTime() : 0;
  if (Date.now() - lastSent < EDIT_LINK_RESEND_COOLDOWN_MS) return false;

  const editLink = `${req.protocol}://${req.get("host")}/edit-review.html?token=${review.editToken}`;
  try {
    await sendMail({
      to: review.email,
      subject: "Your Chawla Classes review — edit link",
      html: `<p>Here's the private link to view or update your Chawla Classes review any time:</p><p><a href="${editLink}">${editLink}</a></p><p>Editing sends it back for a quick re-check before it reappears on the site. If you didn't request this, you can safely ignore this email.</p>`,
      text: `Edit your Chawla Classes review here: ${editLink}`,
    });
    db.findByIdAndUpdate("reviews", review._id, { lastEditLinkSentAt: new Date().toISOString() });
    return true;
  } catch (mailErr) {
    logger.error(`Edit-link email to ${review.email} failed to send: ${mailErr.message}`);
    return false;
  }
}

// ============================================================
// Public read — only approved reviews, only the fields a visitor should
// see (no status/rejectionReason/reviewedBy/email/phone). Featured
// reviews first, then newest first. Feeds the homepage's "Student
// Reviews" section.
// ============================================================
router.get("/approved", (req, res) => {
  try {
    const reviews = db
      .find("reviews", { status: "approved", deleted: { $ne: true } })
      .sort((a, b) => {
        const featuredDiff = (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0);
        if (featuredDiff !== 0) return featuredDiff;
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .map(r => ({
        _id: r._id,
        studentName: r.studentName,
        studentClass: r.studentClass,
        rating: r.rating,
        feedback: r.feedback,
        isFeatured: !!r.isFeatured,
      }));
    res.json({ success: true, data: reviews });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Step 1 — send a 6-digit code to the visitor's email.
// ============================================================
router.post("/send-otp", createSubmissionRateLimiter(5), validators.sendReviewOtp, validate, async (req, res) => {
  try {
    const email = req.body.email.trim().toLowerCase();
    const phone = req.body.phone.trim();

    const existingReviewId = findExistingReviewId(email, phone);
    if (existingReviewId) {
      const existingReview = db.findById("reviews", existingReviewId);
      const sent = await maybeSendEditLink(existingReview, req);
      return res.status(409).json({
        success: false,
        message: sent
          ? "A review already exists for this email or mobile number. We've emailed you the edit link to update it."
          : "A review already exists for this email or mobile number. We recently sent the edit link — please check your inbox (and spam folder).",
      });
    }

    // Cooldown so one identity can't trigger a flood of emails via repeat clicks.
    const recent = db.find("reviewOtps", { email })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    if (recent) {
      const msSinceLast = Date.now() - new Date(recent.createdAt).getTime();
      if (msSinceLast < OTP_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - msSinceLast) / 1000);
        return res.status(429).json({ success: false, message: `Please wait ${waitSec}s before requesting another code.` });
      }
    }

    const otp = generateOtp();
    db.insertOne("reviewOtps", {
      email,
      phone,
      otp,
      attempts: 0,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS).toISOString(),
      verified: false,
      verifiedAt: null,
      verifyToken: null,
      tokenExpiresAt: null,
      used: false,
      usedAt: null,
      reviewId: null,
      // TTL cleanup only -- see services/reviewOtpCleanup.js. Cleared to
      // null the moment `used` flips to true below, so a completed
      // review's identity record (load-bearing for duplicate prevention)
      // is never touched by the TTL index.
      cleanupAt: reviewOtpCleanupDate(),
    });

    const mailResult = await sendMail({
      to: email,
      subject: "Your Chawla Classes verification code",
      html: `<p>Your verification code for submitting a review on the Chawla Classes website is:</p><h2 style="letter-spacing:6px;">${otp}</h2><p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>`,
      text: `Your Chawla Classes review verification code is ${otp}. It expires in 10 minutes.`,
    });

    if (!mailResult || mailResult.sent === false) {
      logger.error(`Review OTP email to ${email} failed to send: ${mailResult?.reason || "unknown reason"}`);
      return res.status(500).json({ success: false, message: "Couldn't send the verification email right now. Please try again in a moment." });
    }

    logger.info(`Review OTP sent to ${email}`);
    res.json({ success: true, message: "Verification code sent — please check your email." });
  } catch (error) {
    logger.error(`POST /reviews/send-otp failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Step 2 — confirm the code, get back a verifyToken to submit with.
// ============================================================
router.post("/verify-otp", createSubmissionRateLimiter(15), validators.verifyReviewOtp, validate, (req, res) => {
  try {
    const email = req.body.email.trim().toLowerCase();
    const phone = req.body.phone.trim();
    const otp   = req.body.otp.trim();

    const record = db.find("reviewOtps", { email, phone, used: false })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (!record) {
      return res.status(400).json({ success: false, message: "No verification code found for this email. Please request a new one." });
    }
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "This code has expired. Please request a new one." });
    }
    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ success: false, message: "Too many incorrect attempts. Please request a new code." });
    }
    if (record.otp !== otp) {
      db.findByIdAndUpdate("reviewOtps", record._id, { attempts: record.attempts + 1 });
      const remaining = MAX_OTP_ATTEMPTS - (record.attempts + 1);
      return res.status(400).json({ success: false, message: remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : "Incorrect code. Please request a new one." });
    }

    const verifyToken = crypto.randomBytes(24).toString("hex");
    db.findByIdAndUpdate("reviewOtps", record._id, {
      verified: true,
      verifiedAt: new Date().toISOString(),
      verifyToken,
      tokenExpiresAt: new Date(Date.now() + VERIFY_TOKEN_EXPIRY_MS).toISOString(),
    });

    res.json({ success: true, message: "Email verified.", data: { verifyToken } });
  } catch (error) {
    logger.error(`POST /reviews/verify-otp failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Public submit — requires a valid, unused verifyToken from Step 2
// above. Always lands as 'pending'; only visible on the site once an
// admin approves it from Review Management. Also mails the reviewer a
// private edit link (see /edit/:token below) so they have a way to fix
// or update it later without going through OTP verification again.
// ============================================================
router.post("/", createSubmissionRateLimiter(10), validators.submitReview, validate, async (req, res) => {
  try {
    const { studentName, studentClass, rating, feedback } = req.body;
    const email = req.body.email.trim().toLowerCase();
    const phone = req.body.phone.trim();
    const verifyToken = req.body.verifyToken.trim();

    const record = db.find("reviewOtps", { email, phone, verifyToken, verified: true, used: false })[0];
    if (!record) {
      return res.status(400).json({ success: false, message: "Please verify your email before submitting." });
    }
    if (new Date(record.tokenExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "Your verification has expired. Please verify your email again." });
    }
    // Authoritative check -- re-checked here (not just at send-otp time)
    // in case a second verified identity sharing the same email/phone
    // slipped through between steps.
    const existingReviewId = findExistingReviewId(email, phone);
    if (existingReviewId) {
      const existingReview = db.findById("reviews", existingReviewId);
      const sent = await maybeSendEditLink(existingReview, req);
      return res.status(409).json({
        success: false,
        message: sent
          ? "A review already exists for this email or mobile number. We've emailed you the edit link to update it."
          : "A review already exists for this email or mobile number. We recently sent the edit link — please check your inbox (and spam folder).",
      });
    }

    // 32 random bytes (256 bits) so this can't be guessed/brute-forced --
    // this token alone grants edit access to the review, no login involved.
    // Never expires: it must still work whether the reviewer comes back
    // after a week or after two years (see GET/PUT /edit/:token below).
    const editToken = crypto.randomBytes(32).toString("hex");

    const review = db.insertOne("reviews", {
      studentName: studentName.trim(),
      studentClass: studentClass.trim(),
      rating,
      feedback: feedback.trim(),
      email,
      phone,
      status: "pending",
      source: "website",
      isFeatured: false,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: "",
      editToken,
      lastEditedAt: null,
      lastEditLinkSentAt: null,
      editCount: 0,
      deleted: false,
      deletedAt: null,
      deletedBy: null,
    });

    db.findByIdAndUpdate("reviewOtps", record._id, {
      used: true,
      usedAt: new Date().toISOString(),
      reviewId: review._id,
      // Exempt from the TTL cleanup index from this point on -- this
      // record is now load-bearing (findExistingReviewId reads it), not
      // abandoned. See services/reviewOtpCleanup.js.
      cleanupAt: null,
    });

    logger.info(`Website review submitted: ${review._id} (${review.studentName}, ${review.rating}★, ${email})`);

    // Best-effort: the review is already saved either way, so a failed
    // edit-link email doesn't fail the submission itself -- just logged
    // inside maybeSendEditLink. No cooldown to worry about on a review
    // that was only just created (lastEditLinkSentAt starts null).
    await maybeSendEditLink(review, req);

    res.status(201).json({
      success: true,
      message: "Thanks for your feedback! It will appear on the site once reviewed. We've emailed you a link in case you want to edit it later.",
      data: { reviewId: review._id },
    });
  } catch (error) {
    logger.error(`POST /reviews failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong submitting your review. Please try again." });
  }
});

// ============================================================
// Public edit — fetch by the private token emailed at submit time, to
// pre-fill the edit form. No OTP re-verification: the token itself
// (mailed only to the address the reviewer verified) is the credential.
// ============================================================
router.get("/edit/:token", createSubmissionRateLimiter(20), (req, res) => {
  try {
    const token = (req.params.token || "").trim();
    const review = token ? db.find("reviews", { editToken: token })[0] : null;
    if (!review || review.deleted) {
      return res.status(404).json({ success: false, message: "This edit link is invalid or has expired." });
    }
    res.json({
      success: true,
      data: {
        studentName: review.studentName,
        studentClass: review.studentClass,
        rating: review.rating,
        feedback: review.feedback,
        status: review.status,
      },
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Public edit — apply the update. Resets status to 'pending' so the
// edited content goes through moderation again, same as a fresh
// submission (an edit shouldn't be a way to sneak changes past Rohit).
// The editToken itself is left as-is so the same link keeps working for
// future edits too. Email/phone are deliberately NOT accepted here (only
// studentName/studentClass/rating/feedback are read from req.body below)
// -- otherwise anyone holding the edit link could reassign the review to
// a different identity entirely. editCount/lastEditedAt give Rohit an
// audit trail in the admin panel if a review gets edited repeatedly.
// ============================================================
router.put("/edit/:token", createSubmissionRateLimiter(10), validators.editReview, validate, (req, res) => {
  try {
    const token = (req.params.token || "").trim();
    const review = token ? db.find("reviews", { editToken: token })[0] : null;
    if (!review || review.deleted) {
      return res.status(404).json({ success: false, message: "This edit link is invalid or has expired." });
    }

    const { studentName, studentClass, rating, feedback } = req.body;
    const updated = db.findByIdAndUpdate("reviews", review._id, {
      studentName: studentName.trim(),
      studentClass: studentClass.trim(),
      rating,
      feedback: feedback.trim(),
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: "",
      lastEditedAt: new Date().toISOString(),
      editCount: (review.editCount || 0) + 1,
    });

    logger.info(`Review ${review._id} edited via public edit link (${review.email}); reset to pending`);

    res.json({
      success: true,
      message: "Your review has been updated! It will appear on the site once reviewed again.",
      data: { reviewId: updated._id },
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong updating your review. Please try again." });
  }
});

// ============================================================
// "Lost your edit link?" — public/feedback.html lets a reviewer
// re-request it by re-entering their verified email/phone (no OTP this
// time; that already happened once at submit time). Same
// maybeSendEditLink + cooldown as the auto-resend on send-otp/submit
// above, so this can't be hammered to spam someone's inbox either.
// ============================================================
router.post("/resend-edit-link", createSubmissionRateLimiter(5), validators.resendEditLink, validate, async (req, res) => {
  try {
    const email = req.body.email.trim().toLowerCase();
    const phone = req.body.phone.trim();

    const existingReviewId = findExistingReviewId(email, phone);
    const review = existingReviewId ? db.findById("reviews", existingReviewId) : null;

    if (!review || !review.editToken) {
      return res.status(404).json({ success: false, message: "No review found for this email or mobile number." });
    }

    const sent = await maybeSendEditLink(review, req);
    res.json({
      success: true,
      message: sent
        ? "Edit link sent! Please check your inbox (and spam folder)."
        : "We recently sent the edit link to this email — please check your inbox (and spam folder), or wait a minute before requesting again.",
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;