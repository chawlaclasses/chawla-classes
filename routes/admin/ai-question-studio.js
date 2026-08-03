// routes/admin/ai-question-studio.js
//
// AI Question Studio — a single, guided workflow that replaces having to
// separately use AI Tools (routes/admin/ai-v2.js) + Import Questions
// (routes/import.js) + the Question Bank's manual "Add Question" form,
// each with their own shape and their own gaps (ai-v2 only does MCQ and
// saves straight to Draft with no preview; import.js can't infer answer
// keys and also saves straight to the bank).
//
// Everything here follows one rule, stated explicitly in the spec this
// was built from:
//
//     Generate -> Preview -> Admin Review -> Approve -> Save
//     Only approved questions are stored permanently.
//
// So every route in this file except /save is READ-ONLY with respect to
// the 'questions' collection — /generate, /extract, /duplicate-check and
// /export only ever return data for the browser to hold in memory while
// the admin reviews it. /save is the one place anything is written, and
// it only writes items the request explicitly marks approved:true.
//
// Reuses, rather than duplicates:
//   - services/ai/aiStudioBatchGenerator.js + aiStudioProvider.js       (AI Generate)
//   - parser/ (parseQuestionsFromText) + ocr/extractor.js + mammoth      (PDF Import / Text Input)
//   - tesseract.js directly, same "eng+hin" config as ocr/extractor.js   (Image OCR)
//   - utils/textSimilarity.js (jaccardSimilarity) — same algorithm the
//     Question Bank's own /duplicate-check already uses
//   - utils/reportGenerator.js (createPdfDoc/renderHeader/sendPdf/...)   (PDF export)
//   - config/questionWorkflow.js status vocabulary (draft/review/approved)
//   - utils/questionHistory.js + utils/auditLog.js                      (same audit trail as every other question-writing route)

"use strict";

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { recordQuestionHistory } = require('../../utils/questionHistory');
const { requirePermission } = require('../../middleware/permissions');
const { hasPermission } = require('../../config/permissions');
const { jaccardSimilarity } = require('../../utils/textSimilarity');
const { generateUUID } = require('../../utils/helpers');

const aiStudioBatchGenerator = require('../../services/ai/aiStudioBatchGenerator');
const { extractText } = require('../../ocr/extractor');
const { parseQuestionsFromText } = require('../../parser');

const MAX_TOTAL_QUESTIONS = 100; // per generation request — sane upper bound for a single Studio run

