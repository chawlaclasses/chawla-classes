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
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validation");
const validators = require("../utils/validators");
const { createSubmissionRateLimiter } = require("../middleware/rateLimit");

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

// index.html's "Admission Form" — kept as its own collection/pipeline
// (routes/admin/admissions.js), separate from the lighter Quick Enquiry
// form above. Higher-intent lead, its own fields and status workflow.
router.post("/admission", createSubmissionRateLimiter(10), validators.submitPublicAdmission, validate, (req, res) => {
  try {
    const { studentName, parentName, phone, email, school, interestedClass, address } = req.body;
    const trimmedPhone = (phone || "").trim();

    const recent = db
      .find("admissions", {})
      .find(a => a.phone === trimmedPhone && (Date.now() - new Date(a.createdAt).getTime()) < DUPLICATE_WINDOW_MS);
    if (recent) {
      return res.status(200).json({ success: true, message: "Admission form received. We'll get back to you shortly." });
    }

    const admission = db.insertOne("admissions", {
      studentName: studentName.trim(),
      parentName: parentName.trim(),
      phone: trimmedPhone,
      email: (email || "").trim(),
      school: (school || "").trim(),
      interestedClass: (interestedClass || "").trim(),
      address: (address || "").trim(),
      source: "website",
      status: "new",
      notes: "",
      createdBy: null,
    });

    logger.info(`Website admission form submitted: ${admission._id} (${admission.studentName}, ${trimmedPhone})`);

    res.status(201).json({ success: true, message: "Admission form received. We'll get back to you shortly." });
  } catch (error) {
    logger.error(`POST /enquiry/admission failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again or call us directly." });
  }
});

module.exports = router;