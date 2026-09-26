// services/fcm.js
//
// Real device push (Firebase Cloud Messaging) for the Flutter student/
// teacher app — separate from services/notifications.js (the in-app
// notification list students/teachers see in the Notification Center).
// This is what actually makes the phone buzz.
//
// Deliberately mirrors how Sentry is wired in app.js: fully optional,
// initializes only if configured, and every public method is a safe
// no-op (never throws) when it isn't — so a deployment with no Firebase
// project set up yet keeps working exactly as before, just without real
// pushes. Set FIREBASE_SERVICE_ACCOUNT_JSON (the full service account
// key file contents, as a single-line JSON string) to turn this on. See
// .env.example.
//
// Token storage: the 'deviceTokens' collection (see routes/studentRoutes.js
// POST /device-token) — one row per (userId, token). A user can have
// several rows (multiple devices logged in).

"use strict";

const db = require('./jsonDb');
const logger = require('../utils/logger');

let admin = null;
let initTried = false;
let enabled = false;

function init() {
    if (initTried) return;
    initTried = true;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
        logger.info('ℹ️  FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM push disabled (in-app notifications still work).');
        return;
    }

    try {
        const serviceAccount = JSON.parse(raw);
        // eslint-disable-next-line global-require
        admin = require('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        }
        enabled = true;
        logger.info('✅ Firebase Admin initialized — FCM push enabled');
    } catch (error) {
        admin = null;
        enabled = false;
        logger.error(`❌ Failed to initialize Firebase Admin (FCM push disabled): ${error.message}`);
    }
}

function isEnabled() {
    init();
    return enabled;
}

// Every value in an FCM data payload must be a string.
function stringifyData(data = {}) {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null) continue;
        out[key] = String(value);
    }
    return out;
}

// Removes device-token rows FCM told us are dead (uninstalled app,
// token rotated on the OS side, etc.) so we stop trying them every time.
function pruneTokens(tokens, responses) {
    responses.forEach((resp, i) => {
        if (resp.success) return;
        const code = resp.error && resp.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            const dead = db.findOne('deviceTokens', { token: tokens[i] });
            if (dead) db.findByIdAndDelete('deviceTokens', dead._id);
        }
    });
}

/**
 * Sends one push to every device token registered for the given user ids.
 * Always resolves (never throws) — callers should treat this as
 * best-effort, exactly like services/notifications.js's createNotification.
 *
 * @returns {Promise<{sent: number, failed: number, disabled?: boolean}>}
 */
async function sendToUsers(userIds, { title, body, data = {} } = {}) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return { sent: 0, failed: 0 };
    }
    if (!isEnabled()) {
        return { sent: 0, failed: 0, disabled: true };
    }

    const tokenDocs = db.find('deviceTokens', { userId: { $in: userIds } });
    const tokens = [...new Set(tokenDocs.map(t => t.token))];
    if (tokens.length === 0) {
        return { sent: 0, failed: 0 };
    }

    try {
        const response = await admin.messaging().sendEachForMulticast({
            tokens,
            notification: { title, body },
            data: stringifyData(data),
            android: { priority: 'high' },
            apns: { payload: { aps: { sound: 'default' } } },
        });
        pruneTokens(tokens, response.responses);
        return { sent: response.successCount, failed: response.failureCount };
    } catch (error) {
        logger.error(`FCM sendEachForMulticast failed: ${error.message}`, { stack: error.stack });
        return { sent: 0, failed: tokens.length };
    }
}

async function sendToUser(userId, payload) {
    return sendToUsers([userId], payload);
}

module.exports = { isEnabled, sendToUsers, sendToUser };
