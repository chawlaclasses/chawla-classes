// controllers/student/bookmarkController.js
"use strict";

const bookmarkService = require('../../services/bookmarks');
const { asyncHandler } = require('../../utils/errorHandler');
const { AppError } = require('../../utils/errorHandler');

exports.toggleBookmark = asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { category = 'default' } = req.body;

    const result = await bookmarkService.addBookmark(
        req.user.id,
        questionId,
        category
    );

    res.json({
        success: true,
        data: result
    });
});

exports.getBookmarks = asyncHandler(async (req, res) => {
    const { category, subject, limit = 50 } = req.query;

    const bookmarks = await bookmarkService.getBookmarks(req.user.id, {
        category,
        subject,
        limit: parseInt(limit)
    });

    res.json({
        success: true,
        data: bookmarks
    });
});

exports.getBookmarkedQuestions = asyncHandler(async (req, res) => {
    const { category, subject, limit = 50 } = req.query;

    const questions = await bookmarkService.getBookmarkedQuestions(req.user.id, {
        category,
        subject,
        limit: parseInt(limit)
    });

    res.json({
        success: true,
        data: questions
    });
});

exports.updateCategory = asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { category } = req.body;

    if (!category) {
        throw new AppError('Category is required', 400);
    }

    const bookmark = await bookmarkService.updateBookmarkCategory(
        req.user.id,
        questionId,
        category
    );

    res.json({
        success: true,
        data: bookmark
    });
});

exports.addNote = asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { note } = req.body;

    if (!note) {
        throw new AppError('Note is required', 400);
    }

    const bookmark = await bookmarkService.addNote(
        req.user.id,
        questionId,
        note
    );

    res.json({
        success: true,
        data: bookmark
    });
});

exports.reviewBookmark = asyncHandler(async (req, res) => {
    const { questionId } = req.params;

    const bookmark = await bookmarkService.reviewBookmark(
        req.user.id,
        questionId
    );

    res.json({
        success: true,
        data: bookmark
    });
});

exports.getCategories = asyncHandler(async (req, res) => {
    const categories = await bookmarkService.getCategories(req.user.id);
    
    res.json({
        success: true,
        data: categories
    });
});

exports.exportBookmarks = asyncHandler(async (req, res) => {
    const { format = 'json' } = req.query;

    const exportData = await bookmarkService.exportBookmarks(
        req.user.id,
        format
    );

    if (format === 'json') {
        res.json({
            success: true,
            data: exportData
        });
    } else if (format === 'csv') {
        // Generate CSV
        const { headers, rows } = exportData;
        let csv = headers.join(',') + '\n';
        rows.forEach(row => {
            csv += row.map(cell => `"${cell}"`).join(',') + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=bookmarks.csv');
        res.send(csv);
    }
});