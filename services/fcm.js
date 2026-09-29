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
const db = require('./jsonDb');   // SAME store routes/studentRoutes.js POST /device-token writes to ('deviceTokens')

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
function readCredentials() {
  // Option A (documented in CHANGES.md): whole service-account JSON in one env var.
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    const j = JSON.parse(rawJson);
    return {
      projectId: (j.project_id || '').trim(),
      clientEmail: (j.client_email || '').trim(),
      privateKey: normalizePrivateKey(j.private_key),
    };
  }
  // Option B: three separate env vars.
  return {
    projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(),
    clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  };
}

function init() {
  if (getApps().length) return true;
  try {
    const { projectId, clientEmail, privateKey } = readCredentials();
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase credentials missing: set FIREBASE_SERVICE_ACCOUNT_JSON, or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY');
    }
    if (projectId !== EXPECTED_PROJECT_ID) {
      // Not fatal to init, but every send to an app token will fail -> shout.
      console.error(`[FCM] !! project_id="${projectId}" but the app uses "${EXPECTED_PROJECT_ID}". Pushes WILL fail.`);
    }
    if (!clientEmail.includes(`@${projectId}.iam.gserviceaccount.com`)) {
      console.error('[FCM] !! client_email does not belong to project_id');
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

// notifications.js passes { title, body, data:{type,id} }; older callers pass { type, id }.
// Accept both — before this, type/id were silently dropped (deep-link data lost).
function normalisePayload(p = {}) {
  const d = p.data || {};
  const { data, ...rest } = p;
  return {
    ...rest,
    type: p.type || d.type || 'general',
    id: p.id !== undefined && p.id !== null ? p.id : (d.id !== undefined && d.id !== null ? d.id : ''),
    extra: { ...(p.extra || {}) },
  };
}

function buildPayloadParts(rawPayload) {
  const { title, body, type, id, extra } = normalisePayload(rawPayload);
  return {
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

function buildMessage(tokens, rawPayload) {
  return { tokens, ...buildPayloadParts(rawPayload) };
}

/** Same shape as buildMessage but for ONE token — sendEach() (not
 * sendEachForMulticast) takes an array of these, each free to carry its
 * OWN data. Used by sendPersonalizedToUsers below. */
function buildSingleMessage(token, rawPayload) {
  return { token, ...buildPayloadParts(rawPayload) };
}

const DEAD = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
// 'invalid-argument' is ALSO what FCM returns for a bad *payload*; pruning on it would
// delete every student's token because of one code bug. Only prune when FCM says the token is the problem.
const isDeadToken = (code, msg) =>
  DEAD.has(code) || (code === 'messaging/invalid-argument' && /registration token/i.test(msg || ''));

/**
 * Send one push to every registered device of the given users.
 * @param {Array<string|ObjectId>} userIds
 * @param {{title,body,type,id,extra}} payload
 * @returns {Promise<{devices:number, success:number, failure:number, pruned:number, errors:string[]}>}
 */
async function sendToUsers(userIds, payload) {
  const result = { devices: 0, success: 0, failure: 0, pruned: 0, errors: [] };
  if (!init()) { result.errors.push(`init: ${initError && initError.message}`); return result; }

  const wanted = new Set((userIds || []).filter(Boolean).map(String));
  const rows = db.findAll('deviceTokens').filter((r) => r && r.token && wanted.has(String(r.userId)));
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
        const msg = (r.error && r.error.message) || '';
        if (isDeadToken(code, msg)) dead.push(chunk[idx]);
        else { result.errors.push(code); console.error(`[FCM] send error: ${code} ${msg}`); }
      });
      if (dead.length) {
        for (const t of dead) result.pruned += db.deleteOne('deviceTokens', { token: t }).deletedCount || 0;
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

/** Single-user convenience wrapper — services/notifications.js#notifyAndPush calls this. */
function sendToUser(userId, payload) {
  return sendToUsers([userId], payload);
}

/**
 * Like sendToUsers, but each recipient gets THEIR OWN `data.id` instead of
 * one shared id for the whole batch — needed for Notices, where every
 * student has their own separate per-student notification row (see
 * services/notifications.js#notifyManyAndPush) and the app resolves a tap
 * via GET /api/notifications/:id scoped to that student's own row, not a
 * shared "notice" id. Uses sendEach() (one Message per token, each free to
 * carry different data) instead of sendEachForMulticast()'s single shared
 * message — still one batched API call per 500-token chunk, not one HTTP
 * call per student.
 * @param {Object<string,string>} userDeepLinkMap  userId -> that user's own deepLinkId
 * @param {{title,body,type}} payload
 * @returns {Promise<{devices:number, success:number, failure:number, pruned:number, errors:string[]}>}
 */
async function sendPersonalizedToUsers(userDeepLinkMap, payload) {
  const result = { devices: 0, success: 0, failure: 0, pruned: 0, errors: [] };
  if (!init()) { result.errors.push(`init: ${initError && initError.message}`); return result; }

  const map = userDeepLinkMap || {};
  const wanted = new Set(Object.keys(map));
  const rows = db.findAll('deviceTokens').filter((r) => r && r.token && wanted.has(String(r.userId)));
  result.devices = rows.length;
  if (!rows.length) {
    console.warn('[FCM] no registered devices for these users — nothing to send (are students registering tokens?)');
    return result;
  }

  for (let i = 0; i < rows.length; i += MULTICAST_LIMIT) {
    const chunk = rows.slice(i, i + MULTICAST_LIMIT);
    const messages = chunk.map((r) => buildSingleMessage(r.token, { ...payload, id: map[String(r.userId)] }));
    try {
      const res = await messaging().sendEach(messages);
      result.success += res.successCount;
      result.failure += res.failureCount;
      const dead = [];
      res.responses.forEach((r, idx) => {
        if (r.success) return;
        const code = (r.error && r.error.code) || 'unknown';
        const msg = (r.error && r.error.message) || '';
        if (isDeadToken(code, msg)) dead.push(chunk[idx].token);
        else { result.errors.push(code); console.error(`[FCM] send error: ${code} ${msg}`); }
      });
      if (dead.length) {
        for (const t of dead) result.pruned += db.deleteOne('deviceTokens', { token: t }).deletedCount || 0;
      }
    } catch (e) {
      result.failure += chunk.length;
      result.errors.push(`${e.code || 'batch'}: ${e.message}`);
      console.error(`[FCM] batch FAILED: ${e.code} ${e.message}`);
    }
  }
  console.log(`[FCM] ${payload.type} (personalized): devices=${result.devices} ok=${result.success} fail=${result.failure} pruned=${result.pruned}`);
  return result;
}

module.exports = {
  init, verifyAtStartup, sendToUsers, sendToUser, sendPersonalizedToUsers, buildMessage, normalizePrivateKey, CHANNEL_ID,
  _setMessagingForTest: (fn) => { messaging = fn; },
};
