// controllers/student/analyticsController.js
"use strict";

const analyticsService = require('../../services/analytics');
const { asyncHandler } = require('../../utils/errorHandler');

exports.getDashboardAnalytics = asyncHandler(async (req, res) => {
    const { period = 'month' } = req.query;
    const analytics = await analyticsService.getDashboardAnalytics(req.user.id, period);
    
    res.json({
        success: true,
        data: analytics
    });
});

exports.getPerformanceTrends = asyncHandler(async (req, res) => {
    const { period = 'week' } = req.query;
    const trends = await analyticsService.getPerformanceTrends(req.user.id, period);
    
    res.json({
        success: true,
        data: trends
    });
});

exports.getSubjectAnalysis = asyncHandler(async (req, res) => {
    const analysis = await analyticsService.getSubjectAnalysis(req.user.id);
    
    res.json({
        success: true,
        data: analysis
    });
});

exports.getChapterAnalysis = asyncHandler(async (req, res) => {
    const { subject } = req.query;
    const analysis = await analyticsService.getChapterAnalysis(req.user.id, subject);
    
    res.json({
        success: true,
        data: analysis
    });
});

exports.getDifficultyAnalysis = asyncHandler(async (req, res) => {
    const analysis = await analyticsService.getDifficultyAnalysis(req.user.id);
    
    res.json({
        success: true,
        data: analysis
    });
});

exports.getTimeAnalysis = asyncHandler(async (req, res) => {
    const analysis = await analyticsService.getTimeAnalysis(req.user.id);
    
    res.json({
        success: true,
        data: analysis
    });
});

exports.getImprovementGraph = asyncHandler(async (req, res) => {
    const { tests = 10 } = req.query;
    const graph = await analyticsService.getImprovementGraph(req.user.id, parseInt(tests));
    
    res.json({
        success: true,
        data: graph
    });
});

exports.getRankTrend = asyncHandler(async (req, res) => {
    const { period = 'month' } = req.query;
    const trend = await analyticsService.getRankTrend(req.user.id, period);
    
    res.json({
        success: true,
        data: trend
    });
});

exports.getPracticeProgress = asyncHandler(async (req, res) => {
    const progress = await analyticsService.getPracticeProgress(req.user.id);

    res.json({
        success: true,
        data: progress
    });
});

exports.exportReport = asyncHandler(async (req, res) => {
    const { format = 'pdf' } = req.query;
    const report = await analyticsService.exportReport(req.user.id, format);
    
    if (format === 'pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=performance-report.pdf');
        res.send(report);
    } else {
        res.json({
            success: true,
            data: report
        });
    }
});