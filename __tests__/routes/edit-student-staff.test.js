/**
 * Edit Student / Edit Staff — optional email, new optional fields, status,
 * class change, duplicate-email rules, attendance matching without email,
 * and profile photo endpoints.
 *
 * Runs the real route modules against the real in-memory JsonDB (its MongoDB
 * write-behind is replaced with a no-op fake); auth is stubbed to a super admin.
 */

const express = require('express');
const request = require('supertest');

// gamification pulls in `uuid` (ESM-only in this install, which jest can't parse) and isn't under test here.
jest.mock('../../services/gamification', () => ({ getGamificationData: async () => null }));
jest.mock('../../services/r2Service', () => ({
  generateKey: (folder, name) => `${folder}/test-${name}`,
  uploadBuffer: jest.fn(async ({ key }) => ({ key, url: null })),
  deleteObject: jest.fn(async () => {}),
  streamToResponse: jest.fn(async (key, res) => res.status(200).send('IMG')),
}));
jest.mock('../../middleware/upload', () => {
  const real = jest.requireActual('../../middleware/upload');
  // Skip the sharp/magic-byte pipeline: pretend the guard stored the file in R2.
  return {
    ...real,
    profilePhotoMimeGuard: (req, _res, next) => {
      if (req.file) { req.file.r2Key = `profile-photos/${Date.now()}-${req.file.originalname}`; }
      next();
    },
  };
});

const db = require('../../services/jsonDb');
const staffRouter = require('../../routes/staff');
const studentsRouter = require('../../routes/admin/students');
const profileRouter = require('../../routes/admin/student-profile');
const attendanceRouter = require('../../routes/admin/attendance');
const { findAttendanceOn } = require('../../utils/profileFields');
const r2Service = require('../../services/r2Service');

let app;
beforeAll(() => {
  const noop = async () => ({ acknowledged: true });
  db.db = { collection: () => ({ insertOne: noop, insertMany: noop, replaceOne: noop, deleteOne: noop, deleteMany: noop }) };
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'super1' }; req.userData = { role: 'super_admin' }; next(); });
  app.use('/api/admin/staff', staffRouter);
  app.use('/api/admin', studentsRouter);
  app.use('/api/admin', profileRouter);
  app.use('/api/admin/attendance', attendanceRouter);
});

beforeEach(() => {
  db.collections = {};
  db._idIndex = {};
  for (const c of ['users', 'classes', 'subjects', 'attendance']) db._ensureCollection(c);
  db.insertOne('users', { _id: 'super1', name: 'Boss', role: 'super_admin', email: 'boss@x.com', loginId: 'boss', isActive: true });
  db.insertOne('classes', { _id: 'c9', name: 'Class 9', displayName: 'Class 9', streams: [], isActive: true });
  db.insertOne('classes', { _id: 'c11', name: 'Class 11', displayName: 'Class 11', streams: ['Science', 'Commerce'], isActive: true });
});

const addStudent = (extra = {}) => db.insertOne('users', {
  role: 'student', name: 'Asha', email: '', phone: '9876543210', classId: 'c9', stream: '', subjectIds: [], isActive: true, password: 'x', ...extra,
});

