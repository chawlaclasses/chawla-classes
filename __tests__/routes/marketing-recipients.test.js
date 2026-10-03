/**
 * HTTP-level tests for the Recipient Selection System:
 *   /marketing/recipients/*             (routes/admin/marketing-recipients.js)
 *   /marketing/campaigns/send-selected  (routes/admin/marketing-campaigns.js)
 *   /marketing/campaigns/campaign-history
 * Also pins that the pre-existing /history route still works.
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

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.userData = { _id: 'admin1', name: 'Admin One', role: 'admin' }; next(); });
  a.use('/recipients', require('../../routes/admin/marketing-recipients'));
  a.use('/campaigns', require('../../routes/admin/marketing-campaigns'));
  return a;
}

beforeEach(() => {
  mockIdCounter = 0;
  mockData.classes = [{ _id: 'c9', name: 'Class 9', displayName: 'Class 9', isActive: true }];
  mockData.users = Array.from({ length: 30 }, (_, i) => ({
    _id: `s${i}`, role: 'student', name: `Student ${i}`, phone: `98000${10000 + i}`, parentName: `Parent ${i}`, parentPhone: `97000${10000 + i}`, classId: 'c9', isActive: true,
  }));
  mockData['fees-v2'] = [{ studentId: 's0', status: 'Pending' }];
  mockData.enquiries = [{ _id: 'e1', name: 'Lead', phone: '9111111111', status: 'new', interestedClass: 'Class 9' }];
  mockData.marketingCampaigns = [
    // a campaign saved by the OLD /send route (no cost / new fields)
    { _id: 'old1', title: 'Legacy blast', message: 'old msg', channels: ['sms'], targetType: 'students', recipientCount: 10, channelResults: { sms: { sent: 8, failed: 2 } }, sentByName: 'Old Admin', createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  sendSms.mockClear();
  sendSms.mockImplementation(async () => ({ sent: true }));
});

describe('GET /recipients/meta', () => {
  test('returns groups, classes, statuses, channels and costs', async () => {
    const res = await request(app()).get('/recipients/meta');
    expect(res.status).toBe(200);
    expect(res.body.data.groups.map(g => g.id)).toEqual(['all_students', 'active_students', 'fee_due', 'new_enquiries', 'parents', 'teachers', 'custom']);
    expect(res.body.data.costs.sms).toBe(0.2);
    expect(res.body.data.channels.find(c => c.id === 'push').available).toBe(false);
  });
  test('needs marketing:view', async () => {
    const res = await request(app()).get('/recipients/meta').set('x-perms', 'something:else');
    expect(res.status).toBe(403);
  });
});

describe('GET /recipients/list', () => {
  test('paginates, searches and returns keys of ALL matches', async () => {
    const res = await request(app()).get('/recipients/list').query({ groups: 'active_students', limit: 10, page: 2 });
    expect(res.body.data.rows).toHaveLength(10);
    expect(res.body.data.total).toBe(30);
    expect(res.body.data.matchingKeys).toHaveLength(30);
    const s = await request(app()).get('/recipients/list').query({ groups: 'custom', search: '9800010005' });
    expect(s.body.data.rows.map(r => r.name)).toEqual(['Student 5']);
  });
});

describe('POST /recipients/estimate', () => {
  test('returns counts, cost and the validation verdict — never the recipient list', async () => {
    const res = await request(app()).post('/recipients/estimate').send({ channel: 'sms', message: 'Admissions open', selection: { groups: ['active_students'] } });
    expect(res.body.data).toMatchObject({ selectedCount: 30, validCount: 30, totalUnits: 30, rate: 0.2, estimatedCost: 6, validationError: null });
    expect(res.body.data.recipients).toBeUndefined();
  });
  test('reports why a send would be blocked', async () => {
    const res = await request(app()).post('/recipients/estimate').send({ channel: 'sms', message: '', selection: { groups: ['custom'] } });
    expect(res.body.data.validationError).toMatch(/message cannot be empty/i);
  });
});

describe('POST /campaigns/send-selected', () => {
  const body = (over = {}) => ({ title: 'Admissions 2027', message: 'Admissions open', channel: 'sms', selection: { groups: ['fee_due'] }, ...over });

  test('sends, logs a campaign with all history fields, returns the outcome', async () => {
    const res = await request(app()).post('/campaigns/send-selected').send(body({ selection: { groups: ['active_students'], excluded: ['student:s0'] } }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ sent: 29, failed: 0, totalRecipients: 29, totalCost: 5.8 });
    expect(sendSms).toHaveBeenCalledTimes(29);

    const saved = mockData.marketingCampaigns.find(c => c.campaignName === 'Admissions 2027');
    expect(saved).toMatchObject({
      message: 'Admissions open', totalRecipients: 29, successfulSends: 29, failedSends: 0, totalCost: 5.8,
      createdByName: 'Admin One', title: 'Admissions 2027', channels: ['sms'],
    });
    expect(saved.createdAt).toBeTruthy();
  });

  test('partial failures are recorded and only successes are billed', async () => {
    sendSms.mockImplementation(async ({ to }) => (to === '9800010001' ? { sent: false, reason: 'Invalid' } : { sent: true }));
    const res = await request(app()).post('/campaigns/send-selected').send(body({ selection: { groups: ['custom'], included: ['student:s0', 'student:s1'] } }));
    expect(res.body.data).toMatchObject({ sent: 1, failed: 1, totalCost: 0.2 });
    expect(res.body.message).toMatch(/1 failed/);
  });

  test.each([
    ['empty message', { message: '   ' }, /message cannot be empty/i],
    ['missing campaign name', { title: '' }, /campaign name/i],
    ['no recipients', { selection: { groups: ['custom'] } }, /no recipients selected/i],
    ['unavailable channel', { channel: 'push' }, /not available/i],
  ])('rejects %s with 400 and sends nothing', async (_n, over, msg) => {
    const res = await request(app()).post('/campaigns/send-selected').send(body(over));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(msg);
    expect(sendSms).not.toHaveBeenCalled();
  });

  test('rejects when every selected number is invalid', async () => {
    mockData.users.push({ _id: 'bad', role: 'student', name: 'No Phone', phone: '123', classId: 'c9', isActive: true });
    const res = await request(app()).post('/campaigns/send-selected').send(body({ selection: { groups: ['custom'], included: ['student:bad'] } }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid mobile number/i);
  });

  test('needs marketing:send', async () => {
    const res = await request(app()).post('/campaigns/send-selected').set('x-perms', 'marketing:view').send(body());
    expect(res.status).toBe(403);
  });

  test('a second send while one is still going out is refused (no double-send)', async () => {
    let release;
    sendSms.mockImplementation(() => new Promise(r => { release = () => r({ sent: true }); }));
    const a = app();
    const first = request(a).post('/campaigns/send-selected').send(body()).then(r => r);
    await new Promise(r => setTimeout(r, 50));
    const second = await request(a).post('/campaigns/send-selected').send(body());
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(201);
  });
});

describe('campaign history', () => {
  test('new endpoint normalises old and new campaigns, paginates and searches', async () => {
    await request(app()).post('/campaigns/send-selected').send({ title: 'New one', message: 'm', channel: 'sms', selection: { groups: ['fee_due'] } });
    const res = await request(app()).get('/campaigns/campaign-history');
    const rows = res.body.data.rows;
    expect(rows.map(r => r.campaignName)).toEqual(['New one', 'Legacy blast']); // newest first
    expect(rows[0]).toMatchObject({ totalRecipients: 1, successfulSends: 1, failedSends: 0, totalCost: 0.2, createdBy: 'Admin One' });
    expect(rows[1]).toMatchObject({ totalRecipients: 10, successfulSends: 8, failedSends: 2, totalCost: null, createdBy: 'Old Admin' });

    const q = await request(app()).get('/campaigns/campaign-history').query({ search: 'legacy' });
    expect(q.body.data.total).toBe(1);
    const p = await request(app()).get('/campaigns/campaign-history').query({ limit: 1, page: 2 });
    expect(p.body.data).toMatchObject({ page: 2, pages: 2 });
  });

  test('the pre-existing GET /history still returns campaigns (new ones keep legacy fields)', async () => {
    await request(app()).post('/campaigns/send-selected').send({ title: 'New one', message: 'm', channel: 'sms', selection: { groups: ['fee_due'] } });
    const res = await request(app()).get('/campaigns/history');
    const c = res.body.data.find(x => x.title === 'New one');
    expect(c).toMatchObject({ channels: ['sms'], recipientCount: 1 });
  });
});
