/**
 * services/storage.js
 *
 * FIX: Added new test system collections to COLLECTIONS registry.
 *      Without these, any call to storage.read/write for the new
 *      collections threw "Unknown collection" errors.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { DATA_DIR } = require("../config");
const logger = require("../utils/logger");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const COLLECTIONS = {
  // ── Existing collections (unchanged) ─────────────────────────────────────
  "students.json":     { fallback: [],                            expectArray: true  },
  "questions.json":    { fallback: [],                            expectArray: true  },
  "results.json":      { fallback: [],                            expectArray: true  },
  "fees.json":         { fallback: [],                            expectArray: true  },
  "attendance.json":   { fallback: [],                            expectArray: true  },
  "announcement.json": { fallback: { message: "No Announcement" }, expectArray: false },

  // ── Test system collections ───────────────────────────────────────────────
  "classes.json":         { fallback: [], expectArray: true },
  "subjects.json":        { fallback: [], expectArray: true },
  "series.json":          { fallback: [], expectArray: true },
  "tests.json":           { fallback: [], expectArray: true },
  "testQuestions.json":   { fallback: [], expectArray: true },
  "studentAttempts.json": { fallback: [], expectArray: true },
  "users.json":           { fallback: [], expectArray: true },
};

function collectionPath(name) {
  return path.join(DATA_DIR, name);
}

function getSpec(name) {
  const spec = COLLECTIONS[name];
  if (!spec) throw new Error(`Unknown collection: "${name}"`);
  return spec;
}

function read(name) {
  const { fallback, expectArray } = getSpec(name);
  const filePath = collectionPath(name);

  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const content = fs.readFileSync(filePath, "utf8");
    if (!content.trim()) return fallback;

    const parsed = JSON.parse(content);

    if (expectArray && !Array.isArray(parsed)) {
      throw new Error(`Collection "${name}" expected array, got ${typeof parsed}`);
    }
    if (!expectArray && typeof parsed !== "object") {
      throw new Error(`Collection "${name}" expected object, got ${typeof parsed}`);
    }

    return parsed;
  } catch (err) {
    logger.error(`Storage read error for "${name}": ${err.message}`);
    try {
      if (fs.existsSync(filePath)) {
        const backupPath = filePath + `.corrupted.${Date.now()}.bak`;
        fs.copyFileSync(filePath, backupPath);
        logger.warn(`Corrupt file backed up to ${backupPath}`);
      }
    } catch (_) {}
    try {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    } catch (_) {}
    return fallback;
  }
}

function write(name, data) {
  getSpec(name);

  const filePath = collectionPath(name);
  const tempPath = filePath + `.tmp.${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    logger.error(`Storage write error for "${name}": ${err.message}`);
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    throw err;
  }
}

function register(name, fallback, expectArray = true) {
  COLLECTIONS[name] = { fallback, expectArray };
}

module.exports = { read, write, register };
