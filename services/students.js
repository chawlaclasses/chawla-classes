/**
 * services/students.js
 *
 * Business logic for student accounts.
 * Controllers call these functions; no Express objects ever reach here.
 */

"use strict";

const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const storage          = require("./storage");
const { BCRYPT_ROUNDS } = require("../config");
const { normalizeEmail } = require("../utils/helpers");

// ── Helpers ───────────────────────────────────────────────────────────────────

function withoutPassword(student) {
  const copy = { ...student };
  delete copy.password;
  return copy;
}

// ── Validators ────────────────────────────────────────────────────────────────

function validateMobile(mobile) {
  return /^[6-9]\d{9}$/.test(mobile);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Read helpers ──────────────────────────────────────────────────────────────

function findByEmail(students, email) {
  return students.find((s) => normalizeEmail(s.email) === email);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function register({ name, mobile, email: rawEmail, password, studentClass }) {
  const email = normalizeEmail(rawEmail);

  if (!name || !mobile || !email || !password) {
    throw Object.assign(new Error("All fields are required"), { status: 400 });
  }
  if (!validateMobile(mobile)) {
    throw Object.assign(new Error("Invalid mobile number"), { status: 400 });
  }
  if (!validateEmail(email)) {
    throw Object.assign(new Error("Invalid email format"), { status: 400 });
  }
  if (password.length < 6) {
    throw Object.assign(new Error("Password must be at least 6 characters"), { status: 400 });
  }

  const students = storage.read("students.json");
  if (students.find((s) => normalizeEmail(s.email) === email || s.mobile === mobile)) {
    throw Object.assign(new Error("Email or mobile already registered"), { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  students.push({
    name,
    mobile,
    email,
    class: studentClass || "",
    password: hashedPassword,
  });

  storage.write("students.json", students);
  return { success: true };
}

async function verifyPassword(email, password) {
  const students  = storage.read("students.json");
  const student   = findByEmail(students, normalizeEmail(email));

  // Always compare (timing-safe even for missing users)
  const { getDummyHash } = require("./auth");
  const hash  = student ? student.password : getDummyHash();
  const match = await bcrypt.compare(password, hash);

  return match && student ? student : null;
}

function getAll() {
  return storage.read("students.json").map(withoutPassword);
}

function getByEmail(email) {
  const student = findByEmail(storage.read("students.json"), normalizeEmail(email));
  if (!student) return null;
  return withoutPassword(student);
}

async function addByAdmin({ name, mobile, email: rawEmail, password, studentClass }) {
  const email = normalizeEmail(rawEmail);

  if (!name || !mobile || !email || !password) {
    throw Object.assign(new Error("All fields are required"), { status: 400 });
  }
  if (password.length < 6) {
    throw Object.assign(new Error("Password must be at least 6 characters"), { status: 400 });
  }

  const students = storage.read("students.json");

  if (findByEmail(students, email)) {
    throw Object.assign(new Error("Email already exists"), { status: 409 });
  }
  if (students.find((s) => s.mobile === mobile)) {
    throw Object.assign(new Error("Mobile number already registered"), { status: 409 });
  }

  students.push({
    name,
    mobile,
    email,
    class: studentClass || "",
    password: await bcrypt.hash(password, BCRYPT_ROUNDS),
  });

  storage.write("students.json", students);
  return { success: true };
}

function remove(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw Object.assign(new Error("Email required"), { status: 400 });

  const students = storage.read("students.json");
  const updated  = students.filter((s) => normalizeEmail(s.email) !== normalized);

  if (updated.length === students.length) {
    throw Object.assign(new Error("Student not found"), { status: 404 });
  }

  storage.write("students.json", updated);
  return { success: true };
}

function update({ originalEmail: rawOrig, name, mobile, email: rawNew, studentClass }) {
  const origEmail = normalizeEmail(rawOrig);
  const newEmail  = normalizeEmail(rawNew);

  if (!origEmail || !name || !mobile || !newEmail) {
    throw Object.assign(new Error("All fields are required"), { status: 400 });
  }
  if (!validateMobile(mobile)) {
    throw Object.assign(new Error("Invalid mobile number"), { status: 400 });
  }
  if (!validateEmail(newEmail)) {
    throw Object.assign(new Error("Invalid email format"), { status: 400 });
  }

  const students = storage.read("students.json");
  const index    = students.findIndex((s) => normalizeEmail(s.email) === origEmail);

  if (index === -1) {
    throw Object.assign(new Error("Student not found"), { status: 404 });
  }
  if (newEmail !== origEmail && findByEmail(students, newEmail)) {
    throw Object.assign(new Error("Email already in use"), { status: 409 });
  }

  students[index].name   = name;
  students[index].mobile = mobile;
  students[index].email  = newEmail;
  if (studentClass !== undefined) students[index].class = studentClass;

  storage.write("students.json", students);
  return { emailChanged: newEmail !== origEmail, newEmail };
}

async function changePassword({ email: rawEmail, oldPassword, newPassword }) {
  const email = normalizeEmail(rawEmail);

  if (!email || !oldPassword || !newPassword) {
    throw Object.assign(new Error("All fields are required"), { status: 400 });
  }
  if (newPassword.length < 6) {
    throw Object.assign(new Error("Password must be at least 6 characters"), { status: 400 });
  }

  const students = storage.read("students.json");
  const student  = findByEmail(students, email);

  if (!student) {
    throw Object.assign(new Error("Student not found"), { status: 404 });
  }
  if (!(await bcrypt.compare(oldPassword, student.password))) {
    throw Object.assign(new Error("Old password incorrect"), { status: 401 });
  }

  student.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  storage.write("students.json", students);
  return { success: true };
}

async function adminResetPassword({ email: rawEmail, newPassword }) {
  const email = normalizeEmail(rawEmail);

  if (!email || !newPassword) {
    throw Object.assign(new Error("Email and new password required"), { status: 400 });
  }
  if (newPassword.length < 6) {
    throw Object.assign(new Error("Password must be at least 6 characters"), { status: 400 });
  }

  const students = storage.read("students.json");
  const student  = findByEmail(students, email);

  if (!student) {
    throw Object.assign(new Error("Student not found"), { status: 404 });
  }

  student.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  storage.write("students.json", students);
  return { success: true };
}

module.exports = {
  register,
  verifyPassword,
  getAll,
  getByEmail,
  addByAdmin,
  remove,
  update,
  changePassword,
  adminResetPassword,
};
