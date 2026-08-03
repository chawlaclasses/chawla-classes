/**
 * Integration tests for GET /api/admin/search.
 *
 * Phase 3 rewrite. The previous version of this file never touched
 * routes/admin/search.js at all — it built its own throwaway Express app in
 * beforeAll with a hand-written mock endpoint and two hardcoded fake
 * results (one of them labeled category: 'Questions', which is where the
 * 'Questions' vs 'Question Bank' mismatch flagged in
 * HANDOFF_NEXT_CLAUDE_PHASE3.md came from — it was fixture data in a test
 * that was never exercising the real route, not a bug in the real route).
 * A mutation test during Phase 3 confirmed this file gave a false "20/20
 * passing" signal even with the real route body replaced by an
 * unconditional 500. See PHASE_3_REPORT.md for the transcript.
 *
 * This version mounts the REAL router at its real production path
 * (/api/admin/search — see routes/adminRoutes.js: `router.use('/search',
 * require('./admin/search'))` under app.js's '/api/admin' prefix) behind a
 * small stand-in for requireApiAdmin that just sets req.userData, the way
 * the real middleware does after verifying a JWT.
 *
 * Unlike the unit test file (which mocks config/permissions to isolate
 * pure route logic), this file uses the REAL config/permissions.js matrix.
 * That's the point of calling it an integration test: routes/admin/search.js
 * exists specifically so "a teacher never sees fee amounts or recruitment
 * candidate PII" (its own file header's words) — that promise depends on
 * this route and the real ROLE_PERMISSIONS matrix agreeing with each
 * other, which mocking hasPermission away would hide.
 *
 * services/jsonDb and utils/logger are mocked — this suite is about
 * route + permissions behavior, not the real JSON-file storage layer or
 * Rohit's real Data/ files.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/jsonDb');
jest.mock('../../utils/logger');

const db = require('../../services/jsonDb');
const { ROLES } = require('../../config/permissions'); // real matrix, not mocked
const searchRouter = require('../../routes/admin/search');

// Fixture data. Every collection has at least one record matching 'rohit'
// so a single query can be asserted against across every category in one
// request, the same way the real dashboard.html header search box would be
// used.
const FIXTURES = {
  users: [
    { _id: 'stu1', name: 'Rohit Student', email: 'rohit.student@x.com', role: 'student', rollNumber: 'CC-101' },
    { _id: 'staff1', name: 'Rohit Teacher', email: 'rohit.teacher@x.com', role: 'teacher' },
  ],
  classes: [{ _id: 'cls1', name: 'rohit-batch', displayName: "Rohit's Batch" }],
  subjects: [{ _id: 'sub1', name: 'Physics', code: 'PHY' }],
  series: [{ _id: 'ser1', name: 'Test Series A', description: 'General series', type: 'Mock' }],
  tests: [{ _id: 'test1', title: 'Unit Test 1', description: 'Chapter 1', isPublished: true }],
  questions: [{ _id: 'q1', questionText: 'A question about Rohit', chapter: 'Ch 5', topic: 'Motion' }],
  homework: [{ _id: 'hw1', title: 'Rohit Homework', description: 'Practice set', isPublished: true }],
  doubts: [{ _id: 'd1', questionText: 'Doubt raised by Rohit', status: 'open' }],
  'fees-v2': [{ _id: 'fee1', studentId: 'stu1', amount: 4500, status: 'due', title: 'Rohit fee record' }],
  facultyApplications: [{ _id: 'app1', fullName: 'Rohit Candidate', email: 'cand@x.com', phone: '9999999999', status: 'pending' }],
  enquiries: [{ _id: 'enq1', name: 'Rohit Enquiry', phone: '8888888888', email: 'enq@x.com' }],
  admissions: [{ _id: 'adm1', studentName: 'Rohit Admission', parentName: 'Parent Name', phone: '7777777777', email: 'adm@x.com' }],
  broadcasts: [{ _id: 'bc1', title: 'Notice about Rohit', message: 'Please note Rohit will be recognized.' }],
};

function mockDb() {
  db.find.mockImplementation((collection, query) => {
    const rows = FIXTURES[collection] || [];
    if (collection === 'users' && query && query.role === 'student') {
      return rows.filter((u) => u.role === 'student');
    }
    if (collection === 'users' && (!query || Object.keys(query).length === 0)) {
      return rows;
    }
    return rows;
  });
  db.findById.mockImplementation((collection, id) => {
    if (collection === 'users') return (FIXTURES.users || []).find((u) => u._id === id) || null;
    return null;
  });
}

// Stands in for the real requireApiAdmin middleware (middleware/apiAuth.js),
// which verifies a JWT and then does `req.userData = user`. We skip real
// JWT verification here — that's apiAuth's own test surface, not this
// route's — and just attach the role the test wants.
function buildApp(userData) {
  const app = express();
  app.use((req, res, next) => {
    if (userData !== undefined) req.userData = userData;
    next();
  });
  app.use('/api/admin/search', searchRouter);
  return app;
}

describe('GET /api/admin/search (integration, real permission matrix)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb();
  });

  test('admin sees categories restricted to admin/super_admin, e.g. Fees and Faculty Recruitment', async () => {
    const res = await request(buildApp({ role: ROLES.ADMIN })).get('/api/admin/search').query({ q: 'rohit' });

    expect(res.status).toBe(200);
    const categories = new Set(res.body.data.results.map((r) => r.category));
    expect(categories).toEqual(new Set([
      'Students', 'Staff', 'Faculty Recruitment', 'Classes', 'Question Bank',
      'Homework', 'Doubts', 'Fees', 'Enquiries', 'Admissions', 'Broadcasts',
    ]));
  });

  test('teacher never sees Fees, Staff, or Faculty Recruitment candidate PII, even on a matching query', async () => {
    const res = await request(buildApp({ role: ROLES.TEACHER })).get('/api/admin/search').query({ q: 'rohit' });

    expect(res.status).toBe(200);
    const categories = new Set(res.body.data.results.map((r) => r.category));
    expect(categories.has('Fees')).toBe(false);
    expect(categories.has('Staff')).toBe(false);
    expect(categories.has('Faculty Recruitment')).toBe(false);
    expect(categories.has('Admissions')).toBe(false);
    expect(categories.has('Enquiries')).toBe(false);
    expect(categories.has('Broadcasts')).toBe(false);
    // But a teacher's own visible categories still come through.
    expect(categories.has('Students')).toBe(true);
    expect(categories.has('Classes')).toBe(true);
    expect(categories.has('Question Bank')).toBe(true);
    expect(categories.has('Homework')).toBe(true);
    expect(categories.has('Doubts')).toBe(true);
  });

  test('accountant sees Fees but not Faculty Recruitment or Homework', async () => {
    const res = await request(buildApp({ role: ROLES.ACCOUNTANT })).get('/api/admin/search').query({ q: 'rohit' });

    const categories = new Set(res.body.data.results.map((r) => r.category));
    expect(categories.has('Fees')).toBe(true);
    expect(categories.has('Faculty Recruitment')).toBe(false);
    expect(categories.has('Homework')).toBe(false);
  });

  test('a request with no userData at all (role undefined) gets zero results, not a crash', async () => {
    const res = await request(buildApp(undefined)).get('/api/admin/search').query({ q: 'rohit' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { results: [] } });
  });

  test('short (<2 char) and missing queries short-circuit to an empty result before any DB read', async () => {
    const shortRes = await request(buildApp({ role: ROLES.SUPER_ADMIN })).get('/api/admin/search').query({ q: 'r' });
    expect(shortRes.body.data.results).toEqual([]);

    const missingRes = await request(buildApp({ role: ROLES.SUPER_ADMIN })).get('/api/admin/search');
    expect(missingRes.body.data.results).toEqual([]);
  });

  test('every result has the shape the frontend depends on (category, section, id, title, subtitle, icon)', async () => {
    const res = await request(buildApp({ role: ROLES.SUPER_ADMIN })).get('/api/admin/search').query({ q: 'rohit' });

    expect(res.body.data.results.length).toBeGreaterThan(0);
    for (const r of res.body.data.results) {
      expect(r).toEqual(expect.objectContaining({
        category: expect.any(String),
        section: expect.any(String),
        id: expect.any(String),
        title: expect.any(String),
        icon: expect.any(String),
      }));
      expect(typeof r.subtitle).toBe('string');
    }
  });

  test('a repeated query param (Express parses it as an array) does not crash the route', async () => {
    // ?q=rohit&q=teacher -> req.query.q is ['rohit', 'teacher'] in Express,
    // not a string. The route does `(req.query.q || '').toString()`, which
    // on an array joins with commas rather than throwing — confirm that
    // holds instead of assuming it.
    const res = await request(buildApp({ role: ROLES.SUPER_ADMIN })).get('/api/admin/search?q=rohit&q=teacher');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('unusual input (SQL-injection-like, script-tag-like, very long) returns 200 with no matches, not a crash', async () => {
    const inputs = ["'; DROP TABLE users; --", '<script>alert(1)</script>', 'z'.repeat(1000)];
    for (const q of inputs) {
      const res = await request(buildApp({ role: ROLES.SUPER_ADMIN })).get('/api/admin/search').query({ q });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results).toEqual([]);
    }
  });

  test('handles a burst of concurrent requests from different roles independently', async () => {
    const roles = [ROLES.ADMIN, ROLES.TEACHER, ROLES.RECEPTION, ROLES.ACCOUNTANT, ROLES.SUPER_ADMIN];
    const responses = await Promise.all(
      roles.map((role) => request(buildApp({ role })).get('/api/admin/search').query({ q: 'rohit' }))
    );

    responses.forEach((res) => expect(res.status).toBe(200));
    // Sanity check the responses didn't bleed into each other: admin/super
    // admin get Fees, teacher/reception/accountant behave per their own
    // matrix (reception and accountant both get Fees too, per real matrix).
    const byRole = Object.fromEntries(roles.map((role, i) => [role, responses[i]]));
    expect(new Set(byRole[ROLES.TEACHER].body.data.results.map((r) => r.category)).has('Fees')).toBe(false);
    expect(new Set(byRole[ROLES.ADMIN].body.data.results.map((r) => r.category)).has('Fees')).toBe(true);
  });
});
