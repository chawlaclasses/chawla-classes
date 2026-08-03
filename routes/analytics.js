// routes/analytics.js
"use strict";

const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/student/analyticsController');
const { requireApiStudent } = require('../middleware/apiAuth');

router.use(requireApiStudent);

// Get dashboard analytics
router.get('/dashboard', 
    analyticsController.getDashboardAnalytics
);

// Get performance trends
router.get('/performance-trends', 
    analyticsController.getPerformanceTrends
);

// Get subject-wise analysis
router.get('/subject-analysis', 
    analyticsController.getSubjectAnalysis
);

// Get chapter-wise analysis
router.get('/chapter-analysis', 
    analyticsController.getChapterAnalysis
);

// Get difficulty analysis
router.get('/difficulty-analysis', 
    analyticsController.getDifficultyAnalysis
);

// Get time analysis
router.get('/time-analysis', 
    analyticsController.getTimeAnalysis
);

// Get improvement graph
router.get('/improvement-graph', 
    analyticsController.getImprovementGraph
);

// Get leaderboard position trend
router.get('/rank-trend', 
    analyticsController.getRankTrend
);

// Get progress from Practice Mode (separate from formal test results)
router.get('/practice-progress',
    analyticsController.getPracticeProgress
);

// Export analytics report
router.get('/export', 
    analyticsController.exportReport
);

module.exports = router;