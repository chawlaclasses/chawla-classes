const express = require('express');
const router = express.Router();
const db = require('../services/jsonDb');
const path = require('path');
const fs = require('fs');

// ============================================================
// Get all notes
// ============================================================
router.get('/', (req, res) => {
    try {
        const notes = db.findAll('notes');
        res.json({
            success: true,
            data: notes
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Get note by ID
// ============================================================
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const note = db.findById('notes', id);
        
        if (!note) {
            return res.status(404).json({
                success: false,
                message: 'Note not found'
            });
        }
        
        res.json({
            success: true,
            data: note
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Create note
// ============================================================
router.post('/', (req, res) => {
    try {
        const { title, content, subject, classId, fileUrl } = req.body;
        
        if (!title) {
            return res.status(400).json({
                success: false,
                message: 'Title is required'
            });
        }
        
        const newNote = db.insertOne('notes', {
            title,
            content: content || '',
            subject: subject || '',
            classId: classId || null,
            fileUrl: fileUrl || null,
            createdBy: req.user?.id || 'admin',
            createdAt: new Date().toISOString()
        });
        
        res.status(201).json({
            success: true,
            data: newNote,
            message: 'Note created successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Update note
// ============================================================
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, subject, classId, fileUrl } = req.body;
        
        const note = db.findById('notes', id);
        if (!note) {
            return res.status(404).json({
                success: false,
                message: 'Note not found'
            });
        }
        
        const updated = db.findByIdAndUpdate('notes', id, {
            title: title || note.title,
            content: content !== undefined ? content : note.content,
            subject: subject !== undefined ? subject : note.subject,
            classId: classId !== undefined ? classId : note.classId,
            fileUrl: fileUrl !== undefined ? fileUrl : note.fileUrl
        });
        
        res.json({
            success: true,
            data: updated,
            message: 'Note updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Delete note
// ============================================================
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        const note = db.findById('notes', id);
        if (!note) {
            return res.status(404).json({
                success: false,
                message: 'Note not found'
            });
        }
        
        db.findByIdAndDelete('notes', id);
        
        res.json({
            success: true,
            message: 'Note deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Upload note file
// ============================================================
router.post('/upload', (req, res) => {
    try {
        // Handle file upload logic here
        // For now, returning success
        res.json({
            success: true,
            message: 'File uploaded successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;