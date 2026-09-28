// routes/practice.js
"use strict";

const express = require('express');
const router = express.Router();
const practiceController = require('../controllers/student/practiceController');
const { requireApiStudent } = require('../middleware/apiAuth');

// All routes require authentication
router.use(requireApiStudent);

// Get available subjects/chapters/difficulties for the practice setup screen
router.get('/filters',
    practiceController.getFilters
);

// Start practice session
router.post('/start', 
    practiceController.startPractice
);

// Get question
router.get('/question/:sessionId', 
    practiceController.getQuestion
);

// Submit answer
router.post('/answer/:sessionId', 
    practiceController.submitAnswer
);

// Complete session
router.post('/complete/:sessionId', 
    practiceController.completeSession
);

// Get session stats
router.get('/stats/:sessionId', 
    practiceController.getSessionStats
);

// Get practice history
router.get('/history', 
    practiceController.getPracticeHistory
);

// Get wrong questions
router.get('/wrong-questions', 
    practiceController.getWrongQuestions
);

// Mark wrong question as improved
router.put('/wrong-questions/:questionId/improved', 
    practiceController.markImproved
);

// Get practice recommendations
router.get('/recommendations', 
    practiceController.getRecommendations
);

module.exports = router;