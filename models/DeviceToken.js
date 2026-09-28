// models/DeviceToken.js
// One row per physical device token. A token belongs to exactly ONE user at a
// time: registering it for user B removes it from user A (shared/handed-down phone).
const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema(
  {
    token:    { type: String, required: true, unique: true, index: true },
    userId:   { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    role:     { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },
    platform: { type: String, default: 'android' },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Tokens not re-registered for ~60 days are stale (the app re-registers on login,
// on token rotation and on app resume, so live devices keep refreshing lastSeenAt).
deviceTokenSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600 });

module.exports = mongoose.models.DeviceToken || mongoose.model('DeviceToken', deviceTokenSchema);
