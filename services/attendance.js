/**
 * services/attendance.js
 */

"use strict";

const storage = require("./storage");
const { normalizeEmail } = require("../utils/helpers");

function mark({ name, studentClass, email: rawEmail, status }) {
  const email = normalizeEmail(rawEmail);
  if (!email || !["Present", "Absent"].includes(status)) {
    throw Object.assign(
      new Error("Email and valid status (Present/Absent) required"),
      { status: 400 }
    );
  }

  const records = storage.read("attendance.json");
  const today   = new Date().toLocaleDateString();
  const existing = records.find(
    (a) => normalizeEmail(a.email) === email && a.date === today
  );

  if (existing) {
    Object.assign(existing, { name, class: studentClass, status });
  } else {
    records.push({ name, class: studentClass, email, status, date: today });
  }

  storage.write("attendance.json", records);
  return { success: true };
}

function getSummary(email) {
  const normalized = normalizeEmail(email);
  const records    = storage.read("attendance.json").filter(
    (a) => normalizeEmail(a.email) === normalized
  );
  const present = records.filter((a) => a.status === "Present").length;
  const absent  = records.filter((a) => a.status === "Absent").length;
  const total   = present + absent;

  return {
    present,
    absent,
    percentage: total > 0 ? ((present / total) * 100).toFixed(1) : "0.0",
  };
}

function getHistory(email, limit = null) {
  const normalized = normalizeEmail(email);
  const records    = storage
    .read("attendance.json")
    .filter((a) => normalizeEmail(a.email) === normalized)
    .reverse();
  return limit ? records.slice(0, limit) : records;
}

function getAll() {
  return storage.read("attendance.json");
}

module.exports = { mark, getSummary, getHistory, getAll };
