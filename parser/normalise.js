/**
 * parser/normalise.js  v2.7
 *
 * Step 1: normaliseOCR(rawText)
 *
 * FIXES v2.7:
 *   - Accounts/Commerce PDF support (₹ symbols, tables, currency)
 *   - Hindi + English mix support
 *   - Math symbols preserved in ORIGINAL format
 *   - Rupee symbols: \yen, \mathbb{R}, \R → ₹
 *   - Currency amounts: 1,00,000 format preserved
 *   - Page headers removed
 *   - P.T.O., TURN OVER removed
 *   - OR questions detected
 *   - Tables preserved
 */

"use strict";

// Latin Extended / special chars that appear in garbled PDF encoding
const GARBLED_LATIN_RE = /[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßœŒšŠžŽ]/g;

/**
 * Detect if a line is garbled PDF encoding
 */
function isGarbledEncoding(line) {
  if (!line || line.trim().length < 5) return false;

  const garbled = (line.match(GARBLED_LATIN_RE) || []).length;
  if (garbled === 0) return false;

  const letters = (line.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
  if (letters < 3) return false;

  return garbled / letters > 0.15;
}

/**
 * PRESERVE MATH SYMBOLS — Keep original format, only fix OCR artifacts
 */
function preserveMathSymbols(text) {
  if (!text) return text;
  
  let result = text;
  
  // ── ONLY fix OCR artifacts ──────────────────────────────────────────────
  
  // Fix "pm" → "±" (standalone word)
  result = result.replace(/\bpm\b/g, '±');
  result = result.replace(/\bPM\b/g, '±');
  
  // Fix "\text{pm}" → "±"
  result = result.replace(/\\text\{\s*pm\s*\}/g, '±');
  result = result.replace(/\\text\{\s*PM\s*\}/g, '±');
  
  // Fix "sqrt" → "√" (standalone word)
  result = result.replace(/\bsqrt\b/g, '√');
  result = result.replace(/\bSQRT\b/g, '√');
  
  // Fix "\text{sqrt}" → "√"
  result = result.replace(/\\text\{\s*[sS]qrt\s*\}/g, '√');
  
  // Fix "text{...}" artifacts
  result = result.replace(/\\text\{\s*([^}]+)\s*\}/g, '$1');
  
  // ── Accounts/Commerce specific fixes ──────────────────────────────────
  
  // Fix Rupee symbols: \yen, \mathbb{R}, \R → ₹
  result = result.replace(/\\yen/g, '₹');
  result = result.replace(/\\mathbb\{R\}/g, '₹');
  result = result.replace(/\\R/g, '₹');
  result = result.replace(/\\mathbb\{Rs\.\}/g, '₹');
  result = result.replace(/\\Rs\./g, '₹');
  
  // Fix currency amounts: 1,00,000 format
  result = result.replace(/(\d+)\s*,\s*(\d{3})/g, '$1,$2');
  
  // Fix "Rs." to "₹"
  result = result.replace(/\bRs\.?\s*/g, '₹ ');
  
  // Fix "¥" to "₹"
  result = result.replace(/¥/g, '₹');
  
  // Fix percentage: 10% → 10%
  result = result.replace(/(\d+)\s*%\s*/g, '$1%');
  
  // Fix "p.a." formatting
  result = result.replace(/p\.a\./g, 'p.a.');
  
  // ── Keep all math symbols AS-IS (NO LaTeX conversion) ──────────────────
  // θ, α, β, γ, π, √, ±, 3/5, x², x₁, sin, cos, tan, â all kept as-is
  // \frac{}{} → kept as \frac{}{} for MathJax rendering
  
  return result;
}

/**
 * Accounts/Commerce PDF specific cleaning
 */
