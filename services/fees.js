/**
 * services/fees.js
 */

"use strict";

const storage = require("./storage");
const { normalizeEmail } = require("../utils/helpers");

function save({ email: rawEmail, amount, status, dueDate }) {
  const email = normalizeEmail(rawEmail);
  if (!email || amount === undefined || !status || !dueDate) {
    throw Object.assign(new Error("Missing fee fields"), { status: 400 });
  }
  if (isNaN(Number(amount))) {
    throw Object.assign(new Error("Amount must be a number"), { status: 400 });
  }

  const fees = storage.read("fees.json");
  const existing = fees.find((f) => normalizeEmail(f.email) === email);

  if (existing) {
    Object.assign(existing, { amount, status, dueDate });
  } else {
    fees.push({ email, amount, status, dueDate });
  }

  storage.write("fees.json", fees);
  return { success: true };
}

function getByEmail(email) {
  const normalized = normalizeEmail(email);
  return (
    storage.read("fees.json").find((f) => normalizeEmail(f.email) === normalized) ||
    { amount: 0, status: "Pending", dueDate: "Not Set" }
  );
}

function getAll() {
  return storage.read("fees.json");
}

module.exports = { save, getByEmail, getAll };
