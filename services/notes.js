/**
 * services/notes.js
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { NOTES_DIR } = require("../config");
const { safePath, validateFileContent } = require("../utils/helpers");

const ALLOWED_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/png",
  "image/jpeg",
];

function list() {
  if (!fs.existsSync(NOTES_DIR)) return [];
  return fs.readdirSync(NOTES_DIR);
}

async function validateUpload(filePath) {
  const valid = await validateFileContent(filePath, ALLOWED_MIMES);
  if (!valid) {
    throw Object.assign(
      new Error("File content does not match its extension"),
      { status: 400 }
    );
  }
}

function getFilePath(fileName) {
  return safePath(NOTES_DIR, fileName);
}

function remove(fileName) {
  const filePath = safePath(NOTES_DIR, fileName);
  if (!filePath) throw Object.assign(new Error("Invalid file name"), { status: 400 });
  if (!fs.existsSync(filePath)) throw Object.assign(new Error("File not found"), { status: 404 });
  fs.unlinkSync(filePath);
  return { success: true };
}

module.exports = { list, validateUpload, getFilePath, remove };
