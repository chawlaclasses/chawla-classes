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
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validation");
const validators = require("../utils/validators");
const { createSubmissionRateLimiter } = require("../middleware/rateLimit");
const { uploadFacultyApplication, facultyApplicationMimeGuard } = require("../middleware/upload");
const { cleanupFile } = require("../utils/helpers");
const { sendMail, isConfigured: mailConfigured } = require("../utils/mailer");

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

function cleanupReqFiles(files) {
  for (const field of Object.values(files || {})) {
    for (const f of field) cleanupFile(f.path);
  }
}

// SECURITY: 5/minute per IP. A genuine applicant submits once; anything
// past that on the same connection is either a double-click or abuse.
router.post(
  "/apply",
  createSubmissionRateLimiter(5),
  applyUpload,
  facultyApplicationMimeGuard,
  validators.submitFacultyApplication,
  validate,
  async (req, res) => {
    const files = req.files || {};
    try {
      const resumeFile = (files.resume || [])[0];
      if (!resumeFile) {
        cleanupReqFiles(files);
        return res.status(400).json({ success: false, message: "Resume is required" });
      }

      const {
        fullName, parentName, gender, dob, phone, whatsapp, email, address, city, state, pin,
        qualification, college, university, passingYear, percentage,
        experience, currentInstitute, positionId, preferredSubjects, preferredClasses, preferredBoards,
        employmentType, expectedSalary, joiningDate, skills,
      } = req.body;

      const normalizedEmail = (email || "").toLowerCase().trim();

      // SECURITY: prevent the same person re-submitting over and over
      // (accidental double-click, or someone trying to flood the pipeline).
      // A rejected application is allowed to re-apply — people improve
      // their resume and try again, that's normal, not abuse.
      const existing = db
        .find("facultyApplications", {})
        .find(a => (a.email === normalizedEmail || a.phone === (phone || "").trim()) && a.status !== "rejected");
      if (existing) {
        cleanupReqFiles(files);
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
        resume: resumeFile ? { filename: resumeFile.filename, originalName: resumeFile.originalname } : null,
        certificates: (files.certificates || []).map(f => ({ filename: f.filename, originalName: f.originalname })),
        photo: (files.photo || [])[0] ? { filename: files.photo[0].filename, originalName: files.photo[0].originalname } : null,
        demoVideo: (files.demoVideo || [])[0] ? { filename: files.demoVideo[0].filename, originalName: files.demoVideo[0].originalname } : null,
        status: "applied",
        adminNotes: [],
        interview: null,
        demoEvaluation: null,
        statusHistory: [{ status: "applied", at: new Date().toISOString(), by: null }],
      });

      logger.info(`Faculty application submitted: ${application._id} (${application.fullName}, ${normalizedEmail})`);

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
      cleanupReqFiles(files);
      logger.error(`POST /careers/apply failed: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: "Something went wrong submitting your application. Please try again." });
    }
  }
);

module.exports = router;