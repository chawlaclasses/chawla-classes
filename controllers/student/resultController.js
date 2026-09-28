// controllers/student/resultsController.js
"use strict";

const db = require('../../services/jsonDb');
const { asyncHandler } = require('../../middleware/error');
const { AppError } = require('../../middleware/error');
const logger = require('../../utils/logger');
const PDFDocument = require('pdfkit');

// ─── Get Results ────────────────────────────────────────────────────────────
exports.getResults = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { subject, limit = 50, page = 1 } = req.query;

    const query = { userId };
    if (subject) query.subject = subject;

    const results = await db.find('results', query, {
        sort: 'createdAt:desc',
        limit: parseInt(limit),
        page: parseInt(page)
    });

    res.json({
        success: true,
        data: results
    });
});

// ─── Get Result Detail ──────────────────────────────────────────────────────
exports.getResultDetail = asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const userId = req.user.id;

    const result = await db.findOne('results', { id: resultId, userId });
    if (!result) {
        throw new AppError('Result not found', 404);
    }

    // Get full analysis
    const analysis = await getResultAnalysis(resultId, userId);

    res.json({
        success: true,
        data: {
            ...result,
            analysis
        }
    });
});

// ─── Get Result Analysis ───────────────────────────────────────────────────
exports.getAnalysis = asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const userId = req.user.id;

    const analysis = await getResultAnalysis(resultId, userId);

    res.json({
        success: true,
        data: analysis
    });
});

// ─── Download Result ──────────────────────────────────────────────────────
exports.downloadResult = asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const { format = 'pdf' } = req.query;
    const userId = req.user.id;

    const result = await db.findOne('results', { id: resultId, userId });
    if (!result) {
        throw new AppError('Result not found', 404);
    }

    if (format === 'pdf') {
        await generatePDFResult(result, res);
    } else {
        res.json({
            success: true,
            data: result
        });
    }
});

// ─── Share Result ──────────────────────────────────────────────────────────
exports.shareResult = asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const userId = req.user.id;

    const result = await db.findOne('results', { id: resultId, userId });
    if (!result) {
        throw new AppError('Result not found', 404);
    }

    // Generate share link
    const shareId = require('crypto').randomBytes(16).toString('hex');
    await db.updateById('results', resultId, {
        shareId,
        sharedAt: new Date().toISOString()
    });

    res.json({
        success: true,
        data: {
            shareId,
            shareUrl: `${req.protocol}://${req.get('host')}/share/${shareId}`
        }
    });
});

// ─── Get Performance Trends ──────────────────────────────────────────────
exports.getTrends = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { period = 'month' } = req.query;

    const trends = await getPerformanceTrends(userId, period);

    res.json({
        success: true,
        data: trends
    });
});

// ─── Get Subject Analysis ──────────────────────────────────────────────────
exports.getSubjectAnalysis = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const analysis = await getSubjectAnalysis(userId);

    res.json({
        success: true,
        data: analysis
    });
});

// ─── Get Chapter Analysis ─────────────────────────────────────────────────
exports.getChapterAnalysis = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { subject } = req.query;

    if (!subject) {
        throw new AppError('Subject is required', 400);
    }

    const analysis = await getChapterAnalysis(userId, subject);

    res.json({
        success: true,
        data: analysis
    });
});

// ─── Get Comparison ──────────────────────────────────────────────────────
exports.getComparison = asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const userId = req.user.id;

    const result = await db.findOne('results', { id: resultId, userId });
    if (!result) {
        throw new AppError('Result not found', 404);
    }

    // Get previous results for comparison
    const previous = await db.find('results', {
        userId,
        subject: result.subject,
        createdAt: { $lt: result.createdAt }
    }, { sort: 'createdAt:desc', limit: 5 });

    res.json({
        success: true,
        data: {
            current: result,
            previous: previous.data,
            improvement: previous.data.length > 0 ? 
                ((result.score - previous.data[0].score) / previous.data[0].score * 100).toFixed(1) : 0
        }
    });
});

// ─── Helper Functions ─────────────────────────────────────────────────────

async function getResultAnalysis(resultId, userId) {
    const result = await db.findOne('results', { id: resultId, userId });
    if (!result) return null;

    // Get questions from this test
    const questions = await db.find('test_questions', { testId: result.testId });
    const answers = result.answers || {};

    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    let totalTime = 0;
    const subjectWise = {};
    const difficultyWise = { easy: 0, medium: 0, hard: 0 };

    questions.data.forEach(q => {
        const answer = answers[q.id];
        const isCorrect = answer?.isCorrect || false;
        const isSkipped = !answer;

        if (isCorrect) correct++;
        else if (isSkipped) skipped++;
        else wrong++;

        if (answer?.timeTaken) totalTime += answer.timeTaken;

        // Subject wise
        if (q.subject) {
            if (!subjectWise[q.subject]) {
                subjectWise[q.subject] = { total: 0, correct: 0 };
            }
            subjectWise[q.subject].total++;
            if (isCorrect) subjectWise[q.subject].correct++;
        }

        // Difficulty wise
        if (q.difficulty) {
            difficultyWise[q.difficulty] = (difficultyWise[q.difficulty] || 0) + 1;
        }
    });

    const total = questions.data.length;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    return {
        score: result.score,
        maxScore: result.maxScore || total,
        percentage: Math.round((result.score / (result.maxScore || total)) * 100),
        correct,
        wrong,
        skipped,
        accuracy,
        totalTime,
        averageTime: total > 0 ? Math.round(totalTime / total) : 0,
        subjectWise,
        difficultyWise,
        rank: result.rank || 'N/A',
        percentile: result.percentile || 0
    };
}

