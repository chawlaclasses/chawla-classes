/**
 * routes/recruitment.js
 *
 * PUBLIC Faculty Recruitment endpoint — the one route a job candidate hits
 * from public/careers.html, before ever logging in (they aren't a user in
 * the system yet). Deliberately kept separate from routes/admin/recruitment.js
 * (which is authenticated, mounted under adminRoutes.js) so there's no risk
 * of an auth check accidentally missing here or there.
 *
 * Mirrors the security posture of routes/apiAuth.js's login route: its own
 * rate limiter (this is the one write endpoint on the whole site that
 * requires no credentials at all, so it's the obvious spam/abuse target),
 * duplicate-submission guard, and the strictest validator in utils/validators.js.
 *
 * ANTI-SPAM HARDENING (2026-08): honeypot field, a per-IP hourly cap
 * (separate from the per-minute limiter already below), a per-IP post-
 * success cooldown, and a mandatory email-OTP verification step (POST
 * /send-otp, /verify-otp below) before /apply will accept a submission —
 * same shape as the Admission Form's equivalent hardening in
 * routes/publicEnquiry.js, sharing services/formOtpService.js and
 * utils/spamDetection.js. The existing duplicate-application guard further
 * down (email/phone, exempting rejected applicants) is UNCHANGED — that's
 * existing, intentional behavior, not something this pass touches.
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validation");
const validators = require("../utils/validators");
const { createSubmissionRateLimiter, createHourlyRateLimiter } = require("../middleware/rateLimit");
const { uploadFacultyApplication, facultyApplicationMimeGuard } = require("../middleware/upload");
const r2Service = require("../services/r2Service");
const { sendMail, isConfigured: mailConfigured } = require("../utils/mailer");
const { honeypotGuard } = require("../middleware/honeypot");
const { careerCooldown } = require("../middleware/submissionCooldown");
const formOtpService = require("../services/formOtpService");
const { isBlockedEmailDomain } = require("../utils/spamDetection");
const { CAREER_HOURLY_LIMIT } = require("../config");

// Public read of open positions — feeds the Careers page's "Current Open
// Positions" section and the application form's position dropdown. Only
// status:'open' and only the fields a candidate should see (no
// createdBy/internal metadata).
router.get("/positions", (req, res) => {
  try {
    const positions = db.find("facultyPositions", { status: "open" })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(p => ({ _id: p._id, title: p.title, description: p.description, qualification: p.qualification, experience: p.experience, employmentType: p.employmentType, salary: p.salary }));
    res.json({ success: true, data: positions });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

const applyUpload = uploadFacultyApplication.fields([
  { name: "resume", maxCount: 1 },
  { name: "certificates", maxCount: 5 },
  { name: "photo", maxCount: 1 },
  { name: "demoVideo", maxCount: 1 },
]);

async function cleanupReqFiles(files) {
  const keys = [];
  for (const field of Object.values(files || {})) {
    for (const f of field) { if (f.r2Key) keys.push(f.r2Key); }
  }
  await r2Service.deleteObjects(keys);
}

// ============================================================
// Career Form — Step 1: email a 6-digit verification code. Plain JSON
// endpoint (no file upload involved yet at this point in the flow).
// ============================================================
router.post(
  "/send-otp",
  honeypotGuard("Verification code sent — please check your email."),
  createSubmissionRateLimiter(5),
  validators.sendCareerOtp,
  validate,
  async (req, res) => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const result = await formOtpService.sendOtp({ email, formType: "career", req });
      res.status(result.statusCode).json({ success: result.ok, message: result.message });
    } catch (error) {
      logger.error(`POST /careers/send-otp failed: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    }
  }
);

// ============================================================
// Career Form — Step 2: confirm the code, get back a verifyToken.
// ============================================================
router.post(
  "/verify-otp",
  createSubmissionRateLimiter(15),
  validators.verifyCareerOtp,
  validate,
  (req, res) => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const otp = req.body.otp.trim();
      const result = formOtpService.verifyOtp({ email, otp, formType: "career" });
      res.status(result.statusCode).json({
        success: result.ok,
        message: result.message,
        ...(result.verifyToken ? { data: { verifyToken: result.verifyToken } } : {}),
      });
    } catch (error) {
      logger.error(`POST /careers/verify-otp failed: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    }
  }
);

// SECURITY: 5/minute per IP (existing), PLUS (this hardening pass) a
// per-IP hourly cap and post-success cooldown, honeypot, and mandatory
// email-OTP verification (verifyToken, checked inside the handler below).
// Ordered so the cheapest IP-only checks run before multer ever touches
// the multipart body, and honeypot runs right after multer parses it but
// BEFORE facultyApplicationMimeGuard — which is what actually uploads
// files to R2 — so a honeypot-caught bot never costs an R2 upload.
router.post(
  "/apply",
  createHourlyRateLimiter(CAREER_HOURLY_LIMIT, "Too many applications submitted from this device. Please try again after some time, or email your resume directly."),
  careerCooldown.check,
  createSubmissionRateLimiter(5),
  applyUpload,
  honeypotGuard("Application submitted successfully. We'll be in touch if there's a match."),
  facultyApplicationMimeGuard,
  validators.submitFacultyApplication,
  validate,
  async (req, res) => {
    const files = req.files || {};
    try {
      const resumeFile = (files.resume || [])[0];
      if (!resumeFile) {
        await cleanupReqFiles(files);
        return res.status(400).json({ success: false, message: "Resume is required" });
      }

      const {
        fullName, parentName, gender, dob, phone, whatsapp, email, address, city, state, pin,
        qualification, college, university, passingYear, percentage,
        experience, currentInstitute, positionId, preferredSubjects, preferredClasses, preferredBoards,
        employmentType, expectedSalary, joiningDate, skills, verifyToken,
      } = req.body;

      const normalizedEmail = (email || "").toLowerCase().trim();
      const trimmedPhone = (phone || "").trim();

      // NEW: mandatory email OTP verification — the applicant must have
      // completed POST /send-otp + /verify-otp for this exact email
      // before this token exists and validates.
      const otpRecord = formOtpService.findValidVerifiedRecord({ email: normalizedEmail, verifyToken: (verifyToken || "").trim(), formType: "career" });
      if (!otpRecord) {
        await cleanupReqFiles(files);
        return res.status(400).json({ success: false, message: "Please verify your email before submitting." });
      }

      // SECURITY: prevent the same person re-submitting over and over
      // (accidental double-click, or someone trying to flood the pipeline).
      // A rejected application is allowed to re-apply — people improve
      // their resume and try again, that's normal, not abuse. UNCHANGED
      // from before this hardening pass.
      const existing = db
        .find("facultyApplications", {})
        .find(a => (a.email === normalizedEmail || a.phone === (phone || "").trim()) && a.status !== "rejected");
      if (existing) {
        await cleanupReqFiles(files);
        return res.status(409).json({
          success: false,
          message: "An application with this email or mobile number is already in progress. We'll be in touch.",
        });
      }

      // skills[] can arrive as a JSON string (fetch/FormData) or an array
      // (already-parsed body) depending on how the form posts it.
      let parsedSkills = [];
      if (Array.isArray(skills)) parsedSkills = skills;
      else if (typeof skills === "string" && skills.trim()) {
        try { parsedSkills = JSON.parse(skills); } catch { parsedSkills = skills.split(",").map(s => s.trim()).filter(Boolean); }
      }

      // NEW: admin-review flags. Only reachable here at all if the hard
      // duplicate block above (non-rejected match) didn't already fire —
      // so a true here means either this email/phone previously applied
      // and was rejected (allowed to re-apply, but worth Rohit knowing),
      // or blockedDomain slipped through somehow (defensive only —
      // send-otp already blocks disposable domains before an OTP is ever
      // issued for one).
      const everAppliedByEmail = db.find("facultyApplications", {}).some(a => a.email === normalizedEmail);
      const everAppliedByPhone = db.find("facultyApplications", {}).some(a => a.phone === trimmedPhone);
      const blockedDomain = isBlockedEmailDomain(normalizedEmail);
      const flags = {
        isSuspicious: everAppliedByEmail || everAppliedByPhone || blockedDomain,
        duplicateEmail: everAppliedByEmail,
        duplicateMobile: everAppliedByPhone,
        blockedDomain,
      };

      const application = db.insertOne("facultyApplications", {
        fullName: (fullName || "").trim(),
        parentName: (parentName || "").trim(),
        gender: gender || "",
        dob: dob || "",
        phone: (phone || "").trim(),
        whatsapp: (whatsapp || "").trim(),
        email: normalizedEmail,
        address: (address || "").trim(),
        city: (city || "").trim(),
        state: (state || "").trim(),
        pin: (pin || "").trim(),
        qualification: (qualification || "").trim(),
        college: (college || "").trim(),
        university: (university || "").trim(),
        passingYear: (passingYear || "").trim(),
        percentage: (percentage || "").trim(),
        experience: (experience || "").trim(),
        currentInstitute: (currentInstitute || "").trim(),
        positionId: (positionId || "").trim(),
        preferredSubjects: (preferredSubjects || "").trim(),
        preferredClasses: (preferredClasses || "").trim(),
        preferredBoards: (preferredBoards || "").trim(),
        employmentType: employmentType || "",
        expectedSalary: (expectedSalary || "").trim(),
        joiningDate: joiningDate || "",
        skills: parsedSkills,
        resume: resumeFile ? { key: resumeFile.r2Key, filename: resumeFile.filename, originalName: resumeFile.originalname } : null,
        certificates: (files.certificates || []).map(f => ({ key: f.r2Key, filename: f.filename, originalName: f.originalname })),
        photo: (files.photo || [])[0] ? { key: files.photo[0].r2Key, filename: files.photo[0].filename, originalName: files.photo[0].originalname } : null,
        demoVideo: (files.demoVideo || [])[0] ? { key: files.demoVideo[0].r2Key, filename: files.demoVideo[0].filename, originalName: files.demoVideo[0].originalname } : null,
        status: "applied",
        adminNotes: [],
        interview: null,
        demoEvaluation: null,
        statusHistory: [{ status: "applied", at: new Date().toISOString(), by: null }],
        // NEW fields (this hardening pass) — additive only, existing
        // status field/values/hiring-pipeline workflow are unchanged.
        emailVerified: true,
        emailVerifiedAt: otpRecord.verifiedAt,
        flags,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] || "",
      });

      formOtpService.markUsed(otpRecord._id, { applicationId: application._id });
      careerCooldown.markSuccess(req);

      logger.info(`Faculty application submitted: ${application._id} (${application.fullName}, ${normalizedEmail})${flags.isSuspicious ? " [flagged for review]" : ""}`);

      // Best-effort — a slow/misconfigured mail server should never block
      // the applicant from getting their success response.
      if (mailConfigured() && normalizedEmail) {
        sendMail({
          to: normalizedEmail,
          subject: "Application Received — Chawla Classes",
          html: `
            <p>Hi ${application.fullName || "there"},</p>
            <p>Thanks for applying to join the faculty at Chawla Classes. We've received your application and our team will review it shortly.</p>
            <p>If shortlisted, we'll reach out on the phone number or email you provided.</p>
            <p>— Chawla Classes</p>
          `,
        }).catch(err => logger.error(`Faculty application confirmation email failed: ${err.message}`));
      }

      res.status(201).json({
        success: true,
        message: "Application submitted successfully. We'll be in touch if there's a match.",
        data: { applicationId: application._id },
      });
    } catch (error) {
      await cleanupReqFiles(files);
      logger.error(`POST /careers/apply failed: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: "Something went wrong submitting your application. Please try again." });
    }
  }
);

module.exports = router;