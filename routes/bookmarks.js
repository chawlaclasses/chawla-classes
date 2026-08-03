// routes/bookmarks.js
"use strict";

const express = require('express');
const router = express.Router();
const bookmarkController = require('../controllers/student/bookmarkController');
const { requireApiStudent } = require('../middleware/apiAuth');

router.use(requireApiStudent);

// Toggle bookmark (add/remove)
router.post('/toggle/:questionId', 
    bookmarkController.toggleBookmark
);

// Get all bookmarks
router.get('/', 
    bookmarkController.getBookmarks
);

// Get bookmarked questions
router.get('/questions', 
    bookmarkController.getBookmarkedQuestions
);

// Update bookmark category
router.put('/:questionId/category', 
    bookmarkController.updateCategory
);

// Add note to bookmark
router.put('/:questionId/note', 
    bookmarkController.addNote
);

// Review bookmark
router.post('/:questionId/review', 
    bookmarkController.reviewBookmark
);

// Get bookmark categories
router.get('/categories', 
    bookmarkController.getCategories
);

// Export bookmarks
router.get('/export', 
    bookmarkController.exportBookmarks
);

module.exports = router;