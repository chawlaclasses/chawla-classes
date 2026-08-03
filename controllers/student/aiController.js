// controllers/student/aiController.js
"use strict";

const aiService = require('../../services/ai');
const { asyncHandler } = require('../../utils/errorHandler');

exports.getSuggestions = asyncHandler(async (req, res) => {
    const suggestions = await aiService.getSuggestions(req.user.id);
    
    res.json({
        success: true,
        data: suggestions
    });
});

exports.getStudyPlanner = asyncHandler(async (req, res) => {
    const { days = 7 } = req.query;
    const planner = await aiService.getStudyPlanner(req.user.id, parseInt(days));
    
    res.json({
        success: true,
        data: planner
    });
});

exports.getRevisionPlan = asyncHandler(async (req, res) => {
    const plan = await aiService.getRevisionPlan(req.user.id);
    
    res.json({
        success: true,
        data: plan
    });
});

exports.getWeakAreas = asyncHandler(async (req, res) => {
    const weakAreas = await aiService.getWeakAreas(req.user.id);
    
    res.json({
        success: true,
        data: weakAreas
    });
});

exports.getStrongAreas = asyncHandler(async (req, res) => {
    const strongAreas = await aiService.getStrongAreas(req.user.id);
    
    res.json({
        success: true,
        data: strongAreas
    });
});

exports.getPracticeRecommendations = asyncHandler(async (req, res) => {
    const recommendations = await aiService.getPracticeSuggestions(req.user.id);
    
    res.json({
        success: true,
        data: recommendations
    });
});

exports.getDailyGoal = asyncHandler(async (req, res) => {
    const goal = await aiService.getDailyGoal(req.user.id);
    
    res.json({
        success: true,
        data: goal
    });
});

exports.getLearningPath = asyncHandler(async (req, res) => {
    const path = await aiService.getLearningPath(req.user.id);
    
    res.json({
        success: true,
        data: path
    });
});

exports.getChapterAnalysis = asyncHandler(async (req, res) => {
    const { subject } = req.params;
    const analysis = await aiService.getChapterAnalysis(req.user.id, subject);
    
    res.json({
        success: true,
        data: analysis
    });
});

exports.predictPerformance = asyncHandler(async (req, res) => {
    const prediction = await aiService.predictPerformance(req.user.id);

    res.json({
        success: true,
        data: prediction
    });
});

exports.getWeakTopicRecommendations = asyncHandler(async (req, res) => {
    const recommendations = await aiService.getWeakTopicRecommendations(req.user.id);

    res.json({
        success: true,
        data: recommendations
    });
});