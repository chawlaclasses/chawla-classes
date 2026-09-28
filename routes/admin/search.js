/**
 * routes/admin/search.js
 *
 * Global header search (the "Search anything..." box in dashboard.html's
 * top bar). Was UI-only until now: dashboard.html has called
 * GET /api/admin/search?q=... since the header-search box was added, but
 * no backend route ever existed for it, so every search silently 404'd
 * and showed "Search failed. Try again."
 *
 * Searches across every module the person has view permission for, and
 * skips the rest — same ROLE_PERMISSIONS matrix as the sidebar (see
 * config/permissions.js), so a teacher never sees fee amounts or
 * recruitment candidate PII show up in search just because they typed a
 * matching name. Mounted at '/search' by routes/adminRoutes.js, under
 * app.js's '/api/admin' + requireApiAdmin, so req.userData is already set.
 *
 * Each result: { category, section, id, title, subtitle, icon }.
 * `section` matches a sidebar data-section value so the frontend's
 * switchSection(r.section) in openHeaderSearchResult() lands in the right
 * place; recruitment/staff results also deep-link to the specific record
 * (see dashboard.html).
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../../services/jsonDb");
const logger = require("../../utils/logger");
const { hasPermission } = require("../../config/permissions");

// Cap per category so one huge match (e.g. a common name) can't crowd out
// every other category in the dropdown.
const RESULTS_PER_CATEGORY = 5;

// Case-insensitive "does q appear anywhere in any of these fields".
// Non-string fields (undefined, numbers, null) are ignored rather than
// thrown on, so callers can pass optional fields freely.
function textMatch(q, ...fields) {
  const needle = q.toLowerCase();
  return fields.some(f => typeof f === "string" && f.toLowerCase().includes(needle));
}

router.get("/", (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    // Mirrors the frontend's own min-length-2 guard (dashboard.html,
    // onHeaderSearchInput) — kept here too so the route is safe to call
    // directly, not just from that one input box.
    if (q.length < 2) {
      return res.json({ success: true, data: { results: [] } });
    }

    const role = req.userData?.role;
    const results = [];

    // ---- Students (stored in 'users' with role:'student') ----
    if (hasPermission(role, "students:view")) {
      db.find("users", { role: "student" })
        .filter(u => textMatch(q, u.name, u.email, u.rollNumber))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(u => results.push({
          category: "Students", section: "students", id: u._id,
          title: u.name, subtitle: u.email || "", icon: "fa-users",
        }));
    }

    // ---- Staff (everyone else in 'users') ----
    if (hasPermission(role, "staff:view")) {
      db.find("users", {})
        .filter(u => u.role !== "student")
        .filter(u => textMatch(q, u.name, u.email, u.role))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(u => results.push({
          category: "Staff", section: "staff", id: u._id,
          title: u.name, subtitle: u.role || "", icon: "fa-user-shield",
        }));
    }

    // ---- Faculty Recruitment candidates ----
    if (hasPermission(role, "recruitment:view")) {
      db.find("facultyApplications", {})
        .filter(a => textMatch(q, a.fullName, a.email, a.phone))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(a => results.push({
          category: "Faculty Recruitment", section: "recruitment", id: a._id,
          title: a.fullName, subtitle: a.status || "", icon: "fa-user-tie",
        }));
    }

    // ---- Classes ----
    if (hasPermission(role, "classes:view")) {
      db.find("classes", {})
        .filter(c => textMatch(q, c.name, c.displayName))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(c => results.push({
          category: "Classes", section: "classes", id: c._id,
          title: c.displayName || c.name, subtitle: "Class", icon: "fa-school",
        }));
    }

    // ---- Subjects ----
    if (hasPermission(role, "subjects:view")) {
      db.find("subjects", {})
        .filter(s => textMatch(q, s.name, s.code))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(s => results.push({
          category: "Subjects", section: "subjects", id: s._id,
          title: s.name, subtitle: s.code || "Subject", icon: "fa-book",
        }));
    }

    // ---- Test Series ----
    if (hasPermission(role, "series:view")) {
      db.find("series", {})
        .filter(s => textMatch(q, s.name, s.description))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(s => results.push({
          category: "Test Series", section: "series", id: s._id,
          title: s.name, subtitle: s.type || "Series", icon: "fa-layer-group",
        }));
    }

    // ---- Tests ----
    if (hasPermission(role, "tests:view")) {
      db.find("tests", {})
        .filter(t => textMatch(q, t.title, t.description))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(t => results.push({
          category: "Tests", section: "tests", id: t._id,
          title: t.title, subtitle: t.isPublished ? "Published" : "Draft", icon: "fa-file-alt",
        }));
    }

    // ---- Question Bank ----
    if (hasPermission(role, "questions:view")) {
      db.find("questions", {})
        .filter(qn => textMatch(q, qn.questionText, qn.chapter, qn.topic))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(qn => results.push({
          category: "Question Bank", section: "questions", id: qn._id,
          title: (qn.questionText || "").slice(0, 80),
          subtitle: qn.chapter || qn.topic || "", icon: "fa-question-circle",
        }));
    }

    // ---- Homework ----
    if (hasPermission(role, "homework:view")) {
      db.find("homework", {})
        .filter(h => textMatch(q, h.title, h.description))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(h => results.push({
          category: "Homework", section: "homework", id: h._id,
          title: h.title, subtitle: h.isPublished ? "Published" : "Draft", icon: "fa-book-open",
        }));
    }

    // ---- Doubts ----
    if (hasPermission(role, "doubts:view")) {
      db.find("doubts", {})
        .filter(d => textMatch(q, d.questionText))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(d => results.push({
          category: "Doubts", section: "doubts", id: d._id,
          title: (d.questionText || "").slice(0, 80), subtitle: d.status || "", icon: "fa-comment-dots",
        }));
    }

    // ---- Fees (join student name in for search + display; the '_id' the
    // frontend needs for the fee record itself, not the student) ----
    if (hasPermission(role, "fees:view")) {
      const studentNameCache = {};
      const getStudentName = (id) => {
        if (!id) return "";
        if (studentNameCache[id] !== undefined) return studentNameCache[id];
        const s = db.findById("users", id);
        return (studentNameCache[id] = s ? s.name : "");
      };
      db.find("fees-v2", {})
        .filter(f => textMatch(
          q, f.title, f.receiptNumber, f.transactionId,
          String(f.amount ?? ""), getStudentName(f.studentId)
        ))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(f => results.push({
          category: "Fees", section: "fees", id: f._id,
          title: `${getStudentName(f.studentId) || "Fee"} — ₹${f.amount ?? ""}`,
          subtitle: f.status || "", icon: "fa-wallet",
        }));
    }

    // ---- Enquiries ----
    if (hasPermission(role, "enquiries:view")) {
      db.find("enquiries", {})
        .filter(e => textMatch(q, e.name, e.phone, e.email))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(e => results.push({
          category: "Enquiries", section: "enquiries", id: e._id,
          title: e.name, subtitle: e.phone || "", icon: "fa-phone-volume",
        }));
    }

    // ---- Admissions ----
    if (hasPermission(role, "admissions:view")) {
      db.find("admissions", {})
        .filter(a => textMatch(q, a.studentName, a.parentName, a.phone, a.email))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(a => results.push({
          category: "Admissions", section: "admissions", id: a._id,
          title: a.studentName, subtitle: a.parentName || "", icon: "fa-graduation-cap",
        }));
    }

    // ---- Broadcasts / Announcements ----
    if (hasPermission(role, "communication:view")) {
      db.find("broadcasts", {})
        .filter(b => textMatch(q, b.title, b.message))
        .slice(0, RESULTS_PER_CATEGORY)
        .forEach(b => results.push({
          category: "Broadcasts", section: "communication", id: b._id,
          title: b.title, subtitle: (b.message || "").slice(0, 60), icon: "fa-bullhorn",
        }));
    }

    res.json({ success: true, data: { results } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Search failed. Please try again." });
  }
});

module.exports = router;