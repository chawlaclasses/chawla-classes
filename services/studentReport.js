// services/studentReport.js
"use strict";

const db = require('./jsonDb');
const { feeWithComputed } = require('./feeCalc');
const gamificationService = require('./gamification');

class StudentReportService {
    async getReportData(studentId) {
        const student = db.findById('users', studentId);
        if (!student) {
            throw Object.assign(new Error('Student not found'), { status: 404 });
        }

        const cls = student.classId ? db.findById('classes', student.classId) : null;

        const [attendance, results, fees, homework, submissions, gamification] = await Promise.all([
            db.find('attendance', { email: student.email }),
            db.find('results', { studentId }),
            db.find('fees-v2', { studentId }),
            student.classId ? db.find('homework', { classId: student.classId, isActive: true }) : [],
            db.find('homeworkSubmissions', { studentId }),
            gamificationService.getGamificationData(student._id).catch(() => null)
        ]);

        // Attendance
        const present = attendance.filter(a => a.status === 'Present').length;
        const absent = attendance.filter(a => a.status === 'Absent').length;
        const totalDays = present + absent;
        const attendanceSummary = {
            present,
            absent,
            totalDays,
            percentage: totalDays > 0 ? Math.round((present / totalDays) * 1000) / 10 : 0
        };

        // Results (tests)
        const passedResults = results.filter(r => r.isPassed);
        const resultsSummary = {
            testsAttempted: results.length,
            averagePercentage: results.length
                ? Math.round(results.reduce((sum, r) => sum + r.percentage, 0) / results.length * 10) / 10
                : 0,
            bestPercentage: results.length ? Math.max(...results.map(r => r.percentage)) : 0,
            passRate: results.length ? Math.round((passedResults.length / results.length) * 1000) / 10 : 0
        };

        // Fees — reuse the canonical computed fields so this never drifts
        // from what admin/student fee pages themselves show.
        const feesComputed = fees.map(feeWithComputed);
        const feesSummary = {
            totalBilled: feesComputed.reduce((sum, f) => sum + f.netPayable, 0),
            totalPaid: feesComputed.filter(f => f.status === 'Paid').reduce((sum, f) => sum + f.netPayable, 0),
            totalPending: feesComputed.filter(f => f.status !== 'Paid').reduce((sum, f) => sum + f.netPayable, 0),
            overdueCount: feesComputed.filter(f => f.isOverdue).length,
            records: feesComputed
        };

        // Homework
        const gradedSubmissions = submissions.filter(s => s.status === 'graded');
        const homeworkSummary = {
            assigned: homework.length,
            submitted: submissions.length,
            graded: gradedSubmissions.length,
            averageScore: gradedSubmissions.length
                ? Math.round(gradedSubmissions.reduce((sum, s) => sum + (s.marksAwarded || 0), 0) / gradedSubmissions.length * 10) / 10
                : null
        };

        return {
            student: {
                name: student.name,
                email: student.email,
                rollNumber: student.rollNumber || '',
                className: cls?.displayName || cls?.name || 'Not Assigned'
            },
            attendance: attendanceSummary,
            results: resultsSummary,
            fees: feesSummary,
            homework: homeworkSummary,
            gamification: gamification ? {
                level: gamification.level?.level,
                levelTitle: gamification.level?.title,
                xp: gamification.xp,
                streak: gamification.streak
            } : null,
            generatedAt: new Date().toISOString()
        };
    }
    async toPdfBuffer(studentId) {
        const data = await this.getReportData(studentId);
        const { createPdfDoc, finalizePdf, renderHeader, renderSectionTitle, renderKeyValueGrid } = require('../utils/reportGenerator');

        const { doc, chunks } = createPdfDoc();

        renderHeader(doc, {
            title: 'Student Report',
            meta: [
                `Student: ${data.student.name} (${data.student.rollNumber || 'No Roll No.'})`,
                `Class: ${data.student.className}`
            ]
        });

        renderSectionTitle(doc, 'Attendance');
        renderKeyValueGrid(doc, [
            ['Present', data.attendance.present],
            ['Absent', data.attendance.absent],
            ['Attendance %', `${data.attendance.percentage}%`]
        ]);

        renderSectionTitle(doc, 'Test Results');
        renderKeyValueGrid(doc, [
            ['Tests Attempted', data.results.testsAttempted],
            ['Average Score', `${data.results.averagePercentage}%`],
            ['Best Score', `${data.results.bestPercentage}%`],
            ['Pass Rate', `${data.results.passRate}%`]
        ]);

        renderSectionTitle(doc, 'Fees');
        renderKeyValueGrid(doc, [
            ['Total Billed', `Rs. ${data.fees.totalBilled}`],
            ['Total Paid', `Rs. ${data.fees.totalPaid}`],
            ['Pending', `Rs. ${data.fees.totalPending}`],
            ['Overdue Installments', data.fees.overdueCount]
        ]);

        renderSectionTitle(doc, 'Homework');
        renderKeyValueGrid(doc, [
            ['Assigned', data.homework.assigned],
            ['Submitted', data.homework.submitted],
            ['Graded', data.homework.graded],
            ['Average Score', data.homework.averageScore ?? 'N/A']
        ]);

        if (data.gamification) {
            renderSectionTitle(doc, 'Engagement');
            renderKeyValueGrid(doc, [
                ['Level', `${data.gamification.level} — ${data.gamification.levelTitle || ''}`],
                ['XP', data.gamification.xp],
                ['Current Streak', `${data.gamification.streak} day(s)`]
            ]);
        }

        return finalizePdf(doc, chunks);
    }

    async toCsv(studentId) {
        const data = await this.getReportData(studentId);
        const { toCSV } = require('../utils/reportGenerator');

        const rows = [
            { metric: 'Student Name', value: data.student.name },
            { metric: 'Roll Number', value: data.student.rollNumber },
            { metric: 'Class', value: data.student.className },
            { metric: 'Attendance %', value: data.attendance.percentage },
            { metric: 'Days Present', value: data.attendance.present },
            { metric: 'Days Absent', value: data.attendance.absent },
            { metric: 'Tests Attempted', value: data.results.testsAttempted },
            { metric: 'Average Test Score %', value: data.results.averagePercentage },
            { metric: 'Best Test Score %', value: data.results.bestPercentage },
            { metric: 'Pass Rate %', value: data.results.passRate },
            { metric: 'Fees Billed', value: data.fees.totalBilled },
            { metric: 'Fees Paid', value: data.fees.totalPaid },
            { metric: 'Fees Pending', value: data.fees.totalPending },
            { metric: 'Overdue Installments', value: data.fees.overdueCount },
            { metric: 'Homework Assigned', value: data.homework.assigned },
            { metric: 'Homework Submitted', value: data.homework.submitted },
            { metric: 'Homework Graded', value: data.homework.graded },
            { metric: 'Homework Average Score', value: data.homework.averageScore ?? '' }
        ];

        return toCSV([{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }], rows);
    }
}

module.exports = new StudentReportService();