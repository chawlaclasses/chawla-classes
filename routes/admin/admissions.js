/**
 * routes/admin/admissions.js
 *
 * Admission form submissions (index.html's "Admission Form") — kept as
 * its own collection/module, deliberately separate from Enquiries
 * (routes/admin/enquiries.js). An enquiry is "someone asked a question";
 * an admission submission is "someone is trying to actually enroll" — a
 * further-along, higher-intent lead with its own fields (parent name,
 * school, address) and its own status workflow.
 *
 * Public submission lives in routes/publicEnquiry.js (POST /admission,
 * no auth). Mounted at '/admissions' by routes/adminRoutes.js, so the
 * final URLs are /api/admin/admissions, /api/admin/admissions/:id.
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

// List admission submissions
router.get("/", requirePermission("admissions:view"), (req, res) => {
  try {
    const { status } = req.query;
    let admissions = db.find("admissions", {});
    if (status) admissions = admissions.filter(a => (a.status || "new") === status);
    admissions = admissions.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, data: admissions });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Manually log an admission enquiry (e.g. a walk-in parent, phone call)
router.post("/", requirePermission("admissions:create"), validators.submitPublicAdmission, validate, (req, res) => {
  try {
    const { studentName, parentName, phone, email, school, interestedClass, address } = req.body;
    const admission = db.insertOne("admissions", {
      studentName: studentName.trim(),
      parentName: parentName.trim(),
      phone: phone.trim(),
      email: (email || "").trim(),
      school: (school || "").trim(),
      interestedClass: (interestedClass || "").trim(),
      address: (address || "").trim(),
      source: "walk-in",
      status: "new",
      notes: "",
      createdBy: req.userData?.name || "admin",
    });
    logAudit(req, "create", "admission", admission._id, `Logged admission enquiry for ${studentName}`);
    res.status(201).json({ success: true, data: admission, message: "Admission enquiry logged" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Update status (new / contacted / admitted / rejected) and/or notes
router.put("/:id", requirePermission("admissions:edit"), (req, res) => {
  try {
    const { status, notes } = req.body;
    if (status && !["new", "contacted", "admitted", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const admission = db.findById("admissions", req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: "Admission record not found" });

    const updated = db.findByIdAndUpdate("admissions", req.params.id, {
      ...(status !== undefined ? { status } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });
    logAudit(req, "edit", "admission", req.params.id, `Updated admission for ${admission.studentName}${status ? ` to "${status}"` : ""}`);
    res.json({ success: true, data: updated, message: "Admission updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;