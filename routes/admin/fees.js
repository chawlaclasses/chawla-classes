// routes/admin/fees.js
//
// Fee Management — installments, discounts, scholarships, late fines,
// PDF receipts, online-payment status tracking, and pending-fee
// reminders — on top of the original minimal CRUD (list / create /
// mark-paid). Extracted out of routes/adminRoutes.js (refactor,
// 2026-07). Mounted at '/fees' by routes/adminRoutes.js, so the final
// URLs (/api/admin/fees, /api/admin/fees/:id, /api/admin/fees/plan,
// /api/admin/fees/remind-bulk, etc.) are unchanged.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { validate } = require('../../middleware/validation');
const validators = require('../../utils/validators');
const { feeWithComputed } = require('../../services/feeCalc');
const { streamFeeReceipt } = require('../../utils/feeReceipt');
const { sendMail } = require('../../utils/mailer');

// Attaches student/class display info on top of the shared feeWithComputed()
// numbers (net payable, overdue status, suggested late fine).
function feeWithStudent(fee) {
  const student = db.findById('users', fee.studentId);
  const cls = student?.classId ? db.findById('classes', student.classId) : null;
  return {
    ...feeWithComputed(fee),
    studentName: student ? student.name : fee.studentId,
    studentEmail: student ? student.email : null,
    className: cls ? (cls.displayName || cls.name) : null,
  };
}

