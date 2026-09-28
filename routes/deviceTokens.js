// routes/deviceTokens.js — mount with:  app.use('/api/student', require('./routes/deviceTokens'));
// ADAPT: replace `requireStudent` with your existing student-JWT middleware — the SAME one
// /api/student/dashboard uses — and make sure it sets req.user (or change the `uid` line).
const express = require('express');
const DeviceToken = require('../models/DeviceToken');
const { requireStudent } = require('../middleware/auth'); // ADAPT path/name

const router = express.Router();
const uid = (req) => (req.user && (req.user._id || req.user.id)) || req.userId;

// POST /api/student/device-token   { token, platform }
router.post('/device-token', requireStudent, async (req, res) => {
  const token = String(req.body.token || '').trim();
  const platform = String(req.body.platform || 'android').toLowerCase();
  if (token.length < 100 || token.length > 4096) {
    return res.status(400).json({ success: false, message: 'Invalid FCM token' });
  }
  try {
    // Upsert by token: ownership moves to the currently logged-in student.
    await DeviceToken.findOneAndUpdate(
      { token },
      { $set: { userId: uid(req), role: 'student', platform, lastSeenAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`[FCM] token registered user=${uid(req)} platform=${platform} len=${token.length}`);
    res.json({ success: true });
  } catch (e) {
    console.error('[FCM] device-token save failed:', e);
    res.status(500).json({ success: false, message: 'Could not save device token' });
  }
});

// POST /api/student/device-token/remove   { token }   (called by the app on logout)
router.post('/device-token/remove', requireStudent, async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (token) await DeviceToken.deleteOne({ token, userId: uid(req) });
  res.json({ success: true });
});

module.exports = router;

// ALSO: in your existing POST /api/auth/logout handler, after verifying the JWT, run
//   await DeviceToken.deleteMany({ userId: <that user's id> });
// so logouts where the app couldn't reach /remove (offline, expired session) still detach the phone.
