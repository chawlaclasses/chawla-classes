/**
 * utils/helpers.js  v2.3
 * 
 * FIXES v2.3:
 *   - generateUUID() now works on ALL Node versions
 *   - isGarbled() uses Set-based char scan (no regex state bugs)
 *   - validateFileContent() reads only 4KB header (memory safe)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

// ── Email ────────────────────────────────────────────────────────────────────

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

// ── Path safety ──────────────────────────────────────────────────────────────

function safePath(baseDir, fileName) {
  if (!fileName || typeof fileName !== "string") return null;
  if (/\.\./.test(fileName)) return null;

  const resolved = path.resolve(baseDir, fileName);
  const normalizedBase = path.resolve(baseDir);

  if (!resolved.startsWith(normalizedBase + path.sep) || resolved === normalizedBase) {
    return null;
  }

  return resolved;
}

// ── ⭐ Node-version-safe UUID generator ────────────────────────────────────

function generateUUID() {
  // Prefer native randomUUID when available (Node 14.17+)
  if (typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch (_) {
      // fall through to manual generation
    }
  }

  // Manual RFC4122 v4 UUID using randomBytes (works on all Node versions)
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ── Async helpers ────────────────────────────────────────────────────────────

function withTimeout(promise, ms, msg = "Operation timed out") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

// ── File cleanup ─────────────────────────────────────────────────────────────

function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

function cleanupDir(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (_) {}
}

// ── Command detection ────────────────────────────────────────────────────────

async function commandExists(cmd) {
  try {
    const probe = process.platform === "win32" ? `where.exe ${cmd}` : `which ${cmd}`;
    await execAsync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

// ── Garbled text detection ──────────────────────────────────────────────────

const GARBLED_LATIN_CHARS =
  "àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßœŒšŠžŽ";
const GARBLED_LATIN_SET = new Set(GARBLED_LATIN_CHARS);

const GREEK_UNICODE = /[αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]/;
const MATH_UNICODE = /[√∫∑∂∞±×÷≤≥≠≈→←↔⇒⇔∠⊥∥△□°]/;
const MATH_PATTERNS = [
  /\\[a-zA-Z]+/,
  /\^\d+/,
  /_\d+/,
  /\d+\s*\/\s*\d+/,
  /[a-zA-Z]\s*→/,
  /[a-zA-Z]\s*̂/,
  /[a-zA-Z]\s*˙/,
  /[a-zA-Z]\s*̄/,
];

// CBSE font garble patterns
const CBSE_FONT_PATTERNS = [
  /H\$o[̴̵̶̷̸̡̢̧̨̛̖̗̘̙̜̝̞̟̠̣̤̥̦̩̪̫̬̭̮̯̰̱̲̳̹̺̻̼͇͈͉͍͎̀́̂̃̄̅̆̇̈̉̊̋̌̍̎̏̐̑̒̓̔̽̾̿̀́͂̓̈́͆͊͋͌̕̚ͅ͏͓͔͕͖͙͚͐͑͒͗͛ͣ͘͜͟͢͝͞͠͡]/, // H$o with combining chars
  /[àáâãä]iZ/,
  /nwpNvH/,
  /H\$moS>/,
  /C\$ma/,
  /boIme/,
  /[Oo]\$[a-z]{2,}/,
  /\$[A-Z][a-z]{2,}/,
];

function isGarbled(text) {
  if (!text || !text.trim()) return true;

  const chars = text.replace(/\s/g, "");
  if (!chars.length) return true;

  // CBSE custom font detection (fast path)
  const sample = text.slice(0, 500);
  const cbseHits = CBSE_FONT_PATTERNS.filter((p) => p.test(sample)).length;
  if (cbseHits >= 2) return true;

  // Math shortcut: if most chars are math symbols, not garbled
  const afterGreek = chars.replace(GREEK_UNICODE, "");
  const afterMath = afterGreek.replace(MATH_UNICODE, "");
  const mathRatio = 1 - afterMath.length / chars.length;
  if (mathRatio > 0.7) return false;

  // Replacement / control characters
  const replacementCount = (text.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  if (replacementCount / chars.length > 0.25) return true;

  // Long unbroken ASCII runs (OCR merge artifact)
  if ((text.match(/[A-Za-z]{20,}/g) || []).length >= 3) return true;

  // Latin-extended garble scan (Set-based, no regex state issues)
  let garbledCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (!GARBLED_LATIN_SET.has(text[i])) continue;

    const context = text.slice(Math.max(0, i - 15), Math.min(text.length, i + 15));
    const isMathCtx = MATH_PATTERNS.some((p) => p.test(context));
    if (!isMathCtx) garbledCount++;
  }

  if (garbledCount / chars.length > 0.12) return true;

  return false;
}

function hasMathSymbols(text) {
  if (!text) return false;
  return GREEK_UNICODE.test(text) || MATH_UNICODE.test(text) || MATH_PATTERNS.some((p) => p.test(text));
}

// ── File MIME validation ────────────────────────────────────────────────────

let _fileType = null;

async function getFileType() {
  if (_fileType !== null) return _fileType;
  try {
    _fileType = await import("file-type");
  } catch (_) {
    _fileType = false;
  }
  return _fileType;
}

async function validateFileContent(filePath, allowedMimes) {
  try {
    const ft = await getFileType();
    if (!ft || !ft.fromBuffer) return true;

    // Read only header bytes (4 KB) instead of entire file
    const HEADER_BYTES = 4096;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(HEADER_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEADER_BYTES, 0);
    fs.closeSync(fd);

    const type = await ft.fromBuffer(buf.subarray(0, bytesRead));
    if (type && !allowedMimes.includes(type.mime)) return false;

    return true;
  } catch (_) {
    return true;
  }
}

/**
 * Same magic-byte MIME validation as validateFileContent(), for uploads
 * that live in memory (multer memoryStorage(), used for everything now
 * headed to Cloudflare R2 — see middleware/upload.js) instead of on disk.
 * Kept as a separate function rather than changing validateFileContent()'s
 * signature, since controllers/pdfController.js and the other
 * still-disk-based uploaders (uploadNote, uploadPdf) keep calling the
 * original path-based version unchanged.
 */
async function validateBufferContent(buffer, allowedMimes) {
  try {
    const ft = await getFileType();
    if (!ft || !ft.fromBuffer) return true;

    const HEADER_BYTES = 4096;
    const header = buffer.subarray(0, HEADER_BYTES);

    const type = await ft.fromBuffer(header);
    if (type && !allowedMimes.includes(type.mime)) return false;

    return true;
  } catch (_) {
    return true;
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  normalizeEmail,
  safePath,
  generateUUID,
  withTimeout,
  cleanupFile,
  cleanupDir,
  commandExists,
  isGarbled,
  hasMathSymbols,
  validateFileContent,
  validateBufferContent,
  GREEK_UNICODE,
  MATH_UNICODE,
  MATH_PATTERNS,
};