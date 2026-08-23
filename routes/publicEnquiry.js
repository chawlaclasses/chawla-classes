/**
 * routes/publicEnquiry.js
 *
 * PUBLIC endpoint for index.html's "Quick Enquiry" form. Writes straight
 * into the same 'enquiries' collection routes/admin/enquiries.js already
 * lists/manages in the admin panel — so a website visitor's enquiry now
 * actually reaches the admin panel, instead of only landing in the
 * external Google Sheet the form used to post to exclusively.
 *
 * Mirrors routes/recruitment.js's security posture: its own rate limiter
 * (the one write endpoint here that needs no login) and a short
 * duplicate-submission window to absorb accidental double-clicks.
 *
 * ANTI-SPAM HARDENING (2026-08) — Admission Form only (POST /admission
 * and its two OTP endpoints below). The Quick Enquiry form (POST /,
 * above) is deliberately left untouched — it's the lightweight, low-
 * friction form; the Admission Form is the higher-intent one this pass
 * specifically targets. Layers applied to /admission, in the order they
 * run: honeypot -> per-IP hourly cap -> per-IP post-success cooldown ->
 * strict validation (real Indian mobile, non-disposable email) -> email
 * OTP verification (send-otp/verify-otp below, modeled on the existing
 * routes/reviews.js flow) -> duplicate-identity flags for admin review ->
 * best-effort "Admission Form Received" confirmation email (same pattern
 * routes/recruitment.js already used for its Career Form applicants).
 * See services/formOtpService.js and utils/spamDetection.js for the
 * shared logic behind most of this.
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validation");
const validators = require("../utils/validators");
const { createSubmissionRateLimiter, createHourlyRateLimiter } = require("../middleware/rateLimit");
const { honeypotGuard } = require("../middleware/honeypot");
const { admissionCooldown } = require("../middleware/submissionCooldown");
const formOtpService = require("../services/formOtpService");
const { isBlockedEmailDomain } = require("../utils/spamDetection");
const { sendMail, isConfigured: mailConfigured } = require("../utils/mailer");
const { ADMISSION_HOURLY_LIMIT } = require("../config");

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes — just long enough to absorb a double submit, short enough that a genuine second enquiry later the same day still goes through.

router.post("/", createSubmissionRateLimiter(10), validators.submitPublicEnquiry, validate, (req, res) => {
  try {
    const { name, phone, email, interestedClass, enquiryType, message } = req.body;
    const trimmedPhone = (phone || "").trim();

    const recent = db
      .find("enquiries", {})
      .find(e => e.phone === trimmedPhone && e.source === "website" && (Date.now() - new Date(e.createdAt).getTime()) < DUPLICATE_WINDOW_MS);
    if (recent) {
      // Not an error from the visitor's point of view — their enquiry IS
      // already logged, just don't create a second row for one double-click.
      return res.status(200).json({ success: true, message: "Enquiry received. We'll get back to you shortly." });
    }

    const notesParts = [];
    if (enquiryType) notesParts.push(`Type: ${enquiryType}`);
    if (message) notesParts.push(message);

    const enquiry = db.insertOne("enquiries", {
      name: name.trim(),
      phone: trimmedPhone,
      email: (email || "").trim(),
      interestedClass: (interestedClass || "").trim(),
      source: "website",
      notes: notesParts.join(" — "),
      status: "new",
      createdBy: null,
    });

    logger.info(`Website enquiry submitted: ${enquiry._id} (${enquiry.name}, ${trimmedPhone})`);

    res.status(201).json({ success: true, message: "Enquiry received. We'll get back to you shortly." });
  } catch (error) {
    logger.error(`POST /enquiry failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again or call us directly." });
  }
});

// ============================================================
// Admission Form — Step 1: email a 6-digit verification code.
// Honeypot first (cheapest check, catches most bots before any real
// work happens); rate-limited per-IP same as routes/reviews.js's
// send-otp (5/min) since this is the one place a bot could otherwise
// spam arbitrary strangers' inboxes with codes.
// ============================================================
router.post(
  "/admission/send-otp",
  honeypotGuard("Verification code sent — please check your email."),
  createSubmissionRateLimiter(5),
  validators.sendAdmissionOtp,
  validate,
  async (req, res) => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const result = await formOtpService.sendOtp({ email, formType: "admission", req });
      res.status(result.statusCode).json({ success: result.ok, message: result.message });
    } catch (error) {
      logger.error(`POST /enquiry/admission/send-otp failed: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    }
  }
);

// ============================================================
// Admission Form — Step 2: confirm the code, get back a verifyToken to
// submit with (routes/reviews.js's exact pattern, generalized in
// services/formOtpService.js).
// ============================================================
router.post(
  "/admission/verify-otp",
  createSubmissionRateLimiter(15),
  validators.verifyAdmissionOtp,
  validate,
  (req, res) => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const otp = req.body.otp.trim();
      const result = formOtpService.verifyOtp({ email, otp, formType: "admission" });
      res.status(result.statusCode).json({
        success: result.ok,
        message: result.message,
        ...(result.verifyToken ? { data: { verifyToken: result.verifyToken } } : {}),
      });
    } catch (error) {
      logger.error(`POST /enquiry/admission/verify-otp failed: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    }
  }
);

// index.html's "Admission Form" — kept as its own collection/pipeline
// (routes/admin/admissions.js), separate from the lighter Quick Enquiry
// form above. Higher-intent lead, its own fields and status workflow.
//
// Layer order below: honeypot -> hourly cap -> cooldown -> strict
// validation (incl. verifyToken presence) -> validate() -> handler (which
// re-checks the verifyToken is an actually-verified, unexpired,
// unused OTP record before saving anything).
router.post(
  "/admission",
  honeypotGuard("Admission form received. We'll get back to you shortly."),
  createHourlyRateLimiter(ADMISSION_HOURLY_LIMIT, "Too many admission form submissions from this device. Please try again after some time, or call us directly."),
  admissionCooldown.check,
  validators.submitAdmissionWebsite,
  validate,
  (req, res) => {
    try {
      const { studentName, parentName, phone, school, interestedClass, address, verifyToken } = req.body;
      const trimmedPhone = (phone || "").trim();
      const email = req.body.email.trim().toLowerCase();

      const otpRecord = formOtpService.findValidVerifiedRecord({ email, verifyToken: (verifyToken || "").trim(), formType: "admission" });
      if (!otpRecord) {
        return res.status(400).json({ success: false, message: "Please verify your email before submitting." });
      }

      // Quick-double-click guard (unchanged from before this hardening
      // pass) — a genuine accidental resubmit within 10 minutes of the
      // same phone number is treated as "already received", not a fresh
      // duplicate lead.
      const recentSameClick = db
        .find("admissions", {})
        .find(a => a.phone === trimmedPhone && (Date.now() - new Date(a.createdAt).getTime()) < DUPLICATE_WINDOW_MS);
      if (recentSameClick) {
        return res.status(200).json({ success: true, message: "Admission form received. We'll get back to you shortly." });
      }

      // NEW: identity duplicate flags for admin review (requirement:
      // "Admin Flags"). Deliberately NOT a hard block for the Admission
      // Form — unlike the Career Form below, it's completely normal for
      // one family to submit separate admission forms for more than one
      // child using the same parent email/mobile. Rohit reviews flagged
      // entries from the admin panel instead of them being silently
      // rejected.
      const existingByEmail = db.find("admissions", {}).some(a => a.email && a.email.toLowerCase() === email);
      const existingByPhone = db.find("admissions", {}).some(a => a.phone === trimmedPhone);
      const blockedDomain = isBlockedEmailDomain(email); // defensive only — send-otp already blocks this
      const flags = {
        isSuspicious: existingByEmail || existingByPhone || blockedDomain,
        duplicateEmail: existingByEmail,
        duplicateMobile: existingByPhone,
        blockedDomain,
      };

      const admission = db.insertOne("admissions", {
        studentName: studentName.trim(),
        parentName: parentName.trim(),
        phone: trimmedPhone,
        email,
        school: (school || "").trim(),
        interestedClass: (interestedClass || "").trim(),
        address: (address || "").trim(),
        source: "website",
        status: "new",
        notes: "",
        createdBy: null,
        // NEW fields (this hardening pass) — additive only, existing
        // status field/values/admin workflow are completely unchanged.
        emailVerified: true,
        emailVerifiedAt: otpRecord.verifiedAt,
        flags,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] || "",
      });

      formOtpService.markUsed(otpRecord._id, { admissionId: admission._id });
      admissionCooldown.markSuccess(req);

      logger.info(`Website admission form submitted: ${admission._id} (${admission.studentName}, ${trimmedPhone}, ${email})${flags.isSuspicious ? " [flagged for review]" : ""}`);

      // Confirmation email — same best-effort pattern as the Career Form's
      // existing "Application Received" email (routes/recruitment.js):
      // a slow/misconfigured mail server should never block the parent
      // from getting their success response.
      if (mailConfigured() && email) {
        sendMail({
          to: email,
          subject: "Admission Form Received — Chawla Classes",
          html: `
            <p>Dear ${admission.parentName || "Parent"},</p>
            <p>Thank you for submitting an admission enquiry for <strong>${admission.studentName}</strong> (Class: ${admission.interestedClass || "—"}) at Chawla Classes.</p>
            <p>We've received your form and our team will contact you shortly on ${trimmedPhone}.</p>
            <p>— Chawla Classes<br>"Step Towards Success"</p>
          `,
          text: `Dear ${admission.parentName || "Parent"}, thank you for submitting an admission enquiry for ${admission.studentName} (Class: ${admission.interestedClass || "-"}) at Chawla Classes. We've received your form and our team will contact you shortly on ${trimmedPhone}. — Chawla Classes`,
        }).catch(err => logger.error(`Admission confirmation email failed: ${err.message}`));
      }

      res.status(201).json({ success: true, message: "Admission form received. We'll get back to you shortly." });
    } catch (error) {
      logger.error(`POST /enquiry/admission failed: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: "Something went wrong. Please try again or call us directly." });
    }
  }
);

module.exports = router;
