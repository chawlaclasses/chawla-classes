const express = require('express');
const router = express.Router();

// ============================================================
// Class Routes
// ============================================================
// Extracted to routes/admin/classes.js (refactor, 2026-07) — see that
// file for the actual route logic. Mounted here so the final URLs
// (/api/admin/classes, /api/admin/classes/:id) are unchanged.
router.use('/classes', require('./admin/classes'));

// ============================================================
// Subject Routes
// ============================================================
// Extracted to routes/admin/subjects.js (refactor, 2026-07) — see that
// file for the actual route logic. Mounted here so the final URLs
// (/api/admin/subjects, /api/admin/subjects/:id) are unchanged.
router.use('/subjects', require('./admin/subjects'));

// ============================================================
// Series Routes
// ============================================================
// Extracted to routes/admin/series.js (refactor, 2026-07) — see that
// file for the actual route logic. Mounted here so the final URLs
// (/api/admin/series, /api/admin/series/:id) are unchanged.
router.use('/series', require('./admin/series'));

// ============================================================
// Test Routes
// ============================================================
// Extracted to routes/admin/tests.js (refactor, 2026-07) — see that
// file for the actual route logic. Mounted here so the final URLs
// (/api/admin/tests, /api/admin/tests/:id, /publish, /unpublish) are
// unchanged.
router.use('/tests', require('./admin/tests'));

// ============================================================
// Question Routes (per-test question attach/remove)
// ============================================================
// Extracted to routes/admin/test-questions.js (refactor, 2026-07) — see
// that file for the actual route logic. Mounted here so the final URLs
// (/api/admin/tests/:testId/questions, .../:id) are unchanged.
router.use('/tests', require('./admin/test-questions'));

// ============================================================
// Smart Test Builder
// ============================================================
// Extracted to routes/admin/test-builder.js (refactor, 2026-07) — see
// that file for the actual route logic. Mounted here so the final URLs
// (/api/admin/tests/:testId/questions/bank, /random, /reorder, and
// /tests/:testId/preview) are unchanged.
router.use('/tests', require('./admin/test-builder'));

// ============================================================
// Homework Module (Admin)
// ============================================================
// Extracted to routes/admin/homework.js (refactor, 2026-07) — see that
// file for the actual route logic. Mounted here so the final URLs
// (/api/admin/homework, /api/admin/homework/:id, .../submissions, etc.)
// are unchanged.
router.use('/homework', require('./admin/homework'));

// ============================================================
// Doubt Management (Admin)
// ============================================================
// Extracted to routes/admin/doubts.js (refactor, 2026-07) — see that
// file for the actual route logic. Mounted here so the final URLs
// (/api/admin/doubts, /api/admin/doubts/:id, etc.) are unchanged.
router.use('/doubts', require('./admin/doubts'));

// ============================================================
// Question Bank (Admin)
// ============================================================
// Extracted to routes/admin/question-bank.js (refactor, 2026-07) — see
// that file for the actual route logic (also consolidates bulk-update
// and bulk-delete, which were scattered elsewhere in the original file
// with no consistent grouping). Mounted here so the final URLs
// (/api/admin/questions, /api/admin/questions/:id, etc.) are unchanged.
router.use('/questions', require('./admin/question-bank'));

// ============================================================
// AI Review Queue (Admin)
// ============================================================
// Dedicated triage view for AI-generated draft questions — separate from
// general Question Bank CRUD. See routes/admin/ai-review-queue.js for the
// approve/reject workflow. Mounted here so URLs are
// /api/admin/ai-review-queue, /api/admin/ai-review-queue/:id/approve, etc.
router.use('/ai-review-queue', require('./admin/ai-review-queue'));

// ============================================================
// Students (lightweight list + bulk + export)
// ============================================================
// Extracted to routes/admin/students.js (refactor, 2026-07) — see that
// file for the actual route logic. Mounted here so the final URLs
// (/api/admin/students-list, /api/admin/students/bulk,
// /api/admin/students/export) are unchanged.
router.use('/', require('./admin/students'));

// ============================================================
// System / Security (sessions, change-password, login-history, audit-logs)
// ============================================================
// Extracted to routes/admin/system.js (refactor, 2026-07) — see that
// file for the actual route logic (this was tangled into the old
// "STUDENTS" banner in the original file despite not being about
// students at all). Mounted here so the final URLs (/api/admin/sessions,
// /api/admin/change-password, /api/admin/login-history,
// /api/admin/audit-logs) are unchanged.
router.use('/', require('./admin/system'));

// ============================================================
// Student 360° Profile
// ============================================================
// Extracted to routes/admin/student-profile.js (refactor, 2026-07) —
// see that file for the actual route logic. Mounted here so the final
// URLs (/api/admin/reports/student/:studentId,
// /api/admin/students/:id/profile, etc.) are unchanged.
router.use('/', require('./admin/student-profile'));

