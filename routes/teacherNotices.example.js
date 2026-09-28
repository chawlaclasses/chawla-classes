// routes/teacherNotices.example.js — REPLACE THE BODY of your existing POST /api/teacher/notices
// with this shape. I could not see your real file (the backend was not in the zip), so every
// `ADAPT` line is yours to map to your actual models/middleware. This is a template, not a drop-in.
const Notice = require('../models/Notice');       // ADAPT
const Student = require('../models/Student');     // ADAPT
const { sendToUsers } = require('../services/fcm');

router.post('/notices', requireTeacher, async (req, res) => {           // ADAPT middleware name
  const { classId, title, message } = req.body;
  if (!classId || !title || !message) {
    return res.status(400).json({ success: false, message: 'classId, title and message are required' });
  }

  // 1. save (same as what you do today)
  const notice = await Notice.create({ classId, title, message, createdBy: req.user._id }); // ADAPT

  // 2. recipients — MUST be the same audience the student app's notice list is built from
  const students = await Student.find({ classId /* ADAPT e.g. { class: classId, status: 'active' } */ })
    .select('_id')
    .lean();
  const studentIds = students.map((s) => s._id);

  // 3. push — awaited so failures are logged and reported back; never throws into the response
  let push = { devices: 0, success: 0, failure: 0, pruned: 0, errors: [] };
  try {
    push = await sendToUsers(studentIds, { type: 'notice', id: notice._id, title, body: message });
  } catch (e) {
    console.error('[FCM] notice push crashed:', e);
    push.errors.push(e.message);
  }

  // The app reads data.notifiedCount; `push` is extra diagnostics (devices reached vs. students).
  res.json({ success: true, data: { id: notice._id, notifiedCount: studentIds.length, push } });
});
