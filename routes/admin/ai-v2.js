// routes/admin/ai-v2.js
//
// AI Module v2 (Admin) — batch-based question/paper generation designed
// to eliminate the MAX_TOKENS / invalid-JSON failures that large
// single-shot requests hit in the original AI module.
//
// routes/admin/ai.js is NOT modified and keeps working exactly as before.
// This is a brand new, additive module. Same DB shape, same auth
// middleware, same audit logging as ai.js — the difference is entirely
// in *how* questions are requested from the LLM: small batches per
// difficulty, validated, retried on failure, then merged + deduplicated.
//
// WIRING: mount this router separately in routes/adminRoutes.js:
//     router.use('/ai-v2', require('./ai-v2'));
// which exposes /api/admin/ai-v2/generate-questions etc. alongside the
// existing /api/admin/ai/* routes. See README.md for details.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { recalcTestTotals } = require('./_helpers');

const aiBatchGenerator = require('../../services/ai/aiBatchGenerator');
const aiProvider = require('../../services/ai/aiProvider');
const { withRetry } = require('../../services/ai/aiRetry');

const MAX_TOTAL_QUESTIONS = 200; // sane upper bound per request

/**
 * Normalize the two supported request shapes into a single
 * { easy, medium, hard } difficulty mix:
 *   1. { difficultyMix: { easy, medium, hard } }              (preferred — matches the spec's Easy/Medium/Hard breakdown)
 *   2. { difficulty: 'easy'|'medium'|'hard'|'mixed', count }   (legacy-style, same shape the old /generate-questions accepted)
 */
function normalizeDifficultyMix(body) {
    if (body.difficultyMix && typeof body.difficultyMix === 'object') {
        const mix = { easy: 0, medium: 0, hard: 0 };
        for (const d of ['easy', 'medium', 'hard']) {
            mix[d] = Math.max(0, parseInt(body.difficultyMix[d], 10) || 0);
        }
        return mix;
    }

    const requestedCount = Math.max(1, parseInt(body.count, 10) || 5);
    if (!body.difficulty || body.difficulty === 'mixed') {
        // Split as evenly as possible across the three difficulties.
        const base = Math.floor(requestedCount / 3);
        const remainder = requestedCount - base * 3;
        return {
            easy: base + (remainder > 0 ? 1 : 0),
            medium: base + (remainder > 1 ? 1 : 0),
            hard: base,
        };
    }

    const mix = { easy: 0, medium: 0, hard: 0 };
    mix[body.difficulty] = requestedCount;
    return mix;
}

/**
 * Builds one clear "topic descriptor" string for the LLM prompt out of
 * whatever the admin actually provided — chapter NAME, chapter NUMBER,
 * subject, class, board, and any free-text details — so the caller never
 * needs to know the exact chapter name. At least one of `chapter` /
 * `chapterNumber` is required; if only the number is given, subject
 * context is required too (a bare number means nothing on its own).
 *
 * The resolution of "chapter number → actual chapter content" is left to
 * the LLM itself: it already knows standard board syllabi (e.g. CBSE
 * NCERT chapter ordering per class/subject), so handing it a descriptor
 * like "Chapter 5 of Class 10 Science (CBSE)" is enough for it to know
 * exactly which chapter that is and generate strictly from it.
 *
 * @returns {{ ok: true, descriptor: string } | { ok: false, message: string }}
 */
