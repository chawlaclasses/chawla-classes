/**
 * Custom Recipient Selection (Marketing → Quick Send → targetType "selection"):
 *   GET  /campaigns/targets/recipients
 *   GET|POST /campaigns/targets/preview
 *   POST /campaigns/send            (targetType: "selection")
 * Also pins that the pre-existing target types / history keep working.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/mailer', () => ({ sendMail: jest.fn(async () => ({ sent: true })) }));
jest.mock('../../utils/whatsapp', () => ({ sendWhatsApp: jest.fn(async () => ({ sent: true })) }));
jest.mock('../../utils/sms', () => ({
  normalizeNumber: (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? d : d.length === 12 && d.startsWith('91') ? d.slice(2) : ''; },
  sendSms: jest.fn(async () => ({ sent: true })),
}));
jest.mock('../../middleware/permissions', () => ({
  requirePermission: (perm) => (req, res, next) => {
    const allowed = req.headers['x-perms'] ? req.headers['x-perms'].split(',') : ['marketing:view', 'marketing:send'];
    return allowed.includes(perm) ? next() : res.status(403).json({ success: false, message: 'forbidden' });
  },
}));

const mockData = {};
let mockIdCounter = 0;
jest.mock('../../services/jsonDb', () => ({
  find: (c, q = {}) => (mockData[c] || []).filter(d => Object.entries(q).every(([k, v]) => d[k] === v)),
  insertOne: (c, doc) => {
    const row = { _id: `new${++mockIdCounter}`, createdAt: new Date().toISOString(), ...doc };
    (mockData[c] = mockData[c] || []).push(row);
    return row;
  },
}));
jest.mock('../../services/settings', () => ({ getSettings: () => ({ campaignCosts: { sms: 0.2, whatsapp: 0, email: 0 } }) }));

const { sendSms } = require('../../utils/sms');
const { sendMail } = require('../../utils/mailer');
const { logAudit } = require('../../utils/auditLog');
const selectionService = require('../../services/marketingSelection');

function app() {
  const a = express();
  a.use(express.json({ limit: '1mb' }));
  a.use((req, _res, next) => { req.userData = { _id: 'admin1', name: 'Admin One', role: 'admin' }; next(); });
  a.use('/campaigns', require('../../routes/admin/marketing-campaigns'));
  return a;
}

const ref = (source, id) => ({ source, id });
const sel = (...refs) => ({ recipients: refs });
const send = (body) => request(app()).post('/campaigns/send').send({ title: 'Offer', message: 'Admissions open', channels: ['sms'], targetType: 'selection', ...body });

beforeEach(() => {
  mockIdCounter = 0;
  mockData.users = [
    { _id: 's1', role: 'student', name: 'Asha Student', phone: '9800000001', email: 'asha@example.com', isActive: true },
    { _id: 's2', role: 'student', name: 'Bala Student', phone: '9800000002', email: '', isActive: true },
    { _id: 's3', role: 'student', name: 'Inactive Kid', phone: '9800000003', isActive: false },
    { _id: 't1', role: 'teacher', name: 'A Teacher', phone: '9800000099', isActive: true }, // never selectable
  ];
  mockData.enquiries = [
    { _id: 'e1', name: 'Chitra Lead', phone: '9811111111', email: 'chitra@example.com', status: 'new' },
    { _id: 'e2', name: 'Dev Lead', phone: '+91 98000 00001', email: '', status: 'contacted' }, // same number as s1, different format
    { _id: 'e3', name: 'No Contact Lead', phone: '', email: '', status: 'new' },
  ];
  mockData.admissions = [
    { _id: 'a1', studentName: 'Esha Admission', parentName: 'Parent E', phone: '9822222222', email: 'esha@example.com', status: 'new' },
  ];
  mockData.marketingCampaigns = [
    { _id: 'old1', title: 'Legacy blast', message: 'old msg', channels: ['sms'], targetType: 'students', recipientCount: 10, channelResults: { sms: { sent: 8, failed: 2 } }, sentByName: 'Old Admin', createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  sendSms.mockClear(); sendSms.mockImplementation(async () => ({ sent: true }));
  sendMail.mockClear(); logAudit.mockClear();
});

// ------------------------------------------------------------------
describe('the original failing request: GET /targets/preview?targetType=selection', () => {
  test('is NOT a 400 — answers 200 with a friendly "select someone" message', async () => {
    const res = await request(app()).get('/campaigns/targets/preview?targetType=selection');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ count: 0, contacts: [], valid: false, code: 'NO_RECIPIENTS_SELECTED' });
    expect(res.body.data.message).toMatch(/select at least one recipient/i);
  });

  test('GET also accepts a compact "source:id" list', async () => {
    const res = await request(app()).get('/campaigns/targets/preview').query({ targetType: 'selection', selection: 'students:s1,enquiries:e1' });
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);
  });

  test('an unknown targetType is still rejected with 400 (unchanged)', async () => {
    const res = await request(app()).get('/campaigns/targets/preview?targetType=bogus');
    expect(res.status).toBe(400);
    const res2 = await request(app()).get('/campaigns/targets/preview');
    expect(res2.status).toBe(400);
  });
});

// ------------------------------------------------------------------
describe('GET /targets/recipients (the picker directory)', () => {
  test('lists students, enquiries and admissions with counts — no teachers, no inactive students', async () => {
    const res = await request(app()).get('/campaigns/targets/recipients');
    expect(res.status).toBe(200);
    const { rows, counts, total, maxSelectable } = res.body.data;
    expect(counts).toEqual({ students: 2, enquiries: 3, admissions: 1 });
    expect(total).toBe(6);
    expect(maxSelectable).toBe(1000);
    expect(rows.map(r => r.key)).not.toContain('students:s3');
    expect(rows.find(r => r.id === 't1')).toBeUndefined();
    expect(rows.find(r => r.key === 'admissions:a1')).toMatchObject({ source: 'admissions', sourceLabel: 'Admission', name: 'Esha Admission', phone: '9822222222', email: 'esha@example.com' });
  });

  test('needs marketing:view', async () => {
    const res = await request(app()).get('/campaigns/targets/recipients').set('x-perms', 'other:perm');
    expect(res.status).toBe(403);
  });
});

// ------------------------------------------------------------------
describe('POST /targets/preview with a selection', () => {
  test('previews exactly the selected people, across all three groups', async () => {
    const res = await request(app()).post('/campaigns/targets/preview')
      .send({ targetType: 'selection', selection: sel(ref('students', 's1'), ref('enquiries', 'e1'), ref('admissions', 'a1')) });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.count).toBe(3);
    expect(res.body.data.summary.bySource).toEqual({ students: 1, enquiries: 1, admissions: 1 });
    expect(res.body.data.contacts.map(c => c.name)).toEqual(['Asha Student', 'Chitra Lead', 'Esha Admission']);
    // only safe fields leave the server
    expect(Object.keys(res.body.data.contacts[0]).sort()).toEqual(['email', 'name', 'phone', 'source', 'sourceLabel']);
  });

  test('empty selection → friendly message, not an error status', async () => {
    for (const body of [{ targetType: 'selection' }, { targetType: 'selection', selection: { recipients: [] } }, { targetType: 'selection', selection: [] }]) {
      const res = await request(app()).post('/campaigns/targets/preview').send(body);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ count: 0, valid: false, code: 'NO_RECIPIENTS_SELECTED' });
    }
  });

  test('merges the same person listed twice (even with a differently formatted number) and says so', async () => {
    const res = await request(app()).post('/campaigns/targets/preview')
      .send({ targetType: 'selection', selection: sel(ref('students', 's1'), ref('enquiries', 'e2'), ref('students', 's1')) });
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.summary.duplicates).toBe(1);
  });

  test('skips deleted/inactive ids and people with no phone or email, and reports both', async () => {
    const res = await request(app()).post('/campaigns/targets/preview')
      .send({ targetType: 'selection', selection: sel(ref('students', 's1'), ref('students', 's3'), ref('students', 'gone'), ref('enquiries', 'e3')) });
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.summary).toMatchObject({ requested: 4, matched: 2, missing: 2, unreachable: 1 });
  });

  test('every selected id missing → friendly RECIPIENTS_NOT_FOUND', async () => {
    const res = await request(app()).post('/campaigns/targets/preview').send({ targetType: 'selection', selection: sel(ref('students', 'gone')) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ valid: false, code: 'RECIPIENTS_NOT_FOUND' });
  });

  test('more than the cap → friendly TOO_MANY_RECIPIENTS', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ref('students', `x${i}`));
    const res = await request(app()).post('/campaigns/targets/preview').send({ targetType: 'selection', selection: sel(...many) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ valid: false, code: 'TOO_MANY_RECIPIENTS' });
    expect(res.body.data.message).toMatch(/at most 1000/);
  });

  test('needs marketing:view', async () => {
    const res = await request(app()).post('/campaigns/targets/preview').set('x-perms', 'other:perm').send({ targetType: 'selection' });
    expect(res.status).toBe(403);
  });
});

// ------------------------------------------------------------------
describe('POST /send with targetType "selection"', () => {
  test('sends ONLY to the selected recipients and records it in history', async () => {
    const res = await send({ selection: sel(ref('students', 's1'), ref('enquiries', 'e1'), ref('admissions', 'a1')) });
    expect(res.status).toBe(201);
    expect(sendSms).toHaveBeenCalledTimes(3);
    expect(sendSms.mock.calls.map(c => c[0].to).sort()).toEqual(['9800000001', '9811111111', '9822222222']);
    // nobody else got it
    expect(sendSms.mock.calls.map(c => c[0].to)).not.toContain('9800000002');

    const saved = mockData.marketingCampaigns.find(c => c.title === 'Offer');
    expect(saved).toMatchObject({ targetType: 'selection', recipientCount: 3, channelResults: { email: { sent: 0, failed: 0 }, whatsapp: { sent: 0, failed: 0 }, sms: { sent: 3, failed: 0 } } });
    expect(saved.targetValue).toBe('3 selected: 1 students, 1 enquiries, 1 admissions');
    expect(saved.selectionSummary.bySource).toEqual({ students: 1, enquiries: 1, admissions: 1 });
    expect(logAudit).toHaveBeenCalled();
  });

  test('works over email too, and de-duplicates so nobody is messaged twice', async () => {
    const res = await send({ channels: ['email'], selection: sel(ref('students', 's1'), ref('enquiries', 'e2'), ref('enquiries', 'e1')) });
    expect(res.status).toBe(201);
    // s1 and e2 share a number → merged; e2 has no email but is merged away anyway
    expect(sendMail.mock.calls.map(c => c[0].to).sort()).toEqual(['asha@example.com', 'chitra@example.com']);
  });

  test('nothing selected → 422 with a friendly message; nothing sent or logged', async () => {
    const before = mockData.marketingCampaigns.length;
    for (const body of [{}, { selection: { recipients: [] } }, { selection: null }, { targetValue: '' }]) {
      const res = await send(body);
      expect(res.status).toBe(422);
      expect(res.status).not.toBe(400);
      expect(res.body).toMatchObject({ success: false, code: 'NO_RECIPIENTS_SELECTED' });
      expect(res.body.message).toMatch(/select at least one recipient/i);
    }
    expect(sendSms).not.toHaveBeenCalled();
    expect(mockData.marketingCampaigns.length).toBe(before);
  });

  test('SAFETY: contact details supplied by the browser are never used', async () => {
    // A tampered client sends raw numbers instead of references.
    const res = await send({ selection: sel({ name: 'Mallory', phone: '9999999999' }, { source: 'students', id: { $ne: null } }) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_SELECTION');
    expect(sendSms).not.toHaveBeenCalled();

    // …and the legacy shape (targetValue = array of contact objects) used to crash with a 500.
    const legacy = await send({ targetValue: [{ name: 'X', phone: { a: 1 } }] });
    expect(legacy.status).toBe(422);
    expect(sendSms).not.toHaveBeenCalled();
  });

  test('SAFETY: a forged id for a record that is not a student/enquiry/admission reaches nobody', async () => {
    const res = await send({ selection: sel(ref('students', 't1'), ref('users', 's1'), ref('__proto__', 's1'), ref('constructor', 'x')) });
    expect(res.status).toBe(422);
    expect(sendSms).not.toHaveBeenCalled();
  });

  test('stale ids are skipped, valid ones still go out', async () => {
    const res = await send({ selection: sel(ref('students', 's1'), ref('students', 'deleted-yesterday')) });
    expect(res.status).toBe(201);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(res.body.data.recipientCount).toBe(1);
  });

  test('channel nobody can receive → 422 "no email address", nothing sent', async () => {
    const res = await send({ channels: ['email'], selection: sel(ref('students', 's2')) }); // s2 has no email
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_REACHABLE_RECIPIENTS');
    expect(res.body.message).toMatch(/email address/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('over the cap → 422, nothing sent', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ref('students', `x${i}`));
    const res = await send({ selection: sel(...many) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('TOO_MANY_RECIPIENTS');
    expect(sendSms).not.toHaveBeenCalled();
  });

  test('title/message/channel validation is unchanged', async () => {
    expect((await request(app()).post('/campaigns/send').send({ message: 'x', channels: ['sms'], targetType: 'selection' })).status).toBe(400);
    expect((await send({ channels: [], selection: sel(ref('students', 's1')) })).status).toBe(400);
  });

  test('needs marketing:send', async () => {
    const res = await request(app()).post('/campaigns/send').set('x-perms', 'marketing:view').send({ title: 't', message: 'm', channels: ['sms'], targetType: 'selection', selection: sel(ref('students', 's1')) });
    expect(res.status).toBe(403);
  });
});

// ------------------------------------------------------------------
describe('regressions — existing behaviour is intact', () => {
  test('non-selection preview + send still work', async () => {
    const prev = await request(app()).get('/campaigns/targets/preview?targetType=students');
    expect(prev.status).toBe(200);
    expect(prev.body.data.count).toBe(2);

    const res = await request(app()).post('/campaigns/send').send({ title: 'All', message: 'hi', channels: ['sms'], targetType: 'students' });
    expect(res.status).toBe(201);
    expect(sendSms).toHaveBeenCalledTimes(2);
    expect(mockData.marketingCampaigns.find(c => c.title === 'All').targetValue).toBeNull();
  });

  test('an empty non-selection target is still the old 400', async () => {
    mockData.enquiries = [];
    const res = await request(app()).post('/campaigns/send').send({ title: 'x', message: 'y', channels: ['sms'], targetType: 'enquiries' });
    expect(res.status).toBe(400);
  });

  test('GET /history still lists old and new campaigns', async () => {
    await send({ selection: sel(ref('students', 's1')) });
    const res = await request(app()).get('/campaigns/history');
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.title)).toEqual(expect.arrayContaining(['Legacy blast', 'Offer']));
  });
});

// ------------------------------------------------------------------
describe('parseSelection (unit)', () => {
  test('accepts the canonical object, a bare array, and a comma list; de-duplicates', () => {
    const a = selectionService.parseSelection({ recipients: [ref('students', 's1'), 'students:s1', ref('enquiries', 'e1')] });
    expect(a.entries.map(e => e.key)).toEqual(['students:s1', 'enquiries:e1']);
    expect(selectionService.parseSelection([ref('students', 's1')]).entries).toHaveLength(1);
    expect(selectionService.parseSelection('students:s1, admissions:a1').entries).toHaveLength(2);
  });

  test('rejects malformed items and odd shapes without throwing', () => {
    expect(selectionService.parseSelection({ recipients: [null, 5, {}, { source: 'students' }, { source: 'students', id: 7 }, 'nocolon', 'students:' , 'students:has space'] }).malformed).toBe(8);
    expect(selectionService.parseSelection({ recipients: 'students:s1' }).shapeOk).toBe(false);
    expect(selectionService.parseSelection(42).shapeOk).toBe(false);
    expect(() => selectionService.resolveSelection({ recipients: [{ source: 'toString', id: 'x' }] })).not.toThrow();
  });
});
