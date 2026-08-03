/**
 * parser/build.js  v2.4
 *
 * Step 7: detectTables(blocks)
 * Step 8: deduplicate(blocks)
 * Step 9: buildQuestionObject(block, meta)
 *
 * FIXES v2.4:
 *   - ⭐ crypto.randomUUID() replaced with generateUUID() imported from
 *     utils/helpers (shared across build.js, services/questions.js, and
 *     services/results.js). randomUUID() only exists on Node 14.17+ — on
 *     older Node runtimes (common on cheap/shared hosting) calling it
 *     throws "crypto.randomUUID is not a function", which bubbles up as
 *     an uncaught exception in buildQuestionObject() and turns into a
 *     500 Internal Server Error on /import-pdf-questions every time the
 *     parser actually finds a question. generateUUID() works on every
 *     Node version.
 *
 * FIXES v2.3 (carried over):
 *   - Math symbols preserved in ORIGINAL format
 *   - Accounts/Commerce PDF support
 *   - Rupee symbols preserved
 *   - Table data appended to question text
 *   - Garbage filter improved for Accounts PDFs
 */

"use strict";

const { mergeOptionsLists } = require("./blocks");
const { generateUUID } = require("../utils/helpers");

// ── PRESERVE MATH SYMBOLS ──────────────────────────────────────────────────

function preserveMathSymbols(text) {
  if (!text) return text;
  
  let result = text;
  
  // Fix "pm" → "±"
  result = result.replace(/\bpm\b/g, '±');
  result = result.replace(/\bPM\b/g, '±');
  result = result.replace(/\\text\{\s*pm\s*\}/g, '±');
  
  // Fix "sqrt" → "√"
  result = result.replace(/\bsqrt\b/g, '√');
  result = result.replace(/\bSQRT\b/g, '√');
  result = result.replace(/\\text\{\s*[sS]qrt\s*\}/g, '√');
  
  // Fix "text{...}" artifacts
  result = result.replace(/\\text\{\s*([^}]+)\s*\}/g, '$1');
  
  // ── Accounts/Commerce specific fixes ──────────────────────────────────
  result = result.replace(/\\yen/g, '₹');
  result = result.replace(/\\mathbb\{R\}/g, '₹');
  result = result.replace(/\\R/g, '₹');
  result = result.replace(/¥/g, '₹');
  result = result.replace(/\bRs\.?\s*/g, '₹ ');
  result = result.replace(/(\d+)\s*,\s*(\d{3})/g, '$1,$2');
  result = result.replace(/\\times/g, '×');
  result = result.replace(/\\pm/g, '±');
  result = result.replace(/\\sqrt/g, '√');
  result = result.replace(/(\d+)\s*%\s*/g, '$1%');
  
  // Keep everything else AS-IS
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 — detectTables
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_KEYWORDS_RE =
  /Balance Sheet|Ledger|Journal|Cash Flow|Trial Balance|Trading Account|Profit & Loss|P&L|Income Statement|Realisation Account|Capital Account|Revaluation Account|Partnership|Debentures/i;

