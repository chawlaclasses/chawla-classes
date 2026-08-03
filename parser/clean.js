/**
 * parser/clean.js  v4.1 — FIXED
 *
 * FIXES v4.1:
 *   - isTableLine() now checks for null/undefined input
 *   - isHindiLine() now checks for null/undefined input
 *   - isHeaderLine() now checks for null/undefined input
 *   - Removed circular require('./index')
 */

"use strict";

// ── Hindi character range ────────────────────────────────────────────────────

const HINDI_CHAR_RE = /[\u0900-\u097F]/;

// ── Garbled CID-encoding detection ──────────────────────────────────────────

const GARBLED_CID_RE = /H\$mo|\$mo|àiZ|nwpNvH|H\$moS>|C\$ma|nwpñV|ñVH\$|§H\$|[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]{2,}/;

function isGarbledCIDLine(line) {
  if (!line || typeof line !== "string") return false;
  const latinCount = (line.match(/[A-Za-z]/g) || []).length;
  const garbledCount = (line.match(/[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) || []).length;
  if (latinCount > 3 && garbledCount / latinCount > 0.25) return true;
  return GARBLED_CID_RE.test(line);
}

// ── isHindiLine ──────────────────────────────────────────────────────────────

function isHindiLine(line) {
  if (!line || typeof line !== "string") return false;
  if (!HINDI_CHAR_RE.test(line)) return false;
  const hindi = (line.match(/[\u0900-\u097F]/g) || []).length;
  const total = (line.match(/[A-Za-z\u0900-\u097F]/g) || []).length;
  return total > 0 && hindi / total > 0.5;
}

// ── isTableLine ──────────────────────────────────────────────────────────────

function isTableLine(line) {
  if (!line || typeof line !== "string") return false;
  if ((line.match(/\|/g) || []).length >= 2) return true;
  if ((line.match(/[\d,]+\s{3,}[\d,]+/g) || []).length >= 1) return true;
  const nonNumeric = line.replace(/[\d,.\s|₹<>()]/g, "");
  if (line.length > 10 && nonNumeric.length / line.length < 0.25) return true;
  return false;
}

// ── Header / footer patterns ─────────────────────────────────────────────────

const HEADER_PATTERNS = [
  /^General\s+Instructions/i,
  /^Read\s+the\s+following\s+instructions/i,
  /^Maximum\s+Marks/i,
  /^Time\s+Allowed/i,
  /^Time\s+allowed/i,
  /^SECTION\s*[A-Ea-e]/i,
  /^Series\s*[:\-]?\s*\w/i,
  /^This\s+question\s+paper\s+contains/i,
  /^This\s+section\s+comprises/i,
  /^Roll\s+No/i,
  /^Q\.P\.\s*Code/i,
  /^Candidates\s+must\s+write/i,
  /^Please\s+check\s+that/i,
  /^Please\s+write\s+down/i,
  /^\d+\s+minute\s+time/i,
  /^The\s+question\s+paper\s+will/i,
  /^the\s+students\s+will\s+read/i,
  /^on\s+the\s+title\s+page/i,
  /^Candidate/i,
  /^Note\s*:/i,
  /^(www\.|http)/i,
  /^[।॥]+$/,
  /^6[67]\/\d+\/\d+/,
  /^Page\s+\d+\s+of\s+\d+/i,
  /^\d{1,3}\s*\/\s*\d{1,3}$/,
  /\bPage\s+\d+\s+of\s+\d+/i,
  /P\.T\.O\.?$/i,
  /^P\.T\.O\.?$/i,
  /^TURN\s+OVER$/i,
  /^collegedunia/i,
  /^666\s*$/,
];

function isHeaderLine(line) {
  if (!line || typeof line !== "string") return false;
  const t = line.trim();
  if (!t || t.length < 2) return false;
  for (const p of HEADER_PATTERNS) {
    if (p.test(t)) return true;
  }
  return false;
}

// ── removeHeaders ────────────────────────────────────────────────────────────

function removeHeaders(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (isGarbledCIDLine(t)) continue;
    if (isHeaderLine(t)) continue;

    if (/^\s*OR\s*$/i.test(t)) {
      out.push("[OR]");
      continue;
    }

    out.push(t);
  }
  return out;
}

// ── removeHindiDuplicates ────────────────────────────────────────────────────

function removeHindiDuplicates(lines) {
  const out = [];
  for (const line of lines) {
    if (line === "[OR]") {
      out.push(line);
      continue;
    }
    if (isHindiLine(line)) continue;
    out.push(line);
  }
  return out;
}

// ── Module exports ───────────────────────────────────────────────────────────

module.exports = {
  isHindiLine,
  isTableLine,
  removeHeaders,
  removeHindiDuplicates,
  isGarbledCIDLine,
  isHeaderLine,
};