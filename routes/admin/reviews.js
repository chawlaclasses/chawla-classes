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
 *
 * DELETE is a SOFT delete: { deleted: true, deletedAt, deletedBy } gets
 * set instead of the row actually being removed. Reasons: an accidental
 * click doesn't lose the review permanently, the audit trail stays
 * complete, and if a review ever comes up in a dispute the history is
 * still there. Deleted reviews are excluded from the normal list/
 * dashboard/public feed, but stay visible under ?status=deleted and can
 * be brought back with PUT /:id/restore.
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

// FIX (production-readiness audit, 2026-08-21, follow-up): the original
// fix below only stripped editToken from the LIST response. Every other
// endpoint here that echoes back a review doc (approve/reject, edit,
// feature/unfeature, restore) had the same leak — the permanent,
// no-further-auth edit credential sitting in the JSON response even
// though the admin frontend never reads it. One helper, used everywhere
// a review document leaves this file.
function stripEditToken(review) {
  if (!review) return review;
  const { editToken, ...rest } = review;
  return rest;
}

// ============================================================
// Dashboard — status counts + average rating of approved reviews.
// Deleted (soft-deleted) reviews never count toward any of these.
// ============================================================
router.get("/dashboard", requirePermission("reviews:view"), (req, res) => {
  try {
    const all = db.find("reviews", {}).filter(r => !r.deleted);
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
// List — optional ?status= filter. Deleted reviews are hidden from the
// normal list (and from every other status filter) unless the caller
// specifically asks for the trash via ?status=deleted.
//
// FIX (production-readiness audit, 2026-08-21): this used to send the raw
// review document, which includes editToken — the permanent, 256-bit
// credential that grants edit access with no further auth. Nothing in
// the admin frontend ever rendered it, but it was sitting in the network
// response for anyone with reviews:view. Stripped below; nothing else
// about the row changes.
// ============================================================
router.get("/", requirePermission("reviews:view"), (req, res) => {
  try {
    const { status } = req.query;
    let reviews = db.find("reviews", {});
    if (status === "deleted") {
      reviews = reviews.filter(r => !!r.deleted);
    } else {
      reviews = reviews.filter(r => !r.deleted);
      if (status) reviews = reviews.filter(r => r.status === status);
    }
    reviews = reviews.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const safeReviews = reviews.map(({ editToken, ...rest }) => rest);
    res.json({ success: true, data: safeReviews });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Manual entry — e.g. a WhatsApp/verbal testimonial typed in by staff.
// Goes straight to 'approved' since an admin is vouching for it.
// ============================================================
router.post("/", requirePermission("reviews:edit"), validators.adminSubmitReview, validate, (req, res) => {
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
      deleted: false,
      deletedAt: null,
      deletedBy: null,
    });

    logAudit(req, "create", "review", review._id, `Added review from ${studentName} (${rating}★)`);
    res.status(201).json({ success: true, data: stripEditToken(review), message: "Review added" });
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
    if (review.deleted) return res.status(400).json({ success: false, message: "This review is deleted. Restore it first." });

    const { status, rejectionReason } = req.body;
    const updated = db.findByIdAndUpdate("reviews", req.params.id, {
      status,
      reviewedBy: req.userData.name,
      reviewedAt: new Date().toISOString(),
      rejectionReason: status === "rejected" ? (rejectionReason || "") : "",
    });

    logAudit(req, "edit", "review", req.params.id, `Review by ${review.studentName} ${status}`);
    res.json({ success: true, data: stripEditToken(updated), message: `Review ${status}` });
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
    if (review.deleted) return res.status(400).json({ success: false, message: "This review is deleted. Restore it first." });

    const { studentName, studentClass, rating, feedback } = req.body;
    const updates = {};
    if (studentName !== undefined) updates.studentName = studentName.trim();
    if (studentClass !== undefined) updates.studentClass = studentClass.trim();
    if (rating !== undefined) updates.rating = rating;
    if (feedback !== undefined) updates.feedback = feedback.trim();
    updates.lastEditedAt = new Date().toISOString();
    updates.editCount = (review.editCount || 0) + 1;

    const updated = db.findByIdAndUpdate("reviews", req.params.id, updates);
    logAudit(req, "edit", "review", req.params.id, `Edited review by ${review.studentName}`);
    res.json({ success: true, data: stripEditToken(updated), message: "Review updated" });
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
    if (review.deleted) return res.status(400).json({ success: false, message: "This review is deleted. Restore it first." });

    const isFeatured = !!req.body.isFeatured;
    const updated = db.findByIdAndUpdate("reviews", req.params.id, { isFeatured });
    logAudit(req, "edit", "review", req.params.id, `Review by ${review.studentName} ${isFeatured ? "featured" : "unfeatured"}`);
    res.json({ success: true, data: stripEditToken(updated), message: isFeatured ? "Marked as featured" : "Unfeatured" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Delete — SOFT delete. Marks the review deleted instead of removing it,
// so it can be recovered (PUT /:id/restore) and the audit trail/dispute
// history stays intact. Hidden from the normal list, dashboard, and the
// public feed from the moment this runs.
// ============================================================
router.delete("/:id", requirePermission("reviews:delete"), (req, res) => {
  try {
    const review = db.findById("reviews", req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    if (review.deleted) return res.status(400).json({ success: false, message: "Review is already deleted" });

    db.findByIdAndUpdate("reviews", req.params.id, {
      deleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: req.userData.name,
    });

    logAudit(req, "delete", "review", req.params.id, `Deleted review by ${review.studentName} (soft delete — recoverable)`);
    res.json({ success: true, message: "Review deleted" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Restore — undo a soft delete. Status/content are untouched, so the
// review comes back exactly as it was (still 'pending' if it was
// pending, still 'approved' -- and back on the public feed -- if it was
// approved when deleted).
// ============================================================
router.put("/:id/restore", requirePermission("reviews:delete"), (req, res) => {
  try {
    const review = db.findById("reviews", req.params.id);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    if (!review.deleted) return res.status(400).json({ success: false, message: "Review isn't deleted" });

    const restored = db.findByIdAndUpdate("reviews", req.params.id, {
      deleted: false,
      deletedAt: null,
      deletedBy: null,
    });

    logAudit(req, "edit", "review", req.params.id, `Restored review by ${review.studentName} from trash`);
    res.json({ success: true, data: stripEditToken(restored), message: "Review restored" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Identity verifications (public/feedback.html's email/phone OTP gate,
// routes/reviews.js) — lets Rohit see who has verified/submitted, and
// reset a record so a specific email/phone can submit again (e.g. a
// genuine student who mistyped their email the first time).
// ============================================================
router.get("/verifications", requirePermission("reviews:view"), (req, res) => {
  try {
    const records = db.find("reviewOtps", {})
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(r => ({
        _id: r._id,
        email: r.email,
        phone: r.phone,
        verified: r.verified,
        verifiedAt: r.verifiedAt,
        used: r.used,
        usedAt: r.usedAt,
        reviewId: r.reviewId,
        createdAt: r.createdAt,
      }));
    res.json({ success: true, data: records });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Reset — deletes the verification record so this email/phone can go
// through OTP verification and submit a review again. Does NOT delete
// their existing review (if any); do that separately from the table
// above if the old one should also go.
router.delete("/verifications/:id", requirePermission("reviews:edit"), (req, res) => {
  try {
    const record = db.findById("reviewOtps", req.params.id);
    if (!record) return res.status(404).json({ success: false, message: "Verification record not found" });

    db.findByIdAndDelete("reviewOtps", req.params.id);
    logAudit(req, "delete", "reviewOtp", req.params.id, `Reset review verification for ${record.email} (${record.phone}) — can submit again`);
    res.json({ success: true, message: "Verification reset — this email/mobile number can submit a review again." });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;