function detectTables(blocks) {
  return blocks.map((block) => {
    const questionText = block.lines.join(" ");

    const hasTableLines = block.tableLines.length >= 2;
    const amountCount = (questionText.match(/\d{1,3}(?:,\d{2,3})+(?:\.\d+)?/g) || []).length;
    const hasRealTable =
      hasTableLines ||
      (TABLE_KEYWORDS_RE.test(questionText) && amountCount >= 2);

    return { ...block, hasTable: hasRealTable };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 8 — deduplicate
// ─────────────────────────────────────────────────────────────────────────────

function deduplicate(blocks) {
  const map = new Map();

  for (const block of blocks) {
    if (!block || block.num === 0) continue;

    const key = `${block.num}-${block.sub || ""}`;

    if (!map.has(key)) {
      map.set(key, block);
      continue;
    }

    const existing = map.get(key);
    const exIsEn = /[A-Za-z]/.test(existing.lines.join(" "));
    const blIsEn = /[A-Za-z]/.test(block.lines.join(" "));

    if (!exIsEn && blIsEn) {
      block.options = mergeOptionsLists(block.options, existing.options);
      map.set(key, block);
    } else if (exIsEn && !blIsEn) {
      existing.options = mergeOptionsLists(existing.options, block.options);
    } else {
      existing.options = mergeOptionsLists(existing.options, block.options);
      const existLen = existing.lines.join(" ").length;
      const blockLen = block.lines.join(" ").length;
      if (blockLen > existLen) {
        block.options = existing.options;
        map.set(key, block);
      }
    }
  }

  return [...map.entries()]
    .sort(([keyA], [keyB]) => {
      const [numA, subA] = keyA.split("-");
      const [numB, subB] = keyB.split("-");
      const nd = parseInt(numA) - parseInt(numB);
      if (nd !== 0) return nd;
      return (subA || "").localeCompare(subB || "");
    })
    .map(([, block]) => block);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 9 — buildQuestionObject
// ─────────────────────────────────────────────────────────────────────────────

// Assertion-Reason detection
const AR_RE = /Assertion\s*\(?\s*[A(]|Reason\s*\(?\s*[R(]/i;

// Case Study detection
const CASE_STUDY_RE =
  /Case\s+Study|Passage|Read\s+the\s+following|Following\s+passage|Observe\s+the|Given\s+below\s+is|Study\s+the\s+following/i;

// [OR] sentinel
const OR_IN_TEXT_RE = /\[OR\]/;

function classifyQuestion(questionText, options, hasTable) {
  const isAR =
    AR_RE.test(questionText) &&
    /Assertion/i.test(questionText) &&
    /Reason/i.test(questionText);

  const isValidMCQ = options.length >= 2 && options.length <= 6 && !hasTable && !isAR;

  const hasSubQuestions = /\b(i|ii|iii|iv|v)\b|\([a-d]\)/i.test(questionText);
  const isCaseStudy =
    CASE_STUDY_RE.test(questionText) ||
    (hasTable && questionText.length > 250 && hasSubQuestions && !isAR);

  if (isAR) return { type: "MCQ", subtype: "AR" };
  if (isValidMCQ) return { type: "MCQ", subtype: null };
  if (isCaseStudy) return { type: "CaseStudy", subtype: null };
  return { type: "Subjective", subtype: null };
}

function guessMarks(type, questionText) {
  if (type === "MCQ") return 1;
  if (type === "CaseStudy") return 5;

  const long = /explain|describe|discuss|derive|prove|show\s+that|justify|elaborate|analyze|evaluate|calculate|compute|compare|differentiate|distinguish|prepare|journalise/i;
  const short = /state|define|write|name|list|give|find|what|why|how|identify|mention|briefly/i;

  if (long.test(questionText)) return 5;
  if (short.test(questionText)) return 2;
  return 3;
}

function isGarbageQuestion(questionText) {
  if (questionText.length < 8) return true;

  const digits = (questionText.match(/\d/g) || []).length;
  if (digits / questionText.length > 0.7) return true;

  if (questionText.length < 30 &&
    /^(Dr\.?|Cr\.?|Particulars|Total|Liabilities|Assets|Balance Sheet)$/i.test(questionText.trim())) {
    return true;
  }

  return false;
}

function buildQuestionObject(block, meta = {}) {
  const { subject = "General", chapter = "", class: qClass = "10" } = meta;

  let questionText = block.lines
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Append table data
  if (block.tableLines && block.tableLines.length > 0) {
    const tableText = block.tableLines.join(" | ");
    questionText = questionText
      ? questionText + " [TABLE: " + tableText + "]"
      : "[TABLE: " + tableText + "]";
  }

  if (isGarbageQuestion(questionText)) return null;

  const isOR = OR_IN_TEXT_RE.test(questionText);
  const { type, subtype: rawSubtype } = classifyQuestion(
    questionText,
    block.options,
    block.hasTable
  );
  const subtype = isOR ? "OR" : rawSubtype;

  // ⭐ Preserve math symbols in final question text
  const finalQuestion = preserveMathSymbols(
    questionText.replace(/\[OR\]/g, "").replace(/\s{2,}/g, " ").trim()
  );

  // ⭐ Preserve math symbols in options
  const finalOptions = block.options.map((o) => {
    const val = o.val || o;
    return preserveMathSymbols(val);
  });

  // FIX: previously an MCQ block with zero/one extracted options (e.g. a
  // currency-heavy line where the PDF's embedded font couldn't be decoded,
  // leaving behind bare "<" placeholders with no digits) still produced a
  // full question object with options:[] and answer:"". That object then
  // sailed straight through deduplicate()/.filter(Boolean) and got saved
  // to the Question Bank as isActive — an unanswerable MCQ a student could
  // actually be served in a real test. Reject it here instead so a block
  // this broken is dropped from the import rather than silently published.
  if (type === "MCQ" && finalOptions.length < 2) {
    return null;
  }

  return {
    // ⭐ FIX: was crypto.randomUUID() — now Node-version-safe generateUUID()
    // imported from utils/helpers (shared with services/questions.js and
    // services/results.js)
    id: generateUUID(),
    question: finalQuestion,
    type,
    subtype: subtype || undefined,
    options: finalOptions,
    answer: "",
    class: qClass,
    subject,
    chapter: chapter || "",
    marks: guessMarks(type, questionText),
    hasTable: !!block.hasTable,
    isOR,
  };
}

module.exports = {
  detectTables,
  deduplicate,
  buildQuestionObject,
};