function resolveChapterDescriptor(body, { subjectNameFromId } = {}) {
    const chapterName = (body.chapter || '').toString().trim();
    const chapterNumberRaw = body.chapterNumber;
    const chapterNumber = chapterNumberRaw !== undefined && chapterNumberRaw !== null && chapterNumberRaw !== ''
        ? parseInt(chapterNumberRaw, 10)
        : null;
    const subject = (body.subject || subjectNameFromId || '').toString().trim();
    const classLevel = (body.classLevel || '').toString().trim();
    const board = (body.board || 'CBSE').toString().trim();
    const details = (body.details || '').toString().trim();

    if (!chapterName && !chapterNumber) {
        return { ok: false, message: 'Either "chapter" (name) or "chapterNumber" is required' };
    }
    if (chapterNumber && !chapterName && !subject) {
        return { ok: false, message: 'When only "chapterNumber" is given, "subject" (or subjectId) is required to identify which chapter that is' };
    }

    const parts = [];
    if (chapterNumber && chapterName) {
        parts.push(`Chapter ${chapterNumber} ("${chapterName}")`);
    } else if (chapterNumber) {
        parts.push(`Chapter ${chapterNumber}`);
    } else {
        parts.push(`the chapter "${chapterName}"`);
    }
    if (subject) parts.push(`of ${subject}`);
    if (classLevel) parts.push(`for ${classLevel}`);
    parts.push(`(${board} board syllabus)`);

    let descriptor = parts.join(' ');
    if (chapterNumber && !chapterName) {
        descriptor += ` — identify the exact standard chapter at this position in the syllabus and generate strictly from its actual content`;
    }
    if (details) {
        descriptor += `. Additional instructions: ${details}`;
    }

    return { ok: true, descriptor };
}

