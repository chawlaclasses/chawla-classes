// routes/admin/test-builder.js
//
// Smart Test Builder — attach questions from the question bank (single or
// bulk), randomized selection by difficulty mix, drag-and-drop reordering,
// and the admin-facing pre-publish preview. Extracted out of
// routes/adminRoutes.js (refactor, 2026-07). Mounted at '/tests' by
// routes/adminRoutes.js, alongside tests.js and test-questions.js — their
// path patterns don't overlap (this file only handles
// /tests/:testId/questions/bank, /random, /reorder, and /tests/:testId/preview),
// so the final URLs are unchanged.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { recalcTestTotals } = require('./_helpers');

// Attach one or more existing Question Bank questions to a test in one call —
// the picker side of drag & drop (dropping bank questions onto the test) and
// the target of "Add Selected" when multiple are checked. Each attached
// question is a content snapshot (like the manual-add route in
// test-questions.js), so later edits to the bank question don't retroactively
// change a test students may already be sitting.
router.post('/:testId/questions/bank', requirePermission('questions:create'), (req, res) => {
  try {
    const { testId } = req.params;
    const { questionIds } = req.body;

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ success: false, message: 'questionIds must be a non-empty array' });
    }

    const test = db.findById('tests', testId);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }

    const existing = db.find('testQuestions', { testId, isActive: true });
    const alreadyAttached = new Set(existing.map(q => q.bankQuestionId).filter(Boolean));
    let order = existing.length;

    const added = [];
    const skipped = [];
    for (const bankId of questionIds) {
      if (alreadyAttached.has(bankId)) { skipped.push(bankId); continue; }
      const bankQuestion = db.findById('questions', bankId);
      if (!bankQuestion) { skipped.push(bankId); continue; }

      order += 1;
      const newQuestion = db.insertOne('testQuestions', {
        testId,
        bankQuestionId: bankId,
        questionText: bankQuestion.questionText,
        options: bankQuestion.options,
        correctAnswer: bankQuestion.correctAnswer,
        explanation: bankQuestion.explanation,
        marks: bankQuestion.marks || 1,
        type: bankQuestion.type || 'mcq',
        difficulty: bankQuestion.difficulty || 'medium',
        chapter: bankQuestion.chapter,
        order,
        isActive: true,
        createdBy: req.user?.id || 'admin'
      });
      added.push(newQuestion);
      alreadyAttached.add(bankId);
    }

    recalcTestTotals(testId);
    if (added.length > 0) {
      logAudit(req, 'create', 'question', testId, `Added ${added.length} question(s) from bank to test "${test.title}"`);
    }

    res.status(201).json({
      success: true,
      data: { added, skippedCount: skipped.length },
      message: `${added.length} question(s) added${skipped.length ? `, ${skipped.length} skipped (already attached or not found)` : ''}`
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Random Question Selection with an optional Difficulty Mix — e.g.
// { difficultyMix: { easy: 5, medium: 10, hard: 5 }, chapter: 'Algebra' }
// picks that exact count per difficulty at random from published/approved
// bank questions, skipping ones already on the test. If a bucket doesn't have
// enough matching questions, it adds as many as it can and reports the
// shortfall rather than failing the whole request.
router.post('/:testId/questions/random', requirePermission('questions:create'), (req, res) => {
  try {
    const { testId } = req.params;
    const { difficultyMix, chapter } = req.body;

    const test = db.findById('tests', testId);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }

    const mix = difficultyMix && typeof difficultyMix === 'object'
      ? difficultyMix
      : { easy: 0, medium: 0, hard: 0 };
    const totalRequested = ['easy', 'medium', 'hard'].reduce((sum, d) => sum + (Number(mix[d]) || 0), 0);
    if (totalRequested <= 0) {
      return res.status(400).json({ success: false, message: 'Specify at least one question count in the difficulty mix' });
    }

    const existing = db.find('testQuestions', { testId, isActive: true });
    const alreadyAttached = new Set(existing.map(q => q.bankQuestionId).filter(Boolean));
    let order = existing.length;

    const shuffle = (arr) => arr
      .map(v => [Math.random(), v])
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);

    const added = [];
    const shortfalls = [];

    for (const level of ['easy', 'medium', 'hard']) {
      const wanted = Number(mix[level]) || 0;
      if (wanted <= 0) continue;

      let pool = db.find('questions', { difficulty: level, isActive: true })
        .filter(q => ['approved', 'published'].includes(q.status || 'draft'))
        .filter(q => !alreadyAttached.has(q._id))
        .filter(q => !chapter || q.chapter === chapter);

      pool = shuffle(pool).slice(0, wanted);
      if (pool.length < wanted) {
        shortfalls.push(`${level}: wanted ${wanted}, found ${pool.length}`);
      }

      for (const bankQuestion of pool) {
        order += 1;
        const newQuestion = db.insertOne('testQuestions', {
          testId,
          bankQuestionId: bankQuestion._id,
          questionText: bankQuestion.questionText,
          options: bankQuestion.options,
          correctAnswer: bankQuestion.correctAnswer,
          explanation: bankQuestion.explanation,
          marks: bankQuestion.marks || 1,
          type: bankQuestion.type || 'mcq',
          difficulty: bankQuestion.difficulty || 'medium',
          chapter: bankQuestion.chapter,
          order,
          isActive: true,
          createdBy: req.user?.id || 'admin'
        });
        added.push(newQuestion);
        alreadyAttached.add(bankQuestion._id);
      }
    }

    recalcTestTotals(testId);
    if (added.length > 0) {
      logAudit(req, 'create', 'question', testId, `Randomly added ${added.length} question(s) to test "${test.title}"`);
    }

    res.status(201).json({
      success: true,
      data: { added, shortfalls },
      message: shortfalls.length
        ? `Added ${added.length} question(s). Some buckets came up short: ${shortfalls.join('; ')}`
        : `Added ${added.length} random question(s)`
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Drag & Drop reordering — accepts the testQuestion IDs in their new order
// and rewrites each one's `order` field to match.
router.put('/:testId/questions/reorder', requirePermission('tests:edit'), (req, res) => {
  try {
    const { testId } = req.params;
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    const testQuestions = db.find('testQuestions', { testId, isActive: true });
    const validIds = new Set(testQuestions.map(q => q._id));

    orderedIds.forEach((id, index) => {
      if (validIds.has(id)) {
        db.findByIdAndUpdate('testQuestions', id, { order: index + 1 });
      }
    });

    res.json({ success: true, message: 'Question order updated' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Preview Before Publish — full test detail with questions in order, for the
// admin-facing "how will students see this" preview modal. Unlike the
// student-facing test endpoints, this intentionally includes correctAnswer /
// explanation since it's for the admin reviewing their own test.
router.get('/:testId/preview', requirePermission('tests:view'), (req, res) => {
  try {
    const { testId } = req.params;
    const test = db.findById('tests', testId);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }

    const questions = db.find('testQuestions', { testId, isActive: true })
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    res.json({ success: true, data: { test, questions } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;