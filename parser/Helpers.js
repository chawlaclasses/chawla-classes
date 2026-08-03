/**
 * utils/helpers.js  v2.1
 *
 * Pure utility functions with no side effects.
 * All file-path operations are sandboxed via safePath().
 *
 * NEW v2.1:
 *   - Math symbol detection and preservation helpers
 *   - LaTeX string validation
 *   - Greek letter mapping
 *   - Math expression detection
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ── Email ────────────────────────────────────────────────────────────────────

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

// ── Path safety ──────────────────────────────────────────────────────────────

function safePath(baseDir, fileName) {
  if (!fileName || typeof fileName !== "string") return null;
  if (/\.\./.test(fileName)) return null;

  const resolved      = path.resolve(baseDir, fileName);
  const normalizedBase = path.resolve(baseDir);

  if (!resolved.startsWith(normalizedBase + path.sep) || resolved === normalizedBase) return null;

  return resolved;
}

// ── Async helpers ────────────────────────────────────────────────────────────

function withTimeout(promise, ms, msg = "Operation timed out") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(msg)), ms)
    ),
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

const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

async function commandExists(cmd) {
  try {
    const probe = process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`;
    await execAsync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

// ── Text helpers ─────────────────────────────────────────────────────────────

const GARBLED_LATIN_RE = /[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßœŒšŠžŽ]/g;

function isGarbled(text) {
  if (!text || !text.trim()) return true;

  const chars = text.replace(/\s/g, "");
  if (!chars.length) return true;

  const replacement = (text.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  if (replacement / chars.length > 0.25) return true;

  if ((text.match(/[A-Za-z]{20,}/g) || []).length >= 3) return true;

  const garbledCount = (text.match(GARBLED_LATIN_RE) || []).length;
  if (garbledCount / chars.length > 0.12) return true;

  return false;
}

// ── ⭐ MATH SYMBOL HELPERS ──────────────────────────────────────────────────

/**
 * Greek letter mapping: Unicode → LaTeX
 */
const GREEK_MAP = {
  'θ': '\\theta',
  'α': '\\alpha',
  'β': '\\beta',
  'γ': '\\gamma',
  'δ': '\\delta',
  'ε': '\\epsilon',
  'ζ': '\\zeta',
  'η': '\\eta',
  'ι': '\\iota',
  'κ': '\\kappa',
  'λ': '\\lambda',
  'μ': '\\mu',
  'ν': '\\nu',
  'ξ': '\\xi',
  'ο': '\\omicron',
  'π': '\\pi',
  'ρ': '\\rho',
  'σ': '\\sigma',
  'τ': '\\tau',
  'υ': '\\upsilon',
  'φ': '\\phi',
  'χ': '\\chi',
  'ψ': '\\psi',
  'ω': '\\omega',
  'Γ': '\\Gamma',
  'Δ': '\\Delta',
  'Θ': '\\Theta',
  'Λ': '\\Lambda',
  'Ξ': '\\Xi',
  'Π': '\\Pi',
  'Σ': '\\Sigma',
  'Φ': '\\Phi',
  'Ψ': '\\Psi',
  'Ω': '\\Omega'
};

/**
 * Common math symbol mapping: Unicode → LaTeX
 */
const MATH_SYMBOL_MAP = {
  '√': '\\sqrt',
  '∫': '\\int',
  '∑': '\\sum',
  '∂': '\\partial',
  '∞': '\\infty',
  '±': '\\pm',
  '×': '\\times',
  '÷': '\\div',
  '≤': '\\le',
  '≥': '\\ge',
  '≠': '\\ne',
  '≈': '\\approx',
  '→': '\\rightarrow',
  '←': '\\leftarrow',
  '↔': '\\leftrightarrow',
  '⇒': '\\Rightarrow',
  '⇔': '\\Leftrightarrow',
  '∠': '\\angle',
  '⊥': '\\perp',
  '∥': '\\parallel',
  '△': '\\triangle',
  '□': '\\square',
  '°': '^{\\circ}'
};

/**
 * Math function mapping: plain → LaTeX
 */
const MATH_FUNC_MAP = {
  'sin': '\\sin',
  'cos': '\\cos',
  'tan': '\\tan',
  'log': '\\log',
  'ln': '\\ln',
  'sqrt': '\\sqrt',
  'lim': '\\lim',
  'max': '\\max',
  'min': '\\min',
  'det': '\\det',
  'tr': '\\tr',
  'rank': '\\rank'
};

/**
 * Check if text contains math symbols (Greek, math operators, etc.)
 */
function hasMathSymbols(text) {
  if (!text) return false;
  
  const allSymbols = { ...GREEK_MAP, ...MATH_SYMBOL_MAP };
  for (const unicode of Object.keys(allSymbols)) {
    if (text.includes(unicode)) return true;
  }
  
  // Check for math function keywords
  for (const func of Object.keys(MATH_FUNC_MAP)) {
    if (new RegExp(`\\b${func}\\b`).test(text)) return true;
  }
  
  // Check for fraction pattern: digit/digit
  if (/\d+\s*\/\s*\d+/.test(text)) return true;
  
  // Check for vector notation: letter→
  if (/[a-zA-Z]\s*→/.test(text)) return true;
  
  // Check for superscript: letter^digit
  if (/[a-zA-Z]\^\d+/.test(text)) return true;
  
  // Check for subscript: letter_digit
  if (/[a-zA-Z]_\d+/.test(text)) return true;
  
  return false;
}

