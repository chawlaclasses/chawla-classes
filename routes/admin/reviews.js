/**
 * routes/admin/reviews.js
 *
 * Admin-side Review Management — the moderation half of the reviews
 * module. Public submission lives in routes/reviews.js instead (no auth
 * there, by design). Mounted at '/reviews' by routes/adminRoutes.js,
 * under app.js's '/api/admin' + requireApiAdmin, so every route below
 * already has req.userData set.
 *
 * A review starts 'pending' when submitted from the website, or
 * 'approved' immediately when an admin types one in directly (no need to
 * approve your own entry). Only 'approved' reviews are ever returned by
 * the public GET /api/reviews/approved endpoint.
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../../services/jsonDb");
const logger = require("../../utils/logger");
const { logAudit } = require("../../utils/auditLog");
const { requirePermission } = require("../../middleware/permissions");
const { validate } = require("../../middleware/validation");
const validators = require("../../utils/validators");

// ============================================================
// Dashboard — status counts + average rating of approved reviews
// ============================================================
router.get("/dashboard", requirePermission("reviews:view"), (req, res) => {
  try {
    const all = db.find("reviews", {});
    const approved = all.filter(r => r.status === "approved");
    const avgRating = approved.length
      ? Math.round((approved.reduce((sum, r) => sum + (r.rating || 0), 0) / approved.length) * 10) / 10
      : 0;

    res.json({
      success: true,
      data: {
        total: all.length,
        pending: all.filter(r => r.status === "pending").length,
        approved: approved.length,
        rejected: all.filter(r => r.status === "rejected").length,
        avgRating,
      },
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// List — optional ?status= filter
// ============================================================
router.get("/", requirePermission("reviews:view"), (req, res) => {
  try {
    const { status } = req.query;
    let reviews = db.find("reviews", {});
    if (status) reviews = reviews.filter(r => r.status === status);
    reviews = reviews.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, data: reviews });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Manual entry — e.g. a WhatsApp/verbal testimonial typed in by staff.
// Goes straight to 'approved' since an admin is vouching for it.
// ============================================================
router.post("/", requirePermission("reviews:edit"), validators.submitReview, validate, (req, res) => {
  try {
    const { studentName, studentClass, rating, feedback } = req.body;

    const review = db.insertOne("reviews", {
      studentName: studentName.trim(),
      studentClass: studentClass.trim(),
      rating,
      feedback: feedback.trim(),
      status: "approved",
      source: "admin",
      isFeatured: false,
      reviewedBy: req.userData.name,
      reviewedAt: new Date().toISOString(),
      rejectionReason: "",
    });

    logAudit(req, "create", "review", review._id, `Added review from ${studentName} (${rating}★)`);
    res.status(201).json({ success: true, data: review, message: "Review added" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Approve / reject
// ============================================================
router.put("/:id/status", requirePermission("reviews:edit"), validators.updateReviewStatus, validate, (req, res) => {
  try {
    const review = db.findById("reviews", req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    const { status, rejectionReason } = req.body;
    const updated = db.findByIdAndUpdate("reviews", req.params.id, {
      status,
      reviewedBy: req.userData.name,
      reviewedAt: new Date().toISOString(),
      rejectionReason: status === "rejected" ? (rejectionReason || "") : "",
    });

    logAudit(req, "edit", "review", req.params.id, `Review by ${review.studentName} ${status}`);
    res.json({ success: true, data: updated, message: `Review ${status}` });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Edit content — fix a typo, correct the class, adjust rating, etc.
// ============================================================
router.put("/:id", requirePermission("reviews:edit"), validators.updateReview, validate, (req, res) => {
  try {
    const review = db.findById("reviews", req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    const { studentName, studentClass, rating, feedback } = req.body;
    const updates = {};
    if (studentName !== undefined) updates.studentName = studentName.trim();
    if (studentClass !== undefined) updates.studentClass = studentClass.trim();
    if (rating !== undefined) updates.rating = rating;
    if (feedback !== undefined) updates.feedback = feedback.trim();

    const updated = db.findByIdAndUpdate("reviews", req.params.id, updates);
    logAudit(req, "edit", "review", req.params.id, `Edited review by ${review.studentName}`);
    res.json({ success: true, data: updated, message: "Review updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Feature / unfeature — pin a great review to the top of the homepage
// ============================================================
router.put("/:id/feature", requirePermission("reviews:edit"), (req, res) => {
  try {
    const review = db.findById("reviews", req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    const isFeatured = !!req.body.isFeatured;
    const updated = db.findByIdAndUpdate("reviews", req.params.id, { isFeatured });
    logAudit(req, "edit", "review", req.params.id, `Review by ${review.studentName} ${isFeatured ? "featured" : "unfeatured"}`);
    res.json({ success: true, data: updated, message: isFeatured ? "Marked as featured" : "Unfeatured" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Delete
// ============================================================
router.delete("/:id", requirePermission("reviews:delete"), (req, res) => {
  try {
    const review = db.findById("reviews", req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    db.findByIdAndDelete("reviews", req.params.id);
    logAudit(req, "delete", "review", req.params.id, `Deleted review by ${review.studentName}`);
    res.json({ success: true, message: "Review deleted" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
