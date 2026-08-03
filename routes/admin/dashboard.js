// routes/admin/dashboard.js
//
// Admin Dashboard data — three read-only aggregation endpoints powering
// the "Admin Dashboard Overview" page and its analytics/charts. Combined
// into one file (rather than three) since they're tightly related and
// each individually small. Every number here is computed from real,
// existing data; nothing is a hardcoded placeholder — where a number
// genuinely can't be computed yet, it comes back as null so the UI can
// say "No data" honestly. Extracted out of routes/adminRoutes.js
// (refactor, 2026-07). Mounted at '/' by routes/adminRoutes.js, so the
// final URLs (/api/admin/dashboard-overview, /api/admin/dashboard-analytics,
// /api/admin/analytics-dashboards) are unchanged.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { requirePermission } = require('../../middleware/permissions');

router.get('/dashboard-overview', requirePermission('dashboard:view'), (req, res) => {
    try {
        const students = db.find('users', { role: 'student' });
        const totalStudents = students.length;
        const activeStudents = students.filter(s => s.isActive !== false).length;

        const now = new Date();
        const todayCandidates = new Set([
            now.toLocaleDateString('en-US'),
            `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`,
            now.toISOString().slice(0, 10)
        ]);
        const attendanceRecords = db.find('attendance', {});
        const todayRecords = attendanceRecords.filter(a => todayCandidates.has(a.date));
        const presentToday = todayRecords.filter(a => (a.status || '').toLowerCase() === 'present').length;
        const todayAttendance = todayRecords.length > 0
            ? { present: presentToday, total: todayRecords.length, percentage: Math.round((presentToday / todayRecords.length) * 100) }
            : { present: 0, total: 0, percentage: null };

        const feeRecords = db.find('fees-v2', {});
        const paidToday = feeRecords.filter(f => f.status === 'Paid' && f.paidDate && f.paidDate.slice(0, 10) === now.toISOString().slice(0, 10));
        const todayRevenue = paidToday.reduce((sum, f) => sum + (f.amount || 0), 0);
        const pendingFeesList = feeRecords.filter(f => f.status !== 'Paid');
        const pendingFees = {
            count: pendingFeesList.length,
            total: pendingFeesList.reduce((sum, f) => sum + (f.amount || 0), 0)
        };

        const tests = db.find('tests', { isPublished: true, isDeleted: false });
        const upcomingTests = tests
            .slice()
            .sort((a, b) => new Date(a.startDate || a.createdAt) - new Date(b.startDate || b.createdAt))
            .slice(0, 5)
            .map(t => {
                const subject = db.findById('subjects', t.subjectId);
                return {
                    title: t.title,
                    subject: subject ? subject.name : 'Unknown',
                    date: t.startDate ? new Date(t.startDate).toLocaleDateString() : 'Not scheduled'
                };
            });

        const recentAdmissions = students
            .slice()
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5)
            .map(s => {
                const cls = s.classId ? db.findById('classes', s.classId) : null;
                return {
                    name: s.name,
                    email: s.email,
                    class: cls ? (cls.displayName || cls.name) : 'Not assigned',
                    joinedAt: s.createdAt
                };
            });

        const enquiries = db.find('enquiries', {});
        const newEnquiries = enquiries.filter(e => (e.status || 'new') === 'new');
        const recentEnquiries = enquiries
            .slice()
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5);

        const results = db.find('results', {}).filter(r => r.studentId && r.testId);
        const latestResults = results
            .slice()
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5)
            .map(r => {
                const student = db.findById('users', r.studentId);
                const test = db.findById('tests', r.testId);
                return {
                    studentName: student ? student.name : 'Unknown',
                    testTitle: test ? test.title : 'Unknown Test',
                    percentage: r.percentage || 0,
                    isPassed: r.isPassed || false,
                    date: r.createdAt
                };
            });

        const mem = process.memoryUsage();
        const serverStatus = {
            status: 'online',
            uptimeSeconds: Math.floor(process.uptime()),
            memoryUsedMB: Math.round(mem.rss / 1024 / 1024),
            nodeVersion: process.version
        };

        res.json({
            success: true,
            data: {
                totalStudents,
                activeStudents,
                todayAttendance,
                todayRevenue,
                pendingFees,
                upcomingTests,
                recentAdmissions,
                newEnquiries: { count: newEnquiries.length, recent: recentEnquiries },
                latestResults,
                serverStatus
            }
        });
    } catch (error) {
        logger.error(`Dashboard overview failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({
            success: false,
            message: 'Failed to load dashboard overview'
        });
    }
});

router.get('/dashboard-analytics', requirePermission('dashboard:view'), (req, res) => {
    try {
        const now = new Date();
        const students = db.find('users', { role: 'student' });

        const admissionsThisMonth = students.filter(s => {
            const d = new Date(s.createdAt);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length;

        const feeRecords = db.find('fees-v2', { status: 'Paid' });
        const feeGraph = [];
        for (let i = 6; i >= 0; i--) {
            const day = new Date(now);
            day.setDate(day.getDate() - i);
            const dayStr = day.toISOString().slice(0, 10);
            const dayTotal = feeRecords
                .filter(f => f.paidDate && f.paidDate.slice(0, 10) === dayStr)
                .reduce((sum, f) => sum + (f.amount || 0), 0);
            feeGraph.push({ date: dayStr, amount: dayTotal });
        }

        const todayStr = now.toISOString().slice(0, 10);
        const dailyActiveStudents = students.filter(
            s => s.lastLoginAt && s.lastLoginAt.slice(0, 10) === todayStr
        ).length;

        const allResults = db.find('results', {}).filter(r => r.studentId && r.testId);
        const studentsWithAttempts = new Set(allResults.map(r => r.studentId));
        const activeStudentCount = students.filter(s => s.isActive !== false).length;
        const testCompletionRate = activeStudentCount > 0
            ? Math.round((studentsWithAttempts.size / activeStudentCount) * 100)
            : null;

        const byStudent = {};
        allResults.forEach(r => {
            if (!byStudent[r.studentId]) byStudent[r.studentId] = [];
            byStudent[r.studentId].push(r.percentage || 0);
        });
        const topPerformers = Object.entries(byStudent)
            .map(([studentId, percentages]) => {
                const student = db.findById('users', studentId);
                const avg = percentages.reduce((a, b) => a + b, 0) / percentages.length;
                return {
                    name: student ? student.name : 'Unknown',
                    testsAttempted: percentages.length,
                    averageScore: Math.round(avg)
                };
            })
            .sort((a, b) => b.averageScore - a.averageScore)
            .slice(0, 5);

        const byClass = {};
        allResults.forEach(r => {
            const student = db.findById('users', r.studentId);
            if (!student || !student.classId) return;
            if (!byClass[student.classId]) byClass[student.classId] = [];
            byClass[student.classId].push(r.percentage || 0);
        });
        const weakClasses = Object.entries(byClass)
            .map(([classId, percentages]) => {
                const cls = db.findById('classes', classId);
                const avg = percentages.reduce((a, b) => a + b, 0) / percentages.length;
                return {
                    className: cls ? (cls.displayName || cls.name) : 'Unknown',
                    testsAttempted: percentages.length,
                    averageScore: Math.round(avg)
                };
            })
            .sort((a, b) => a.averageScore - b.averageScore)
            .slice(0, 5);

        const timeline = [];
        students.slice(-10).forEach(s => timeline.push({
            type: 'admission', text: `${s.name} was admitted`, date: s.createdAt
        }));
        allResults.slice(-10).forEach(r => {
            const student = db.findById('users', r.studentId);
            const test = db.findById('tests', r.testId);
            timeline.push({
                type: 'test',
                text: `${student ? student.name : 'A student'} attempted ${test ? test.title : 'a test'} (${r.percentage || 0}%)`,
                date: r.createdAt
            });
        });
        feeRecords.slice(-10).forEach(f => {
            const student = db.findById('users', f.studentId);
            timeline.push({
                type: 'payment',
                text: `${student ? student.name : 'A student'} paid ₹${f.amount}`,
                date: f.paidDate
            });
        });
        db.find('enquiries', {}).slice(-10).forEach(e => timeline.push({
            type: 'enquiry', text: `New enquiry from ${e.name}`, date: e.createdAt
        }));
        timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({
            success: true,
            data: {
                admissionsThisMonth,
                feeCollectionGraph: feeGraph,
                dailyActiveStudents,
                testCompletionRate,
                topPerformers,
                weakClasses,
                activityTimeline: timeline.slice(0, 10)
            }
        });
    } catch (error) {
        logger.error(`Dashboard analytics failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({
            success: false,
            message: 'Failed to load dashboard analytics'
        });
    }
});

