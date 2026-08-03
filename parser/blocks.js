/**
 * parser/blocks.js  v2.8
 *
 * Step 4: detectQuestionBlocks(lines, hindiMode)
 * Step 5: extractOptions(blocks)
 * Step 6: splitInlineOptions(blocks)
 *
 * FIXES v2.8:
 *   - Accounts/Commerce PDF support
 *   - Hindi question numbers detection
 *   - OR questions detection
 *   - Better option extraction for Accounts papers
 *   - Math symbols preserved in ORIGINAL format
 *   - Rupee symbols preserved
 */

"use strict";

const { isHindiLine, isTableLine } = require("./clean");

// ─────────────────────────────────────────────────────────────────────────────
// ⭐ PRESERVE MATH SYMBOLS — Keep original format, only fix OCR artifacts
// ─────────────────────────────────────────────────────────────────────────────

function preserveMathSymbols(text) {
  if (!text) return text;
  
  let result = text;
  
  // ── ONLY fix OCR artifacts ──────────────────────────────────────────────
  
  // Fix "pm" → "±"
  result = result.replace(/\bpm\b/g, '±');
  result = result.replace(/\bPM\b/g, '±');
  result = result.replace(/\\text\{\s*pm\s*\}/g, '±');
  result = result.replace(/\\text\{\s*PM\s*\}/g, '±');
  
  // Fix "sqrt" → "√"
  result = result.replace(/\bsqrt\b/g, '√');
  result = result.replace(/\bSQRT\b/g, '√');
  result = result.replace(/\\text\{\s*[sS]qrt\s*\}/g, '√');
  
  // Fix "text{...}" artifacts
  result = result.replace(/\\text\{\s*([^}]+)\s*\}/g, '$1');
  
  // ── Accounts/Commerce specific fixes ──────────────────────────────────
  
  // Fix Rupee symbols
  result = result.replace(/\\yen/g, '₹');
  result = result.replace(/\\mathbb\{R\}/g, '₹');
  result = result.replace(/\\R/g, '₹');
  result = result.replace(/¥/g, '₹');
  result = result.replace(/\bRs\.?\s*/g, '₹ ');
  
  // Fix currency amounts
  result = result.replace(/(\d+)\s*,\s*(\d{3})/g, '$1,$2');
  
  // Fix LaTeX math
  result = result.replace(/\\times/g, '×');
  result = result.replace(/\\pm/g, '±');
  result = result.replace(/\\sqrt/g, '√');
  
  // Fix percentage
  result = result.replace(/(\d+)\s*%\s*/g, '$1%');
  
  // ── Keep all math symbols AS-IS (NO LaTeX conversion) ──────────────────
  // θ, α, β, γ, π, √, ±, 3/5, x², x₁, sin, cos, tan, â all kept as-is
  
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — detectQuestionBlocks (with Accounts/Commerce support)
// ─────────────────────────────────────────────────────────────────────────────

const NOT_A_QUESTION_PATTERNS = [
  /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
  /^\d+\s+each\s+at/i,
  /^(Non.?Current|Current Assets|Assets|Liabilities|Particulars)/i,
  /all\s+questions\s+are\s+compulsory|question\s+paper/i,
  /^(Marks?|Attempt|Answer)\s*:/i,
  /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/,
  /P\.?T\.?O\.?/i,
  /\bPage\s+\d+\s+of\s+\d+/i,
  /\d+\/\d+[-\/]\d+\s+Page/i,
  /TURN\s+OVER/i,
];

const FULL_LINE_NOT_QUESTION = [
  /^(Dr|Cr|Particulars|Balance Sheet|Capital Account|Liabilities|Assets)\b/i,
];

function notAQuestion(line, isFullLine = false) {
  if (NOT_A_QUESTION_PATTERNS.some((p) => p.test(line))) return true;
  if (isFullLine && FULL_LINE_NOT_QUESTION.some((p) => p.test(line))) return true;
  return false;
}

let currentNum = 0;

