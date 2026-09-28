/**
 * utils/studentTimeline.js
 *
 * Builds one chronological timeline per student out of data that already
 * lives in separate collections (admission, attendance, fees, tests,
 * results, notifications). Nothing here writes data — it's a read-only
 * aggregator so the Student Timeline UI has one endpoint to call instead
 * of stitching together five API responses client-side.
 *
 * NOTE on Certificates: there is no certificate-issuance feature in this
 * codebase — the "certificates: 3" figure shown on the student gamification
 * dashboard (controllers/student/dashboardController.js) is a hardcoded
 * placeholder, not real data. This builder does NOT invent certificate
 * entries; buildStudentTimeline() always returns an empty certificates
 * list today. If/when a real certificate feature is built (a collection +
 * an admin "issue certificate" action), wire its events in here the same
 * way the other categories are wired below — the frontend timeline
 * already has a "certificate" type ready to render.
 */

"use strict";

const db = require('../services/jsonDb');

/**
 * @param {object} student - a full user record with role === 'student'
 * @returns {Array<{type:string, icon:string, title:string, subtitle:string, date:string}>}
 *          sorted newest-first
 */
function buildStudentTimeline(student) {
    const events = [];

    // ── Admission ──────────────────────────────────────────────────────
    events.push({
        type: 'admission',
        icon: '🎓',
        title: 'Admitted',
        subtitle: 'Joined Chawla Classes',
        date: student.createdAt,
    });

    // ── Attendance ─────────────────────────────────────────────────────
    const attendanceRecords = db.find('attendance', { email: student.email });
    attendanceRecords.forEach(a => {
        events.push({
            type: 'attendance',
            icon: a.status === 'Present' ? '✅' : '❌',
            title: `Marked ${a.status || 'Unknown'}`,
            subtitle: a.class || '',
            date: new Date(a.date).toISOString(),
        });
    });

    // ── Fee Payments (current fees-v2 module — created + paid events) ──
    const fees = db.find('fees-v2', { studentId: student._id });
    fees.forEach(f => {
        events.push({
            type: 'fee',
            icon: '💰',
            title: `Fee of ₹${f.amount} added${f.description ? ` — ${f.description}` : ''}`,
            subtitle: `Due ${f.dueDate}`,
            date: f.createdAt,
        });
        if (f.status === 'Paid' && f.paidDate) {
            events.push({
                type: 'fee',
                icon: '✅',
                title: `Paid ₹${f.amount}`,
                subtitle: f.description || '',
                date: f.paidDate,
            });
        }
    });

    // ── Tests (attempt started) ─────────────────────────────────────────
    const attempts = db.find('studentAttempts', { studentId: student._id });
    attempts.forEach(a => {
        const test = db.findById('tests', a.testId);
        events.push({
            type: 'test',
            icon: '📝',
            title: `Started test "${test ? test.title : 'Unknown test'}"`,
            subtitle: a.isSubmitted ? 'Submitted' : 'In progress',
            date: a.startTime || a.createdAt,
        });
    });

    // ── Results (test graded) ───────────────────────────────────────────
    const results = db.find('results', { studentId: student._id }).filter(r => r.testId);
    results.forEach(r => {
        const test = db.findById('tests', r.testId);
        events.push({
            type: 'result',
            icon: r.isPassed ? '🏅' : '📊',
            title: `Result: "${test ? test.title : 'Unknown test'}" — ${r.percentage}%`,
            subtitle: r.isPassed ? 'Passed' : 'Not passed',
            date: r.createdAt,
        });
    });

    // ── Certificates — no data source yet, see file header note above ──
    // (intentionally no events pushed)

    // ── Notifications ───────────────────────────────────────────────────
    const notifications = db.find('notifications', { userId: student._id });
    notifications.forEach(n => {
        events.push({
            type: 'notification',
            icon: '🔔',
            title: n.title || 'Notification',
            subtitle: n.message || '',
            date: n.createdAt,
        });
    });

    events.sort((a, b) => new Date(b.date) - new Date(a.date));
    return events;
}

module.exports = { buildStudentTimeline };
