// routes/settings.js
//
// Admin Settings module: institute info, academic session, passing
// criteria, theme color, email configuration (+ real test-send via
// nodemailer), WhatsApp configuration (config storage — see note below),
// backup/restore, and maintenance mode.
//
// NOTE on WhatsApp: there is no WhatsApp Business API account connected
// here. The config fields (provider/accountSid/authToken/fromNumber) are
// stored and validated for shape, but actually sending a WhatsApp message
// requires real credentials from a provider (Twilio, Meta Cloud API, etc.)
// that only the person deploying this app can obtain — this can't be
// tested end-to-end without them. The test-email feature, by contrast,
// uses nodemailer directly and will really send mail once given valid
// SMTP credentials.

"use strict";

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const settingsService = require('../services/settings');
const logger = require('../utils/logger');
const { diskStorage } = require('../middleware/upload');
const { cleanupFile } = require('../utils/helpers');
const { logAudit } = require('../utils/auditLog');
const { requirePermission } = require('../middleware/permissions');
const { ROOT_DIR, DATA_DIR } = require('../config');

const IMAGES_DIR = path.join(ROOT_DIR, 'images');
const BACKUPS_DIR = path.join(ROOT_DIR, 'backups');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg', '.ico']);
const uploadBranding = multer({
    storage: diskStorage(IMAGES_DIR),
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB is plenty for a logo/favicon
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_IMAGE_EXT.has(ext)) {
            return cb(new Error(`Unsupported image type: ${ext}`));
        }
        cb(null, true);
    }
});

// Get full settings (admin only — includes email/WhatsApp credentials)
router.get('/', requirePermission('settings:view'), (req, res) => {
    try {
        res.json({ success: true, data: settingsService.getSettings() });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Update settings
router.put('/', requirePermission('settings:edit'), (req, res) => {
    try {
        const allowed = ['instituteName', 'academicSession', 'passingCriteria', 'themeColor',
            'email', 'whatsapp', 'backup', 'maintenanceMode', 'maintenanceMessage'];
        const patch = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) patch[key] = req.body[key];
        }
        const updated = settingsService.updateSettings(patch);
        logAudit(req, 'edit', 'settings', null, 'Updated application settings');
        res.json({ success: true, data: updated, message: 'Settings updated' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Upload logo
router.post('/logo', requirePermission('settings:edit'), uploadBranding.single('logo'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const logoUrl = `/images/${req.file.filename}`;
        settingsService.updateSettings({ logoUrl });
        logAudit(req, 'edit', 'settings', null, 'Updated institute logo');
        res.json({ success: true, data: { logoUrl }, message: 'Logo updated' });
    } catch (error) {
        if (req.file) cleanupFile(req.file.path);
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Upload favicon
router.post('/favicon', requirePermission('settings:edit'), uploadBranding.single('favicon'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const faviconUrl = `/images/${req.file.filename}`;
        settingsService.updateSettings({ faviconUrl });
        logAudit(req, 'edit', 'settings', null, 'Updated favicon');
        res.json({ success: true, data: { faviconUrl }, message: 'Favicon updated' });
    } catch (error) {
        if (req.file) cleanupFile(req.file.path);
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Send a real test email using the configured SMTP settings
router.post('/test-email', requirePermission('settings:edit'), async (req, res) => {
    try {
        const { to } = req.body;
        if (!to) return res.status(400).json({ success: false, message: 'Recipient email (to) is required' });

        const { email, instituteName } = settingsService.getSettings();
        if (!email.host || !email.user || !email.pass) {
            return res.status(400).json({ success: false, message: 'Email settings are incomplete — host, user, and password are required' });
        }

        const transporter = nodemailer.createTransport({
            host: email.host,
            port: email.port || 587,
            secure: !!email.secure,
            auth: { user: email.user, pass: email.pass }
        });

        await transporter.sendMail({
            from: `"${email.fromName || instituteName}" <${email.fromAddress || email.user}>`,
            to,
            subject: `Test email from ${instituteName}`,
            text: `This is a test email from ${instituteName}'s admin settings. If you received this, your email configuration is working correctly.`
        });

        logAudit(req, 'edit', 'settings', null, `Sent test email to ${to}`);
        res.json({ success: true, message: `Test email sent to ${to}` });
    } catch (error) {
        // Real SMTP errors (bad credentials, unreachable host, etc.) surface here —
        // this is genuine feedback, not a placeholder response.
        res.status(500).json({ success: false, message: `Failed to send test email: ${error.message}` });
    }
});

// ── Backups ─────────────────────────────────────────────────────────────────

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

router.post('/backup', requirePermission('settings:edit'), (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup-${timestamp}`;
        const backupPath = path.join(BACKUPS_DIR, backupName);
        copyDir(DATA_DIR, backupPath);
        logAudit(req, 'export', 'settings', null, `Created manual backup: ${backupName}`);
        res.json({ success: true, data: { name: backupName }, message: 'Backup created successfully' });
    } catch (error) {
        logger.error(`Backup failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Backup failed. Please try again or contact support.' });
    }
});

router.get('/backups', requirePermission('settings:view'), (req, res) => {
    try {
        const backups = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => {
                const stat = fs.statSync(path.join(BACKUPS_DIR, e.name));
                return { name: e.name, createdAt: stat.birthtime || stat.ctime };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, data: backups });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.post('/backups/:name/restore', requirePermission('settings:backup_restore'), (req, res) => {
    try {
        const backupPath = path.join(BACKUPS_DIR, req.params.name);
        if (!fs.existsSync(backupPath) || !backupPath.startsWith(BACKUPS_DIR)) {
            return res.status(404).json({ success: false, message: 'Backup not found' });
        }
        // Safety net: back up current state before overwriting, in case the
        // restore itself needs to be undone.
        const preRestoreName = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        copyDir(DATA_DIR, path.join(BACKUPS_DIR, preRestoreName));

        copyDir(backupPath, DATA_DIR);
        logAudit(req, 'import', 'settings', null, `Restored backup: ${req.params.name}`);
        res.json({
            success: true,
            message: 'Backup restored. Restart the server to load the restored data (jsonDb reads collections into memory at startup).'
        });
    } catch (error) {
        logger.error(`Restore failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Restore failed. Please try again or contact support.' });
    }
});

router.delete('/backups/:name', requirePermission('settings:backup_restore'), (req, res) => {
    try {
        const backupPath = path.join(BACKUPS_DIR, req.params.name);
        if (!fs.existsSync(backupPath) || !backupPath.startsWith(BACKUPS_DIR)) {
            return res.status(404).json({ success: false, message: 'Backup not found' });
        }
        fs.rmSync(backupPath, { recursive: true, force: true });
        logAudit(req, 'delete', 'settings', null, `Deleted backup: ${req.params.name}`);
        res.json({ success: true, message: 'Backup deleted' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;