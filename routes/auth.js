const express = require('express');
const router = express.Router();
const db = require('../services/jsonDb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// FIX (security, audit 2026-07): use the one canonical JWT_SECRET from
// services/auth.js instead of a locally hardcoded fallback string — see
// middleware/apiAuth.js for the full explanation. (This file is still
// unmounted per the Module 1 fix in app.js; kept consistent regardless.)
const { JWT_SECRET } = require('../services/auth');

// ============================================================
// Admin Login
// ============================================================
router.post('/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }
        
        const user = db.findOne('users', { email, role: 'admin' });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
        
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
        
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            },
            message: 'Admin login successful'
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
});

// ============================================================
// Student Login
// ============================================================
router.post('/student/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }
        
        const user = db.findOne('users', { email, role: 'student' });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
        
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
        
        const classData = db.findById('classes', user.classId);
        
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    class: classData ? classData.displayName : null
                }
            },
            message: 'Student login successful'
        });
    } catch (error) {
        console.error('Student login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
});

// ============================================================
// Verify Token
// ============================================================
router.get('/verify', (req, res) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = db.findById('users', decoded.id);
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }
        
        res.json({
            success: true,
            data: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
});

// ============================================================
// Register (Admin only)
// ============================================================
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role, classId } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Name, email and password are required'
            });
        }
        
        const existing = db.findOne('users', { email });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'User with this email already exists'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = db.insertOne('users', {
            name,
            email,
            password: hashedPassword,
            role: role || 'student',
            classId: classId || null,
            isActive: true
        });
        
        res.status(201).json({
            success: true,
            data: {
                id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role
            },
            message: 'User registered successfully'
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
});

module.exports = router;