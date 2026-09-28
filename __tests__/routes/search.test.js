/**
 * Unit tests for routes/admin/search.js (GET /api/admin/search)
 *
 * Phase 3 rewrite. The previous version of this file (Phase 2 and earlier)
 * imported the real router but never actually sent a request through it —
 * every test reimplemented its own inline copy of the filtering logic and
 * asserted against that copy instead. A mutation test during Phase 3 proved
 * this: replacing the entire route body with `return
 * res.status(500).json(...)` still left all 5 tests in this file (and all
 * 15 in the integration file) green. See PHASE_3_REPORT.md for the full
 * before/after transcript.
 *
 * This version drives the real router through supertest, so a change to
 * routes/admin/search.js's actual behavior will actually be seen here.
 *
 * services/jsonDb, utils/logger, and config/permissions are mocked — this
 * is a unit test of the route's own logic (query-length guard, per-category
 * permission gating, per-category result cap, the fees student-name-lookup
 * cache, and the error path), not of the real permission matrix or the real
 * data files. See __tests__/integration/search.integration.test.js for a
 * test that exercises the real config/permissions.js matrix instead.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/jsonDb');
jest.mock('../../utils/logger');
jest.mock('../../config/permissions', () => ({
  hasPermission: jest.fn(),
}));

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { hasPermission } = require('../../config/permissions');
const searchRouter = require('../../routes/admin/search');

function buildApp(userData = { role: 'admin' }) {
  const app = express();
  app.use((req, res, next) => {
    req.userData = userData;
    next();
  });
  app.use('/api/admin/search', searchRouter);
  return app;
}

describe('GET /api/admin/search (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: every category permitted, every collection empty. Individual
    // tests override with mockImplementation for the collection(s) they care
    // about. Defaulting to [] (not undefined) matters — the real route calls
    // `.filter(...)` straight on db.find()'s return value with no guard, so
    // an unmocked jest.fn() returning undefined would throw a TypeError
    // that has nothing to do with the behavior under test.
    db.find.mockImplementation(() => []);
    db.findById.mockImplementation(() => null);
    hasPermission.mockReturnValue(true);
  });

  test('returns empty results and skips all DB/permission checks for a 1-char query', async () => {
    const res = await request(buildApp()).get('/api/admin/search').query({ q: 'a' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { results: [] } });
    expect(db.find).not.toHaveBeenCalled();
    expect(hasPermission).not.toHaveBeenCalled();
  });

  test('returns empty results for a missing query param', async () => {
    const res = await request(buildApp()).get('/api/admin/search');

    expect(res.status).toBe(200);
    expect(res.body.data.results).toEqual([]);
  });

  test('matches students by name, email, or roll number (case-insensitive)', async () => {
    db.find.mockImplementation((collection) => {
      if (collection === 'users') {
        return [
          { _id: 's1', name: 'Rohit Sharma', email: 'rohit@x.com', role: 'student', rollNumber: 'CC-001' },
          { _id: 's2', name: 'Someone Else', email: 'else@x.com', role: 'student', rollNumber: 'CC-002' },
        ];
      }
      return [];
    });

    const res = await request(buildApp()).get('/api/admin/search').query({ q: 'ROHIT' });

    expect(res.status).toBe(200);
    expect(res.body.data.results).toEqual([
      {
        category: 'Students', section: 'students', id: 's1',
        title: 'Rohit Sharma', subtitle: 'rohit@x.com', icon: 'fa-users',
      },
    ]);
  });

  test('Staff category excludes student-role users and only includes the rest', async () => {
    db.find.mockImplementation((collection, query) => {
      if (collection === 'users' && query && query.role === 'student') {
        return [{ _id: 's1', name: 'Test Teacher', email: 't@x.com', role: 'student' }];
      }
      if (collection === 'users' && (!query || Object.keys(query).length === 0)) {
        return [
          { _id: 't1', name: 'Test Teacher', email: 't@x.com', role: 'teacher' },
          { _id: 's1', name: 'Test Teacher', email: 't@x.com', role: 'student' },
        ];
      }
      return [];
    });

    const res = await request(buildApp()).get('/api/admin/search').query({ q: 'teacher' });

    const staffResults = res.body.data.results.filter((r) => r.category === 'Staff');
    expect(staffResults).toHaveLength(1);
    expect(staffResults[0]).toMatchObject({ id: 't1', title: 'Test Teacher', subtitle: 'teacher' });
  });

  test('uses "Question Bank" as the category label, not "Questions"', async () => {
    // This is the concrete lead from HANDOFF_NEXT_CLAUDE_PHASE3.md: the old
    // integration test's hardcoded mock data used the category 'Questions',
    // which does not match routes/admin/search.js's real value of
    // 'Question Bank'. That old test never actually asserted the category
    // value, so the mismatch was invisible. This test pins the real value
    // so a future rename of either side gets caught.
    db.find.mockImplementation((collection) => {
      if (collection === 'questions') {
        return [{ _id: 'q1', questionText: 'Explain photosynthesis', chapter: 'Biology Ch.4' }];
      }
      return [];
    });

    const res = await request(buildApp()).get('/api/admin/search').query({ q: 'photosynthesis' });

    const categories = res.body.data.results.map((r) => r.category);
    expect(categories).toContain('Question Bank');
    expect(categories).not.toContain('Questions');
  });

  test('caps results per category at 5, even when more than 5 match', async () => {
    db.find.mockImplementation((collection) => {
      if (collection === 'subjects') {
        return Array.from({ length: 8 }, (_, i) => ({ _id: `sub${i}`, name: `Physics ${i}`, code: `PHY${i}` }));
      }
      return [];
    });

    const res = await request(buildApp()).get('/api/admin/search').query({ q: 'physics' });

    const subjectResults = res.body.data.results.filter((r) => r.category === 'Subjects');
    expect(subjectResults).toHaveLength(5);
  });

  test('a category is omitted entirely when its permission is denied, while others remain', async () => {
    hasPermission.mockImplementation((role, permission) => permission !== 'staff:view');
    db.find.mockImplementation((collection, query) => {
      if (collection === 'users' && query && query.role === 'student') {
        return [{ _id: 's1', name: 'Rohit Sharma', email: 'rohit@x.com', role: 'student' }];
      }
      if (collection === 'users') {
        return [{ _id: 't1', name: 'Rohit Teacher', email: 'rt@x.com', role: 'teacher' }];
      }
      return [];
    });

    const res = await request(buildApp()).get('/api/admin/search').query({ q: 'rohit' });

    const categories = res.body.data.results.map((r) => r.category);
    expect(categories).toContain('Students');
    expect(categories).not.toContain('Staff');
  });

  test('Fees results join in the student name and cache repeat lookups by studentId', async () => {
    db.find.mockImplementation((collection) => {
      if (collection === 'fees-v2') {
        return [
          { _id: 'f1', studentId: 'stu1', amount: 5000, status: 'paid', title: 'Term 1 fee' },
          { _id: 'f2', studentId: 'stu1', amount: 6000, status: 'due', title: 'Term 2 fee' },
        ];
      }
      return [];
    });
    db.findById.mockImplementation((collection, id) => {
      if (collection === 'users' && id === 'stu1') return { _id: 'stu1', name: 'Rohit Sharma' };
      return null;
    });

    const res = await request(buildApp()).get('/api/admin/search').query({ q: 'term' });

    const feeResults = res.body.data.results.filter((r) => r.category === 'Fees');
    expect(feeResults).toHaveLength(2);
    expect(feeResults[0].title).toBe('Rohit Sharma — ₹5000');
    expect(feeResults[1].title).toBe('Rohit Sharma — ₹6000');
    // Both fee records share studentId 'stu1' — the route's studentNameCache
    // should mean only one findById call for it, not two.
    expect(db.findById).toHaveBeenCalledTimes(1);
  });

  test('returns 500 and logs when a collection lookup throws', async () => {
    db.find.mockImplementation((collection) => {
      if (collection === 'users') throw new Error('DB read failed');
      return [];
    });

    const res = await request(buildApp()).get('/api/admin/search').query({ q: 'rohit' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Search failed. Please try again.' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toEqual(expect.stringContaining('/api/admin/search'));
  });

  test('does not crash on special characters, SQL-injection-like, or script-tag-like input', async () => {
    const queries = ["'; DROP TABLE users; --", '<script>alert(1)</script>', 'a@b.com#$%'];
    for (const q of queries) {
      const res = await request(buildApp()).get('/api/admin/search').query({ q });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });
});
