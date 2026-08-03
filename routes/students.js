const express = require('express');
const router = express.Router();
const db = require('../services/jsonDb');

// ============================================================
// Get all students
// ============================================================
router.get('/', (req, res) => {
    try {
        const students = db.findAll('students');
        res.json({
            success: true,
            data: students
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Get student by ID
// ============================================================
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const student = db.findById('students', id);
        
        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }
        
        res.json({
            success: true,
            data: student
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Create student
// ============================================================
router.post('/', async (req, res) => {
    try {
        const { name, email, mobile, password, classId } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Name, email and password are required'
            });
        }
        
        // Check if student exists
        const existing = db.findOne('students', { email });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'Student with this email already exists'
            });
        }
        
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newStudent = db.insertOne('students', {
            name,
            email,
            mobile,
            password: hashedPassword,
            classId: classId || null,
            isActive: true
        });
        
        res.status(201).json({
            success: true,
            data: newStudent,
            message: 'Student created successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Update student
// ============================================================
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, mobile, classId, isActive } = req.body;
        
        const student = db.findById('students', id);
        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }
        
        const updated = db.findByIdAndUpdate('students', id, {
            name: name || student.name,
            email: email || student.email,
            mobile: mobile || student.mobile,
            classId: classId !== undefined ? classId : student.classId,
            isActive: isActive !== undefined ? isActive : student.isActive
        });
        
        res.json({
            success: true,
            data: updated,
            message: 'Student updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================================
// Delete student
// ============================================================
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        const student = db.findById('students', id);
        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }
        
        db.findByIdAndDelete('students', id);
        
        res.json({
            success: true,
            message: 'Student deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;