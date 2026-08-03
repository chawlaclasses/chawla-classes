const express = require('express');
const router = express.Router();
const db = require('../services/jsonDb');

// ============================================================
// Get all questions (from question bank)
// ============================================================
router.get('/', (req, res) => {
    try {
        // FIX: findAll() was returning soft-deleted questions too, since
        // nothing filtered on isActive. That's why a "successful" delete
        // (which only sets isActive:false) never actually disappeared
        // from the list.
        const questions = db.find('questions', { isActive: true });
        res.json({
            success: true,
            data: questions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Get question by ID
// ============================================================
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const question = db.findById('questions', id);

        // FIX: also treat a soft-deleted question as "not found" when
        // fetched directly, so edit/view screens can't reopen a deleted
        // question either.
        if (!question || question.isActive === false) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }

        res.json({
            success: true,
            data: question
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Create question
// ============================================================
router.post('/', (req, res) => {
    try {
        const { questionText, options, correctAnswer, explanation, marks, type, chapter } = req.body;

        if (!questionText || !options || !correctAnswer) {
            return res.status(400).json({
                success: false,
                message: 'Question text, options, and correct answer are required'
            });
        }

        const newQuestion = db.insertOne('questions', {
            questionText,
            chapter: chapter || 'Uncategorized',
            options,
            correctAnswer,
            explanation: explanation || '',
            marks: marks || 1,
            type: type || 'mcq',
            isActive: true,
            createdBy: req.user?.id || 'admin'
        });

        res.status(201).json({
            success: true,
            data: newQuestion,
            message: 'Question added successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Update question
// ============================================================
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { questionText, chapter, options, correctAnswer, explanation, marks, type, isActive } = req.body;

        const question = db.findById('questions', id);
        if (!question || question.isActive === false) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }

        const updated = db.findByIdAndUpdate('questions', id, {
            questionText: questionText || question.questionText,
            chapter: chapter !== undefined ? chapter : question.chapter,
            options: options || question.options,
            correctAnswer: correctAnswer || question.correctAnswer,
            explanation: explanation !== undefined ? explanation : question.explanation,
            marks: marks || question.marks,
            type: type || question.type,
            isActive: isActive !== undefined ? isActive : question.isActive
        });

        res.json({
            success: true,
            data: updated,
            message: 'Question updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Delete question (soft delete)
// ============================================================
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;

        const question = db.findById('questions', id);
        if (!question || question.isActive === false) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }

        // Soft delete
        db.findByIdAndUpdate('questions', id, { isActive: false });

        res.json({
            success: true,
            message: 'Question deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;