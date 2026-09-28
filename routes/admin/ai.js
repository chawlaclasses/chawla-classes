// routes/admin/ai.js
//
// AI Module (Admin) — Question Generator, Paper Generator, and Answer
// Explanation are backed by utils/llm.js (Claude API); they respond with
// a clear 503 if ANTHROPIC_API_KEY isn't set, rather than a confusing
// 500. Performance Prediction and Weak Topic Recommendation reuse
// services/ai.js, whose core logic is statistical and works with no AI
// key at all. Extracted out of routes/adminRoutes.js (refactor,
// 2026-07). Mounted at '/ai' by routes/adminRoutes.js, so the final URLs
// (/api/admin/ai/generate-questions, etc.) are unchanged.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { callClaude, callClaudeJSON } = require('../../utils/llm');
const aiService = require('../../services/ai');
const { recalcTestTotals } = require('./_helpers');

const QUESTION_GEN_SYSTEM_PROMPT = `You are an expert exam question writer for an Indian coaching institute.

Generate high-quality multiple-choice questions suitable for students preparing for board/competitive exams.

Always respond with ONLY a JSON array (no markdown fences, no commentary) in this exact shape:

[{"questionText":"...","options":[{"text":"...","isCorrect":true},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false}],"correctAnswer":"<text of the correct option>","explanation":"<2-3 sentence explanation>","difficulty":"easy|medium|hard"}]

Each question must have exactly 4 options.
Exactly one option must have "isCorrect": true.
Do not repeat questions.

IMPORTANT:
Return ONLY valid JSON.

Do NOT return:
- markdown
- explanations
- notes
- thinking
- code fences

The first character of your response MUST be "[".
The last character of your response MUST be "]".

If you cannot generate questions, return [] only.`;

const AI_BATCH_SIZE = 5;

async function generateQuestionBatch(chapter, difficultyLabel, count) {
    const result = await callClaudeJSON({
        system: QUESTION_GEN_SYSTEM_PROMPT,
        prompt: `Generate exactly ${count} multiple-choice questions on the topic "${chapter}" with difficulty "${difficultyLabel}". Return ONLY the JSON array.`,
        maxTokens: 2500
    });

    if (!result.ok) {
        throw new Error(result.reason);
    }

    if (!Array.isArray(result.data)) {
        throw new Error("AI returned invalid JSON");
    }

    return result.data;
}