async function getPerformanceTrends(userId, period) {
    const results = await db.find('results', { userId }, { sort: 'createdAt:asc' });
    const data = results.data;

    if (data.length === 0) return [];

    let limit = period === 'week' ? 7 : period === 'month' ? 30 : data.length;
    const recent = data.slice(-limit);

    return recent.map(r => ({
        date: r.createdAt,
        score: Math.round((r.score / r.maxScore) * 100),
        testName: r.testName,
        subject: r.subject
    }));
}

async function getSubjectAnalysis(userId) {
    const results = await db.find('results', { userId });
    const subjectStats = {};

    results.data.forEach(result => {
        if (result.subjectWise) {
            Object.entries(result.subjectWise).forEach(([subject, data]) => {
                if (!subjectStats[subject]) {
                    subjectStats[subject] = { total: 0, correct: 0, tests: 0 };
                }
                subjectStats[subject].total += data.total || 0;
                subjectStats[subject].correct += data.correct || 0;
                subjectStats[subject].tests++;
            });
        }
    });

    return Object.entries(subjectStats).map(([subject, stats]) => ({
        subject,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
        totalQuestions: stats.total,
        testsAttempted: stats.tests,
        averageScore: stats.tests > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
    }));
}

async function getChapterAnalysis(userId, subject) {
    const results = await db.find('results', { userId, subject });
    const chapterStats = {};

    results.data.forEach(result => {
        if (result.chapterWise) {
            Object.entries(result.chapterWise).forEach(([chapter, data]) => {
                if (!chapterStats[chapter]) {
                    chapterStats[chapter] = { total: 0, correct: 0 };
                }
                chapterStats[chapter].total += data.total || 0;
                chapterStats[chapter].correct += data.correct || 0;
            });
        }
    });

    return Object.entries(chapterStats).map(([chapter, stats]) => ({
        chapter,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
        totalQuestions: stats.total,
        status: stats.total > 0 && (stats.correct / stats.total) > 0.7 ? 'strong' :
                stats.total > 0 && (stats.correct / stats.total) > 0.4 ? 'medium' : 'weak'
    }));
}

async function generatePDFResult(result, res) {
    try {
        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=result-${result.id}.pdf`);
        
        doc.pipe(res);

        // Header
        doc.fontSize(24)
           .fillColor('#c9a84c')
           .text('Chawla Classes', { align: 'center' });
        
        doc.fontSize(14)
           .fillColor('#666')
           .text('Student Result Report', { align: 'center' });

        doc.moveDown();

        // Student Info
        doc.fontSize(12)
           .fillColor('#333')
           .text(`Name: ${result.studentName || 'Student'}`);
        doc.text(`Test: ${result.testName}`);
        doc.text(`Date: ${new Date(result.createdAt).toLocaleDateString()}`);
        doc.text(`Subject: ${result.subject || 'General'}`);

        doc.moveDown();

        // Score Card
        const percentage = Math.round((result.score / result.maxScore) * 100);
        doc.fontSize(16)
           .fillColor('#c9a84c')
           .text('Score Card', { align: 'center' });
        
        doc.fontSize(14)
           .fillColor('#333')
           .text(`Score: ${result.score} / ${result.maxScore}`);
        doc.text(`Percentage: ${percentage}%`);
        if (result.rank) doc.text(`Rank: #${result.rank}`);

        doc.moveDown();

        // Analysis
        const analysis = await getResultAnalysis(result.id, result.userId);
        if (analysis) {
            doc.fontSize(16)
               .fillColor('#c9a84c')
               .text('Performance Analysis', { align: 'center' });
            
            doc.fontSize(12)
               .fillColor('#333')
               .text(`Correct: ${analysis.correct}`);
            doc.text(`Wrong: ${analysis.wrong}`);
            doc.text(`Skipped: ${analysis.skipped}`);
            doc.text(`Accuracy: ${analysis.accuracy}%`);
        }

        doc.moveDown();

        // Footer
        doc.fontSize(10)
           .fillColor('#999')
           .text('Generated by Chawla Classes Student Portal', { align: 'center' });
        doc.text(new Date().toLocaleString(), { align: 'center' });

        doc.end();

    } catch (error) {
        logger.error('PDF generation failed:', error);
        throw new AppError('Failed to generate PDF', 500);
    }
}