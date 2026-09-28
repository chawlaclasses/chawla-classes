// routes/admin/classes.js
//
// Class management — CRUD for the "classes" collection (e.g. "Class 10",
// "Class 12 PCM"). Extracted out of routes/adminRoutes.js (refactor,
// 2026-07) as part of splitting that 3,671-line file into one module per
// domain — this file's routes and behavior are unchanged, only its
// location moved. Mounted at '/classes' by routes/adminRoutes.js, so the
// final URLs (/api/admin/classes, /api/admin/classes/:id) are identical to
// before the split.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { validate } = require('../../middleware/validation');
const validators = require('../../utils/validators');
const { isClassAllowedForUser } = require('../../config/permissions');

// Get all classes
router.get('/', requirePermission('classes:view'), (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', isActive } = req.query;

    let classes = db.find('classes', {});

    // Scope to the caller's assigned classes if they have one (teachers
    // with assignedClasses set via Staff Management). Everyone else sees
    // everything, as before.
    classes = classes.filter(c => isClassAllowedForUser(req.userData, c._id));

    if (isActive !== undefined) {
      classes = classes.filter(c => c.isActive === (isActive === 'true'));
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      classes = classes.filter(c =>
        searchRegex.test(c.name) || searchRegex.test(c.displayName)
      );
    }

    // Classes created before the "rearrange" feature existed have no
    // `order` — fall back to creation order for those so the list is at
    // least stable (not re-sorted differently on every load) until an
    // admin actually rearranges them.
    classes = [...classes].sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedData = classes.slice(start, end);
    const total = classes.length;

    res.json({
      success: true,
      data: paginatedData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Reorder classes — takes the full list of class ids in their new display
// order and assigns each a 0-based `order` value accordingly. Registered
// before '/:id' so 'reorder' is never swallowed as an :id param.
router.put('/reorder', requirePermission('classes:edit'), (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    const allClasses = db.find('classes', {});
    const validIds = new Set(allClasses.map(c => c._id));
    const missing = orderedIds.filter(id => !validIds.has(id));
    if (missing.length > 0) {
      return res.status(400).json({ success: false, message: 'One or more class ids were not found' });
    }

    orderedIds.forEach((id, index) => {
      db.findByIdAndUpdate('classes', id, { order: index });
    });

    logAudit(req, 'edit', 'class', null, 'Reordered classes');
    res.json({ success: true, message: 'Class order updated' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Get class by ID
router.get('/:id', requirePermission('classes:view'), (req, res) => {
  try {
    const { id } = req.params;
    const classData = db.findById('classes', id);

    if (!classData) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    res.json({ success: true, data: classData });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Create class
router.post('/', requirePermission('classes:create'), validators.createClass, validate, (req, res) => {
  try {
    const { name, displayName, description } = req.body;

    if (!name || !displayName) {
      return res.status(400).json({
        success: false,
        message: 'Name and display name are required'
      });
    }

    // Check if class exists
    const existing = db.findOne('classes', { name });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Class with this name already exists'
      });
    }

    const newClass = db.insertOne('classes', {
      name,
      displayName,
      description,
      subjects: [],
      isActive: true,
      order: db.find('classes', {}).length,
      createdBy: req.user?.id || 'admin'
    });

    logAudit(req, 'create', 'class', newClass._id, `Added class "${displayName}"`);

    res.status(201).json({
      success: true,
      data: newClass,
      message: 'Class created successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Update class
router.put('/:id', requirePermission('classes:edit'), validators.updateClass, validate, (req, res) => {
  try {
    const { id } = req.params;
    const { name, displayName, description, isActive } = req.body;

    const existing = db.findById('classes', id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    const updated = db.findByIdAndUpdate('classes', id, {
      name: name || existing.name,
      displayName: displayName || existing.displayName,
      description: description !== undefined ? description : existing.description,
      isActive: isActive !== undefined ? isActive : existing.isActive
    });

    logAudit(req, 'edit', 'class', id, `Updated class "${updated.displayName || updated.name}"`);

    res.json({
      success: true,
      data: updated,
      message: 'Class updated successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Delete class
router.delete('/:id', requirePermission('classes:delete'), (req, res) => {
  try {
    const { id } = req.params;

    const existing = db.findById('classes', id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    // Check if class has subjects
    const subjects = db.find('subjects', { classId: id });
    if (subjects.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete class with existing subjects'
      });
    }

    // FIX: this check was missing entirely — deleting a class that still
    // had students assigned to it left those students with a dangling
    // classId (pointing at a now-nonexistent class), which broke their
    // dashboard with a 404 "Class not found" instead of failing safely
    // here, before any damage was done.
    const studentsInClass = db.find('users', { role: 'student', classId: id });
    if (studentsInClass.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete class with ${studentsInClass.length} student(s) still assigned to it. Move them to another class first.`
      });
    }

    db.findByIdAndDelete('classes', id);
    logAudit(req, 'delete', 'class', id, `Deleted class "${existing.displayName || existing.name}"`);

    res.json({
      success: true,
      message: 'Class deleted successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;