// ---------------------------------------------------------------------------
// File upload (PDF Import / Image OCR sources) — same limits/pattern as
// routes/import.js, kept independent since that file's `upload` instance
// isn't exported.
// ---------------------------------------------------------------------------
const uploadDir = path.join(__dirname, '../../uploads');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, `studio-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const fileFilter = (req, file, cb) => {
    const allowed = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain', 'image/png', 'image/jpeg', 'image/webp',
    ];
    if (allowed.includes(file.mimetype) || file.mimetype === 'application/msword') cb(null, true);
    else cb(new Error('Only PDF, DOCX, TXT, PNG, JPEG, or WEBP files are allowed'), false);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 15 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Same "topic descriptor" idea as ai-v2.js's resolveChapterDescriptor —
// kept as its own small copy here rather than importing a function
// ai-v2.js doesn't export, per "don't rename/restructure existing files".
function buildTopicDescriptor(academic = {}) {
    const parts = [];
    const chapter = (academic.chapter || '').toString().trim();
    const topic = (academic.topic || '').toString().trim();
    const subTopic = (academic.subTopic || '').toString().trim();
    parts.push(chapter ? `the chapter "${chapter}"` : 'the given topic');
    if (topic) parts.push(`focused on "${topic}"`);
    if (subTopic) parts.push(`specifically "${subTopic}"`);
    if (academic.subjectName) parts.push(`for ${academic.subjectName}`);
    if (academic.classLevel) parts.push(academic.classLevel);
    if (academic.book) parts.push(`(from "${academic.book}")`);
    if (academic.examType) parts.push(`prepared for ${academic.examType}`);
    let descriptor = parts.join(' ');
    if (academic.learningOutcome) descriptor += `. The learning outcome to target: ${academic.learningOutcome}`;
    return descriptor;
}

function normalizeDifficultyMix(dist = {}) {
    const mix = { easy: 0, medium: 0, hard: 0, very_hard: 0 };
    for (const d of Object.keys(mix)) mix[d] = Math.max(0, parseInt(dist[d], 10) || 0);
    return mix;
}

// Maps a Studio "Save Destination" (Section 12) to the existing
// config/questionWorkflow.js status vocabulary. "Question Bank" is only
// reachable for items the admin approved in Preview (Section 13) — the
// approval click *is* the "Admin Review -> Approve" step the workflow
// diagram calls for, so saving those straight to 'approved' does not
// skip review, it records that review already happened.
const DESTINATION_STATUS = {
    draft: 'draft',
    review_queue: 'draft', // draft + generatedByAI is exactly what makes a question show up in the AI Review Queue (routes/admin/ai-review-queue.js's isQueued())
    question_bank: 'approved',
    export_only: null, // never written to the DB
};

function mapQuestionTypeLabel(rawType) {
    // parser/build.js's classifyQuestion() vocabulary -> Studio's kebab-case types
    if (!rawType) return 'subjective';
    const t = String(rawType).toLowerCase();
    if (t === 'mcq') return 'mcq';
    if (t === 'casestudy' || t === 'case-study') return 'case-study';
    return 'subjective';
}

// ---------------------------------------------------------------------------
// POST /generate  — Section 1 "AI Generate" source.
// Body: { academic:{}, generation:{numQuestions, marksEach, bloom:{}},
//         questionTypes:[], pattern, difficultyDistribution:{}, prompt,
//         advanced:{}, negativeInstructions:[], tags:[], language }
// Returns generated questions for Preview. NOTHING is saved here.
// ---------------------------------------------------------------------------
router.post('/generate', requirePermission('ai:generate'), async (req, res) => {
    try {
        const { academic = {}, generation = {}, questionTypes, pattern, difficultyDistribution, prompt,
            advanced = {}, negativeInstructions, tags, language } = req.body;

        if (!academic.chapter && !academic.topic) {
            return res.status(400).json({ success: false, message: 'Chapter or Topic is required to generate questions' });
        }

        let subjectName = academic.subjectName;
        let classLevel = academic.classLevel;
        if (academic.subjectId) {
            const subject = db.findById('subjects', academic.subjectId);
            if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });
            subjectName = subjectName || subject.name;
        }
        if (academic.classId) {
            const classData = db.findById('classes', academic.classId);
            if (!classData) return res.status(404).json({ success: false, message: 'Class not found' });
            classLevel = classLevel || classData.displayName || classData.name;
        }

        const topicDescriptor = buildTopicDescriptor({ ...academic, subjectName, classLevel });
        const difficultyMix = normalizeDifficultyMix(difficultyDistribution);
        const totalRequested = Object.values(difficultyMix).reduce((a, b) => a + b, 0);

        if (totalRequested <= 0) {
            return res.status(400).json({ success: false, message: 'Difficulty Distribution must add up to at least 1 question' });
        }
        if (totalRequested > MAX_TOTAL_QUESTIONS) {
            return res.status(400).json({ success: false, message: `Cannot request more than ${MAX_TOTAL_QUESTIONS} questions in one run` });
        }
        const requestedCount = parseInt(generation.numQuestions, 10) || totalRequested;
        const distributionWarning = requestedCount !== totalRequested
            ? `Difficulty Distribution totals ${totalRequested}, not the requested ${requestedCount} — generated ${totalRequested}.`
            : null;

        const spec = {
            pattern, bloom: generation.bloom, advanced, negativeInstructions, tags, language, prompt,
        };

        const { questions, requested, generated, cells } = await aiStudioBatchGenerator.generateStudioQuestions({
            topicDescriptor,
            questionTypes: Array.isArray(questionTypes) && questionTypes.length ? questionTypes : ['mcq'],
            difficultyMix,
            spec,
        });

        // Attach marks/chapter tagging now — the provider doesn't know
        // the admin's chosen marks-per-question or content hierarchy.
        const marksEach = parseInt(generation.marksEach, 10) || 1;
        questions.forEach(q => {
            q.marks = q.marks || marksEach;
            q.chapter = academic.chapter || '';
            q.book = academic.book || '';
            q.topic = academic.topic || '';
            q.subTopic = academic.subTopic || '';
            q.learningOutcome = academic.learningOutcome || '';
            q.subjectId = academic.subjectId || null;
            q.classId = academic.classId || null;
            q.tags = Array.isArray(tags) ? tags : [];
            q.source = 'ai-generate';
            q.approved = false;
            q.rejected = false;
            q.bookmarked = false;
        });

        logAudit(req, 'create', 'question', null, `AI Question Studio generated ${generated}/${requested} question(s) on "${academic.chapter || academic.topic}" (preview only, not yet saved)`);

        res.json({
            success: true,
            data: { questions, requested, generated, cells },
            message: generated < requested
                ? `${generated} of ${requested} requested question(s) generated for preview (some batches could not be completed after retries).`
                : `${generated} question(s) generated — review and approve them below before saving.`,
            warning: distributionWarning,
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong while generating questions. Please try again.' });
    }
});

// ---------------------------------------------------------------------------
// POST /regenerate — Preview step's per-card "Regenerate" action (Section 13).
// Body: { type, difficulty, academic:{}, spec fields..., excludeTexts:[] }
// ---------------------------------------------------------------------------
router.post('/regenerate', requirePermission('ai:generate'), async (req, res) => {
    try {
        const { type = 'mcq', difficulty = 'medium', academic = {}, pattern, bloom, advanced, negativeInstructions, tags, language, prompt, excludeTexts } = req.body;

        const topicDescriptor = buildTopicDescriptor(academic);
        const { questions } = await aiStudioBatchGenerator.generateStudioQuestions({
            topicDescriptor,
            questionTypes: [type],
            difficultyMix: { [difficulty]: 1 },
            spec: { pattern, bloom, advanced, negativeInstructions, tags, language, prompt, excludeTexts },
        });

        if (!questions.length) {
            return res.status(503).json({ success: false, message: 'Could not regenerate a replacement question. Please try again.' });
        }

        const q = questions[0];
        q.marks = q.marks || 1;
        q.chapter = academic.chapter || '';
        q.subjectId = academic.subjectId || null;
        q.classId = academic.classId || null;
        q.tags = Array.isArray(tags) ? tags : [];
        q.source = 'ai-generate';
        q.approved = false;
        q.rejected = false;
        q.bookmarked = false;

        res.json({ success: true, data: q, message: 'Question regenerated' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ---------------------------------------------------------------------------
// POST /extract — Section 1 "PDF Import" / "Image OCR" / "Text Input" sources.
// multipart/form-data with a `file`, OR JSON body { text: "..." } for
// pasted Text Input. Always returns Preview items, never saves.
// ---------------------------------------------------------------------------
router.post('/extract', requirePermission('ai:generate'), upload.single('file'), async (req, res) => {
    let filePath = null;
    try {
        const chapter = req.body.chapter || '';
        const subject = req.body.subjectName || 'General';
        const classLevel = req.body.classLevel || '10';
        let rawText = '';
        let source = 'text-input';

        if (req.file) {
            filePath = req.file.path;
            const ext = path.extname(req.file.originalname).toLowerCase();

            if (ext === '.pdf') {
                source = 'pdf-import';
                const { text } = await extractText(filePath); // pdftotext -> pdf-parse -> OCR fallback, handled internally
                rawText = text || '';
            } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext) || (req.file.mimetype || '').startsWith('image/')) {
                source = 'image-ocr';
                rawText = await ocrImageFile(filePath);
            } else if (ext === '.docx') {
                source = 'pdf-import';
                const docxResult = await mammoth.extractRawText({ buffer: fs.readFileSync(filePath) });
                rawText = docxResult.value || '';
            } else if (ext === '.txt') {
                source = 'pdf-import';
                rawText = fs.readFileSync(filePath, 'utf8');
            } else {
                return res.status(400).json({ success: false, message: 'Unsupported file format. Please upload PDF, DOCX, TXT, or an image.' });
            }
        } else if (req.body.text && req.body.text.trim()) {
            rawText = req.body.text;
            source = 'text-input';
        } else {
            return res.status(400).json({ success: false, message: 'Upload a file or paste text to extract questions from.' });
        }

        if (!rawText || rawText.trim().length < 20) {
            return res.status(422).json({ success: false, message: 'No readable text could be extracted. Try a clearer scan/photo, or paste the text directly.' });
        }

        const parsed = parseQuestionsFromText(rawText, { subject, chapter, class: classLevel });

        const questions = parsed.map(p => ({
            tempId: p.id || generateUUID(),
            questionText: p.question,
            type: mapQuestionTypeLabel(p.type),
            options: (p.options || []).map(text => ({ text, isCorrect: false })),
            correctAnswer: '',
            difficulty: 'medium',
            marks: p.marks || 1,
            chapter: chapter || p.chapter || '',
            explanation: '',
            source,
            aiConfidence: null,
            qualityScore: null,
            estimatedAccuracy: null,
            needsAnswerKey: (p.type || '').toLowerCase() === 'mcq', // extracted MCQs have no inferred answer key — admin must mark the correct option before this can be approved
            approved: false,
            rejected: false,
            bookmarked: false,
            tags: [],
        }));

        res.json({
            success: true,
            data: { questions, totalExtracted: questions.length, source, rawTextPreview: rawText.slice(0, 500) },
            message: questions.length
                ? `${questions.length} question(s) extracted for preview — review and fill in any missing answer keys before saving.`
                : 'No question-like content was detected in this file.',
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong while extracting questions. Please try again.' });
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (_) { /* best-effort cleanup */ }
        }
    }
});

// Direct tesseract.js call for a single image file — same "eng+hin" language
// pack combination ocr/extractor.js's (unexported) ocrOnePage() uses for PDF
// page images, applied here to a standalone photo/scan instead of a PDF page.
async function ocrImageFile(imagePath) {
    let Tesseract;
    try {
        Tesseract = require('tesseract.js');
    } catch (_) {
        return '';
    }
    try {
        const result = await Tesseract.recognize(imagePath, 'eng+hin');
        return result?.data?.text || '';
    } catch (err) {
        logger.error(`Image OCR failed: ${err.message}`);
        return '';
    }
}

// ---------------------------------------------------------------------------
// POST /duplicate-check — Section 14. Batch version of the Question Bank's
// existing single-question POST /questions/duplicate-check — same
// algorithm (utils/textSimilarity.js), scoped the same way (subject +
// chapter), just able to check a whole Preview batch in one call instead
// of one request per card.
// Body: { items:[{tempId, questionText}], subjectId, chapter }
// ---------------------------------------------------------------------------
router.post('/duplicate-check', requirePermission('questions:view'), (req, res) => {
    try {
        const { items, subjectId, chapter } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.json({ success: true, data: [] });
        }

        let candidates = db.find('questions', {}).filter(q => q.isActive !== false);
        if (subjectId) candidates = candidates.filter(q => q.subjectId === subjectId);
        if (chapter) candidates = candidates.filter(q => (q.chapter || '').trim().toLowerCase() === String(chapter).trim().toLowerCase());

        const results = items.map(item => {
            if (!item.questionText || !item.questionText.trim()) {
                return { tempId: item.tempId, duplicatePercent: 0, similarityPercent: 0, existingQuestion: null };
            }
            let best = null;
            for (const q of candidates) {
                const similarity = Math.round(jaccardSimilarity(item.questionText, q.questionText) * 100);
                if (!best || similarity > best.similarityPercent) {
                    best = { similarityPercent: similarity, existingQuestion: { _id: q._id, questionText: q.questionText, chapter: q.chapter, status: q.status } };
                }
            }
            return {
                tempId: item.tempId,
                duplicatePercent: best ? best.similarityPercent : 0,
                similarityPercent: best ? best.similarityPercent : 0,
                existingQuestion: best && best.similarityPercent >= 60 ? best.existingQuestion : null,
            };
        });

        res.json({ success: true, data: results });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ---------------------------------------------------------------------------
// POST /save — Section 12/17. The ONLY route in this file that writes to
// the 'questions' collection. Only items with approved:true are persisted;
// everything else is counted in the summary but skipped, so a stray
// generated-but-never-reviewed item can never sneak into the bank.
// Body: { items:[...], destination, tagsOverride:[] }
// ---------------------------------------------------------------------------
router.post('/save', requirePermission('questions:create'), (req, res) => {
    try {
        const { items, destination = 'review_queue' } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'No questions to save' });
        }
        if (!Object.prototype.hasOwnProperty.call(DESTINATION_STATUS, destination)) {
            return res.status(400).json({ success: false, message: `Unknown save destination "${destination}"` });
        }

        // "Question Bank" (status: approved) is the one destination that
        // requires the reviewer's own permission to approve questions —
        // same permission questionWorkflow.js's review->approved
        // transition requires everywhere else in the app. Anyone with
        // questions:create can still send items to Draft/Review Queue.
        if (destination === 'question_bank' && !hasPermission(req.userData?.role, 'questions:approve')) {
            return res.status(403).json({ success: false, message: 'Your role can send questions to the Review Queue, but only a reviewer can save directly to the Question Bank.' });
        }

        const approvedItems = items.filter(it => it.approved === true && it.rejected !== true);
        const rejectedCount = items.filter(it => it.rejected === true).length;
        const duplicatesSkipped = items.filter(it => it.duplicateAction === 'skip').length;

        const status = DESTINATION_STATUS[destination];
        const saved = [];

        if (status !== null) {
            for (const it of approvedItems) {
                if (!it.questionText || !it.questionText.trim()) continue;

                let classId = it.classId || null;
                if (!classId && it.subjectId) {
                    const subject = db.findById('subjects', it.subjectId);
                    classId = subject?.classId || null;
                }

                const doc = db.insertOne('questions', {
                    questionText: it.questionText,
                    type: it.type || 'mcq',
                    chapter: it.chapter || 'Uncategorized',
                    book: it.book || '',
                    topic: it.topic || '',
                    subTopic: it.subTopic || '',
                    learningOutcome: it.learningOutcome || '',
                    subjectId: it.subjectId || null,
                    classId,
                    options: it.options || [],
                    correctAnswer: it.correctAnswer || '',
                    explanation: it.explanation || '',
                    hint: it.hint || '',
                    stepSolution: it.stepSolution || '',
                    diagramSuggestion: it.diagramSuggestion || it.diagramDescription || '',
                    assertion: it.assertion || '',
                    reason: it.reason || '',
                    caseText: it.caseText || '',
                    columnA: it.columnA || undefined,
                    columnB: it.columnB || undefined,
                    correctMapping: it.correctMapping || undefined,
                    unit: it.unit || '',
                    marks: it.marks || 1,
                    difficulty: it.difficulty || 'medium',
                    tags: Array.isArray(it.tags) ? it.tags : [],
                    bookmarked: Boolean(it.bookmarked),
                    status,
                    isActive: true,
                    generatedByAI: it.source === 'ai-generate',
                    aiModuleVersion: it.source === 'ai-generate' ? 'studio' : undefined,
                    importedFrom: it.source && it.source !== 'ai-generate' && it.source !== 'manual' ? it.source : undefined,
                    aiConfidence: it.aiConfidence ?? undefined,
                    qualityScore: it.qualityScore ?? undefined,
                    estimatedAccuracy: it.estimatedAccuracy ?? undefined,
                    createdBy: req.user?.id || 'admin',
                });

                recordQuestionHistory(req, doc._id, 'created', {
                    toStatus: status,
                    summary: `Created via AI Question Studio (source: ${it.source || 'manual'}, destination: ${destination})`,
                });
                saved.push(doc);
            }
        }

        if (saved.length > 0) {
            logAudit(req, 'create', 'question', null, `AI Question Studio saved ${saved.length} question(s) to ${destination} (source(s): ${[...new Set(approvedItems.map(i => i.source || 'manual'))].join(', ')})`);
        }

        const summary = {
            generated: items.length,
            approved: approvedItems.length,
            rejected: rejectedCount,
            duplicates: duplicatesSkipped,
            saved: saved.length,
        };

        res.status(201).json({
            success: true,
            data: { saved, summary, destination },
            message: destination === 'export_only'
                ? `${approvedItems.length} approved question(s) ready for export (not saved to the Question Bank).`
                : `${saved.length} question(s) saved to ${destination === 'question_bank' ? 'Question Bank' : destination === 'draft' ? 'Draft' : 'Review Queue'}.`,
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong while saving. Please try again.' });
    }
});

// ---------------------------------------------------------------------------
// POST /export — Section 11. Only ever operates on items the client
// already holds (Preview/approved items) — never re-reads the DB, so
// "Export Only" truly never touches the Question Bank.
// Body: { items:[...], format: 'json'|'html'|'printable'|'pdf' }
// ---------------------------------------------------------------------------
router.post('/export', requirePermission('questions:view'), async (req, res) => {
    try {
        const { items, format = 'json' } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'No questions to export' });
        }

        if (format === 'json') {
            return res.json({ success: true, data: items });
        }

        if (format === 'html' || format === 'printable') {
            const html = buildPrintableHtml(items);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        }

        if (format === 'pdf') {
            const { createPdfDoc, finalizePdf, renderHeader, sendPdf } = require('../../utils/reportGenerator');
            const { doc, chunks } = createPdfDoc();
            renderHeader(doc, { title: 'AI Question Studio Export', subtitle: `${items.length} question(s)`, meta: [] });
            items.forEach((q, i) => {
                doc.moveDown(0.5);
                doc.fontSize(11).fillColor('#222222').text(`${i + 1}. ${stripHtml(q.questionText || '')}`);
                (q.options || []).forEach((o, idx) => {
                    const label = String.fromCharCode(65 + idx);
                    doc.fontSize(10).fillColor('#444444').text(`   ${label}. ${stripHtml(o.text || o)}`);
                });
                if (q.correctAnswer) doc.fontSize(9).fillColor('#666666').text(`   Answer: ${stripHtml(String(q.correctAnswer))}`);
                if (q.explanation) doc.fontSize(9).fillColor('#666666').text(`   Explanation: ${stripHtml(q.explanation)}`);
            });
            const buffer = await finalizePdf(doc, chunks);
            return sendPdf(res, buffer, `ai-question-studio-export-${Date.now()}.pdf`);
        }

        return res.status(400).json({ success: false, message: `Unknown export format "${format}"` });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong while exporting. Please try again.' });
    }
});

function stripHtml(str) {
    return String(str || '').replace(/<[^>]*>/g, '');
}

function escapeHtmlServer(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildPrintableHtml(items) {
    const body = items.map((q, i) => `
        <div style="margin-bottom:18px;page-break-inside:avoid;">
            <p style="margin:0 0 6px;font-weight:600;">${i + 1}. ${escapeHtmlServer(q.questionText)}</p>
            ${(q.options || []).map((o, idx) => `<p style="margin:0 0 2px 20px;">${String.fromCharCode(65 + idx)}. ${escapeHtmlServer(o.text || o)}</p>`).join('')}
            ${q.correctAnswer ? `<p style="margin:4px 0 0 20px;color:#166534;font-size:13px;">Answer: ${escapeHtmlServer(String(q.correctAnswer))}</p>` : ''}
            ${q.explanation ? `<p style="margin:2px 0 0 20px;color:#555;font-size:13px;">Explanation: ${escapeHtmlServer(q.explanation)}</p>` : ''}
        </div>
    `).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AI Question Studio Export</title>
        <style>body{font-family:Arial,sans-serif;max-width:800px;margin:30px auto;color:#111;}</style>
        </head><body><h2>AI Question Studio — ${items.length} Question(s)</h2>${body}</body></html>`;
}

module.exports = router;
