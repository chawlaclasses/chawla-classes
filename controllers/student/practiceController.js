// controllers/student/practiceController.js
"use strict";

const practiceService = require('../../services/practice');
const gamificationService = require('../../services/gamification');
const { asyncHandler } = require('../../utils/errorHandler');
const { AppError } = require('../../utils/errorHandler');
const logger = require('../../utils/logger');

exports.getFilters = asyncHandler(async (req, res) => {
    const filters = await practiceService.getAvailableFilters();

    res.json({
        success: true,
        data: filters
    });
});

exports.startPractice = asyncHandler(async (req, res) => {
    const { subject, chapter, difficulty, questionType, count, random, bookmarked, wrong } = req.body;
    
    const session = await practiceService.startSession(req.user.id, {
        subject,
        chapter,
        difficulty,
        questionType,
        count: count || 10,
        random: random ?? true,
        bookmarked: bookmarked || false,
        wrong: wrong || false
    });

    res.json({
        success: true,
        data: {
            sessionId: session.id,
            totalQuestions: session.questions.length,
            questions: session.questions.map(q => ({
                id: q.id,
                text: q.text,
                options: q.options,
                type: q.type,
                difficulty: q.difficulty,
                marks: q.marks
            }))
        }
    });
});

exports.getQuestion = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const session = await practiceService.getSession(sessionId);
    
    if (!session) {
        throw new AppError('Session not found', 404);
    }

    if (session.studentId !== req.user.id) {
        throw new AppError('Unauthorized access', 403);
    }

    const question = session.questions[session.currentIndex];
    if (!question) {
        return res.json({
            success: true,
            data: {
                completed: true,
                stats: session.stats
            }
        });
    }

    res.json({
        success: true,
        data: {
            question: {
                id: question.id,
                text: question.text,
                options: question.options,
                type: question.type,
                difficulty: question.difficulty,
                marks: question.marks
            },
            currentIndex: session.currentIndex,
            totalQuestions: session.questions.length,
            progress: (session.currentIndex / session.questions.length) * 100
        }
    });
});

exports.submitAnswer = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { questionId, answer, timeTaken } = req.body;

    const result = await practiceService.submitAnswer(
        sessionId,
        questionId,
        answer,
        timeTaken || 0
    );

    // Update gamification
    if (result.isCorrect) {
        await gamificationService.addXP(req.user.id, 10, 'practice_correct');
        await gamificationService.addCoins(req.user.id, 5, 'practice_correct');
    } else {
        await gamificationService.addXP(req.user.id, 2, 'practice_wrong');
    }

    res.json({
        success: true,
        data: result
    });
});

exports.completeSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const session = await practiceService.completeSession(sessionId);

    // Update gamification (single source of truth for this session's rewards)
    await gamificationService.addXP(req.user.id, session.stats.correct * 5, 'practice_complete');
    await gamificationService.addCoins(req.user.id, session.stats.correct * 3, 'practice_complete');
    await gamificationService.updateStreak(req.user.id);

    // Check achievements
    await gamificationService.checkAchievements(req.user.id, 'questions_solved', {
        count: session.stats.answered
    });

    if (session.stats.total > 0 && session.stats.correct === session.stats.total) {
        await gamificationService.checkAchievements(req.user.id, 'test_completed', {
            score: 100
        });
    }

    if (session.subject && session.stats.answered > 0) {
        await gamificationService.checkAchievements(req.user.id, 'subject_master', {
            subject: session.subject,
            accuracy: session.stats.accuracy
        });
    }

    res.json({
        success: true,
        data: {
            stats: session.stats,
            xpEarned: session.stats.correct * 5,
            coinsEarned: session.stats.correct * 3
        }
    });
});

exports.getSessionStats = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const stats = await practiceService.getSessionStats(sessionId);
    
    res.json({
        success: true,
        data: stats
    });
});

exports.getPracticeHistory = asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;
    const history = await practiceService.getPracticeHistory(req.user.id, parseInt(limit));
    
    res.json({
        success: true,
        data: history
    });
});

exports.getWrongQuestions = asyncHandler(async (req, res) => {
    const { subject, chapter, limit = 50, improved } = req.query;
    const wrongQuestions = await practiceService.getWrongQuestions(req.user.id, {
        subject,
        chapter,
        limit: parseInt(limit),
        improved
    });
    
    res.json({
        success: true,
        data: wrongQuestions
    });
});

exports.markImproved = asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const result = await practiceService.markImproved(req.user.id, questionId);
    
    res.json({
        success: true,
        data: result
    });
});

exports.getRecommendations = asyncHandler(async (req, res) => {
    const recommendations = await practiceService.getRecommendations(req.user.id);
    
    res.json({
        success: true,
        data: recommendations
    });
});