// Generate N new MCQ questions on a chapter/topic and save them as drafts
// in the Question Bank (same review workflow as manually-created or
// PDF-imported questions — an admin/teacher still approves before they go live).
// AI Generation History — one row per past "Generate Questions" batch,
// with what happened to it since: how many of its questions are now
// Approved/Published, how many were Rejected (soft-deleted, whether via
// the AI Review Queue or the regular Question Bank), and how many are
// still sitting in Draft/Review waiting on a decision. Lets an admin
// re-open/audit a batch without re-generating it.
router.get('/generation-history', requirePermission('ai:view'), (req, res) => {
  try {
    const batches = db.find('ai-generation-batches', {})
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const data = batches.map(batch => {
      const questions = db.find('questions', { aiBatchId: batch._id });
      const rejected = questions.filter(q => q.isActive === false).length;
      const approved = questions.filter(q => q.isActive !== false && ['approved', 'published'].includes(q.status)).length;
      const pending = questions.filter(q => q.isActive !== false && !['approved', 'published'].includes(q.status)).length;
      return {
        _id: batch._id,
        prompt: batch.prompt,
        chapterRequested: batch.chapterRequested,
        difficultyRequested: batch.difficultyRequested,
        countRequested: batch.countRequested,
        countGenerated: batch.countGenerated,
        approved,
        rejected,
        pending,
        createdBy: batch.createdBy,
        createdAt: batch.createdAt,
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// All questions from one specific AI generation batch — lets the admin
// "re-open" a past batch and see exactly what was generated.
router.get('/generation-history/:batchId', requirePermission('ai:view'), (req, res) => {
  try {
    const batch = db.findById('ai-generation-batches', req.params.batchId);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }
    const questions = db.find('questions', { aiBatchId: batch._id });
    res.json({ success: true, data: { batch, questions } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

router.post('/generate-questions', requirePermission('ai:generate'), async (req, res) => {
    try {
        const { chapter, difficulty, count, marks } = req.body;
        if (!chapter || !count) {
            return res.status(400).json({ success: false, message: 'chapter and count are required' });
        }
        const requestedCount = Math.min(20, Math.max(1, parseInt(count, 10) || 5));
        const difficultyLabel = difficulty && difficulty !== 'mixed' ? difficulty : 'a mix of easy, medium and hard';

        let questions = [];

for (let i = 0; i < requestedCount; i += AI_BATCH_SIZE) {

    const batchSize = Math.min(
        AI_BATCH_SIZE,
        requestedCount - i
    );

    const batch = await generateQuestionBatch(
        chapter,
        difficultyLabel,
        batchSize
    );

    questions.push(...batch);
}

// Remove duplicate questions
questions = questions.filter(
    (q, index, self) =>
        index === self.findIndex(
            x => x.questionText.trim() === q.questionText.trim()
        )
);

        const batch = db.insertOne('ai-generation-batches', {
            prompt: chapter,
            chapterRequested: chapter,
            difficultyRequested: difficulty || 'mixed',
            countRequested: requestedCount,
            countGenerated: questions.length,
            createdBy: req.user?.id || 'admin',
        });

        const created = questions.map(q => db.insertOne('questions', {
            questionText: q.questionText,
            chapter,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation || '',
            marks: parseInt(marks, 10) || 1,
            type: 'mcq',
            difficulty: q.difficulty || (difficulty !== 'mixed' ? difficulty : 'medium'),
            status: 'draft',
            isActive: true,
            generatedByAI: true,
            aiBatchId: batch._id,
            createdBy: req.user?.id || 'admin',
        }));

        logAudit(req, 'create', 'question', null, `AI-generated ${created.length} question(s) on "${chapter}"`);
        res.status(201).json({ success: true, data: created, message: `${created.length} question(s) generated and saved as drafts` });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Generate a full test paper: creates N new AI-written questions matching a
// difficulty mix, saves them as draft Question Bank entries, and assembles
// them into a new (unpublished) Test — ready for admin review via the
// Smart Test Builder's Preview before publishing.
router.post('/generate-paper', requirePermission('ai:generate'), async (req, res) => {
    try {
        const { title, classId, subjectId, chapter, duration, difficultyMix, marksPerQuestion } = req.body;
        if (!title || !classId || !subjectId || !chapter) {
            return res.status(400).json({ success: false, message: 'title, classId, subjectId and chapter are required' });
        }
        const mix = difficultyMix && typeof difficultyMix === 'object' ? difficultyMix : { easy: 3, medium: 4, hard: 3 };
        const totalRequested = ['easy', 'medium', 'hard'].reduce((sum, d) => sum + (Number(mix[d]) || 0), 0);
        if (totalRequested <= 0 || totalRequested > 40) {
            return res.status(400).json({ success: false, message: 'Total questions across the difficulty mix must be between 1 and 40' });
        }
        const perMark = parseInt(marksPerQuestion, 10) || 1;

        const classData = db.findById('classes', classId);
        if (!classData) {
            return res.status(404).json({ success: false, message: 'Class not found' });
        }
        const AI_BATCH_SIZE = 5;
        async function generateQuestionBatch(prompt, count) {
    const result = await callClaudeJSON({
        system: QUESTION_GEN_SYSTEM_PROMPT,
        prompt,
        maxTokens: 400 * count,
    });

    if (!result.ok) {
        throw new Error(result.reason);
    }

    if (!Array.isArray(result.data)) {
        throw new Error("AI returned invalid JSON");
    }

    return result.data;
}
        
        const result = await callClaudeJSON({
            system: QUESTION_GEN_SYSTEM_PROMPT,
            prompt: `Generate a set of multiple-choice questions on the topic "${chapter}" with this exact difficulty breakdown: ${mix.easy || 0} easy, ${mix.medium || 0} medium, ${mix.hard || 0} hard (${totalRequested} total). Set each question's "difficulty" field accordingly.`,
            maxTokens: 400 * totalRequested,
        });

        if (!result.ok) {
            return res.status(503).json({ success: false, message: result.reason });
        }
        if (!Array.isArray(result.data)) {
            return res.status(502).json({ success: false, message: 'AI response was not in the expected format' });
        }

        // Save each generated question to the bank as a draft first...
        const bankQuestions = result.data.map(q => db.insertOne('questions', {
            questionText: q.questionText,
            chapter,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation || '',
            marks: perMark,
            type: 'mcq',
            difficulty: q.difficulty || 'medium',
            status: 'draft',
            isActive: true,
            generatedByAI: true,
            createdBy: req.user?.id || 'admin',
        }));

        // ...then create the test and attach them (same snapshot pattern as
        // the Smart Test Builder's "attach from bank" route).
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

        logAudit(req, 'create', 'test', test._id, `AI-generated paper "${title}" with ${bankQuestions.length} questions`);
        res.status(201).json({
            success: true,
            data: { test: db.findById('tests', test._id), questionsGenerated: bankQuestions.length },
            message: `Paper "${title}" created with ${bankQuestions.length} AI-generated questions — still in Draft, review before publishing.`
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Generate (and optionally save) an explanation for a question — either an
// existing bank question by ID, or an ad-hoc question passed inline.
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

        const result = await callClaude({
            system: 'You are a patient tutor. Explain WHY the correct answer is correct in clear, simple language a student can learn from. 2-4 sentences. No markdown, no headers.',
            prompt: `Question: ${text}\nOptions: ${(opts || []).map(o => o.text).join(' | ')}\nCorrect answer: ${answer}\n\nExplain why this is correct.`,
            maxTokens: 400,
        });

        if (!result.ok) {
            return res.status(503).json({ success: false, message: result.reason });
        }

        const explanation = result.text.trim();
        if (questionId && save) {
            db.findByIdAndUpdate('questions', questionId, { explanation });
            logAudit(req, 'edit', 'question', questionId, 'AI-generated explanation saved');
        }

        res.json({ success: true, data: { explanation }, message: 'Explanation generated' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Admin view of a specific student's performance prediction / weak topics
// (the student-facing versions of these live under /api/ai/*)
router.get('/predict-performance/:studentId', requirePermission('ai:view'), async (req, res) => {
    try {
        const prediction = await aiService.predictPerformance(req.params.studentId);
        res.json({ success: true, data: prediction });
    } catch (error) {
        logger.error(`AI predict-performance failed: ${error.message}`, { stack: error.stack });
        const isNotFound = error.message === 'Student not found';
        res.status(isNotFound ? 404 : 500).json({
            success: false,
            message: isNotFound ? error.message : 'Something went wrong. Please try again.'
        });
    }
});

router.get('/weak-topics/:studentId', requirePermission('ai:view'), async (req, res) => {
    try {
        const recommendations = await aiService.getWeakTopicRecommendations(req.params.studentId);
        res.json({ success: true, data: recommendations });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;