describe('Edit Student', () => {
  test('student WITHOUT email can be edited and saved (blank email is valid)', async () => {
    const s = addStudent({ email: '' });
    const res = await request(app).put(`/api/admin/students/${s._id}/profile`).send({ name: 'Asha K', email: '', address: 'Uttam Nagar', notes: 'Good' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/updated successfully/i);
    const saved = db.findById('users', s._id);
    expect(saved.name).toBe('Asha K');
    expect(saved.email).toBe('');
    expect(saved.address).toBe('Uttam Nagar');
    expect(saved.notes).toBe('Good');
  });

  test('legacy record with no email field at all still edits fine, and PATCH works too', async () => {
    const s = addStudent();
    delete db.findById('users', s._id).email;
    const res = await request(app).patch(`/api/admin/students/${s._id}/profile`).send({ section: 'B' });
    expect(res.status).toBe(200);
    expect(db.findById('users', s._id).section).toBe('B');
  });

  test('email is format-checked only when provided', async () => {
    const s = addStudent();
    expect((await request(app).put(`/api/admin/students/${s._id}/profile`).send({ email: 'not-an-email' })).status).toBe(400);
    expect((await request(app).put(`/api/admin/students/${s._id}/profile`).send({ email: 'asha@example.com' })).status).toBe(200);
    expect(db.findById('users', s._id).email).toBe('asha@example.com');
  });

  test('duplicate email is rejected, but two blank-email students never clash', async () => {
    const a = addStudent({ name: 'A', email: 'a@x.com' });
    const b = addStudent({ name: 'B', email: '' });
    const c = addStudent({ name: 'C', email: '' });
    expect((await request(app).put(`/api/admin/students/${b._id}/profile`).send({ email: 'A@X.com' })).status).toBe(409);
    expect((await request(app).put(`/api/admin/students/${c._id}/profile`).send({ email: '', name: 'C2' })).status).toBe(200);
    expect(db.findById('users', b._id).email).toBe('');
    expect(a.email).toBe('a@x.com');
  });

  test('clearing an existing email works and keeps attendance history', async () => {
    const s = addStudent({ email: 'old@x.com' });
    db.insertOne('attendance', { name: 'Asha', email: 'old@x.com', status: 'Present', date: '1/1/2026' }); // legacy row, no studentId
    const res = await request(app).put(`/api/admin/students/${s._id}/profile`).send({ email: '' });
    expect(res.status).toBe(200);
    expect(db.findById('users', s._id).email).toBe('');
    expect(db.find('attendance', {})[0].studentId).toBe(s._id);
    expect(require('../../utils/profileFields').attendanceRecordsFor(db.findById('users', s._id))).toHaveLength(1);
  });

  test('status, name, phone, class can be changed; required fields cannot be blanked', async () => {
    const s = addStudent();
    expect((await request(app).put(`/api/admin/students/${s._id}/profile`).send({ isActive: false })).status).toBe(200);
    expect(db.findById('users', s._id).isActive).toBe(false);
    expect((await request(app).put(`/api/admin/students/${s._id}/profile`).send({ name: '' })).status).toBe(400);
    expect((await request(app).put(`/api/admin/students/${s._id}/profile`).send({ phone: '' })).status).toBe(400);
    expect((await request(app).put(`/api/admin/students/${s._id}/profile`).send({ classId: '' })).status).toBe(400);
    expect((await request(app).put(`/api/admin/students/${s._id}/profile`).send({ isActive: 'yes' })).status).toBe(400);
    // class with streams needs a stream
    expect((await request(app).put(`/api/admin/students/${s._id}/profile`).send({ classId: 'c11' })).status).toBe(400);
    const ok = await request(app).put(`/api/admin/students/${s._id}/profile`).send({ classId: 'c11', stream: 'Science' });
    expect(ok.status).toBe(200);
    expect(db.findById('users', s._id)).toMatchObject({ classId: 'c11', stream: 'Science' });
  });

  test('an older student with no phone / no class can still be saved', async () => {
    const s = addStudent({ phone: '', classId: null });
    const res = await request(app).put(`/api/admin/students/${s._id}/profile`).send({ name: 'No Phone', phone: '', classId: '' });
    expect(res.status).toBe(200);
  });

  test('response never leaks the password hash', async () => {
    const s = addStudent();
    const res = await request(app).put(`/api/admin/students/${s._id}/profile`).send({ name: 'Asha Z' });
    expect(res.body.data.password).toBeUndefined();
  });

  test('a password cannot be set on a student with no email', async () => {
    const s = addStudent({ email: '' });
    const res = await request(app).put(`/api/admin/students/${s._id}/profile`).send({ password: 'secret1' });
    expect(res.status).toBe(400);
  });

  test('profile GET exposes the new fields', async () => {
    const s = addStudent({ section: 'A', notes: 'hi' });
    const res = await request(app).get(`/api/admin/students/${s._id}/profile`);
    expect(res.status).toBe(200);
    expect(res.body.data.personalDetails).toMatchObject({ name: 'Asha', section: 'A', notes: 'hi', hasPhoto: false, email: '' });
  });
});

describe('Add Student', () => {
  test('email is optional', async () => {
    const res = await request(app).post('/api/admin/students').send({ name: 'No Mail', phone: '9999999999' });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('');
    expect(res.body.data.password).toBeUndefined();
  });
  test('with an email, password is still required and duplicates are rejected', async () => {
    expect((await request(app).post('/api/admin/students').send({ name: 'X', email: 'x@x.com' })).status).toBe(400);
    expect((await request(app).post('/api/admin/students').send({ name: 'X', email: 'x@x.com', password: 'secret1', sendEmail: false })).status).toBe(201);
    expect((await request(app).post('/api/admin/students').send({ name: 'Y', email: 'X@x.com', password: 'secret1', sendEmail: false })).status).toBe(409);
    expect((await request(app).post('/api/admin/students').send({ name: 'Y', email: 'bad', password: 'secret1' })).status).toBe(400);
  });
});

describe('Attendance without email', () => {
  test('two blank-email students do not overwrite each other', async () => {
    const a = addStudent({ name: 'A' });
    const b = addStudent({ name: 'B' });
    const res = await request(app).post('/api/admin/attendance/mark').send({
      classId: 'c9', date: '2/2/2026', records: [{ studentId: a._id, status: 'Present' }, { studentId: b._id, status: 'Absent' }],
    });
    expect(res.status).toBe(200);
    const rows = db.find('attendance', {});
    expect(rows).toHaveLength(2);
    expect(findAttendanceOn(db.findById('users', a._id), '2/2/2026').status).toBe('Present');
    expect(findAttendanceOn(db.findById('users', b._id), '2/2/2026').status).toBe('Absent');
  });
});

describe('Staff', () => {
  const mk = (extra = {}) => db.insertOne('users', { name: 'Teach', role: 'teacher', loginId: 'teach1', email: '', phone: '9811111111', isActive: true, password: 'x', ...extra });

  test('staff can be created and edited without an email', async () => {
    const created = await request(app).post('/api/admin/staff').send({ name: 'Ravi', loginId: 'ravi.sir', password: 'password1', role: 'teacher', sendEmail: false });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('');
    expect(created.body.data.password).toBeUndefined();
    const id = created.body.data._id;
    const edited = await request(app).put(`/api/admin/staff/${id}`).send({ name: 'Ravi K', designation: 'Maths', qualification: 'M.Sc', address: 'Delhi', joiningDate: '2024-04-01', notes: 'n', email: '' });
    expect(edited.status).toBe(200);
    expect(db.findById('users', id)).toMatchObject({ name: 'Ravi K', designation: 'Maths', qualification: 'M.Sc', address: 'Delhi', joiningDate: '2024-04-01', notes: 'n', email: '' });
  });

  test('two staff with blank email do not conflict; duplicate real email is rejected', async () => {
    const a = mk({ loginId: 'a1', email: 'a@x.com' });
    const b = mk({ loginId: 'b1' });
    const c = mk({ loginId: 'c1' });
    expect((await request(app).put(`/api/admin/staff/${c._id}`).send({ email: '' })).status).toBe(200);
    expect((await request(app).put(`/api/admin/staff/${b._id}`).send({ email: 'A@x.com' })).status).toBe(409);
    expect((await request(app).put(`/api/admin/staff/${b._id}`).send({ email: 'nope' })).status).toBe(400);
    expect((await request(app).put(`/api/admin/staff/${b._id}`).send({ email: 'b@x.com' })).status).toBe(200);
    expect(db.findById('users', a._id).email).toBe('a@x.com');
  });

  test('legacy staff (no loginId, email only) cannot lock themselves out by clearing email', async () => {
    const old = mk({ loginId: undefined, email: 'old@x.com' });
    delete db.findById('users', old._id).loginId;
    expect((await request(app).put(`/api/admin/staff/${old._id}`).send({ email: '' })).status).toBe(400);
  });

  test('status, validation and required-field rules', async () => {
    const t = mk();
    expect((await request(app).put(`/api/admin/staff/${t._id}`).send({ isActive: false })).status).toBe(200);
    expect(db.findById('users', t._id).isActive).toBe(false);
    expect((await request(app).put(`/api/admin/staff/${t._id}`).send({ name: '  ' })).status).toBe(400);
    expect((await request(app).put(`/api/admin/staff/${t._id}`).send({ phone: '' })).status).toBe(400);
    expect((await request(app).put(`/api/admin/staff/${t._id}`).send({ joiningDate: 'tomorrow' })).status).toBe(400);
    expect((await request(app).put(`/api/admin/staff/${t._id}`).send({ role: 'bogus' })).status).toBe(400);
    expect((await request(app).put('/api/admin/staff/super1').send({ isActive: false })).status).toBe(400); // can't deactivate yourself
  });

  test('list does not leak password / refresh token / photo key', async () => {
    mk({ refreshToken: 'secret', photoKey: 'profile-photos/a.png' });
    const res = await request(app).get('/api/admin/staff');
    const row = res.body.data.find(r => r.loginId === 'teach1');
    expect(row.password).toBeUndefined();
    expect(row.refreshToken).toBeUndefined();
    expect(row.photoKey).toBeUndefined();
    expect(row.hasPhoto).toBe(true);
  });
});

describe('Profile photos', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  test('student: upload → stored, fetch streams it, delete removes it, wrong type rejected', async () => {
    const s = addStudent();
    const up = await request(app).post(`/api/admin/students/${s._id}/photo`).attach('photo', png, 'me.png');
    expect(up.status).toBe(200);
    expect(db.findById('users', s._id).photoKey).toMatch(/^profile-photos\//);
    expect((await request(app).get(`/api/admin/students/${s._id}/photo`)).status).toBe(200);
    expect((await request(app).get(`/api/admin/students/${s._id}/profile`)).body.data.personalDetails.hasPhoto).toBe(true);
    const bad = await request(app).post(`/api/admin/students/${s._id}/photo`).attach('photo', Buffer.from('x'), 'evil.exe');
    expect(bad.status).toBe(400);
    expect((await request(app).delete(`/api/admin/students/${s._id}/photo`)).status).toBe(200);
    expect(db.findById('users', s._id).photoKey).toBeNull();
    expect(r2Service.deleteObject).toHaveBeenCalled();
    expect((await request(app).get(`/api/admin/students/${s._id}/photo`)).status).toBe(404);
  });

  test('staff: upload + fetch', async () => {
    const t = db.insertOne('users', { name: 'T', role: 'teacher', loginId: 't9', isActive: true });
    expect((await request(app).post(`/api/admin/staff/${t._id}/photo`).attach('photo', png, 'me.jpg')).status).toBe(200);
    expect((await request(app).get(`/api/admin/staff/${t._id}/photo`)).status).toBe(200);
  });
});
