const express = require('express');
const router = express.Router();
const db = require('../services/jsonDb');
const path = require('path');
const fs = require('fs');

// ============================================================
// Get all PDFs
// ============================================================
router.get('/', (req, res) => {
    try {
        const pdfs = db.findAll('pdfs');
        res.json({
            success: true,
            data: pdfs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Get PDF by ID
// ============================================================
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const pdf = db.findById('pdfs', id);
        
        if (!pdf) {
            return res.status(404).json({
                success: false,
                message: 'PDF not found'
            });
        }
        
        res.json({
            success: true,
            data: pdf
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Upload PDF
// ============================================================
router.post('/upload', (req, res) => {
    try {
        const { title, description, fileUrl, subject, classId } = req.body;
        
        if (!title || !fileUrl) {
            return res.status(400).json({
                success: false,
                message: 'Title and file URL are required'
            });
        }
        
        const newPdf = db.insertOne('pdfs', {
            title,
            description: description || '',
            fileUrl,
            subject: subject || '',
            classId: classId || null,
            uploadedBy: req.user?.id || 'admin',
            uploadedAt: new Date().toISOString()
        });
        
        res.status(201).json({
            success: true,
            data: newPdf,
            message: 'PDF uploaded successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Delete PDF
// ============================================================
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        const pdf = db.findById('pdfs', id);
        if (!pdf) {
            return res.status(404).json({
                success: false,
                message: 'PDF not found'
            });
        }
        
        db.findByIdAndDelete('pdfs', id);
        
        res.json({
            success: true,
            message: 'PDF deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;