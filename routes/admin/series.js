// routes/admin/series.js
//
// Series management — CRUD for the "series" collection (a series groups
// tests under a subject, e.g. "Weekly Tests", "Mock Series"). Extracted
// out of routes/adminRoutes.js (refactor, 2026-07). Mounted at '/series'
// by routes/adminRoutes.js, so the final URLs (/api/admin/series,
// /api/admin/series/:id) are identical to before the split.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { validate } = require('../../middleware/validation');
const validators = require('../../utils/validators');
const { isClassAllowedForUser, isSubjectAllowedForUser } = require('../../config/permissions');

// Get all series
router.get('/', requirePermission('series:view'), (req, res) => {
  try {
    const { subjectId, classId } = req.query;

    let query = {};
    if (subjectId) query.subjectId = subjectId;
    if (classId) query.classId = classId;

    let series = db.find('series', query);
    series = series.filter(s => isClassAllowedForUser(req.userData, s.classId) && isSubjectAllowedForUser(req.userData, s.subjectId));

    res.json({
      success: true,
      data: series
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Create series
router.post('/', requirePermission('series:create'), validators.createSeries, validate, (req, res) => {
  try {
    const { name, subjectId, classId, description, type } = req.body;

    if (!name || !subjectId || !classId) {
      return res.status(400).json({
        success: false,
        message: 'Name, subject, and class are required'
      });
    }

    // Check if subject exists
    const subject = db.findById('subjects', subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    // Check for duplicate
    const existing = db.findOne('series', { subjectId, name });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Series with this name already exists for this subject'
      });
    }

    const newSeries = db.insertOne('series', {
      name,
      subjectId,
      classId,
      description,
      type: type || 'other',
      isActive: true,
      createdBy: req.user?.id || 'admin'
    });

    logAudit(req, 'create', 'series', newSeries._id, `Added series "${name}"`);

    res.status(201).json({
      success: true,
      data: newSeries,
      message: 'Series created successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Update series
// FIX: same missing-endpoint issue as subjects — the Edit-Series modal in
// the admin UI called this path, but it never existed on the backend.
router.put('/:id', requirePermission('series:edit'), validators.updateSeries, validate, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.findById('series', id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Series not found' });
    }
    const { name, subjectId, classId, description, type, isActive } = req.body;
    if (!name || !subjectId) {
      return res.status(400).json({ success: false, message: 'Name and subject are required' });
    }
    const updated = db.updateById('series', id, {
      name, subjectId, classId, description, type: type || 'other', isActive: isActive !== false
    });
    logAudit(req, 'edit', 'series', id, `Updated series "${name}"`);
    res.json({ success: true, data: updated, message: 'Series updated successfully' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Delete series
router.delete('/:id', requirePermission('series:delete'), (req, res) => {
  console.log("===== DELETE SERIES =====");
    console.log("Series ID:", req.params.id);
  try {
    const { id } = req.params;
    const existing = db.findById('series', id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Series not found' });
    }
    // Find all tests in this series
const tests = db.find('tests', { seriesId: id });

// Delete related data first
tests.forEach(test => {

    // Delete test questions
    const testQuestions = db.find('testQuestions', {
        testId: test._id
    });

    testQuestions.forEach(q => {
        db.findByIdAndDelete('testQuestions', q._id);
    });

    // Delete student results (if collection exists)
    const results = db.find('results', {
        testId: test._id
    });

    results.forEach(r => {
        db.findByIdAndDelete('results', r._id);
    });

    // Delete student attempts (if collection exists)
    const attempts = db.find('attempts', {
        testId: test._id
    });

    attempts.forEach(a => {
        db.findByIdAndDelete('attempts', a._id);
    });

    // Finally delete the test
    db.findByIdAndDelete('tests', test._id);
});
    db.findByIdAndDelete('series', id);
    logAudit(req, 'delete', 'series', id, `Deleted series "${existing.name}"`);
    res.json({ success: true, message: 'Series deleted successfully' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;