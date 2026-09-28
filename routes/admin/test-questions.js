// routes/admin/test-questions.js
//
// Attach/remove questions on a specific test (testQuestions collection).
// This is distinct from the question BANK routes (bare /questions/:id,
// for the reusable question bank) — those live in a separate module.
// Extracted out of routes/adminRoutes.js (refactor, 2026-07). Mounted at
// '/tests' by routes/adminRoutes.js (alongside, not replacing, the
// tests.js router also mounted there — their path patterns don't
// overlap: tests.js uses single-segment patterns like /:id, this file
// uses two/three-segment patterns like /:testId/questions), so the final
// URLs are unchanged.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { recalcTestTotals } = require('./_helpers');

// Get questions for a test
router.get('/:testId/questions', requirePermission('tests:view'), (req, res) => {
  try {
    const { testId } = req.params;

    const test = db.findById('tests', testId);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }

    const questions = db.find('testQuestions', { testId, isActive: true });

    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Add question to test
router.post('/:testId/questions', requirePermission('questions:create'), (req, res) => {
  try {
    const { testId } = req.params;
    const { questionText, options, correctAnswer, explanation, marks, type } = req.body;

    if (!questionText || !options || !correctAnswer) {
      return res.status(400).json({
        success: false,
        message: 'Question text, options, and correct answer are required'
      });
    }

    const test = db.findById('tests', testId);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }

    const count = db.countDocuments('testQuestions', { testId });
    const order = count + 1;

    const newQuestion = db.insertOne('testQuestions', {
      testId,
      questionText,
      options,
      correctAnswer,
      explanation,
      marks: marks || 1,
      type: type || 'mcq',
      order,
      bankQuestionId: null,
      isActive: true,
      createdBy: req.user?.id || 'admin'
    });

    // Auto marks calculation — totalMarks/totalQuestions are always derived
    // from the actual attached questions rather than the value typed when the
    // test was first created.
    recalcTestTotals(testId);

    logAudit(req, 'create', 'question', newQuestion._id, `Added question to test "${test.title}"`);

    res.status(201).json({
      success: true,
      data: newQuestion,
      message: 'Question added successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Remove a question from a specific test (does not delete it from the
// question bank — see routes/admin/question-bank.js for that)
// FIX: this used to be mounted at the same bare '/questions/:id' path as
// the "delete from question bank" route elsewhere, which meant Express
// always matched THIS handler first — the bank delete was completely
// unreachable. Scoping this one under /tests/:testId/questions/:id (to
// match its sibling POST route just above) resolves the collision.
router.delete('/:testId/questions/:id', requirePermission('questions:delete'), (req, res) => {
  try {
    const { id } = req.params;

    const question = db.findById('testQuestions', id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    // Soft delete
    db.findByIdAndUpdate('testQuestions', id, { isActive: false });

    // Auto marks calculation — recompute from what's left attached.
    recalcTestTotals(question.testId);

    const test = db.findById('tests', question.testId);
    logAudit(req, 'delete', 'question', id, `Removed question from test "${test ? test.title : question.testId}"`);

    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;