router.get('/analytics-dashboards', requirePermission('dashboard:view'), (req, res) => {
    try {
        const now = new Date();
        const students = db.find('users', { role: 'student' });
        const activeStudents = students.filter(s => s.isActive !== false);

        const admissionGrowth = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            const count = students.filter(s => {
                const sd = new Date(s.createdAt);
                return sd.getMonth() === d.getMonth() && sd.getFullYear() === d.getFullYear();
            }).length;
            admissionGrowth.push({ month: monthLabel, count });
        }

        const allFees = db.find('fees-v2', {});
        const feeCollection = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            const collected = allFees
                .filter(f => f.status === 'Paid' && f.paidDate && new Date(f.paidDate).getMonth() === d.getMonth() && new Date(f.paidDate).getFullYear() === d.getFullYear())
                .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
            const pending = allFees
                .filter(f => f.status !== 'Paid' && f.dueDate && new Date(f.dueDate).getMonth() === d.getMonth() && new Date(f.dueDate).getFullYear() === d.getFullYear())
                .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
            feeCollection.push({ month: monthLabel, collected, pending });
        }
        const totalCollected = allFees.filter(f => f.status === 'Paid').reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
        const totalPending = allFees.filter(f => f.status !== 'Paid').reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

        const allResultsForParticipation = db.find('results', {}).filter(r => r.testId);
        const tests = db.find('tests', { isPublished: true });
        const testParticipation = tests.map(t => {
            const eligible = activeStudents.filter(s => s.classId === t.classId).length;
            const attempted = new Set(allResultsForParticipation.filter(r => r.testId === t._id).map(r => r.studentId)).size;
            return {
                testTitle: t.title,
                eligible,
                attempted,
                participationRate: eligible > 0 ? Math.round((attempted / eligible) * 100) : 0
            };
        }).sort((a, b) => b.attempted - a.attempted).slice(0, 10);

        const allQuestions = db.find('questions', {});
        const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
        allQuestions.forEach(q => {
            const d = ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium';
            difficultyCounts[d]++;
        });
        const questionDifficulty = Object.entries(difficultyCounts).map(([difficulty, count]) => ({ difficulty, count }));

        const allResults = db.find('results', {}).filter(r => r.testId);
        const bySubject = {};
        allResults.forEach(r => {
            const test = db.findById('tests', r.testId);
            if (!test || !test.subjectId) return;
            if (!bySubject[test.subjectId]) bySubject[test.subjectId] = [];
            bySubject[test.subjectId].push(r.percentage || 0);
        });
        const subjectPerformance = Object.entries(bySubject).map(([subjectId, percentages]) => {
            const subject = db.findById('subjects', subjectId);
            const avg = percentages.reduce((a, b) => a + b, 0) / percentages.length;
            return {
                subjectName: subject ? subject.name : 'Unknown',
                averageScore: Math.round(avg),
                testsAttempted: percentages.length
            };
        }).sort((a, b) => b.averageScore - a.averageScore);

        const allAttendance = db.find('attendance', {});
        const studentEngagement = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateLabel = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
            const dayRecords = allAttendance.filter(a => a.date === dateLabel);
            const presentCount = dayRecords.filter(a => a.status === 'Present').length;
            studentEngagement.push({
                date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                attendanceRate: dayRecords.length > 0 ? Math.round((presentCount / dayRecords.length) * 100) : null,
                marked: dayRecords.length
            });
        }

        res.json({
            success: true,
            data: {
                admissionGrowth,
                feeCollection: { monthly: feeCollection, totalCollected, totalPending },
                testParticipation,
                questionDifficulty,
                subjectPerformance,
                studentEngagement
            }
        });
    } catch (error) {
        logger.error(`Analytics dashboards failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Failed to load analytics' });
    }
});

module.exports = router;