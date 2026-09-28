/**
 * controllers/dashboardController.js
 */

"use strict";

const { ok } = require("../middleware/errors");
const storage    = require("../services/storage");
const { normalizeEmail } = require("../utils/helpers");

function getDashboardStats(_req, res) {
  const students   = storage.read("students.json");
  const questions  = storage.read("questions.json");
  const results    = storage.read("results.json");
  const fees       = storage.read("fees.json");
  const attendance = storage.read("attendance.json");

  const pcts = results
    .filter((r) => typeof r.score === "number" && typeof r.total === "number" && r.total > 0)
    .map((r) => (r.score / r.total) * 100);

  const presentCount = attendance.filter((a) => a.status === "Present").length;

  return res.json({
    students:       students.length,
    questions:      questions.length,
    results:        results.length,
    averageScore:   pcts.length ? (pcts.reduce((a, b) => a + b, 0) / pcts.length).toFixed(1) : "0.0",
    highestScore:   pcts.length ? Math.max(...pcts).toFixed(1) : "0.0",
    pendingFees:    fees.filter((f) => f.status === "Pending").length,
    attendanceRate: attendance.length
      ? ((presentCount / attendance.length) * 100).toFixed(1)
      : "0.0",
  });
}

module.exports = { getDashboardStats };
