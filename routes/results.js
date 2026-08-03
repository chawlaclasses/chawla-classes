const express = require('express');
const router = express.Router();
const db = require('../services/jsonDb');

// ============================================================
// Get all results
// ============================================================
router.get('/', (req, res) => {
    try {
        const results = db.findAll('results');
        
        // Populate student and test details
        const populatedResults = results.map(r => {
            const student = db.findById('users', r.studentId);
            const test = db.findById('tests', r.testId);
            return {
                ...r,
                studentId: student ? { _id: student._id, name: student.name, email: student.email } : null,
                testId: test ? { _id: test._id, title: test.title } : null
            };
        });
        
        res.json({
            success: true,
            data: populatedResults
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Get result by ID
// ============================================================
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const result = db.findById('results', id);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Result not found'
            });
        }
        
        // Populate student and test details
        const student = db.findById('users', result.studentId);
        const test = db.findById('tests', result.testId);
        
        const populatedResult = {
            ...result,
            studentId: student ? { _id: student._id, name: student.name, email: student.email } : null,
            testId: test ? { _id: test._id, title: test.title, totalMarks: test.totalMarks } : null
        };
        
        res.json({
            success: true,
            data: populatedResult
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Create result
// ============================================================
router.post('/', (req, res) => {
    try {
        const { studentId, testId, marksObtained, totalMarks, percentage, isPassed, answers } = req.body;
        
        if (!studentId || !testId) {
            return res.status(400).json({
                success: false,
                message: 'Student ID and Test ID are required'
            });
        }
        
        const newResult = db.insertOne('results', {
            studentId,
            testId,
            marksObtained: marksObtained || 0,
            totalMarks: totalMarks || 0,
            percentage: percentage || 0,
            isPassed: isPassed || false,
            answers: answers || [],
            createdAt: new Date().toISOString()
        });
        
        res.status(201).json({
            success: true,
            data: newResult,
            message: 'Result saved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Update result
// ============================================================
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { marksObtained, totalMarks, percentage, isPassed, answers } = req.body;
        
        const result = db.findById('results', id);
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Result not found'
            });
        }
        
        const updated = db.findByIdAndUpdate('results', id, {
            marksObtained: marksObtained !== undefined ? marksObtained : result.marksObtained,
            totalMarks: totalMarks !== undefined ? totalMarks : result.totalMarks,
            percentage: percentage !== undefined ? percentage : result.percentage,
            isPassed: isPassed !== undefined ? isPassed : result.isPassed,
            answers: answers || result.answers
        });
        
        res.json({
            success: true,
            data: updated,
            message: 'Result updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Delete result
// ============================================================
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        const result = db.findById('results', id);
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Result not found'
            });
        }
        
        db.findByIdAndDelete('results', id);
        
        res.json({
            success: true,
            message: 'Result deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Get results by student
// ============================================================
router.get('/student/:studentId', (req, res) => {
    try {
        const { studentId } = req.params;
        
        const results = db.findAll('results', { studentId });
        
        // Populate test details
        const populatedResults = results.map(r => {
            const test = db.findById('tests', r.testId);
            return {
                ...r,
                testId: test ? { _id: test._id, title: test.title, totalMarks: test.totalMarks } : null
            };
        });
        
        res.json({
            success: true,
            data: populatedResults
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;