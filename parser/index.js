/**
 * parser/index.js  v2.6
 *
 * Main entry point for the question parsing pipeline.
 *
 * FIXES v2.6:
 *   - Accounts/Commerce PDF support
 *   - Math symbols preserved in ORIGINAL format (NO LaTeX conversion)
 *   - Auto-detects Hindi-only PDFs and Accounts PDFs
 *   - Only OCR artifacts like "pm" → "±" and "sqrt" → "√" are fixed
 *   - Rupee symbols preserved
 */

"use strict";

const { normaliseOCR, preserveMathSymbols, cleanAccountsText, isAccountsPDF } = require("./normalise");
const { removeHeaders, removeHindiDuplicates } = require("./clean");
const {
  detectQuestionBlocks,
  splitInlineOptions,
  extractOptions,
} = require("./blocks");
const { detectTables, deduplicate, buildQuestionObject } = require("./build");
const { DEBUG_PDF } = require("../config");
const logger = require("../utils/logger");

// ── Hindi-only detection ──────────────────────────────────────────────────────
const HINDI_CHAR_RE = /[\u0900-\u097F]/;

function hindiLineRatio(line) {
  const hindi = (line.match(/[\u0900-\u097F]/g) || []).length;
  const total = (line.match(/[A-Za-z\u0900-\u097F]/g) || []).length;
  return total > 0 ? hindi / total : 0;
}

function isHindiLine(line) {
  return hindiLineRatio(line) > 0.5;
}

function detectHindiOnlyMode(lines) {
  const content = lines.filter((l) => l && l !== "[OR]" && l.trim().length > 3);
  if (content.length === 0) return false;
  const hindiCount = content.filter(isHindiLine).length;
  return hindiCount / content.length > 0.55;
}

// ─────────────────────────────────────────────────────────────────────────────

function parseQuestionsFromText(rawText, meta = {}) {
  console.log("📥 [PARSER] Input length:", rawText?.length || 0);
  console.log("📥 [PARSER] Input preview:", rawText?.slice(0, 300));
  
  if (!rawText || typeof rawText !== "string") {
    console.log("❌ [PARSER] Invalid input");
    return [];
  }
  
  // ⭐ If text is very short, return empty
  if (rawText.trim().length < 50) {
    console.log("❌ [PARSER] Text too short");
    return [];
  } 
  let normalized = normaliseOCR(rawText);
  
  // Step 1.5: Accounts PDF specific cleaning
  if (isAccountsPDF(rawText)) {
    normalized = cleanAccountsText(normalized);
    if (DEBUG_PDF) logger.debug("[Parser] Accounts/Commerce PDF detected");
  }
  
  const rawLines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  // Step 2: Strip headers/footers, tag OR
  const cleanLines = removeHeaders(rawLines);

  // Step 3: Remove Hindi duplicates (in bilingual PDFs) OR keep all (Hindi-only)
  const processedLines = removeHindiDuplicates(cleanLines);

  // Detect Hindi-only mode AFTER cleanup
  const hindiMode = detectHindiOnlyMode(processedLines);
  if (DEBUG_PDF && hindiMode) logger.debug("[Parser] Hindi-only PDF detected");

  // Step 4: Group into question blocks (pass hindiMode so Hindi numbers work)
  const rawBlocks = detectQuestionBlocks(processedLines, hindiMode);

  // Step 4.5: Split single-line multi-option rows
  const splitBlocks = splitInlineOptions(rawBlocks);

  // Step 5: Separate options from question text
  const blocksWithOpts = extractOptions(splitBlocks);

  // Step 6: Flag table/ledger blocks
  const blocksWithTables = detectTables(blocksWithOpts);

  // Step 6.5: Merge bilingual duplicates, sort
  const uniqueBlocks = deduplicate(blocksWithTables);

  // Step 7+8: Build and validate question objects
  const questions = uniqueBlocks
    .map((block) => buildQuestionObject(block, meta))
    .filter(Boolean);

  // ⭐ Preserve math symbols in final question text (keep original format)
  questions.forEach(q => {
    if (q.question) {
      q.question = preserveMathSymbols(q.question);
      // Fix rupee symbols in question
      q.question = q.question.replace(/\\yen/g, '₹');
      q.question = q.question.replace(/\\mathbb\{R\}/g, '₹');
      q.question = q.question.replace(/¥/g, '₹');
    }
    if (q.options && Array.isArray(q.options)) {
      q.options = q.options.map(opt => {
        let cleanOpt = preserveMathSymbols(opt);
        cleanOpt = cleanOpt.replace(/\\yen/g, '₹');
        cleanOpt = cleanOpt.replace(/\\mathbb\{R\}/g, '₹');
        cleanOpt = cleanOpt.replace(/¥/g, '₹');
        return cleanOpt;
      });
    }
  });

  if (DEBUG_PDF) {
    const counts = questions.reduce((acc, q) => {
      const k = q.subtype || q.type;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    logger.debug(`[Parser] ${questions.length} questions | mode: ${hindiMode ? "Hindi" : "English"}`, counts);
    
    if (questions.length > 0) {
      logger.debug("[Parser] Sample questions:");
      questions.slice(0, 3).forEach((q, i) => {
        const preview = q.question ? q.question.slice(0, 80) + (q.question.length > 80 ? "…" : "") : "";
        logger.debug(`  Q${i+1}: [${q.type}] ${preview}`);
      });
    }
  }

  return questions;
}

module.exports = { parseQuestionsFromText };