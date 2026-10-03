// utils/profileFields.js
//
// Shared helpers for the Edit Student / Edit Staff work:
//
//  * Optional-email parsing  — email is OPTIONAL everywhere. A blank value is
//    valid ("no email"); a non-blank value must be a well-formed address.
//  * Optional text cleaning  — trims + length-caps free-text profile fields.
//  * Attendance matching     — the legacy `attendance` collection was keyed by
//    the student's EMAIL. Now that a student may have no email, every blank-
//    email student would "match" every other blank-email student's records
//    (and overwrite them). These helpers match on studentId first and only
//    fall back to email for old records that predate studentId, and never
//    match on a blank email.

"use strict";

const db = require('../services/jsonDb');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Interprets an `email` value from a request body.
 *   undefined / null      -> { provided: false }           (leave email untouched)
 *   '' / '   '            -> { provided: true, value: '' } (clear / leave blank — valid)
 *   'a@b.co'              -> { provided: true, value: 'a@b.co' } (lower-cased, trimmed)
 *   'not-an-email'        -> { provided: true, error: '...' }
 *   non-string (object…)  -> { provided: true, error: '...' }
 */
function parseOptionalEmail(raw) {
    if (raw === undefined || raw === null) return { provided: false };
    if (typeof raw !== 'string') return { provided: true, error: 'Enter a valid email address' };
    const value = raw.trim().toLowerCase();
    if (value === '') return { provided: true, value: '' };
    if (value.length > 254 || !EMAIL_RE.test(value)) return { provided: true, error: 'Enter a valid email address' };
    return { provided: true, value };
}

/**
 * Trims an optional free-text field. Returns { provided, value, error }.
 * undefined/null -> not provided. Non-strings and over-long values are errors.
 */
function parseOptionalText(raw, label, maxLen) {
    if (raw === undefined || raw === null) return { provided: false };
    if (typeof raw !== 'string') return { provided: true, error: `${label} must be text` };
    const value = raw.trim();
    if (value.length > maxLen) return { provided: true, error: `${label} cannot exceed ${maxLen} characters` };
    return { provided: true, value };
}

/** Optional phone: blank is fine, otherwise 7-15 chars of digits and common separators. */
function parseOptionalPhone(raw, label) {
    const t = parseOptionalText(raw, label, 20);
    if (!t.provided || t.error || t.value === '') return t;
    const digits = t.value.replace(/[^\d]/g, '');
    if (!/^[\d\s()+-]+$/.test(t.value) || digits.length < 7 || digits.length > 15) {
        return { provided: true, error: `${label} must be 7–15 digits` };
    }
    return t;
}

/** Optional YYYY-MM-DD date: blank is fine. */
function parseOptionalDate(raw, label) {
    const t = parseOptionalText(raw, label, 10);
    if (!t.provided || t.error || t.value === '') return t;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.value) || Number.isNaN(Date.parse(t.value))) {
        return { provided: true, error: `${label} must be a valid date` };
    }
    return t;
}

// ── Attendance matching ───────────────────────────────────────────────────

function attendanceMatches(record, student) {
    if (!record || !student) return false;
    if (record.studentId) return record.studentId === student._id;
    return !!student.email && !!record.email && record.email === student.email;
}

function attendanceRecordsFor(student) {
    return db.find('attendance', {}).filter(a => attendanceMatches(a, student));
}

function findAttendanceOn(student, date) {
    return db.find('attendance', {}).find(a => a.date === date && attendanceMatches(a, student)) || null;
}

/**
 * Before a student's email changes (or is cleared), stamp their studentId onto
 * the old email-keyed attendance rows so history is not orphaned.
 */
function pinAttendanceToStudent(student) {
    if (!student || !student.email) return 0;
    let n = 0;
    for (const a of db.find('attendance', {})) {
        if (!a.studentId && a.email === student.email) {
            db.updateById('attendance', a._id, { studentId: student._id });
            n++;
        }
    }
    return n;
}

module.exports = {
    EMAIL_RE,
    parseOptionalEmail,
    parseOptionalText,
    parseOptionalPhone,
    parseOptionalDate,
    attendanceMatches,
    attendanceRecordsFor,
    findAttendanceOn,
    pinAttendanceToStudent,
};
