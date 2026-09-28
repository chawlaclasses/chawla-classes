// routes/admin/communication.js
//
// Communication Center — one composer that can fan a message out across
// Push (in-app), Email, WhatsApp and SMS, targeted by Class, Batch, an
// individual student, everyone with a pending fee, or everyone marked
// absent (today or a given date). Every send is logged to the
// 'broadcasts' collection for history/audit. Extracted out of
// routes/adminRoutes.js (refactor, 2026-07). Mounted at '/communication'
// by routes/adminRoutes.js, so the final URLs
// (/api/admin/communication/send, etc.) are unchanged.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { sendMail } = require('../../utils/mailer');
const { sendWhatsApp } = require('../../utils/whatsapp');
const { sendSms } = require('../../utils/sms');
const notificationService = require('../../services/notifications');

// Resolves a { targetType, targetValue } pair into the actual list of
// student records it refers to — shared by the preview and send endpoints
// so "what you previewed" always matches "who actually got it".
function resolveCommunicationTargets(targetType, targetValue) {
    const allStudents = db.find('users', { role: 'student' }).filter(s => s.isActive !== false);

    switch (targetType) {
        case 'class': {
            if (!targetValue) return [];
            return allStudents.filter(s => s.classId === targetValue);
        }
        case 'batch': {
            if (!targetValue) return [];
            return allStudents.filter(s => (s.batch || '') === targetValue);
        }
        case 'individual': {
            if (!targetValue) return [];
            const student = db.findById('users', targetValue);
            return (student && student.role === 'student') ? [student] : [];
        }
        case 'pending_fees': {
            const pendingStudentIds = new Set(db.find('fees-v2', { status: 'Pending' }).map(f => f.studentId));
            return allStudents.filter(s => pendingStudentIds.has(s._id));
        }
        case 'absent_today': {
            const targetDate = targetValue || new Date().toLocaleDateString('en-US');
            const absentEmails = new Set(
                db.find('attendance', { date: targetDate, status: 'Absent' }).map(a => a.email)
            );
            return allStudents.filter(s => absentEmails.has(s.email));
        }
        default:
            return [];
    }
}

// Distinct batch names currently assigned to any student, for the "Batch" dropdown
router.get('/batches', requirePermission('communication:view'), (req, res) => {
    try {
        const batches = Array.from(new Set(
            db.find('users', { role: 'student' })
              .map(s => (s.batch || '').trim())
              .filter(Boolean)
        )).sort();
        res.json({ success: true, data: batches });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Preview who a given targeting selection would reach, before sending
router.get('/targets/preview', requirePermission('communication:view'), (req, res) => {
    try {
        const { targetType, targetValue } = req.query;
        if (!targetType) {
            return res.status(400).json({ success: false, message: 'targetType is required' });
        }
        const students = resolveCommunicationTargets(targetType, targetValue);
        res.json({
            success: true,
            data: {
                count: students.length,
                students: students.map(s => ({ _id: s._id, name: s.name, email: s.email, phone: s.phone || '' }))
            }
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Compose and send — fans the message out across every selected channel to
// every resolved recipient, and logs one 'broadcasts' record summarizing
// the result. Channel failures (e.g. SMTP/Twilio not configured) don't
// block the other channels — each is attempted independently.
router.post('/send', requirePermission('communication:send'), async (req, res) => {
    try {
        const { title, message, channels, targetType, targetValue } = req.body;

        if (!title || !message || !message.trim()) {
            return res.status(400).json({ success: false, message: 'Title and message are required' });
        }
        const validChannels = ['push', 'email', 'whatsapp', 'sms'];
        const selectedChannels = (Array.isArray(channels) ? channels : []).filter(c => validChannels.includes(c));
        if (selectedChannels.length === 0) {
            return res.status(400).json({ success: false, message: 'Select at least one channel' });
        }

        const students = resolveCommunicationTargets(targetType, targetValue);
        if (students.length === 0) {
            return res.status(400).json({ success: false, message: 'No students match this target — nothing was sent' });
        }

        const channelResults = {
            push: { sent: 0, failed: 0 },
            email: { sent: 0, failed: 0 },
            whatsapp: { sent: 0, failed: 0 },
            sms: { sent: 0, failed: 0 },
        };

        for (const student of students) {
            if (selectedChannels.includes('push')) {
                try {
                    await notificationService.createNotification(student._id, 'broadcast', title, message.trim());
                    channelResults.push.sent += 1;
                } catch (err) {
                    channelResults.push.failed += 1;
                }
            }
            if (selectedChannels.includes('email')) {
                const result = await sendMail({
                    to: student.email,
                    subject: title,
                    html: `<p>${message.trim().replace(/\n/g, '<br>')}</p><p>— Chawla Classes</p>`,
                });
                channelResults.email[result.sent ? 'sent' : 'failed'] += 1;
            }
            if (selectedChannels.includes('whatsapp')) {
                const result = await sendWhatsApp({ to: student.phone, body: `*${title}*\n\n${message.trim()}` });
                channelResults.whatsapp[result.sent ? 'sent' : 'failed'] += 1;
            }
            if (selectedChannels.includes('sms')) {
                const result = await sendSms({ to: student.phone, body: `${title}: ${message.trim()}` });
                channelResults.sms[result.sent ? 'sent' : 'failed'] += 1;
            }
        }

        const broadcast = db.insertOne('broadcasts', {
            title,
            message: message.trim(),
            channels: selectedChannels,
            targetType,
            targetValue: targetValue || null,
            recipientCount: students.length,
            channelResults,
            sentBy: req.user?.id || 'admin',
            sentByName: req.user?.name || 'Admin',
        });

        logAudit(req, 'create', 'broadcast', broadcast._id, `Sent "${title}" to ${students.length} student(s) via ${selectedChannels.join(', ')}`);

        res.status(201).json({
            success: true,
            data: broadcast,
            message: `Sent to ${students.length} student(s) via ${selectedChannels.join(', ')}`
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Send history, newest first
router.get('/history', requirePermission('communication:view'), (req, res) => {
    try {
        const history = db.find('broadcasts', {}).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
        res.json({ success: true, data: history });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;