// List fee records — filter by status/studentId/classId/feePlanId/overdue-only
router.get('/', requirePermission('fees:view'), (req, res) => {
    try {
        const { status, studentId, classId, feePlanId, overdue } = req.query;
        let fees = db.find('fees-v2', {});
        if (status) fees = fees.filter(f => f.status === status);
        if (studentId) fees = fees.filter(f => f.studentId === studentId);
        if (feePlanId) fees = fees.filter(f => f.feePlanId === feePlanId);
        fees = fees.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        fees = fees.map(feeWithStudent);
        if (classId) fees = fees.filter(f => {
            const student = db.findById('users', f.studentId);
            return student && student.classId === classId;
        });
        if (overdue === 'true') fees = fees.filter(f => f.isOverdue);
        res.json({ success: true, data: fees });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Create a single pending fee record for a student (discount/scholarship optional)
router.post('/', requirePermission('fees:create'), (req, res) => {
    try {
        const { studentId, amount, dueDate, description, title, discountAmount, discountReason, scholarshipAmount, scholarshipReason } = req.body;
        if (!studentId || !amount || !dueDate) {
            return res.status(400).json({ success: false, message: 'studentId, amount and dueDate are required' });
        }
        const student = db.findById('users', studentId);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        const fee = db.insertOne('fees-v2', {
            studentId,
            feePlanId: null,
            installmentNumber: 1,
            totalInstallments: 1,
            title: title || description || 'Fee Payment',
            amount: parseFloat(amount),
            discountAmount: parseFloat(discountAmount) || 0,
            discountReason: discountReason || '',
            scholarshipAmount: parseFloat(scholarshipAmount) || 0,
            scholarshipReason: scholarshipReason || '',
            lateFineAmount: 0,
            dueDate,
            description: description || '',
            status: 'Pending',
            paidDate: null,
            paymentMethod: null,
            paymentStatus: 'not_initiated',
            transactionId: null,
            receiptNumber: null,
            remindersSent: [],
            createdBy: req.user?.id || 'admin'
        });
        logAudit(req, 'create', 'fee', fee._id, `Added fee of ₹${fee.amount} for ${student.name}`);
        res.json({ success: true, data: feeWithStudent(fee), message: 'Fee record created' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Create a full installment plan — splits totalAmount across N installments,
// spaced intervalDays apart, all sharing a feePlanId. The last installment
// absorbs any rounding remainder so the installments always sum to exactly
// totalAmount.
router.post('/plan', requirePermission('fees:create'), (req, res) => {
    try {
        const {
            studentId, totalAmount, installments, firstDueDate, intervalDays,
            title, discountAmount, discountReason, scholarshipAmount, scholarshipReason
        } = req.body;

        const count = parseInt(installments, 10);
        const total = parseFloat(totalAmount);
        const gapDays = parseInt(intervalDays, 10) || 30;

        if (!studentId || !total || !count || count < 1 || !firstDueDate) {
            return res.status(400).json({ success: false, message: 'studentId, totalAmount, installments and firstDueDate are required' });
        }
        const student = db.findById('users', studentId);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const discount = parseFloat(discountAmount) || 0;
        const scholarship = parseFloat(scholarshipAmount) || 0;
        const perInstallmentAmount = Math.floor((total / count) * 100) / 100;
        const perInstallmentDiscount = Math.floor((discount / count) * 100) / 100;
        const perInstallmentScholarship = Math.floor((scholarship / count) * 100) / 100;

        const feePlanId = db.generateId();
        const created = [];

        for (let i = 0; i < count; i += 1) {
            const isLast = i === count - 1;
            const dueDate = new Date(firstDueDate);
            dueDate.setDate(dueDate.getDate() + i * gapDays);

            const amount = isLast
                ? Math.round((total - perInstallmentAmount * (count - 1)) * 100) / 100
                : perInstallmentAmount;
            const instDiscount = isLast
                ? Math.round((discount - perInstallmentDiscount * (count - 1)) * 100) / 100
                : perInstallmentDiscount;
            const instScholarship = isLast
                ? Math.round((scholarship - perInstallmentScholarship * (count - 1)) * 100) / 100
                : perInstallmentScholarship;

            const fee = db.insertOne('fees-v2', {
                studentId,
                feePlanId,
                installmentNumber: i + 1,
                totalInstallments: count,
                title: title || 'Fee Payment',
                amount,
                discountAmount: instDiscount,
                discountReason: discountReason || '',
                scholarshipAmount: instScholarship,
                scholarshipReason: scholarshipReason || '',
                lateFineAmount: 0,
                dueDate: dueDate.toISOString(),
                description: `Installment ${i + 1} of ${count}`,
                status: 'Pending',
                paidDate: null,
                paymentMethod: null,
                paymentStatus: 'not_initiated',
                transactionId: null,
                receiptNumber: null,
                remindersSent: [],
                createdBy: req.user?.id || 'admin'
            });
            created.push(fee);
        }

        logAudit(req, 'create', 'fee', feePlanId, `Created ${count}-installment fee plan (₹${total}) for ${student.name}`);
        res.status(201).json({ success: true, data: created.map(feeWithStudent), message: `${count} installments created` });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Edit an unpaid fee's amount/discount/scholarship/due date
router.put('/:id', requirePermission('fees:edit'), validators.updateFee, validate, (req, res) => {
    try {
        const fee = db.findById('fees-v2', req.params.id);
        if (!fee) {
            return res.status(404).json({ success: false, message: 'Fee record not found' });
        }
        if (fee.status === 'Paid') {
            return res.status(400).json({ success: false, message: 'Cannot edit a fee that has already been paid' });
        }
        const { amount, dueDate, title, discountAmount, discountReason, scholarshipAmount, scholarshipReason } = req.body;
        const updates = {};
        if (amount !== undefined) updates.amount = parseFloat(amount);
        if (dueDate !== undefined) updates.dueDate = dueDate;
        if (title !== undefined) updates.title = title;
        if (discountAmount !== undefined) updates.discountAmount = parseFloat(discountAmount) || 0;
        if (discountReason !== undefined) updates.discountReason = discountReason;
        if (scholarshipAmount !== undefined) updates.scholarshipAmount = parseFloat(scholarshipAmount) || 0;
        if (scholarshipReason !== undefined) updates.scholarshipReason = scholarshipReason;

        const updated = db.findByIdAndUpdate('fees-v2', req.params.id, updates);
        logAudit(req, 'edit', 'fee', req.params.id, `Updated fee record`);
        res.json({ success: true, data: feeWithStudent(updated), message: 'Fee updated' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Delete an unpaid fee record (e.g. created by mistake)
router.delete('/:id', requirePermission('fees:edit'), (req, res) => {
    try {
        const fee = db.findById('fees-v2', req.params.id);
        if (!fee) {
            return res.status(404).json({ success: false, message: 'Fee record not found' });
        }
        if (fee.status === 'Paid') {
            return res.status(400).json({ success: false, message: 'Cannot delete a fee that has already been paid' });
        }
        db.deleteById('fees-v2', req.params.id);
        logAudit(req, 'delete', 'fee', req.params.id, `Deleted unpaid fee record`);
        res.json({ success: true, message: 'Fee record deleted' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Apply (or clear) a late fine — defaults to the day-based suggestion if no
// amount is given, but the admin can always override.
router.put('/:id/apply-late-fine', requirePermission('fees:edit'), validators.applyLateFine, validate, (req, res) => {
    try {
        const fee = db.findById('fees-v2', req.params.id);
        if (!fee) {
            return res.status(404).json({ success: false, message: 'Fee record not found' });
        }
        const { lateFineAmount } = req.body;
        const amount = lateFineAmount !== undefined
            ? Math.max(0, parseFloat(lateFineAmount) || 0)
            : feeWithComputed(fee).suggestedLateFine;

        const updated = db.findByIdAndUpdate('fees-v2', req.params.id, { lateFineAmount: amount });
        logAudit(req, 'edit', 'fee', req.params.id, `Applied late fine of ₹${amount}`);
        res.json({ success: true, data: feeWithStudent(updated), message: 'Late fine applied' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Update online-payment status without necessarily marking the fee fully
// paid yet (e.g. "processing" while a UPI payment is being confirmed).
router.put('/:id/payment-status', requirePermission('fees:edit'), (req, res) => {
    try {
        const { paymentStatus, transactionId } = req.body;
        const validStatuses = ['not_initiated', 'processing', 'success', 'failed'];
        if (!validStatuses.includes(paymentStatus)) {
            return res.status(400).json({ success: false, message: `paymentStatus must be one of: ${validStatuses.join(', ')}` });
        }
        const fee = db.findById('fees-v2', req.params.id);
        if (!fee) {
            return res.status(404).json({ success: false, message: 'Fee record not found' });
        }
        const updates = { paymentStatus };
        if (transactionId !== undefined) updates.transactionId = transactionId;
        const updated = db.findByIdAndUpdate('fees-v2', req.params.id, updates);
        logAudit(req, 'edit', 'fee', req.params.id, `Payment status set to "${paymentStatus}"`);
        res.json({ success: true, data: feeWithStudent(updated), message: 'Payment status updated' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Mark a fee record as paid — records how (cash/online/UPI/etc.), generates
// a receipt number, and stamps paidDate.
router.put('/:id/mark-paid', requirePermission('fees:edit'), validators.markFeePaid, validate, (req, res) => {
    try {
        const fee = db.findById('fees-v2', req.params.id);
        if (!fee) {
            return res.status(404).json({ success: false, message: 'Fee record not found' });
        }
        const { paymentMethod, transactionId } = req.body;

        const paidCount = db.find('fees-v2', {}).filter(f => f.receiptNumber).length;
        const receiptNumber = `RCPT-${new Date().getFullYear()}-${String(paidCount + 1).padStart(5, '0')}`;

        const updated = db.findByIdAndUpdate('fees-v2', req.params.id, {
            status: 'Paid',
            paidDate: new Date().toISOString(),
            paymentMethod: paymentMethod || 'cash',
            paymentStatus: 'success',
            transactionId: transactionId || fee.transactionId || null,
            receiptNumber,
        });
        logAudit(req, 'edit', 'fee', req.params.id, `Marked fee of ₹${fee.amount} as paid (${paymentMethod || 'cash'}), receipt ${receiptNumber}`);
        res.json({ success: true, data: feeWithStudent(updated), message: 'Fee marked as paid' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Download the PDF receipt for a paid fee
router.get('/:id/receipt', requirePermission('fees:view'), (req, res) => {
    try {
        const fee = db.findById('fees-v2', req.params.id);
        if (!fee) {
            return res.status(404).json({ success: false, message: 'Fee record not found' });
        }
        if (fee.status !== 'Paid') {
            return res.status(400).json({ success: false, message: 'Receipt is only available once the fee is paid' });
        }
        const student = db.findById('users', fee.studentId);
        const cls = student?.classId ? db.findById('classes', student.classId) : null;
        streamFeeReceipt(
            feeWithComputed(fee),
            { ...student, className: cls ? (cls.displayName || cls.name) : null },
            res
        );
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Send a pending-fee reminder email to one student
router.post('/:id/remind', requirePermission('fees:edit'), async (req, res) => {
    try {
        const fee = db.findById('fees-v2', req.params.id);
        if (!fee) {
            return res.status(404).json({ success: false, message: 'Fee record not found' });
        }
        if (fee.status === 'Paid') {
            return res.status(400).json({ success: false, message: 'This fee is already paid' });
        }
        const student = db.findById('users', fee.studentId);
        const computed = feeWithComputed(fee);

        const result = await sendMail({
            to: student?.email,
            subject: `Fee Reminder — ₹${computed.netPayable} due${computed.isOverdue ? ' (overdue)' : ''}`,
            html: `
                <p>Dear ${student?.name || 'Student'},</p>
                <p>This is a reminder that a fee payment of <strong>₹${computed.netPayable}</strong>
                   (${fee.title || 'Fee Payment'}) was due on <strong>${new Date(fee.dueDate).toLocaleDateString('en-IN')}</strong>.</p>
                ${computed.isOverdue ? `<p>This payment is currently <strong>${computed.daysOverdue} day(s) overdue</strong>. Please clear it at the earliest to avoid a late fine.</p>` : ''}
                <p>Please contact the office if you've already paid or have any questions.</p>
                <p>— Chawla Classes</p>
            `,
        });

        const remindersSent = [...(fee.remindersSent || []), { sentAt: new Date().toISOString(), emailSent: result.sent, reason: result.reason || null }];
        db.findByIdAndUpdate('fees-v2', req.params.id, { remindersSent });

        logAudit(req, 'edit', 'fee', req.params.id, `Sent pending-fee reminder (email ${result.sent ? 'sent' : 'not sent: ' + result.reason})`);
        res.json({
            success: true,
            data: { emailSent: result.sent, reason: result.reason || null },
            message: result.sent ? 'Reminder email sent' : `Reminder logged, but email was not sent (${result.reason})`
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Bulk-remind every currently overdue (or all pending, if includeUpcoming) fee
router.post('/remind-bulk', requirePermission('fees:edit'), async (req, res) => {
    try {
        const { includeUpcoming } = req.body;
        const pending = db.find('fees-v2', { status: 'Pending' }).map(feeWithComputed);
        const targets = includeUpcoming ? pending : pending.filter(f => f.isOverdue);

        let sent = 0;
        let failed = 0;
        for (const fee of targets) {
            const student = db.findById('users', fee.studentId);
            const result = await sendMail({
                to: student?.email,
                subject: `Fee Reminder — ₹${fee.netPayable} due${fee.isOverdue ? ' (overdue)' : ''}`,
                html: `
                    <p>Dear ${student?.name || 'Student'},</p>
                    <p>This is a reminder that a fee payment of <strong>₹${fee.netPayable}</strong>
                       (${fee.title || 'Fee Payment'}) was due on <strong>${new Date(fee.dueDate).toLocaleDateString('en-IN')}</strong>.</p>
                    ${fee.isOverdue ? `<p>This payment is currently <strong>${fee.daysOverdue} day(s) overdue</strong>.</p>` : ''}
                    <p>— Chawla Classes</p>
                `,
            });
            if (result.sent) sent += 1; else failed += 1;
            const remindersSent = [...(fee.remindersSent || []), { sentAt: new Date().toISOString(), emailSent: result.sent, reason: result.reason || null }];
            db.findByIdAndUpdate('fees-v2', fee._id, { remindersSent });
        }

        logAudit(req, 'edit', 'fee', null, `Bulk fee reminders: ${sent} sent, ${failed} failed (${targets.length} targeted)`);
        res.json({ success: true, data: { targeted: targets.length, sent, failed }, message: `Reminders sent to ${sent} student(s)${failed ? `, ${failed} failed` : ''}` });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;