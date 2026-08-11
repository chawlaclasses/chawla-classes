/**
 * routes/reviews.js
 *
 * PUBLIC Reviews endpoint — index.html's "Student Feedback & Rating" form
 * (studentName, studentClass, rating, feedback) posts here, and the
 * "Student Reviews" section reads back only the approved ones. Previously
 * this form/section talked only to an external Google Sheet with no
 * moderation at all (anyone's submission appeared immediately); this
 * gives Rohit an actual approve/reject step from the admin panel before
 * anything shows on the site. See routes/admin/reviews.js for the
 * moderation side.
 *
 * Mirrors the security posture of routes/publicEnquiry.js: its own rate
 * limiter (the one write endpoint here that needs no login) and the
 * strictest validator in utils/validators.js. No duplicate-submission
 * guard — unlike an enquiry/admission, a genuine student leaving more
 * than one review over time isn't abuse, and there's no phone/email on
 * this form to key a dedupe window on anyway.
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validation");
const validators = require("../utils/validators");
const { createSubmissionRateLimiter } = require("../middleware/rateLimit");

// Public read — only approved reviews, only the fields a visitor should
// see (no status/rejectionReason/reviewedBy). Featured reviews first,
// then newest first. Feeds index.html's "Student Reviews" section.
router.get("/approved", (req, res) => {
  try {
    const reviews = db
      .find("reviews", { status: "approved" })
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
      }));
    res.json({ success: true, data: reviews });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Public submit — always lands as 'pending'; only visible on the site
// once an admin approves it from Review Management.
router.post("/", createSubmissionRateLimiter(10), validators.submitReview, validate, (req, res) => {
  try {
    const { studentName, studentClass, rating, feedback } = req.body;

    const review = db.insertOne("reviews", {
      studentName: studentName.trim(),
      studentClass: studentClass.trim(),
      rating,
      feedback: feedback.trim(),
      status: "pending",
      source: "website",
      isFeatured: false,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: "",
    });

    logger.info(`Website review submitted: ${review._id} (${review.studentName}, ${review.rating}★)`);

    res.status(201).json({
      success: true,
      message: "Thanks for your feedback! It will appear on the site once reviewed.",
      data: { reviewId: review._id },
    });
  } catch (error) {
    logger.error(`POST /reviews failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong submitting your review. Please try again." });
  }
});

module.exports = router;