/**
 * Convert Unicode math symbols to LaTeX
 */
function mathSymbolsToLatex(text) {
  if (!text) return text;
  
  let result = text;
  
  // Greek letters
  for (const [unicode, latex] of Object.entries(GREEK_MAP)) {
    result = result.replace(new RegExp(unicode, 'g'), latex);
  }
  
  // Math symbols
  for (const [unicode, latex] of Object.entries(MATH_SYMBOL_MAP)) {
    result = result.replace(new RegExp(unicode, 'g'), latex);
  }
  
  // Fractions: 3/5 → \frac{3}{5}
  result = result.replace(/(\d+)\s*\/\s*(\d+)(?=\s|$|[,;.])/g, '\\frac{$1}{$2}');
  
  // Vector notation: a→ → \vec{a}
  result = result.replace(/([a-zA-Z])\s*→/g, '\\vec{$1}');
  
  // Hat notation: â → \hat{a}
  result = result.replace(/([a-zA-Z])\s*̂/g, '\\hat{$1}');
  
  // Dot notation: ȧ → \dot{a}
  result = result.replace(/([a-zA-Z])\s*˙/g, '\\dot{$1}');
  
  // Bar notation: ā → \bar{a}
  result = result.replace(/([a-zA-Z])\s*̄/g, '\\bar{$1}');
  
  // Superscript: x^2 → x^{2}
  result = result.replace(/([a-zA-Z])\^(\d+)/g, '$1^{$2}');
  result = result.replace(/([a-zA-Z])\^\{([^}]+)\}/g, '$1^{$2}');
  
  // Subscript: x_1 → x_{1}
  result = result.replace(/([a-zA-Z])_(\d+)/g, '$1_{$2}');
  result = result.replace(/([a-zA-Z])_\{([^}]+)\}/g, '$1_{$2}');
  
  // Math functions
  for (const [func, latex] of Object.entries(MATH_FUNC_MAP)) {
    result = result.replace(new RegExp(`\\b${func}\\b`, 'g'), latex);
  }
  
  return result;
}

/**
 * Check if text contains LaTeX math expressions
 */
function hasLatexMath(text) {
  if (!text) return false;
  
  const latexPatterns = [
    /\\[a-zA-Z]+/,           // \sin, \theta, etc.
    /\^\{[^}]+\}/,           // ^{...}
    /\_\{[^}]+\}/,           // _{...}
    /\\frac\{[^}]+\}\{[^}]+\}/,  // \frac{...}{...}
    /\\sqrt\{[^}]+\}/,       // \sqrt{...}
    /\\vec\{[^}]+\}/,        // \vec{...}
    /\\hat\{[^}]+\}/,        // \hat{...}
    /\\dot\{[^}]+\}/,        // \dot{...}
    /\\bar\{[^}]+\}/,        // \bar{...}
  ];
  
  for (const pattern of latexPatterns) {
    if (pattern.test(text)) return true;
  }
  
  return false;
}

/**
 * Convert LaTeX to plain text (for display in non-math contexts)
 * Simple conversion - just remove LaTeX markup
 */
function latexToPlain(text) {
  if (!text) return text;
  
  let result = text;
  
  // Remove LaTeX commands and keep their arguments
  // \frac{a}{b} → a/b
  result = result.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2');
  
  // \vec{a} → a
  result = result.replace(/\\vec\{([^}]+)\}/g, '$1');
  
  // \hat{a} → a
  result = result.replace(/\\hat\{([^}]+)\}/g, '$1');
  
  // \theta → θ
  const reverseGreek = {};
  for (const [unicode, latex] of Object.entries(GREEK_MAP)) {
    reverseGreek[latex] = unicode;
  }
  for (const [latex, unicode] of Object.entries(reverseGreek)) {
    result = result.replace(new RegExp(latex, 'g'), unicode);
  }
  
  // Remove other LaTeX commands
  result = result.replace(/\\[a-zA-Z]+/g, '');
  
  // Clean up braces
  result = result.replace(/[{}]/g, '');
  
  return result;
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

    const type = await ft.fromBuffer(fs.readFileSync(filePath));
    if (type && !allowedMimes.includes(type.mime)) return false;

    return true;
  } catch (_) {
    return true;
  }
}

module.exports = {
  normalizeEmail,
  safePath,
  withTimeout,
  cleanupFile,
  cleanupDir,
  commandExists,
  isGarbled,
  validateFileContent,
  // ── Math helpers ──────────────────────────────────────────────────────────
  GREEK_MAP,
  MATH_SYMBOL_MAP,
  MATH_FUNC_MAP,
  hasMathSymbols,
  mathSymbolsToLatex,
  hasLatexMath,
  latexToPlain,
};