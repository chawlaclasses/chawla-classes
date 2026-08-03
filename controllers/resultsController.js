/**
 * controllers/resultsController.js
 */

"use strict";

const { ok, badRequest, serverError } = require("../middleware/errors");
const resultsService  = require("../services/results");
const studentsService = require("../services/students");
const { normalizeEmail } = require("../utils/helpers");
const logger = require("../utils/logger");

function handleServiceError(res, err) {
  const status = err.status || 500;
  if (status >= 500) logger.error(err.message);
  return res.status(status).json({ success: false, message: err.message });
}

function saveResult(req, res) {
  const { score, total, email } = req.body;
  const payload = req.tokenPayload;

  if (payload.role === "student" && normalizeEmail(payload.email) !== normalizeEmail(email)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  try {
    const result = resultsService.saveResult({ email, score, total });
    ok(res, { rank: result.rank });
  } catch (err) {
    handleServiceError(res, err);
  }
}

function getResults(_req, res) {
  return res.json(resultsService.getAll());
}

function getStudentResults(req, res) {
  return res.json(resultsService.getByEmail(req.params.email));
}

function getStudentPerformance(req, res) {
  return res.json(resultsService.getPerformance(req.params.email));
}

function getLeaderboard(_req, res) {
  const students = studentsService.getAll();
  return res.json(resultsService.getLeaderboard(students));
}

module.exports = {
  saveResult,
  getResults,
  getStudentResults,
  getStudentPerformance,
  getLeaderboard,
};