// ============================================================
// Enquiries
// ============================================================
// Extracted to routes/admin/enquiries.js (refactor, 2026-07) — this
// section had no banner comment at all in the original file. Mounted
// here so the final URLs (/api/admin/enquiries, /api/admin/enquiries/:id)
// are unchanged.
router.use('/enquiries', require('./admin/enquiries'));

// ============================================================
// Fee Management Module
// ============================================================
// Extracted to routes/admin/fees.js (refactor, 2026-07) — see that
// file for the actual route logic. Mounted here so the final URLs
// (/api/admin/fees, /api/admin/fees/:id, /api/admin/fees/plan,
// /api/admin/fees/remind-bulk, etc.) are unchanged.
router.use('/fees', require('./admin/fees'));

// ============================================================
// Communication Center
// ============================================================
// Extracted to routes/admin/communication.js (refactor, 2026-07) — see
// that file for the actual route logic. Mounted here so the final URLs
// (/api/admin/communication/send, /api/admin/communication/history, etc.)
// are unchanged.
router.use('/communication', require('./admin/communication'));

// ============================================================
// AI Module (Admin)
// ============================================================
// Extracted to routes/admin/ai.js (refactor, 2026-07) — see that file
// for the actual route logic. Mounted here so the final URLs
// (/api/admin/ai/generate-questions, etc.) are unchanged.
router.use('/ai', require('./admin/ai'));
// ============================================================
// AI Module V2 (Testing)
// ============================================================
// Mounted separately for testing. Existing /api/admin/ai routes
// remain unchanged.
router.use('/ai-v2', require('./admin/ai-v2'));
// ============================================================
// AI Question Studio
// ============================================================
// New, additive module — see routes/admin/ai-question-studio.js. Does
// not touch /ai or /ai-v2; mounted at its own path so
// /api/admin/ai-question-studio/* is entirely new surface area.
router.use('/ai-question-studio', require('./admin/ai-question-studio'));
// ============================================================
// Attendance
// ============================================================
// Extracted to routes/admin/attendance.js (refactor, 2026-07) — see
// that file for the actual route logic. Mounted here so the final URLs
// (/api/admin/attendance, /api/admin/attendance/mark) are unchanged.
router.use('/attendance', require('./admin/attendance'));

// ============================================================
// Admin Dashboard (Overview + Analytics + Analytics Dashboards)
// ============================================================
// Extracted to routes/admin/dashboard.js (refactor, 2026-07) — see that
// file for the actual route logic (all three sections combined into
// one file since they're tightly related). Mounted here so the final
// URLs (/api/admin/dashboard-overview, /api/admin/dashboard-analytics,
// /api/admin/analytics-dashboards) are unchanged.
router.use('/', require('./admin/dashboard'));

// ============================================================
// Faculty Recruitment (Careers / ATS)
// ============================================================
// Admin-side candidate management. The public application-submission
// endpoint is separate (routes/recruitment.js, no auth), mounted directly
// in app.js. Final URL: /api/admin/recruitment.
router.use('/recruitment', require('./admin/recruitment'));

// ============================================================
// Marketing (Banners + Campaigns)
// ============================================================
// Admin-side banner CRUD (routes/admin/marketing.js) and campaign
// send/history (routes/admin/marketing-campaigns.js) — separate files,
// same '/marketing' URL family. Public read of active banners is
// separate and unauthenticated (routes/marketing.js), mounted directly
// in app.js. Final URLs: /api/admin/marketing/banners,
// /api/admin/marketing/campaigns/send, etc.
router.use('/marketing', require('./admin/marketing'));
router.use('/marketing/campaigns', require('./admin/marketing-campaigns'));

// ============================================================
// Review Management
// ============================================================
// Admin-side moderation (approve/reject/edit/feature/delete) for reviews
// submitted through index.html's "Student Feedback & Rating" form. Public
// submission + approved-list read is separate and unauthenticated
// (routes/reviews.js), mounted directly in app.js. Final URL:
// /api/admin/reviews.
router.use('/reviews', require('./admin/reviews'));

// ============================================================
// Global header search (dashboard.html's "Search anything..." box)
// ============================================================
// Was UI-only before this — the frontend has called this URL since the
// search box was added, but the route never existed. Final URL:
// /api/admin/search. See routes/admin/search.js for per-category
// permission filtering.
router.use('/search', require('./admin/search'));

// ============================================================
// Admissions (separate from Enquiries — a further-along, higher-intent
// lead with its own fields and status workflow)
// ============================================================
router.use('/admissions', require('./admin/admissions'));

module.exports = router;