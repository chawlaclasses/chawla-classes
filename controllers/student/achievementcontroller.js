// controllers/student/achievementController.js
"use strict";

const gamificationService = require('../../services/gamification');
const { asyncHandler } = require('../../utils/errorHandler');

exports.getSummary = asyncHandler(async (req, res) => {
    const data = await gamificationService.getGamificationData(req.user.id);

    res.json({
        success: true,
        data
    });
});

exports.getCatalog = asyncHandler(async (req, res) => {
    const catalog = await gamificationService.getCatalogWithProgress(req.user.id);

    res.json({
        success: true,
        data: catalog
    });
});

exports.getLeaderboard = asyncHandler(async (req, res) => {
    // Scoped to the student's own class by default — a global leaderboard
    // across every class isn't a meaningful comparison for a student.
    const leaderboard = await gamificationService.getLeaderboard(req.userData?.classId || null, 100);

    res.json({
        success: true,
        data: leaderboard
    });
});

exports.getDailyReward = asyncHandler(async (req, res) => {
    const reward = await gamificationService.getDailyRewards(req.user.id);

    res.json({
        success: true,
        data: reward
    });
});

exports.claimDailyReward = asyncHandler(async (req, res) => {
    const reward = await gamificationService.claimDailyReward(req.user.id);

    res.json({
        success: true,
        data: reward
    });
});