function matchQuestionStart(line, hindiMode = false) {
  if (!line || typeof line !== "string") return null;
  
  const trimmed = line.trim();
  if (!trimmed) return null;
  
  let currentNum = 0;
  
  // ── OR questions ─────────────────────────────────────────────────────────
  if (/^\[?OR\]?\s*[:.\-]?\s*/i.test(trimmed)) {
    const rest = trimmed.replace(/^\[?OR\]?\s*[:.\-]?\s*/i, '');
    return { num: currentNum || 0, sub: 'or', rest: rest || '[OR]' };
  }
  
  // ── ⭐ FIX: Detect "1. Book-keeping is..." format ──────────────────────
  // This is the most common format in your PDF
  const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
  if (numberedMatch) {
    const num = parseInt(numberedMatch[1]);
    const rest = numberedMatch[2].trim();
    
    // ⭐ ONLY skip if it's definitely a header (not a question)
    const headerKeywords = ['Class', 'Roll No', 'Name', 'Date', 'Time', 'Multiple Choice', 'Accountancy'];
    if (headerKeywords.some(kw => rest.startsWith(kw))) {
      return null;
    }
    
    // ⭐ Don't skip based on first letter - it could be any text
    if (rest.length < 3) return null;
    
    // ⭐ If it starts with a number or option letter, it's NOT a question
    if (/^\d+[.)]/.test(rest) || /^[A-Da-d][.)]/.test(rest)) {
      return null;
    }
    
    return { num, sub: null, rest };
  }
  
  // ── "Q1." or "Q.1" format ──────────────────────────────────────────────
  const qMatch = trimmed.match(/^Q\.?\s*(\d{1,3})\s*[.):]?\s*(.+)/i);
  if (qMatch) {
    const num = parseInt(qMatch[1]);
    const rest = qMatch[2].trim();
    if (rest.length < 3) return null;
    return { num, sub: null, rest };
  }
  
  // ── "Question 1." format ────────────────────────────────────────────────
  const questionMatch = trimmed.match(/^Question\s*(\d{1,3})\s*[.:]?\s*(.+)/i);
  if (questionMatch) {
    const num = parseInt(questionMatch[1]);
    const rest = questionMatch[2].trim();
    if (rest.length < 3) return null;
    return { num, sub: null, rest };
  }
  
  // ── Sub-questions like "1. (i)" or "1. (a)" ─────────────────────────────
  const subMatch = trimmed.match(/^(\d+)\.?\s*\(([a-z]|[ivx]+)\)\s*(.+)/i);
  if (subMatch) {
    const num = parseInt(subMatch[1]);
    return { num, sub: subMatch[2].toLowerCase(), rest: subMatch[3].trim() };
  }
  
  return null;
}

// ── Option patterns ──────────────────────────────────────────────────────────

const OPTION_START_RE = /^(?:\(([A-Da-d])\)|([A-Da-d])\s*[.)])\s*/;

// ⭐ Add more option patterns for numbered options
const NUMBERED_OPTION_RE = /^(\d{1,2})\.?\s*[.)]\s*/;

