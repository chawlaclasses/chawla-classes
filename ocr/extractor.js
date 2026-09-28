/**
 * ocr/extractor.js
 *
 * Text extraction pipeline for PDF files.
 *
 * Priority chain (best quality first):
 *   1. pdftotext (Poppler CLI)   — fastest, best layout preservation
 *   2. pdf-parse (Node library)  — fallback when pdftotext unavailable
 *   3. Tesseract OCR             — last resort for scanned/image PDFs
 *
 * OCR is used ONLY when the first two methods produce garbled or empty output.
 */

"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const { execFile, exec } = require("child_process");
const { promisify }      = require("util");

const { MAX_OCR_PAGES, OCR_CONCURRENCY, UPLOADS_DIR, DEBUG_PDF } = require("../config");
const { withTimeout, isGarbled, cleanupDir } = require("../utils/helpers");
const logger = require("../utils/logger");

const execFileAsync = promisify(execFile);
const execAsync     = promisify(exec);

// ── Lazy-load pdf-parse to avoid startup crash on missing native deps ─────────
let _pdfParse = null;
function getPdfParse() {
  if (_pdfParse !== null) return _pdfParse;
  try { _pdfParse = require("pdf-parse"); }
  catch (_) { logger.warn("pdf-parse not available"); _pdfParse = false; }
  return _pdfParse;
}

// ── Lazy-load Tesseract ───────────────────────────────────────────────────────
let _Tesseract = null;
function getTesseract() {
  if (_Tesseract !== null) return _Tesseract;
  try { _Tesseract = require("tesseract.js"); }
  catch (_) { logger.warn("tesseract.js not available"); _Tesseract = false; }
  return _Tesseract;
}

// ── Lazy-load pdf-poppler ─────────────────────────────────────────────────────
let _pdfPoppler = null;
function getPdfPoppler() {
  if (_pdfPoppler !== null) return _pdfPoppler;
  try { _pdfPoppler = require("pdf-poppler"); }
  catch (_) { logger.warn("pdf-poppler not available"); _pdfPoppler = false; }
  return _pdfPoppler;
}

