// controllers/student/dailyTargetController.js
"use strict";

const dailyTargetsService = require('../../services/dailytargets');
const { asyncHandler } = require('../../utils/errorHandler');

exports.getToday = asyncHandler(async (req, res) => {
    const target = await dailyTargetsService.getToday(req.user.id);
    const streak = await dailyTargetsService.getTargetStreak(req.user.id);

    res.json({
        success: true,
        data: { ...target, streak }
    });
});

exports.updateToday = asyncHandler(async (req, res) => {
    const { targetQuestions, targetMinutes } = req.body;
    const target = await dailyTargetsService.updateToday(req.user.id, { targetQuestions, targetMinutes });

    res.json({
        success: true,
        data: target
    });
});

exports.getHistory = asyncHandler(async (req, res) => {
    const { days = 14 } = req.query;
    const history = await dailyTargetsService.getHistory(req.user.id, parseInt(days));

    res.json({
        success: true,
        data: history
    });
});