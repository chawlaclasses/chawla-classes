// routes/admin/tests.js
//
// Test management — CRUD plus publish/unpublish for the "tests"
// collection. Extracted out of routes/adminRoutes.js (refactor, 2026-07).
// Mounted at '/tests' by routes/adminRoutes.js, so the final URLs
// (/api/admin/tests, /api/admin/tests/:id, /api/admin/tests/:id/publish,
// /api/admin/tests/:id/unpublish) are identical to before the split.
//
// Note: question-attach/detach routes and the Smart Test Builder live in
// their own files (routes/admin/questions.js, routes/admin/test-builder.js)
// even though they also operate on tests — this file is specifically the
// test record's own CRUD + publish state.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { validate } = require('../../middleware/validation');
const validators = require('../../utils/validators');
const { isClassAllowedForUser, isSubjectAllowedForUser } = require('../../config/permissions');

// Get all tests
router.get('/', requirePermission('tests:view'), (req, res) => {
  try {
    const { seriesId, subjectId, classId, isPublished } = req.query;

    let query = {};
    if (seriesId) query.seriesId = seriesId;
    if (subjectId) query.subjectId = subjectId;
    if (classId) query.classId = classId;
    if (isPublished !== undefined) query.isPublished = isPublished === 'true';

    let tests = db.find('tests', query);
    // Scope to the caller's assigned classes/subjects if they have either
    // set (teachers via Staff Management). Everyone else sees everything.
    tests = tests.filter(t => isClassAllowedForUser(req.userData, t.classId) && isSubjectAllowedForUser(req.userData, t.subjectId));

    res.json({
      success: true,
      data: tests
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Create test
router.post('/', requirePermission('tests:create'), validators.createTest, validate, (req, res) => {
  try {
    const { title, description, seriesId, subjectId, classId, totalMarks, passingMarks, duration } = req.body;

    if (!title || !seriesId || !subjectId || !classId || !totalMarks || !passingMarks || !duration) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be filled'
      });
    }

    if (!isClassAllowedForUser(req.userData, classId) || !isSubjectAllowedForUser(req.userData, subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    // Check if series exists
    const series = db.findById('series', seriesId);
    if (!series) {
      return res.status(404).json({ success: false, message: 'Series not found' });
    }

    // Check for duplicate
    const existing = db.findOne('tests', { seriesId, title });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Test with this title already exists in this series'
      });
    }

    const newTest = db.insertOne('tests', {
      title,
      description,
      seriesId,
      subjectId,
      classId,
      totalMarks,
      passingMarks,
      duration,
      negativeMarking: { enabled: false, value: 0 },
      maximumAttempts: 1,
      randomizeQuestions: false,
      randomizeOptions: false,
      isPublished: false,
      isScheduled: false,
      startDate: null,
      endDate: null,
      totalQuestions: 0,
      questions: [],
      createdBy: req.user?.id || 'admin',
      isDeleted: false
    });

    logAudit(req, 'create', 'test', newTest._id, `Added test "${title}"`);

    res.status(201).json({
      success: true,
      data: newTest,
      message: 'Test created successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Update test
router.put('/:id', requirePermission('tests:edit'), validators.updateTest, validate, (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const test = db.findById('tests', id);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }
    if (!isClassAllowedForUser(req.userData, test.classId) || !isSubjectAllowedForUser(req.userData, test.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    if (updateData.classId && !isClassAllowedForUser(req.userData, updateData.classId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to that class." });
    }
    if (updateData.subjectId && !isSubjectAllowedForUser(req.userData, updateData.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to that subject." });
    }

    const updated = db.findByIdAndUpdate('tests', id, updateData);

    logAudit(req, 'edit', 'test', id, `Updated test "${updated.title}"`);

    res.json({
      success: true,
      data: updated,
      message: 'Test updated successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Delete test
router.delete('/:id', requirePermission('tests:delete'), (req, res) => {
  try {
    const { id } = req.params;

    const test = db.findById('tests', id);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }
    if (!isClassAllowedForUser(req.userData, test.classId) || !isSubjectAllowedForUser(req.userData, test.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    db.findByIdAndDelete('tests', id);
    logAudit(req, 'delete', 'test', id, `Deleted test "${test.title}"`);

    res.json({
      success: true,
      message: 'Test deleted successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Publish test
router.post('/:id/publish', requirePermission('tests:edit'), (req, res) => {
  try {
    const { id } = req.params;

    const test = db.findById('tests', id);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }
    if (!isClassAllowedForUser(req.userData, test.classId) || !isSubjectAllowedForUser(req.userData, test.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    // Check if test has questions
    const questions = db.find('testQuestions', { testId: id });
    if (questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot publish test without questions'
      });
    }

    db.findByIdAndUpdate('tests', id, { isPublished: true });
    logAudit(req, 'edit', 'test', id, `Published test "${test.title}"`);

    res.json({
      success: true,
      message: 'Test published successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Unpublish test
router.post('/:id/unpublish', requirePermission('tests:edit'), (req, res) => {
  try {
    const { id } = req.params;

    const test = db.findById('tests', id);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }
    if (!isClassAllowedForUser(req.userData, test.classId) || !isSubjectAllowedForUser(req.userData, test.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    db.findByIdAndUpdate('tests', id, { isPublished: false });
    logAudit(req, 'edit', 'test', id, `Unpublished test "${test.title}"`);

    res.json({
      success: true,
      message: 'Test unpublished successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;