// ── Check CLI tools ───────────────────────────────────────────────────────────
async function commandExists(cmd) {
  try {
    const probe = process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`;
    await execAsync(probe);
    return true;
  } catch (_) { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Method 1: pdftotext
// ─────────────────────────────────────────────────────────────────────────────
async function extractWithPdftotext(filePath) {
  try {
    if (!(await commandExists("pdftotext"))) return null;

    const result = await withTimeout(
      execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"], {
        maxBuffer: 10 * 1024 * 1024,
      }),
      30_000,
      "pdftotext timed out"
    );

    return result.stdout || null;
  } catch (err) {
    logger.warn(`pdftotext failed: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Method 2: pdf-parse
// ─────────────────────────────────────────────────────────────────────────────

/** Custom page renderer that preserves spatial layout by tracking x/y positions. */
async function customPageRender(pageData) {
  const items = (
    await pageData.getTextContent({ normalizeWhitespace: false })
  ).items || [];

  if (!items.length) return "";

  let result = "", lastX = null, lastW = 0, lastY = null;

  for (const item of items) {
    const str = item.str || "";
    if (!str) continue;

    const x = item.transform?.[4] || 0;
    const y = item.transform?.[5] || 0;
    const w = item.width || 0;

    if (lastY !== null) {
      if (Math.abs(y - lastY) > 5) {
        result += "\n";
        lastX = null;
      } else if (lastX !== null && x - (lastX + lastW) > 2) {
        result += " ";
      }
    }

    result += str;
    lastX = x;
    lastW = w;
    lastY = y;
  }

  return result + "\n";
}

async function extractWithPdfParse(buffer) {
  const mod = getPdfParse();
  if (!mod) return null;

  // Suppress noisy pdf-parse console output
  const _w = console.warn, _e = console.error;
  const NOISE = /TT:|Warning: TT|OPS\.\d|GetOperatorList|invalid/i;
  console.warn  = (...a) => { if (!NOISE.test(String(a[0] || ""))) _w.apply(console, a); };
  console.error = (...a) => { if (!NOISE.test(String(a[0] || ""))) _e.apply(console, a); };

  try {
    let data;
    if (typeof mod === "function") {
      data = await mod(buffer, { pagerender: customPageRender });
    } else if (mod.PDFParse) {
      const p = new mod.PDFParse();
      data = await p.parse(buffer, { pagerender: customPageRender });
    } else {
      return null;
    }

    return (data.text || "")
      .replace(/[\u0001-\u0009\u000B\u000C\u000E-\u001F]/g, " ")
      .replace(/[ \t]{2,}/g, " ");
  } finally {
    console.warn = _w;
    console.error = _e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Method 3: Tesseract OCR
// ─────────────────────────────────────────────────────────────────────────────

async function getPdfPageCount(filePath) {
  try {
    const mod = getPdfParse();
    if (!mod) return 0;
    const data = await mod(fs.readFileSync(filePath));
    return data.numpages || 0;
  } catch (_) { return 0; }
}

async function ocrOnePage(imagePath, pageNum) {
  const Tesseract = getTesseract();
  if (!Tesseract) return { pageNum, text: `[OCR unavailable for page ${pageNum}]` };

  try {
    const result = await withTimeout(
      Tesseract.recognize(imagePath, "eng+hin"),
      300_000,
      `OCR page ${pageNum} timed out`
    );
    return { pageNum, text: result.data.text || "" };
  } catch (err) {
    logger.error(`OCR page ${pageNum} failed: ${err.message}`);
    return { pageNum, text: `[OCR failed for page ${pageNum}]` };
  }
}

async function extractWithOCR(pdfPath) {
  let outputDir = null;

  try {
    const pdfPoppler = getPdfPoppler();
    if (!pdfPoppler) {
      throw new Error("pdf-poppler not available for OCR conversion");
    }

    const pageCount = await getPdfPageCount(pdfPath);
    if (pageCount > MAX_OCR_PAGES) {
      throw new Error(`PDF has ${pageCount} pages, exceeds max ${MAX_OCR_PAGES}`);
    }

    outputDir = path.join(
      UPLOADS_DIR,
      `ocr-${Date.now()}-${crypto.randomInt(100_000, 999_999)}`
    );
    fs.mkdirSync(outputDir, { recursive: true });

    // Convert all pages to PNG in one Poppler call
    await withTimeout(
      pdfPoppler.convert(pdfPath, {
        format:     "png",
        out_dir:    outputDir,
        out_prefix: "page",
        page:       null,
      }),
      120_000,
      "PDF page conversion timed out"
    );

    const files       = fs.readdirSync(outputDir).filter((f) => f.endsWith(".png")).sort();
    const pagesToRead = Math.min(files.length, MAX_OCR_PAGES);

    if (DEBUG_PDF) logger.debug(`[OCR] ${pagesToRead} pages, concurrency=${OCR_CONCURRENCY}`);

    // Parallel OCR with a bounded sliding window
    const pageResults = new Array(pagesToRead);

    for (let start = 0; start < pagesToRead; start += OCR_CONCURRENCY) {
      const end     = Math.min(start + OCR_CONCURRENCY, pagesToRead);
      const chunk   = files.slice(start, end);
      const promises = chunk.map((file, idx) =>
        ocrOnePage(path.join(outputDir, file), start + idx + 1)
      );
      const results = await Promise.all(promises);

      for (const r of results) pageResults[r.pageNum - 1] = r.text;

      if (DEBUG_PDF) logger.debug(`[OCR] Pages ${start + 1}–${end} done`);
    }

    const fullText = pageResults
      .map((t, i) => t || `[OCR skipped page ${i + 1}]`)
      .join("\n");

    if (DEBUG_PDF) logger.debug(`[OCR] Total chars: ${fullText.length}`);

    return { text: fullText, outputDir };
  } catch (err) {
    logger.error(`OCR failed: ${err.message}`);
    cleanupDir(outputDir);
    return { text: "", outputDir: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry — tries methods in priority order
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract text from a PDF file using the best available method.
 *
 * @param {string} filePath  Absolute path to the PDF
 * @returns {{ text: string, method: string, ocrOutputDir: string|null }}
 */
// ─────────────────────────────────────────────────────────────────────────────
// Main entry — tries methods in priority order
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract text from a PDF file using the best available method.
 *
 * @param {string} filePath  Absolute path to the PDF
 * @param {object} options   { forcePdftotext: boolean, preferLayout: boolean }
 * @returns {{ text: string, method: string, ocrOutputDir: string|null }}
 */
// ─────────────────────────────────────────────────────────────────────────────
// Main entry — tries methods in priority order
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract text from a PDF file using the best available method.
 *
 * @param {string} filePath  Absolute path to the PDF
 * @param {object} options   { forcePdftotext: boolean, preferLayout: boolean }
 * @returns {{ text: string, method: string, ocrOutputDir: string|null }}
 */
async function extractText(filePath, options = {}) {
  const { forcePdftotext = false, preferLayout = false } = options;
  
  logger.debug(`[PDF] extractText called with options:`, { forcePdftotext, preferLayout });

  // ⭐ 1. FORCE pdftotext with -layout (for Accounts/table PDFs)
  if (forcePdftotext || preferLayout) {
    const ptText = await extractWithPdftotext(filePath);
    if (ptText) {
      logger.debug("[PDF] ✅ Using pdftotext with -layout (table mode)");
      return { text: ptText, method: "pdftotext-layout", ocrOutputDir: null };
    }
  }

  // 2. pdftotext (already has -layout, but try again just in case)
  const ptText = await extractWithPdftotext(filePath);
  if (ptText && !isGarbled(ptText)) {
    if (DEBUG_PDF) logger.debug("[PDF] Using pdftotext");
    return { text: ptText, method: "pdftotext", ocrOutputDir: null };
  }

  // 3. pdf-parse
  try {
    const buffer = fs.readFileSync(filePath);
    const ppText = await extractWithPdfParse(buffer);
    if (ppText && !isGarbled(ppText)) {
      if (DEBUG_PDF) logger.debug("[PDF] Using pdf-parse");
      return { text: ppText, method: "pdf-parse", ocrOutputDir: null };
    }
  } catch (err) {
    logger.warn(`pdf-parse read failed: ${err.message}`);
  }

  // 4. Tesseract OCR
  if (DEBUG_PDF) logger.debug("[PDF] Falling back to OCR");
  const { text, outputDir } = await extractWithOCR(filePath);
  return { text: text || "", method: "ocr", ocrOutputDir: outputDir };
}

module.exports = {
  extractText,
  // isGarbled ab helpers se import ho raha hai, yahan se nahi
};