function detectQuestionBlocks(lines, hindiMode = false) {
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (!line || line.length < 2) continue;

    if (line === "[OR]") {
      if (current) current.lines.push("[OR]");
      continue;
    }

    // Check if it's an option line
    if (current && OPTION_START_RE.test(line)) {
      current.rawOpts.push(line);
      continue;
    }

    // Check if it's a table line
    if (current && isTableLine(line)) {
      current.tableLines.push(line);
      continue;
    }

    const qStart = matchQuestionStart(line, hindiMode);

    if (qStart && qStart.num > 0) {
      if (qStart.sub !== null && qStart.sub !== 'or') {
        if (!current) {
          current = { num: qStart.num, sub: null, lines: [], rawOpts: [], tableLines: [] };
        } else if (current.num !== qStart.num) {
          blocks.push(current);
          current = { num: qStart.num, sub: null, lines: [], rawOpts: [], tableLines: [] };
        }
      }

      // If it's an OR question, add to existing current
      if (qStart.sub === 'or' && current) {
        current.lines.push('[OR] ' + qStart.rest);
        continue;
      }

      // Push previous block if exists
      if (current) blocks.push(current);

      current = {
        num: qStart.num,
        sub: qStart.sub,
        lines: qStart.rest ? [qStart.rest] : [],
        rawOpts: [],
        tableLines: [],
      };

    } else if (current) {
      // Check if it's an option
      if (OPTION_START_RE.test(line)) {
        current.rawOpts.push(line);
      } else if (isTableLine(line)) {
        current.tableLines.push(line);
      } else {
        current.lines.push(line);
      }
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — extractOptions (v2.8)
// ─────────────────────────────────────────────────────────────────────────────

const CIRCLED_MAP = {
  "Ⓐ": "A", "Ⓑ": "B", "Ⓒ": "C", "Ⓓ": "D",
  "ⓐ": "a", "ⓑ": "b", "ⓒ": "c", "ⓓ": "d",
};

function normaliseCircled(line) {
  return line.replace(/[ⒶⒷⒸⒹⓐⓑⓒⓓ]/g, (ch) => CIRCLED_MAP[ch] || ch);
}

const OPTION_RE = /^(?:\(([A-Da-d])\)|([A-Da-d])[.):])\s*(.+)|^([A-Da-d])\s{2,}(.+)/;

function parseOptionLine(rawLine) {
  const line = normaliseCircled(rawLine.trim());
  const m = line.match(OPTION_RE);
  if (!m) return null;

  let key, val;
  if (m[4]) {
    key = m[4].toUpperCase();
    val = m[5].trim();
  } else {
    key = (m[1] || m[2]).toUpperCase();
    val = m[3].trim();
  }

  if (!val) val = "[formula]";
  
  // ⭐ Preserve math symbols in original format
  val = preserveMathSymbols(val);
  
  return { key, val };
}

function mergeOptionsLists(primary, secondary) {
  const result = [...primary];
  for (const o of secondary) {
    if (!result.find((x) => x.key === o.key)) result.push(o);
  }
  return result.sort((a, b) => {
  const keyA = a?.key || '';
  const keyB = b?.key || '';
  // ⭐ FIX: Handle undefined/null keys
const charA = (keyA && typeof keyA === 'string') ? keyA.charCodeAt(0) : 0;
const charB = (keyB && typeof keyB === 'string') ? keyB.charCodeAt(0) : 0;
return charA - charB;
});
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — splitInlineOptions
// ─────────────────────────────────────────────────────────────────────────────

function splitInlineOptions(blocks) {
  const PAREN_SPLIT_RE = /\s+(?=\([A-Da-d]\)\s)/;
  const NOPAREN_SPLIT_RE = /\s{3,}(?=[A-Da-d][).]\s)/;

  function maybeSplit(line) {
    const parenMarkers = line.match(/\([A-Da-d]\)\s/g);
    if (parenMarkers && parenMarkers.length >= 2) {
      const parts = line.split(PAREN_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) return parts;
    }

    const noParenMarkers = line.match(/(?:^|\s{3,})[A-Da-d][).]\s/g);
    if (noParenMarkers && noParenMarkers.length >= 2) {
      const parts = line.split(NOPAREN_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) return parts;
    }

    return [line];
  }

  return blocks.map((block) => {
    const newLines = [];
    const newRawOpts = [];

    for (const line of block.lines) {
      const parts = maybeSplit(line);
      if (parts.length > 1) newRawOpts.push(...parts);
      else newLines.push(line);
    }

    for (const line of block.rawOpts) {
      newRawOpts.push(...maybeSplit(line));
    }

    return { ...block, lines: newLines, rawOpts: newRawOpts };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 main — extractOptions (v2.8)
// ─────────────────────────────────────────────────────────────────────────────

function extractOptions(blocks) {
  return blocks.map((block) => {
    const options = [];
    const continuation = [];
    let afterOptions = false;
    let incompleteOption = null;

    const allOptLines = [...block.rawOpts];

    for (let i = 0; i < allOptLines.length; i++) {
      const line = allOptLines[i];
      const opt = parseOptionLine(line);

      if (opt) {
        if (incompleteOption) {
          options.push(incompleteOption);
          incompleteOption = null;
        }

        if (opt.val === "[formula]" || opt.val.length < 2) {
          if (i + 1 < allOptLines.length) {
            const nextLine = allOptLines[i + 1].trim();
            if (!/^(?:\([A-Da-d]\)|[A-Da-d][.):])\s*/.test(nextLine)) {
              opt.val = preserveMathSymbols(nextLine);
              i++;
            } else {
              incompleteOption = opt;
              continue;
            }
          }
        }

        options.push(opt);
        afterOptions = true;
      } else if (!afterOptions) {
        continuation.push(line);
      } else {
        if (options.length > 0) {
          const lastOpt = options[options.length - 1];
          if (lastOpt.val !== "[formula]") {
            lastOpt.val += " " + preserveMathSymbols(line.trim());
          }
        }
      }
    }

    if (incompleteOption) {
      options.push(incompleteOption);
    }

    return {
      ...block,
      lines: [...block.lines, ...continuation],
      // ⭐ Options WITHOUT A/B/C/D labels
      options: options.map(o => o.val),
    };
  });
}

module.exports = {
  detectQuestionBlocks,
  splitInlineOptions,
  extractOptions,
  mergeOptionsLists,
};