// POST /generate-questions
// Body: { chapter, marks?, difficultyMix? } OR { chapter, marks?, difficulty?, count? }
// Generates new MCQ questions via the batch engine and saves them as
// draft Question Bank entries (same review workflow as ai.js).
router.post('/generate-questions', requirePermission('ai:generate'), async (req, res) => {
    try {
        const { chapter, chapterNumber, marks, subjectId, classId } = req.body;

        let subjectNameFromId = null;
        if (subjectId) {
            const subjectData = db.findById('subjects', subjectId);
            if (!subjectData) {
                return res.status(404).json({ success: false, message: 'Subject not found' });
            }
            subjectNameFromId = subjectData.name;
        }
        let classLevel = req.body.classLevel;
        if (!classLevel && classId) {
            const classData = db.findById('classes', classId);
            if (!classData) {
                return res.status(404).json({ success: false, message: 'Class not found' });
            }
            classLevel = classData.displayName || classData.name;
        }

        const resolved = resolveChapterDescriptor({ ...req.body, classLevel }, { subjectNameFromId });
        if (!resolved.ok) {
            return res.status(400).json({ success: false, message: resolved.message });
        }
        const chapterLabel = (chapter || '').toString().trim() || `Chapter ${parseInt(chapterNumber, 10)}`;

        const difficultyMix = normalizeDifficultyMix(req.body);
        const totalRequested = difficultyMix.easy + difficultyMix.medium + difficultyMix.hard;
        if (totalRequested <= 0) {
            return res.status(400).json({ success: false, message: 'At least one question must be requested' });
        }
        if (totalRequested > MAX_TOTAL_QUESTIONS) {
            return res.status(400).json({ success: false, message: `Cannot request more than ${MAX_TOTAL_QUESTIONS} questions at once` });
        }

        const { questions, requested, generated } = await aiBatchGenerator.generateQuestions({ chapter: resolved.descriptor, difficultyMix });

        const created = questions.map(q => db.insertOne('questions', {
            questionText: q.questionText,
            chapter: chapterLabel,
            chapterNumber: chapterNumber ? parseInt(chapterNumber, 10) : null,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation || '',
            marks: parseInt(marks, 10) || 1,
            type: 'mcq',
            difficulty: q.difficulty || 'medium',
            status: 'draft',
            isActive: true,
            generatedByAI: true,
            aiModuleVersion: 'v2',
            createdBy: req.user?.id || 'admin',
        }));

        logAudit(req, 'create', 'question', null, `AI-v2 generated ${created.length}/${requested} question(s) on "${chapterLabel}"`);

        res.status(201).json({
            success: true,
            data: created,
            message: generated < requested
                ? `${created.length} of ${requested} requested question(s) generated and saved as drafts (some batches could not be completed after retries)`
                : `${created.length} question(s) generated and saved as drafts`,
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// POST /generate-paper
// Body: { title, classId, subjectId, chapter, duration?, difficultyMix?, marksPerQuestion? }
// Generates a full test paper matching a difficulty mix, saves the
// questions as drafts in the bank, then assembles them into a new
// (unpublished) Test — same pattern as the Smart Test Builder.
router.post('/generate-paper', requirePermission('ai:generate'), async (req, res) => {
    try {
        const { title, classId, subjectId, chapter, chapterNumber, duration, difficultyMix, marksPerQuestion } = req.body;
        if (!title || !classId || !subjectId || (!chapter && !chapterNumber)) {
            return res.status(400).json({ success: false, message: 'title, classId, subjectId, and either chapter or chapterNumber are required' });
        }

        const rawMix = (difficultyMix && typeof difficultyMix === 'object') ? difficultyMix : { easy: 3, medium: 4, hard: 3 };
        const mix = normalizeDifficultyMix({ difficultyMix: rawMix });
        const totalRequested = mix.easy + mix.medium + mix.hard;
        if (totalRequested <= 0) {
            return res.status(400).json({ success: false, message: 'difficultyMix must specify at least one question' });
        }
        if (totalRequested > MAX_TOTAL_QUESTIONS) {
            return res.status(400).json({ success: false, message: `Cannot request more than ${MAX_TOTAL_QUESTIONS} questions at once` });
        }

        const classData = db.findById('classes', classId);
        if (!classData) {
            return res.status(404).json({ success: false, message: 'Class not found' });
        }
        const subjectData = db.findById('subjects', subjectId);
        if (!subjectData) {
            return res.status(404).json({ success: false, message: 'Subject not found' });
        }

        const resolved = resolveChapterDescriptor(
            { ...req.body, classLevel: classData.displayName || classData.name },
            { subjectNameFromId: subjectData.name }
        );
        if (!resolved.ok) {
            return res.status(400).json({ success: false, message: resolved.message });
        }
        const chapterLabel = (chapter || '').toString().trim() || `Chapter ${parseInt(chapterNumber, 10)}`;

        const perMark = parseInt(marksPerQuestion, 10) || 1;
        const { questions, requested, generated } = await aiBatchGenerator.generateQuestions({ chapter: resolved.descriptor, difficultyMix: mix });

        if (generated === 0) {
            return res.status(503).json({ success: false, message: 'AI provider could not generate any valid questions. Please try again.' });
        }

        // Save each generated question to the bank as a draft first...
        const bankQuestions = questions.map(q => db.insertOne('questions', {
            questionText: q.questionText,
            chapter: chapterLabel,
            chapterNumber: chapterNumber ? parseInt(chapterNumber, 10) : null,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation || '',
            marks: perMark,
            type: 'mcq',
            difficulty: q.difficulty || 'medium',
            status: 'draft',
            isActive: true,
            generatedByAI: true,
            aiModuleVersion: 'v2',
            createdBy: req.user?.id || 'admin',
        }));

        // ...then create the test and attach them (same snapshot pattern
        // as the Smart Test Builder's "attach from bank" route).
        const test = db.insertOne('tests', {
            title,
            classId,
            subjectId,
            duration: parseInt(duration, 10) || 60,
            totalQuestions: 0,
            totalMarks: 0,
            isPublished: false,
            isActive: true,
            generatedByAI: true,
            aiModuleVersion: 'v2',
            createdBy: req.user?.id || 'admin',
        });

        bankQuestions.forEach((bq, i) => {
            db.insertOne('testQuestions', {
                testId: test._id,
                bankQuestionId: bq._id,
                questionText: bq.questionText,
                options: bq.options,
                correctAnswer: bq.correctAnswer,
                explanation: bq.explanation,
                marks: bq.marks,
                type: bq.type,
                difficulty: bq.difficulty,
                chapter: bq.chapter,
                order: i + 1,
                isActive: true,
                createdBy: req.user?.id || 'admin',
            });
        });
        recalcTestTotals(test._id);

        logAudit(req, 'create', 'test', test._id, `AI-v2 generated paper "${title}" with ${bankQuestions.length}/${requested} questions`);

        res.status(201).json({
            success: true,
            data: { test: db.findById('tests', test._id), questionsGenerated: bankQuestions.length, questionsRequested: requested },
            message: generated < requested
                ? `Paper "${title}" created with ${bankQuestions.length} of ${requested} requested AI-generated questions — still in Draft, review before publishing.`
                : `Paper "${title}" created with ${bankQuestions.length} AI-generated questions — still in Draft, review before publishing.`,
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// POST /explain-question
// Body: { questionId } OR { questionText, options, correctAnswer }, plus optional save: true
// Generates (and optionally saves) an explanation for a question — either
// an existing bank question by ID, or an ad-hoc question passed inline.
// Identical contract to ai.js's /explain-question, routed through the new
// provider layer (services/ai/aiProvider.js) instead of calling
// utils/llm.js directly, with retry on transient failures.
router.post('/explain-question', requirePermission('ai:generate'), async (req, res) => {
    try {
        const { questionId, questionText, options, correctAnswer, save } = req.body;

        let question = null;
        if (questionId) {
            question = db.findById('questions', questionId);
            if (!question) {
                return res.status(404).json({ success: false, message: 'Question not found' });
            }
        }
        const text = question ? question.questionText : questionText;
        const opts = question ? question.options : options;
        const answer = question ? question.correctAnswer : correctAnswer;
        if (!text || !answer) {
            return res.status(400).json({ success: false, message: 'questionId, or questionText + correctAnswer, are required' });
        }

        const result = await withRetry(
            () => aiProvider.explainAnswer({ questionText: text, options: opts, correctAnswer: answer }),
            { label: 'explain-question', maxRetries: 2 }
        );

        if (!result.ok) {
            return res.status(503).json({ success: false, message: result.reason });
        }

        const explanation = result.text.trim();
        if (questionId && save) {
            db.findByIdAndUpdate('questions', questionId, { explanation });
            logAudit(req, 'edit', 'question', questionId, 'AI-v2 generated explanation saved');
        }

        res.json({ success: true, data: { explanation }, message: 'Explanation generated' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// POST /generate-notes
// Body: { chapter, subject?, classId?, title? }
// Generates full study notes via the AI provider and saves them as a
// new entry in the Notes module (same `notes` collection routes/notes.js
// reads from), so they immediately show up wherever notes are listed.
router.post('/generate-notes', requirePermission('ai:generate'), async (req, res) => {
    try {
        const { chapter, chapterNumber, subject, subjectId, classId, title } = req.body;

        let subjectNameFromId = null;
        if (subjectId) {
            const subjectData = db.findById('subjects', subjectId);
            if (!subjectData) {
                return res.status(404).json({ success: false, message: 'Subject not found' });
            }
            subjectNameFromId = subjectData.name;
        }
        let classLevel = null;
        if (classId) {
            const classData = db.findById('classes', classId);
            if (!classData) {
                return res.status(404).json({ success: false, message: 'Class not found' });
            }
            classLevel = classData.displayName || classData.name;
        }

        const resolved = resolveChapterDescriptor({ ...req.body, classLevel }, { subjectNameFromId });
        if (!resolved.ok) {
            return res.status(400).json({ success: false, message: resolved.message });
        }
        const chapterLabel = (chapter || '').toString().trim() || `Chapter ${parseInt(chapterNumber, 10)}`;

        const result = await withRetry(
            () => aiProvider.generateNotes({ chapter: resolved.descriptor }),
            { label: 'generate-notes', maxRetries: 2 }
        );

        if (!result.ok) {
            return res.status(503).json({ success: false, message: result.reason });
        }

        const note = db.insertOne('notes', {
            title: title || result.data.title || chapterLabel,
            content: result.data.content,
            subject: subject || subjectNameFromId || '',
            classId: classId || null,
            fileUrl: null,
            generatedByAI: true,
            aiModuleVersion: 'v2',
            createdBy: req.user?.id || 'admin',
        });

        logAudit(req, 'create', 'note', note._id, `AI-v2 generated notes for "${chapterLabel}"`);

        res.status(201).json({
            success: true,
            data: note,
            message: 'Notes generated and saved successfully',
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;