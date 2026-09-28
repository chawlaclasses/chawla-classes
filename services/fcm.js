<<<<<<< HEAD
// services/fcm.js — the ONLY place firebase-admin is initialised and FCM is called.
//
// Env (Render):
//   FIREBASE_PROJECT_ID     must be  chawla-classes-student-app  (same project as the app)
//   FIREBASE_CLIENT_EMAIL   firebase-adminsdk-...@chawla-classes-student-app.iam.gserviceaccount.com
//   FIREBASE_PRIVATE_KEY    the "private_key" value; literal "\n" sequences, real newlines,
//                           or wrapping quotes are all accepted.
// MODULAR API on purpose: firebase-admin >= 13/14 removed the legacy namespace
// (admin.credential.cert / admin.messaging() / admin.apps are undefined there).
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const DeviceToken = require('../models/DeviceToken');

const EXPECTED_PROJECT_ID = 'chawla-classes-student-app';
// Must equal kPushChannelId in the Flutter app AND the manifest default channel.
const CHANNEL_ID = 'chawla_classes_default';
const MULTICAST_LIMIT = 500;

function normalizePrivateKey(raw) {
  if (!raw) return raw;
  let k = String(raw).trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\n/g, '\n');
}

let initError = null;
let messaging = () => getMessaging();   // indirection so tests can stub FCM
function init() {
  if (getApps().length) return true;
  const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  try {
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY missing');
    }
    if (projectId !== EXPECTED_PROJECT_ID) {
      // Not fatal to init, but every send to an app token will fail -> shout.
      console.error(`[FCM] !! FIREBASE_PROJECT_ID="${projectId}" but the app uses "${EXPECTED_PROJECT_ID}". Pushes WILL fail.`);
    }
    if (!clientEmail.includes(`@${projectId}.iam.gserviceaccount.com`)) {
      console.error('[FCM] !! FIREBASE_CLIENT_EMAIL does not belong to FIREBASE_PROJECT_ID');
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    initError = null;
    console.log(`[FCM] firebase-admin initialised for project ${projectId}`);
    return true;
  } catch (e) {
    initError = e;
    console.error('[FCM] firebase-admin init FAILED:', e.message);
    return false;
  }
}

/** Call once at server start. Validates credentials against Google without delivering anything. */
async function verifyAtStartup() {
  if (!init()) return { ok: false, error: initError && initError.message };
  try {
    // dryRun: full auth + validation round-trip, nothing delivered.
    await messaging().send({ token: 'x'.repeat(152), data: { ping: '1' } }, true);
    return { ok: true };
  } catch (e) {
    const code = e.code || '';
    // A fake token is *expected* to be rejected as invalid — that still proves credentials/project work.
    if (code === 'messaging/invalid-argument' || code === 'messaging/registration-token-not-registered') {
      console.log('[FCM] startup check OK (credentials accepted by FCM)');
      return { ok: true };
    }
    console.error(`[FCM] startup check FAILED: ${code} ${e.message}`);
    return { ok: false, error: `${code} ${e.message}` };
  }
}

const str = (v) => (v === undefined || v === null ? '' : String(v)); // FCM data values MUST be strings

function buildMessage(tokens, { title, body, type = 'general', id = '', extra = {} }) {
  return {
    tokens,
    // notification + data ("hybrid"): the Android system draws it when the app is
    // backgrounded/killed (survives OEM task-killers far better than data-only),
    // and the app still receives `data` for tap navigation.
    notification: { title: str(title), body: str(body) },
    data: {
      type: str(type), id: str(id), title: str(title), body: str(body),
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, str(v)])),
    },
    android: {
      priority: 'high',                 // wakes a dozing device
      ttl: 24 * 60 * 60 * 1000,         // hold up to 24h if the phone is off
      notification: { channelId: CHANNEL_ID, ...(id && { tag: `${str(type)}-${str(id)}` }) },
    },
  };
}

const DEAD = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Send one push to every registered device of the given users.
 * @param {Array<string|ObjectId>} userIds
 * @param {{title,body,type,id,extra}} payload
 * @returns {Promise<{devices:number, success:number, failure:number, pruned:number, errors:string[]}>}
 */
async function sendToUsers(userIds, payload) {
  const result = { devices: 0, success: 0, failure: 0, pruned: 0, errors: [] };
  if (!init()) { result.errors.push(`init: ${initError && initError.message}`); return result; }

  const rows = await DeviceToken.find({ userId: { $in: userIds } }).select('token').lean();
  const tokens = [...new Set(rows.map((r) => r.token))];
  result.devices = tokens.length;
  if (!tokens.length) {
    console.warn('[FCM] no registered devices for these users — nothing to send (are students registering tokens?)');
    return result;
  }

  for (let i = 0; i < tokens.length; i += MULTICAST_LIMIT) {
    const chunk = tokens.slice(i, i + MULTICAST_LIMIT);
    try {
      const res = await messaging().sendEachForMulticast(buildMessage(chunk, payload));
      result.success += res.successCount;
      result.failure += res.failureCount;
      const dead = [];
      res.responses.forEach((r, idx) => {
        if (r.success) return;
        const code = (r.error && r.error.code) || 'unknown';
        if (DEAD.has(code)) dead.push(chunk[idx]);
        else { result.errors.push(code); console.error(`[FCM] send error: ${code} ${r.error && r.error.message}`); }
      });
      if (dead.length) {
        const del = await DeviceToken.deleteMany({ token: { $in: dead } });
        result.pruned += del.deletedCount || dead.length;
      }
    } catch (e) {
      // Whole-batch failure = auth / project / network problem, not a bad token.
      result.failure += chunk.length;
      result.errors.push(`${e.code || 'batch'}: ${e.message}`);
      console.error(`[FCM] batch FAILED: ${e.code} ${e.message}`);
    }
  }
  console.log(`[FCM] ${payload.type}/${payload.id}: devices=${result.devices} ok=${result.success} fail=${result.failure} pruned=${result.pruned}`);
  return result;
}

module.exports = {
  init, verifyAtStartup, sendToUsers, buildMessage, normalizePrivateKey, CHANNEL_ID,
  _setMessagingForTest: (fn) => { messaging = fn; },
};
=======
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
>>>>>>> abf3b5bc0d36e3261db6bbefb9f12b8672844ab8
