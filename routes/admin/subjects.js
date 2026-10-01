// routes/admin/subjects.js
//
// Subject management — CRUD for the "subjects" collection (each subject
// belongs to a class). Extracted out of routes/adminRoutes.js (refactor,
// 2026-07). Mounted at '/subjects' by routes/adminRoutes.js, so the final
// URLs (/api/admin/subjects, /api/admin/subjects/:id) are identical to
// before the split.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { validate } = require('../../middleware/validation');
const validators = require('../../utils/validators');
const { isSubjectAllowedForUser } = require('../../config/permissions');
const { normalizeStream, classHasStreams } = require('../../utils/streams');

// A subject's stream is '' (common to all streams) or one of the streams its
// class offers. Returns { ok, stream, message }.
function resolveSubjectStream(classData, rawStream) {
  const stream = normalizeStream(rawStream);
  if (!stream) return { ok: true, stream: '' };
  if (!classHasStreams(classData) || !classData.streams.includes(stream)) {
    return { ok: false, message: `${classData.displayName || classData.name} does not offer the ${stream} stream. Enable it on the class first.` };
  }
  return { ok: true, stream };
}

// Get all subjects
router.get('/', requirePermission('subjects:view'), (req, res) => {
  try {
    const { classId, isActive, stream } = req.query;

    let query = {};
    if (classId) query.classId = classId;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    let subjects = db.find('subjects', query);
    // ?stream=Commerce -> Commerce subjects + common (stream-less) ones
    if (stream) {
      const wanted = normalizeStream(stream);
      subjects = subjects.filter(s => !s.stream || s.stream === wanted);
    }
    subjects = subjects.filter(s => isSubjectAllowedForUser(req.userData, s._id));

    res.json({
      success: true,
      data: subjects
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Create subject
router.post('/', requirePermission('subjects:create'), validators.createSubject, validate, (req, res) => {
  try {
    const { name, code, classId, description, stream } = req.body;

    if (!name || !code || !classId) {
      return res.status(400).json({
        success: false,
        message: 'Name, code, and class are required'
      });
    }

    // Check if class exists
    const classData = db.findById('classes', classId);
    if (!classData) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    const streamCheck = resolveSubjectStream(classData, stream);
    if (!streamCheck.ok) {
      return res.status(400).json({ success: false, message: streamCheck.message });
    }

    // Check for duplicate — same name is allowed in different streams
    // (e.g. "Mathematics" for Science and for Commerce are separate subjects).
    const existing = db.find('subjects', { classId, name })
      .find(s => (s.stream || '') === streamCheck.stream);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Subject with this name already exists in this class' + (streamCheck.stream ? ` for ${streamCheck.stream}` : '')
      });
    }

    const newSubject = db.insertOne('subjects', {
      name,
      code: code.toUpperCase(),
      classId,
      stream: streamCheck.stream,
      description,
      isActive: true,
      createdBy: req.user?.id || 'admin'
    });

    // Add subject to class
    const subjects = classData.subjects || [];
    subjects.push(newSubject._id);
    db.findByIdAndUpdate('classes', classId, { subjects });

    logAudit(req, 'create', 'subject', newSubject._id, `Added subject "${name}"`);

    res.status(201).json({
      success: true,
      data: newSubject,
      message: 'Subject created successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Update subject
// FIX: the admin UI's Edit-Subject modal already called PUT /subjects/:id
// (see public/admin/dashboard.html) but this endpoint never existed —
// every edit attempt was silently failing.
router.put('/:id', requirePermission('subjects:edit'), validators.createSubject, validate, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.findById('subjects', id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    const { name, code, classId, description, isActive, stream } = req.body;
    if (!name || !code || !classId) {
      return res.status(400).json({ success: false, message: 'Name, code, and class are required' });
    }
    const classData = db.findById('classes', classId);
    if (!classData) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    // If the client didn't send `stream` at all, keep what the subject had.
    const streamCheck = resolveSubjectStream(classData, stream !== undefined ? stream : existing.stream);
    if (!streamCheck.ok) {
      return res.status(400).json({ success: false, message: streamCheck.message });
    }
    const updated = db.updateById('subjects', id, {
      name, code: code.toUpperCase(), classId, stream: streamCheck.stream, description, isActive: isActive !== false
    });
    logAudit(req, 'edit', 'subject', id, `Updated subject "${name}"`);
    res.json({ success: true, data: updated, message: 'Subject updated successfully' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Delete subject
// FIX: same as above — the Delete button existed, this endpoint didn't.
router.delete('/:id', requirePermission('subjects:delete'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.findById('subjects', id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    const series = db.find('series', { subjectId: id });
    if (series.length > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete subject with existing series' });
    }
    db.findByIdAndDelete('subjects', id);
    logAudit(req, 'delete', 'subject', id, `Deleted subject "${existing.name}"`);
    res.json({ success: true, message: 'Subject deleted successfully' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
