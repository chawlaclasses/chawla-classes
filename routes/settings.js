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
const { uploadFileToR2 } = require('../middleware/upload');
const { validateBufferContent } = require('../utils/helpers');
const r2Service = require('../services/r2Service');
const { logAudit } = require('../utils/auditLog');
const { requirePermission } = require('../middleware/permissions');
const db = require('../services/jsonDb');
const mongoBackup = require('../services/mongoBackup');

const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg', '.ico']);
const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
// FIX (local storage -> Cloudflare R2 migration): branding assets go
// straight to R2 under "branding/" now, with a public URL — this category
// was already served with no auth via /images, so no access-control
// change here, just where the bytes live. memoryStorage() replaces the
// old diskStorage(IMAGES_DIR); see uploadFileToR2() in middleware/upload.js.
const uploadBranding = multer({
    storage: multer.memoryStorage(),
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
router.post('/logo', requirePermission('settings:edit'), uploadBranding.single('logo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const isValid = await validateBufferContent(req.file.buffer, ALLOWED_IMAGE_MIMES);
        if (!isValid) {
            return res.status(400).json({ success: false, message: 'File content does not match its extension. Upload rejected.' });
        }
        await uploadFileToR2(req.file, 'branding');
        settingsService.updateSettings({ logoUrl: req.file.r2Url, logoKey: req.file.r2Key });
        logAudit(req, 'edit', 'settings', null, 'Updated institute logo');
        res.json({ success: true, data: { logoUrl: req.file.r2Url }, message: 'Logo updated' });
    } catch (error) {
        if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key);
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Upload favicon
router.post('/favicon', requirePermission('settings:edit'), uploadBranding.single('favicon'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const isValid = await validateBufferContent(req.file.buffer, ALLOWED_IMAGE_MIMES);
        if (!isValid) {
            return res.status(400).json({ success: false, message: 'File content does not match its extension. Upload rejected.' });
        }
        await uploadFileToR2(req.file, 'branding');
        settingsService.updateSettings({ faviconUrl: req.file.r2Url, faviconKey: req.file.r2Key });
        logAudit(req, 'edit', 'settings', null, 'Updated favicon');
        res.json({ success: true, data: { faviconUrl: req.file.r2Url }, message: 'Favicon updated' });
    } catch (error) {
        if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key);
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
// FIX (production hardening, Phase 2, issue #1/#10): this used to
// fs.copyFileSync the Data/ folder — stale/empty since the jsonDb ->
// MongoDB migration, so "backups" silently stopped containing any real
// data, and restoring one did nothing useful. Replaced entirely with
// services/mongoBackup.js, which snapshots every real MongoDB collection
// into MongoDB itself (survives a Render redeploy — nothing depends on
// local disk anymore) and restores via an atomic per-collection swap.
// Routes, methods, and response envelope shape are unchanged; response
// payloads are a superset of the old ones (extra fields added, nothing
// removed) so any existing frontend code reading .name/.createdAt/.message
// keeps working untouched.

// Best-effort: waits briefly for any writes already queued in jsonDb to
// finish before a restore starts swapping collections underneath them.
// This narrows, but doesn't eliminate, the race between an in-flight
// write and a restore's collection swap — see PHASE_2_REPORT.md for the
// full explanation and why full write-quiescing is deferred to Phase 3
// (graceful shutdown) rather than solved here.
async function waitForWritesToDrain(timeoutMs = 5000) {
    const start = Date.now();
    while (db.getStatus().pendingWrites > 0 && Date.now() - start < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

router.post('/backup', requirePermission('settings:edit'), async (req, res) => {
    try {
        const backup = await mongoBackup.createBackup({ kind: 'manual' });
        logAudit(req, 'export', 'settings', null, `Created manual backup: ${backup.name}`);
        res.json({
            success: true,
            data: { name: backup.name, createdAt: backup.createdAt, collections: backup.collections.length, totalDocs: backup.totalDocs },
            message: 'Backup created successfully'
        });
    } catch (error) {
        logger.error(`Backup failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Backup failed. Please try again or contact support.' });
    }
});

router.get('/backups', requirePermission('settings:view'), async (req, res) => {
    try {
        const backups = await mongoBackup.listBackups();
        const data = backups.map((b) => ({
            name: b.name,
            createdAt: b.createdAt,
            kind: b.kind,
            collections: b.collections.length,
            totalDocs: b.totalDocs,
        }));
        res.json({ success: true, data });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.post('/backups/:name/restore', requirePermission('settings:backup_restore'), async (req, res) => {
    // Best-effort write-quiescing around the restore — see
    // waitForWritesToDrain's comment. Restored to its original value
    // (not just switched off) in `finally`, in case it was already on
    // for an unrelated reason.
    const wasMaintenanceMode = !!settingsService.getSettings().maintenanceMode;
    try {
        if (!wasMaintenanceMode) {
            const current = settingsService.getSettings();
            settingsService.updateSettings({
                maintenanceMode: true,
                maintenanceMessage: current.maintenanceMessage || 'Scheduled maintenance in progress. Please check back shortly.',
            });
        }
        await waitForWritesToDrain();

        const result = await mongoBackup.restoreBackup(req.params.name);

        if (result.success) {
            logAudit(req, 'import', 'settings', null, `Restored backup: ${req.params.name}`);
            res.json({
                success: true,
                data: result,
                message: `Backup restored (${result.attempted}/${result.totalCollections} collections) and is live now — no server restart needed. A safety snapshot of the prior state was saved as "${result.preRestoreBackupName}".`
            });
        } else {
            // Never report success for a restore that didn't fully complete.
            logAudit(req, 'import', 'settings', null, `Restore incomplete for backup: ${req.params.name} (${result.attempted}/${result.totalCollections} collections)`);
            res.status(500).json({
                success: false,
                data: result,
                message: `Restore did not complete for every collection (${result.attempted}/${result.totalCollections} attempted before stopping). Nothing was lost — the prior state was saved as "${result.preRestoreBackupName}". See data.results for which collection failed and why.`
            });
        }
    } catch (error) {
        if (error.code === 'NOT_FOUND') {
            return res.status(404).json({ success: false, message: 'Backup not found' });
        }
        logger.error(`Restore failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Restore failed. Please try again or contact support.' });
    } finally {
        if (!wasMaintenanceMode) {
            settingsService.updateSettings({ maintenanceMode: false });
        }
    }
});

router.delete('/backups/:name', requirePermission('settings:backup_restore'), async (req, res) => {
    try {
        const deleted = await mongoBackup.deleteBackup(req.params.name);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Backup not found' });
        }
        logAudit(req, 'delete', 'settings', null, `Deleted backup: ${req.params.name}`);
        res.json({ success: true, message: 'Backup deleted' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;