// services/analytics.js
//
// FIX: this file did not exist at all. controllers/student/analyticsController.js
// required it (`require('../../services/analytics')`) and called nine methods
// on it, so every request to /api/analytics/* was crashing with
// "Cannot find module '../../services/analytics'" before this file existed.
//
// Implemented against the real result/test schema actually written by
// routes/studentRoutes.js (POST /tests/submit): results are keyed by
// studentId/testId, store marksObtained/totalMarks/percentage/timeTaken/
// correctAnswers/incorrectAnswers/unansweredQuestions/questionWiseAnalysis,
// and rank/totalStudents once computed.

"use strict";

const db = require('./jsonDb');

function periodCutoff(period) {
    const now = new Date();
    if (period === 'week') return new Date(now.setDate(now.getDate() - 7));
    if (period === 'month') return new Date(now.setMonth(now.getMonth() - 1));
    if (period === 'year') return new Date(now.setFullYear(now.getFullYear() - 1));
    return null; // 'all'
}

function inPeriod(result, cutoff) {
    if (!cutoff) return true;
    return new Date(result.createdAt) >= cutoff;
}

function sortedResultsFor(studentId) {
    return db.find('results', { studentId })
        .slice()
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

// Join each questionWiseAnalysis entry with its question's subject/chapter/difficulty.
function annotatedAnswers(result) {
    return (result.questionWiseAnalysis || []).map(qa => {
        const question = db.findById('testQuestions', qa.questionId) || db.findById('questions', qa.questionId);
        return {
            ...qa,
            subject: question?.subject || 'Unknown',
            chapter: question?.chapter || 'Unknown',
            difficulty: question?.difficulty || 'medium'
        };
    });
}

class AnalyticsService {
    async getDashboardAnalytics(studentId, period = 'month') {
        const cutoff = periodCutoff(period);
        const results = sortedResultsFor(studentId).filter(r => inPeriod(r, cutoff));

        const totalTests = results.length;
        const totalTimeSpent = results.reduce((sum, r) => sum + (r.timeTaken || 0), 0);
        const averagePercentage = totalTests
            ? Math.round(results.reduce((s, r) => s + (r.percentage || 0), 0) / totalTests)
            : 0;
        const bestPercentage = totalTests
            ? Math.max(...results.map(r => r.percentage || 0))
            : 0;
        const passRate = totalTests
            ? Math.round((results.filter(r => r.isPassed).length / totalTests) * 100)
            : 0;

        return {
            period,
            totalTests,
            averagePercentage,
            bestPercentage,
            passRate,
            totalTimeSpent,
            recentResults: results.slice(-5).reverse().map(r => ({
                id: r._id,
                testId: r.testId,
                percentage: r.percentage,
                isPassed: r.isPassed,
                date: r.createdAt
            }))
        };
    }

    async getPerformanceTrends(studentId, period = 'week') {
        const cutoff = periodCutoff(period);
        const results = sortedResultsFor(studentId).filter(r => inPeriod(r, cutoff));

        return results.map(r => ({
            date: r.createdAt,
            testId: r.testId,
            percentage: r.percentage,
            marksObtained: r.marksObtained,
            totalMarks: r.totalMarks
        }));
    }

    async getSubjectAnalysis(studentId) {
        const results = sortedResultsFor(studentId);
        const bySubject = {};

        results.forEach(result => {
            const test = db.findById('tests', result.testId);
            const subject = test?.subjectName || test?.subject || 'Unknown';
            if (!bySubject[subject]) {
                bySubject[subject] = { total: 0, correct: 0, tests: 0, percentageSum: 0 };
            }
            bySubject[subject].tests++;
            bySubject[subject].percentageSum += result.percentage || 0;
            bySubject[subject].correct += result.correctAnswers || 0;
            bySubject[subject].total += (result.correctAnswers || 0) + (result.incorrectAnswers || 0) + (result.unansweredQuestions || 0);
        });

        return Object.entries(bySubject).map(([subject, s]) => ({
            subject,
            testsAttempted: s.tests,
            accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
            averagePercentage: s.tests > 0 ? Math.round(s.percentageSum / s.tests) : 0
        }));
    }

    async getChapterAnalysis(studentId, subject) {
        const results = sortedResultsFor(studentId);
        const byChapter = {};

        results.forEach(result => {
            annotatedAnswers(result).forEach(qa => {
                if (subject && qa.subject !== subject) return;
                if (!byChapter[qa.chapter]) byChapter[qa.chapter] = { total: 0, correct: 0 };
                byChapter[qa.chapter].total++;
                if (qa.isCorrect) byChapter[qa.chapter].correct++;
            });
        });

        return Object.entries(byChapter).map(([chapter, c]) => {
            const accuracy = c.total > 0 ? Math.round((c.correct / c.total) * 100) : 0;
            return {
                chapter,
                totalQuestions: c.total,
                accuracy,
                status: accuracy > 70 ? 'strong' : accuracy > 40 ? 'medium' : 'weak'
            };
        });
    }

    async getDifficultyAnalysis(studentId) {
        const results = sortedResultsFor(studentId);
        const byDifficulty = { easy: { total: 0, correct: 0 }, medium: { total: 0, correct: 0 }, hard: { total: 0, correct: 0 } };

        results.forEach(result => {
            annotatedAnswers(result).forEach(qa => {
                const d = byDifficulty[qa.difficulty] ? qa.difficulty : 'medium';
                byDifficulty[d].total++;
                if (qa.isCorrect) byDifficulty[d].correct++;
            });
        });

        return Object.entries(byDifficulty).map(([difficulty, d]) => ({
            difficulty,
            totalQuestions: d.total,
            accuracy: d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0
        }));
    }

    async getTimeAnalysis(studentId) {
        const results = sortedResultsFor(studentId);
        if (results.length === 0) {
            return { averageTimePerTest: 0, averageTimePerQuestion: 0, trend: [] };
        }

        const totalTime = results.reduce((s, r) => s + (r.timeTaken || 0), 0);
        const totalQuestions = results.reduce(
            (s, r) => s + (r.correctAnswers || 0) + (r.incorrectAnswers || 0) + (r.unansweredQuestions || 0),
            0
        );

        return {
            averageTimePerTest: Math.round(totalTime / results.length),
            averageTimePerQuestion: totalQuestions > 0 ? Math.round(totalTime / totalQuestions) : 0,
            trend: results.map(r => ({ date: r.createdAt, timeTaken: r.timeTaken || 0 }))
        };
    }

    async getImprovementGraph(studentId, testsCount = 10) {
        const results = sortedResultsFor(studentId).slice(-testsCount);
        return results.map((r, i) => ({
            testNumber: i + 1,
            date: r.createdAt,
            percentage: r.percentage,
            delta: i > 0 ? Math.round((r.percentage - results[i - 1].percentage) * 100) / 100 : 0
        }));
    }

    async getRankTrend(studentId, period = 'month') {
        const cutoff = periodCutoff(period);
        const results = sortedResultsFor(studentId)
            .filter(r => inPeriod(r, cutoff) && r.rank);

        return results.map(r => ({
            date: r.createdAt,
            testId: r.testId,
            rank: r.rank,
            totalStudents: r.totalStudents || null
        }));
    }

    // Progress from Practice Mode sessions (separate from formal test
    // results above) — aggregated per-question rather than per-session, so
    // a mixed "Any subject" session still attributes each answer to the
    // right subject/chapter.
    async getPracticeProgress(studentId) {
        const sessions = await db.find('practice_sessions', { studentId, status: 'completed' });
        const bySubject = {};
        const byChapter = {};
        let totalAnswered = 0;
        let totalCorrect = 0;
        let lastPracticedAt = null;

        sessions.forEach(session => {
            if (!session.completedAt) return;
            if (!lastPracticedAt || session.completedAt > lastPracticedAt) {
                lastPracticedAt = session.completedAt;
            }

            (session.questions || []).forEach(q => {
                const ans = session.answers?.[q.id];
                if (!ans) return; // skipped, not answered

                totalAnswered++;
                if (ans.isCorrect) totalCorrect++;

                const subject = q.subject || 'General';
                bySubject[subject] = bySubject[subject] || { attempted: 0, correct: 0 };
                bySubject[subject].attempted++;
                if (ans.isCorrect) bySubject[subject].correct++;

                if (q.chapter) {
                    const key = `${subject} :: ${q.chapter}`;
                    byChapter[key] = byChapter[key] || { subject, chapter: q.chapter, attempted: 0, correct: 0 };
                    byChapter[key].attempted++;
                    if (ans.isCorrect) byChapter[key].correct++;
                }
            });
        });

        const [wrongPending, wrongImproved] = await Promise.all([
            db.find('wrong_questions', { studentId, improved: false }),
            db.find('wrong_questions', { studentId, improved: true })
        ]);

        return {
            sessionsCompleted: sessions.length,
            totalQuestionsAnswered: totalAnswered,
            overallAccuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
            lastPracticedAt,
            subjects: Object.entries(bySubject)
                .map(([subject, s]) => ({
                    subject,
                    attempted: s.attempted,
                    accuracy: s.attempted > 0 ? Math.round((s.correct / s.attempted) * 100) : 0
                }))
                .sort((a, b) => b.attempted - a.attempted),
            chapters: Object.values(byChapter)
                .map(c => ({
                    subject: c.subject,
                    chapter: c.chapter,
                    attempted: c.attempted,
                    accuracy: c.attempted > 0 ? Math.round((c.correct / c.attempted) * 100) : 0,
                    status: c.attempted === 0 ? 'unknown' : (c.correct / c.attempted) > 0.7 ? 'strong' : (c.correct / c.attempted) > 0.4 ? 'medium' : 'weak'
                }))
                .sort((a, b) => b.attempted - a.attempted),
            wrongQuestionsPending: wrongPending.length,
            wrongQuestionsImproved: wrongImproved.length
        };
    }

    async exportReport(studentId, format = 'json') {
        const [dashboard, subjects, difficulty] = await Promise.all([
            this.getDashboardAnalytics(studentId, 'all'),
            this.getSubjectAnalysis(studentId),
            this.getDifficultyAnalysis(studentId)
        ]);

        const report = { generatedAt: new Date().toISOString(), studentId, dashboard, subjects, difficulty };

        if (format !== 'pdf') return report;

        const PDFDocument = require('pdfkit');
        const student = db.findById('students', studentId);
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));

        doc.fontSize(20).fillColor('#c9a84c').text('Chawla Classes', { align: 'center' });
        doc.fontSize(13).fillColor('#666').text('Performance Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(11).fillColor('#333').text(`Student: ${student?.name || studentId}`);
        doc.text(`Generated: ${new Date().toLocaleString()}`);
        doc.moveDown();
        doc.fontSize(14).fillColor('#c9a84c').text('Overview');
        doc.fontSize(11).fillColor('#333')
            .text(`Tests attempted: ${dashboard.totalTests}`)
            .text(`Average score: ${dashboard.averagePercentage}%`)
            .text(`Best score: ${dashboard.bestPercentage}%`)
            .text(`Pass rate: ${dashboard.passRate}%`);
        doc.moveDown();
        doc.fontSize(14).fillColor('#c9a84c').text('Subject-wise accuracy');
        doc.fontSize(11).fillColor('#333');
        subjects.forEach(s => doc.text(`${s.subject}: ${s.accuracy}% (${s.testsAttempted} tests)`));

        return await new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.end();
        });
    }
}

module.exports = new AnalyticsService();