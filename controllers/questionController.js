/**
 * controllers/questionController.js
 */

"use strict";

const { ok, serverError } = require("../middleware/errors");
const questionsService    = require("../services/questions");
const logger              = require("../utils/logger");

function handleServiceError(res, err) {
  const status = err.status || 500;
  if (status >= 500) logger.error(err.message);
  return res.status(status).json({ success: false, message: err.message });
}

function getQuestions(_req, res) {
  try {
    const questions = questionsService.getAll();
    return res.json({ success: true, questions });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

function addQuestion(req, res) {
  try {
    const q = questionsService.add(req.body);
    ok(res, { id: q.id });
  } catch (err) {
    handleServiceError(res, err);
  }
}

function updateQuestion(req, res) {
  try {
    questionsService.update(req.body);
    ok(res);
  } catch (err) {
    handleServiceError(res, err);
  }
}

function deleteQuestion(req, res) {
  try {
    questionsService.remove(req.body.id);
    ok(res);
  } catch (err) {
    handleServiceError(res, err);
  }
}

function bulkSave(req, res) {
  try {
    const result = questionsService.bulkSave(req.body.questions);
    ok(res, result);
  } catch (err) {
    handleServiceError(res, err);
  }
}

function bulkUpdate(req, res) {
  try {
    const result = questionsService.bulkUpdate(req.body.updates);
    ok(res, result);
  } catch (err) {
    handleServiceError(res, err);
  }
}

function bulkDelete(req, res) {
  try {
    const result = questionsService.bulkDelete(req.body.ids);
    ok(res, result);
  } catch (err) {
    handleServiceError(res, err);
  }
}

module.exports = {
  getQuestions,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  bulkSave,
  bulkUpdate,
  bulkDelete,
};