function cleanAccountsText(text) {
  if (!text) return text;
  
  let result = text;
  
  // ── Remove page headers ────────────────────────────────────────────────
  result = result.replace(/\d+\s*\/\d+[-\/]\d+\s+Page\s+\d+\s+of\s+\d+/gi, '');
  result = result.replace(/Page\s+\d+\s+of\s+\d+/gi, '');
  result = result.replace(/\d+\s*\/\d+[-\/]\d+\s+Page/i, '');
  result = result.replace(/P\.?T\.?O\.?/gi, '');
  result = result.replace(/TURN\s+OVER/gi, '');
  result = result.replace(/continued/i, '');
  
  // ── Fix OR separators ──────────────────────────────────────────────────
  result = result.replace(/## OR/g, '[OR]');
  result = result.replace(/# OR/g, '[OR]');
  result = result.replace(/\bOR\b(?=\s)/g, '[OR]');
  
  // ── Fix Rupee symbols ──────────────────────────────────────────────────
  result = result.replace(/\\yen/g, '₹');
  result = result.replace(/\\mathbb\{R\}/g, '₹');
  result = result.replace(/\\R/g, '₹');
  result = result.replace(/¥/g, '₹');
  result = result.replace(/\bRs\.?\s*/g, '₹ ');
  
  // ── Fix currency amounts ──────────────────────────────────────────────
  result = result.replace(/(\d+)\s*,\s*(\d{3})/g, '$1,$2');
  result = result.replace(/(\d+)\s*,\s*(\d{3})\s*,\s*(\d{3})/g, '$1,$2,$3');
  
  // ── Fix table separators ──────────────────────────────────────────────
  result = result.replace(/\|/g, ' | ');
  result = result.replace(/\s{3,}/g, ' ');
  
  // ── Fix LaTeX math ────────────────────────────────────────────────────
  result = result.replace(/\\times/g, '×');
  result = result.replace(/\\pm/g, '±');
  result = result.replace(/\\sqrt/g, '√');
  
  // ── Fix percentage ─────────────────────────────────────────────────────
  result = result.replace(/(\d+)\s*%\s*/g, '$1%');
  
  // ── Fix p.a. ──────────────────────────────────────────────────────────
  result = result.replace(/p\.a\./g, 'p.a.');
  
  // ── Remove extra spaces ────────────────────────────────────────────────
  result = result.replace(/\s{3,}/g, ' ');
  
  return result;
}

/**
 * Check if text is Accounts/Commerce PDF (contains ₹, tables, etc.)
 */
function isAccountsPDF(text) {
  if (!text) return false;
  
  const indicators = [
    /\\yen/,
    /\\mathbb\{R\}/,
    /¥/,
    /Balance Sheet/,
    /Ledger/,
    /Journal/,
    /Debentures/,
    /Partnership/,
    /Capital Account/,
    /Revaluation Account/,
    /Realisation Account/,
    /Profit and Loss/,
    /Trading Account/,
    /Goodwill/,
    /Reserves and Surplus/,
    /Share Capital/,
    /Debtors/,
    /Creditors/,
    /Stock/,
    /Machinery/,
    /Furniture/,
    /Buildings/,
    /Cash at Bank/
  ];
  
  let count = 0;
  for (const pattern of indicators) {
    if (pattern.test(text)) count++;
    if (count >= 3) return true;
  }
  return false;
}

function normaliseOCR(rawText) {
  const lines = rawText.split("\n");
  const isAccounts = isAccountsPDF(rawText);
  
  const processedLines = lines.map(line => {
    // Skip garbled lines
    if (isGarbledEncoding(line)) return "";

    let processed = line;
    
    // ── Accounts PDF specific cleaning ──────────────────────────────────
    if (isAccounts) {
      processed = cleanAccountsText(processed);
    }
    
    // ── Fix Rs. symbol OCR artifacts ───────────────────────────────────
    processed = processed
      .replace(/[<＜]\s*(\d{1,3}(?:,\d{2,3})+)/g, "₹ $1")
      .replace(/₹\s*/g, "₹ ")
      .replace(/\bRs\.?(\d)/g, "₹ $1")
      .replace(/[\u20B9]/g, "₹ ")

      // ── Unicode spaces → regular space ──────────────────────────────────
      .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
      .replace(/\u00AD/g, "")

      // ── ⭐ PRESERVE MATH SYMBOLS ──────────────────────────────────────
      // Keep θ, α, β, γ, δ, π, φ, ψ, ω as they are
      // Keep √, ∫, ∑, ∂, ∞, ±, ×, ÷, ≤, ≥, ≠, ≈ as they are
      // Keep →, ←, ↔, ⇒, ⇔, ∠, ⊥, ∥, △, □, ° as they are
      // Keep fractions as "3/5"
      // Keep vectors as "â"
      // Keep superscript as "x²"
      // Keep subscript as "x₁"

      // ── Repair hyphen-broken words ──────────────────────────────────────
      .replace(/([A-Za-z])-\s+([a-z])/g, "$1$2")

      // ── Number/letter spacing fixes ─────────────────────────────────────
      .replace(/(\d+)\s*\.\s*([A-Z])/g, "$1. $2")
      .replace(/(\d+)\s*\)\s*([A-Z])/g, "$1) $2")
      .replace(/([A-Za-z])\s*\(([A-D])\)/g, "$1 ($2)")

      // ── CamelCase fixes ─────────────────────────────────────────────────
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([0-9])([A-Za-z])/g, "$1 $2")

      // ── Remove stray Hindi noise from English text ─────────────────────
      .replace(/(?<=[A-Za-z0-9,;])\s*[\u0900-\u097F]{1,3}\s*(?=[A-Za-z0-9,;(])/g, " ")

      // ── Protect multi-space gaps BEFORE collapsing ─────────────────────
      .replace(/(\S)\s{3,}(\S)/g, (m, a, b) => `${a}\x00TAB\x00${b}`)
      .replace(/\s{2,}(?=[A-Da-d][).]\s)/g, "\x00OPT\x00")

      // ── Collapse remaining multiple spaces ──────────────────────────────
      .replace(/[ \t]{2,}/g, " ")

      // ── Restore protected gaps ──────────────────────────────────────────
      .replace(/\x00TAB\x00/g, "   ")
      .replace(/\x00OPT\x00/g, "   ");

    return processed;
  });

  return processedLines.join("\n");
}

module.exports = { normaliseOCR, isGarbledEncoding, preserveMathSymbols, cleanAccountsText, isAccountsPDF };