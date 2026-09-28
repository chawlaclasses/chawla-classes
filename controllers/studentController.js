/**
 * controllers/studentController.js
 *
 * HTTP handlers for student management and password operations.
 */

"use strict";

const { ok, badRequest, notFound, serverError } = require("../middleware/errors");
const studentsService = require("../services/students");
const { signToken }   = require("../services/auth");
const { normalizeEmail } = require("../utils/helpers");
const logger = require("../utils/logger");

function handleServiceError(res, err) {
  const status = err.status || 500;
  if (status >= 500) logger.error(err.message);
  return res.status(status).json({ success: false, message: err.message });
}

// ── List / get ────────────────────────────────────────────────────────────────

function getStudents(_req, res) {
  return ok(res, { students: studentsService.getAll() });
}

function getStudent(req, res) {
  const student = studentsService.getByEmail(req.params.email);
  if (!student) return notFound(res, "Student not found");
  return res.json(student); // legacy: bare object (no success wrapper)
}

// ── Admin CRUD ────────────────────────────────────────────────────────────────

async function addStudent(req, res) {
  try {
    await studentsService.addByAdmin({
      name:         req.body.name,
      mobile:       req.body.mobile,
      email:        req.body.email,
      password:     req.body.password,
      studentClass: req.body.class,
    });
    ok(res);
  } catch (err) {
    handleServiceError(res, err);
  }
}

function deleteStudent(req, res) {
  try {
    studentsService.remove(req.body.email);
    ok(res);
  } catch (err) {
    handleServiceError(res, err);
  }
}

function updateStudent(req, res) {
  try {
    const result = studentsService.update({
      originalEmail: req.body.originalEmail,
      name:          req.body.name,
      mobile:        req.body.mobile,
      email:         req.body.email,
      studentClass:  req.body.class,
    });

    const response = { success: true };

    // Reissue token if student changed their own email
    if (
      req.tokenPayload.role === "student" &&
      result.emailChanged
    ) {
      response.token = signToken({ role: "student", email: result.newEmail });
    }

    return res.json(response);
  } catch (err) {
    handleServiceError(res, err);
  }
}

// ── Passwords ─────────────────────────────────────────────────────────────────

async function changePassword(req, res) {
  const { email, oldPassword, newPassword } = req.body;

  // Students can only change their own password
  if (
    req.tokenPayload.role === "student" &&
    normalizeEmail(req.tokenPayload.email) !== normalizeEmail(email)
  ) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  try {
    await studentsService.changePassword({ email, oldPassword, newPassword });
    ok(res);
  } catch (err) {
    handleServiceError(res, err);
  }
}

async function adminResetPassword(req, res) {
  try {
    await studentsService.adminResetPassword({
      email:       req.body.email,
      newPassword: req.body.newPassword,
    });
    ok(res);
  } catch (err) {
    handleServiceError(res, err);
  }
}

module.exports = {
  getStudents,
  getStudent,
  addStudent,
  deleteStudent,
  updateStudent,
  changePassword,
  adminResetPassword,
};
