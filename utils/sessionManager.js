/**
 * utils/sessionManager.js
 *
 * Turns the otherwise-stateless JWT auth into something with real
 * "sessions" that can be listed and individually revoked — each login
 * creates a row in the 'sessions' collection, and the JWT carries that
 * row's id as `sid`. Auth middleware checks the row is still there and
 * not revoked on every request, so revoking a session takes effect
 * immediately even though the JWT itself is still technically valid for
 * up to 24h.
 *
 * jsonDb persists by rewriting the whole collection file on every write
 * (see services/jsonDb.js), so touchSession() below is deliberately
 * throttled — it would otherwise hit disk on literally every API call.
 */

"use strict";

const db = require("../services/jsonDb");
const { parseDevice, getClientIp } = require("./loginHistory");

const TOUCH_THROTTLE_MS = 5 * 60 * 1000; // only rewrite lastSeenAt every 5 min at most

const createSession = (req, user) => {
    return db.insertOne("sessions", {
        userId: user._id,
        role: user.role,
        name: user.name,
        email: user.email,
        device: parseDevice(req.headers["user-agent"]),
        userAgent: req.headers["user-agent"] || "",
        ip: getClientIp(req),
        lastSeenAt: new Date().toISOString(),
        revoked: false,
        revokedAt: null,
    });
};

const getSession = (sid) => (sid ? db.findById("sessions", sid) : null);

const isSessionValid = (sid) => {
    const session = getSession(sid);
    return Boolean(session && !session.revoked);
};

// Best-effort, throttled — never let this block or fail the request it's
// attached to.
const touchSession = (sid) => {
    try {
        const session = getSession(sid);
        if (!session) return;
        const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
        if (Date.now() - lastSeen >= TOUCH_THROTTLE_MS) {
            db.updateById("sessions", sid, { lastSeenAt: new Date().toISOString() });
        }
    } catch (_) {
        // non-critical
    }
};

const revokeSession = (sid) => {
    const session = getSession(sid);
    if (!session || session.revoked) return session;
    return db.updateById("sessions", sid, { revoked: true, revokedAt: new Date().toISOString() });
};

// Used by "Log out all other devices" — revokes every active session for a
// user except the one making the request right now.
const revokeOtherSessions = (userId, exceptSid) => {
    const sessions = db.find("sessions", { userId, revoked: false });
    let count = 0;
    sessions.forEach((s) => {
        if (s._id !== exceptSid) {
            db.updateById("sessions", s._id, { revoked: true, revokedAt: new Date().toISOString() });
            count += 1;
        }
    });
    return count;
};

const listActiveSessionsForUser = (userId, currentSid) => {
    return db
        .find("sessions", { userId, revoked: false })
        .slice()
        .sort((a, b) => new Date(b.lastSeenAt || b.createdAt) - new Date(a.lastSeenAt || a.createdAt))
        .map((s) => ({ ...s, current: s._id === currentSid }));
};

module.exports = {
    createSession,
    getSession,
    isSessionValid,
    touchSession,
    revokeSession,
    revokeOtherSessions,
    listActiveSessionsForUser,
};
