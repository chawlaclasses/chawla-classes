/**
 * controllers/pdfController.js
 *
 * Handles PDF/TXT upload, text extraction, and question parsing.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const { uploadPdf }             = require("../middleware/upload");
const { extractText }           = require("../ocr/extractor");
const { parseQuestionsFromText } = require("../parser");
const { isGarbled }             = require("../utils/helpers");
const { cleanupFile, cleanupDir, safePath } = require("../utils/helpers");
const { UPLOADS_DIR }           = require("../config");
const logger                    = require("../utils/logger");

// ── ⭐ skipHeaderPages — Remove cover page, P.T.O., page numbers, Q.P. Code ──

function skipHeaderPages(text) {
    if (!text || typeof text !== "string") return text || "";
    
    const lines = text.split('\n');
    let startIndex = 0;
    
    const headerPatterns = [
        /Page\s+\d+\s+of\s+\d+/i,
        /P\.?T\.?O\.?/i,
        /TURN\s+OVER/i,
        /Q\.P\.\s*Code/i,
        /Q\.P\. Code/i,
        /àiZ-nl\s+H\$moS>/i,
        /AZwH\$_m\$§H\$/,
        /Series\s+[A-Z0-9]+/i,
        /SET\s+[A-Z0-9]+/i,
        /Candidates\s+must\s+write/i,
        /answer-book/i,
        /^[0-9,\s.]+$/,
        /^[0-9]{1,3}\s*\/\s*[0-9]{1,3}$/,
        /^\s*$/,
        /Please\s+check\s+that/i,
        /contains\s+\d+\s+printed\s+pages/i,
        /This\s+question\s+paper\s+contains/i,
        /àíZ-nÌ\s+H\$moS>/,
        /narjmWu/,
        /CÎma-nwpñVH$m/,
        /67\/2\/1/,
        /^\d{3}\s*$/,
    ];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        let isHeader = false;
        for (const pattern of headerPatterns) {
            if (pattern.test(line)) {
                isHeader = true;
                break;
            }
        }
        
        if (!isHeader && /[àáâãäåæçèéêëìíîï]/.test(line)) {
            if (!/Q\.?\s*\d+/.test(line) && !/àiZ-nl\s*\d+/.test(line) && !/प्रश्न\s*\d+/.test(line)) {
                if (line.length < 100) {
                    isHeader = true;
                }
            }
        }
        
        if (!isHeader) {
            startIndex = i;
            break;
        }
    }
    
    if (startIndex === 0) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^Q\.?\s*\d+/.test(line) || 
                /^àiZ-nl\s*\d+/.test(line) || 
                /^प्रश्न\s*\d+/.test(line) ||
                /^\d+\.\s+[A-Z]/.test(line)) {
                startIndex = i;
                break;
            }
        }
    }
    
    if (startIndex === 0) {
        return text;
    }
    
    return lines.slice(startIndex).join('\n');
}

// ── Shared cleanup helper ─────────────────────────────────────────────────────

function cleanupOrphans() {
  try {
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    for (const entry of fs.readdirSync(UPLOADS_DIR)) {
      if (!entry.startsWith("ocr-")) continue;
      const dp = safePath(UPLOADS_DIR, entry);
      if (dp && fs.existsSync(dp) && now - fs.statSync(dp).mtimeMs > ONE_DAY) {
        fs.rmSync(dp, { recursive: true, force: true });
        logger.info(`[Cleanup] Removed orphan OCR dir: ${entry}`);
      }
    }
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /preview-pdf
// ─────────────────────────────────────────────────────────────────────────────

function previewPdf(req, res) {
   // ⭐ Safely get accountsMode from request body
  const accountsMode = req.body && req.body.accountsMode === 'true';
  
  uploadPdf.single("pdf")(req, res, async (uploadErr) => {
    if (uploadErr) {
      cleanupFile(req.file?.path);
      return res.status(400).json({ success: false, message: uploadErr.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const tempPath = req.file.path;
    let ocrOutputDir = null;
    let rawText = "";

    try {
      if (!fs.existsSync(tempPath)) {
        throw new Error("File not found on server");
      }

      const fileExt = path.extname(req.file.originalname).toLowerCase();

      if (fileExt === ".txt") {
        rawText = fs.readFileSync(tempPath, "utf-8");
        logger.debug(`[PDF Controller] TXT file loaded: ${req.file.originalname}`);
      } else {
        // ⭐ Pass accountsMode to extractText
        const result = await extractText(tempPath, { 
          forcePdftotext: accountsMode,
          preferLayout: accountsMode
        });
        rawText = result.text;
        ocrOutputDir = result.ocrOutputDir || null;
        logger.debug(`[PDF Controller] Extraction method: ${result.method}`);
      }

      if (!rawText || rawText.trim().length < 50) {
        return res.json({
          success: false,
          message: "Unable to extract readable text from this file.",
        });
      }

      let questionCount   = 0;
      let sampleQuestions = [];

      try {
        const parsed = parseQuestionsFromText(rawText);
        questionCount = parsed.length;
        sampleQuestions = parsed.slice(0, 3).map((q) => ({
          question: q.question,
          type:     q.type,
          subtype:  q.subtype,
          options:  q.options,
          marks:    q.marks,
          hasTable: q.hasTable,
        }));
      } catch (_) {}

      const preview =
        rawText.slice(0, 500) + (rawText.length > 500 ? "\n…(truncated)" : "");

      return res.json({
        success: true,
        method: fileExt === ".txt" ? "text-file" : "pdf-parse",
        preview,
        fullText:      rawText,
        totalLength:   rawText.length,
        questionCount,
        sampleQuestions,
        hasContent: rawText.trim().length > 50,
      });
    } catch (err) {
      logger.error(`Preview error: ${err.message}`);
      return res.status(500).json({ success: false, message: err.message });
    } finally {
      cleanupFile(tempPath);
      cleanupDir(ocrOutputDir);
      cleanupOrphans();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /import-pdf-questions
// ─────────────────────────────────────────────────────────────────────────────

function importPdfQuestions(req, res) {
  console.log("📥 [PDF IMPORT] Started");
  
  uploadPdf.single("pdf")(req, res, async (uploadErr) => {
    if (uploadErr) {
      cleanupFile(req.file?.path);
      return res.status(400).json({ success: false, message: uploadErr.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const tempPath = req.file.path;

    if (!safePath(UPLOADS_DIR, req.file.filename)) {
      cleanupFile(tempPath);
      return res.status(400).json({ success: false, message: "Invalid upload path" });
    }

    const meta = {
      class:   req.body?.class   || "10",
      subject: req.body?.subject || "Accountancy",
      chapter: req.body?.chapter || "",
    };

    let ocrOutputDir = null;
    let rawText = "";

    try {
      if (!fs.existsSync(tempPath)) {
        throw new Error("File not found on server");
      }

      const fileExt = path.extname(req.file.originalname).toLowerCase();
      console.log("📥 [PDF IMPORT] File extension:", fileExt);

      if (fileExt === ".txt") {
        rawText = fs.readFileSync(tempPath, "utf-8");
        console.log("📥 [PDF IMPORT] TXT loaded, length:", rawText.length);
      } else {
        // ⭐ FIX: Force pdftotext for all PDFs
        const result = await extractText(tempPath, { 
          forcePdftotext: true,
          preferLayout: true 
        });
        rawText = result.text;
        ocrOutputDir = result.ocrOutputDir || null;
        console.log("📥 [PDF IMPORT] Extraction method:", result.method);
        console.log("📥 [PDF IMPORT] Text length:", rawText.length);
        console.log("📥 [PDF IMPORT] Text preview:", rawText.slice(0, 300));
      }

      if (!rawText || rawText.trim().length < 100) {
        return res.json({
          success: false,
          message: "Unable to extract sufficient text from this file.",
          preview: rawText?.slice(0, 500) || "No text extracted",
        });
      }

      const questions = parseQuestionsFromText(rawText, meta);

      if (questions.length === 0) {
        return res.json({
          success: false,
          message: "No questions could be parsed from the file. Try DEBUG_PDF=true for verbose output.",
          preview: rawText.slice(0, 1000),
          method: fileExt === ".txt" ? "text-file" : "pdf-parse",
        });
      }

      console.log("✅ [PDF IMPORT] Returning", questions.length, "questions");
      return res.json({ success: true, questions, method: fileExt === ".txt" ? "text-file" : "pdf-parse" });
      
    } catch (err) {
      logger.error(`Import error: ${err.message}`);
      return res.status(500).json({ success: false, message: err.message });
    } finally {
      cleanupFile(tempPath);
      cleanupDir(ocrOutputDir);
      cleanupOrphans();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /import-text-questions
// ─────────────────────────────────────────────────────────────────────────────

function importTextQuestions(req, res) {
  console.log("📥 [DEBUG] importTextQuestions called");
  console.log("📥 [DEBUG] Body keys:", Object.keys(req.body || {}));
  
  try {
    const rawText = req.body?.text;
    console.log("📥 [DEBUG] Text length:", rawText?.length || 0);
    console.log("📥 [DEBUG] Text preview:", rawText?.slice(0, 200));

    if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
      console.log("❌ [DEBUG] No text provided");
      return res.status(400).json({ success: false, message: "No text provided" });
    }

    if (rawText.trim().length < 100) {
      console.log("❌ [DEBUG] Text too short:", rawText.trim().length);
      return res.json({
        success: false,
        message: "Unable to extract sufficient text from the provided content.",
      });
    }

    console.log("📥 [DEBUG] Calling skipHeaderPages...");
    const textWithoutHeader = skipHeaderPages(rawText);
    console.log("📥 [DEBUG] After header removal:", textWithoutHeader.length, "chars");

    const meta = {
      class:   req.body?.class   || "10",
      subject: req.body?.subject || "Accountancy",
      chapter: req.body?.chapter || "",
    };

    console.log("📥 [DEBUG] Calling parseQuestionsFromText...");
    const questions = parseQuestionsFromText(textWithoutHeader, meta);
    console.log("📥 [DEBUG] Questions parsed:", questions.length);

    if (questions.length === 0) {
      console.log("⚠️ [DEBUG] No questions found");
      return res.json({
        success: false,
        message: "No questions could be parsed from the text.",
        preview: rawText.slice(0, 1000),
        cleanedPreview: textWithoutHeader.slice(0, 1000),
        method: "text",
        headerRemoved: textWithoutHeader.length < rawText.length,
      });
    }

    // ⭐ Save to database using bulkSave
    try {
      const { bulkSave } = require('../services/questions');
      const result = bulkSave(questions);
      console.log("✅ [DEBUG] Saved to database:", result.saved, "saved,", result.skipped, "skipped");
    } catch (saveErr) {
      console.warn("⚠️ [DEBUG] Could not save to database:", saveErr.message);
      // Continue anyway — return questions even if save fails
    }

    console.log("✅ [DEBUG] Success! Returning", questions.length, "questions");
    return res.json({ success: true, questions, method: "text" });
    
  } catch (err) {
    console.error("❌ [DEBUG] importTextQuestions ERROR:", err);
    console.error("❌ [DEBUG] Stack:", err.stack);
    return res.status(500).json({ 
      success: false, 
      message: err.message,
      stack: err.stack 
    });
  }
}

module.exports = { previewPdf, importPdfQuestions, importTextQuestions };