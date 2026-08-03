// routes/admin/enquiries.js
//
// Admissions enquiries (walk-in / phone leads logged by staff) — list,
// create, and status updates (new / contacted / converted / closed).
// Extracted out of routes/adminRoutes.js (refactor, 2026-07). This section
// had no banner comment at all in the original file, sitting unlabeled
// between Student 360 Profile and Fee Management. Mounted at '/enquiries'
// by routes/adminRoutes.js, so the final URLs (/api/admin/enquiries,
// /api/admin/enquiries/:id) are unchanged.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { validate } = require('../../middleware/validation');
const validators = require('../../utils/validators');

// List enquiries
router.get('/', requirePermission('enquiries:view'), (req, res) => {
    try {
        const { status } = req.query;
        let enquiries = db.find('enquiries', {});
        if (status) {
            enquiries = enquiries.filter(e => (e.status || 'new') === status);
        }
        enquiries = enquiries.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, data: enquiries });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Create an enquiry (e.g. a walk-in / phone enquiry logged by staff)
router.post('/', requirePermission('enquiries:create'), (req, res) => {
    try {
        const { name, phone, email, interestedClass, source, notes } = req.body;
        if (!name || !phone) {
            return res.status(400).json({ success: false, message: 'Name and phone are required' });
        }
        const enquiry = db.insertOne('enquiries', {
            name,
            phone,
            email: email || '',
            interestedClass: interestedClass || '',
            source: source || 'walk-in',
            notes: notes || '',
            status: 'new',
            createdBy: req.user?.id || 'admin'
        });
        logAudit(req, 'create', 'enquiry', enquiry._id, `Logged enquiry from ${name}`);
        res.json({ success: true, data: enquiry, message: 'Enquiry logged successfully' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Update enquiry status (new / contacted / converted / closed)
router.put('/:id', requirePermission('enquiries:edit'), validators.updateEnquiry, validate, (req, res) => {
    try {
        const { status, notes } = req.body;
        const enquiry = db.findById('enquiries', req.params.id);
        if (!enquiry) {
            return res.status(404).json({ success: false, message: 'Enquiry not found' });
        }
        const updated = db.updateById('enquiries', req.params.id, {
            ...(status !== undefined ? { status } : {}),
            ...(notes !== undefined ? { notes } : {})
        });
        logAudit(req, 'edit', 'enquiry', req.params.id, `Updated enquiry for ${enquiry.name}${status ? ` to "${status}"` : ''}`);
        res.json({ success: true, data: updated, message: 'Enquiry updated' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;