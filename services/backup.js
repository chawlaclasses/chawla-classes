/**
 * services/backup.js
 *
 * Generates a full data backup as a JSON object.
 * Student passwords are intentionally excluded from the backup payload.
 */

"use strict";

const storage = require("./storage");

const STUDENT_SAFE_FIELDS = ["name", "mobile", "email", "class"];

function generateBackup() {
  const students = storage.read("students.json").map((s) =>
    Object.fromEntries(
      STUDENT_SAFE_FIELDS.filter((f) => s[f] !== undefined).map((f) => [f, s[f]])
    )
  );

  return {
    generatedAt:  new Date().toISOString(),
    students,
    questions:    storage.read("questions.json"),
    results:      storage.read("results.json"),
    fees:         storage.read("fees.json"),
    attendance:   storage.read("attendance.json"),
    announcement: storage.read("announcement.json"),
  };
}

module.exports = { generateBackup };
