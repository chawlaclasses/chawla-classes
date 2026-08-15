/**
 * Tests for routes/settings.js's email-diagnostics endpoints: POST
 * /test-email (real nodemailer send, mocked here since it needs real
 * SMTP credentials to actually connect) and POST /test-smtp-connectivity
 * (mocked utils/netProbe here — netProbe's own real-socket behavior is
 * covered live in __tests__/utils/netProbe.test.js).
 *
 * The bug this suite exists to pin down: saveEmailSettings() on the
 * frontend never sends a `secure` field, so it silently stayed `false` in
 * every saved record regardless of port — including port 465, which
 * requires secure:true. These tests assert the route now derives `secure`
 * from the port instead of trusting that unset field.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('nodemailer');
jest.mock('../../utils/netProbe');
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../middleware/upload', () => ({
  diskStorage: () => ({ _handleFile: (_r, _f, cb) => cb(null, {}), _removeFile: (_r, _f, cb) => cb(null) }),
}));
jest.mock('../../services/settings', () => ({
  getSettings: jest.fn(),
  updateSettings: jest.fn(),
}));

const nodemailer = require('nodemailer');
const { probeTcpPort } = require('../../utils/netProbe');
const settingsService = require('../../services/settings');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userData = { role: 'super_admin' }; // '*' permission — passes every requirePermission check
    next();
  });
  const settingsRouter = require('../../routes/settings');
  app.use(settingsRouter);
  return app;
}

function baseEmailSettings(overrides = {}) {
  return {
    instituteName: 'Chawla Classes',
    email: {
      host: 'smtp.gmail.com', port: 587, secure: undefined,
      user: '4chawlaclasses@gmail.com', pass: 'app-password',
      fromName: 'Chawla Classes', fromAddress: 'no-reply@chawlaclasses.com',
      ...overrides,
    },
  };
}

describe('POST /test-email', () => {
  let sendMail;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail = jest.fn().mockResolvedValue({ messageId: 'abc' });
    nodemailer.createTransport.mockReturnValue({ sendMail });
  });

  test('port 587 (no secure field ever saved): derives secure:false, not a hardcoded true/false bug', async () => {
    settingsService.getSettings.mockReturnValue(baseEmailSettings({ port: 587 }));

    const res = await request(buildApp()).post('/test-email').send({ to: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const transportArgs = nodemailer.createTransport.mock.calls[0][0];
    expect(transportArgs.secure).toBe(false);
    expect(transportArgs.port).toBe(587);
  });

  test('port 465 (no secure field ever saved): derives secure:true — this was the actual bug', async () => {
    settingsService.getSettings.mockReturnValue(baseEmailSettings({ port: 465 }));

    await request(buildApp()).post('/test-email').send({ to: 'test@example.com' });

    const transportArgs = nodemailer.createTransport.mock.calls[0][0];
    expect(transportArgs.secure).toBe(true);
    expect(transportArgs.port).toBe(465);
  });

  test('an explicit secure value (if some future caller sets one) is still respected over the port-based default', async () => {
    settingsService.getSettings.mockReturnValue(baseEmailSettings({ port: 465, secure: false }));

    await request(buildApp()).post('/test-email').send({ to: 'test@example.com' });

    const transportArgs = nodemailer.createTransport.mock.calls[0][0];
    expect(transportArgs.secure).toBe(false); // explicit false wins even on port 465
  });

  test('sets short timeouts instead of nodemailer\'s 2-minute default', async () => {
    settingsService.getSettings.mockReturnValue(baseEmailSettings());

    await request(buildApp()).post('/test-email').send({ to: 'test@example.com' });

    const transportArgs = nodemailer.createTransport.mock.calls[0][0];
    expect(transportArgs.connectionTimeout).toBeLessThanOrEqual(10000);
    expect(transportArgs.greetingTimeout).toBeLessThanOrEqual(10000);
    expect(transportArgs.socketTimeout).toBeLessThanOrEqual(10000);
  });

  test('a timeout-flavored error gets the network-block hint appended, not just the raw nodemailer message', async () => {
    settingsService.getSettings.mockReturnValue(baseEmailSettings());
    const err = new Error('Connection timeout');
    err.code = 'ETIMEDOUT';
    sendMail.mockRejectedValue(err);

    const res = await request(buildApp()).post('/test-email').send({ to: 'test@example.com' });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/blocked at the network level/i);
    expect(res.body.message).toMatch(/Test Connectivity/i);
  });

  test('an auth-flavored error gets the app-password hint, not the network-block hint', async () => {
    settingsService.getSettings.mockReturnValue(baseEmailSettings());
    const err = new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
    err.code = 'EAUTH';
    sendMail.mockRejectedValue(err);

    const res = await request(buildApp()).post('/test-email').send({ to: 'test@example.com' });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/app password/i);
    expect(res.body.message).not.toMatch(/blocked at the network level/i);
  });

  test('missing "to" is rejected before touching nodemailer at all', async () => {
    const res = await request(buildApp()).post('/test-email').send({});
    expect(res.status).toBe(400);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  test('incomplete email settings are rejected before touching nodemailer at all', async () => {
    settingsService.getSettings.mockReturnValue(baseEmailSettings({ pass: '' }));
    const res = await request(buildApp()).post('/test-email').send({ to: 'test@example.com' });
    expect(res.status).toBe(400);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});

describe('POST /test-smtp-connectivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsService.getSettings.mockReturnValue(baseEmailSettings());
  });

  test('probes 587, 465, and a control port, and returns a "blocked" verdict when SMTP ports fail but control succeeds', async () => {
    probeTcpPort.mockImplementation((host, port) => {
      if (port === 443) return Promise.resolve({ host, port, ok: true, detail: 'TCP connected', ms: 40 });
      return Promise.resolve({ host, port, ok: false, detail: 'No response after 8000ms', ms: 8000 });
    });

    const res = await request(buildApp()).post('/test-smtp-connectivity').send({});

    expect(res.status).toBe(200);
    expect(probeTcpPort).toHaveBeenCalledWith('smtp.gmail.com', 587);
    expect(probeTcpPort).toHaveBeenCalledWith('smtp.gmail.com', 465);
    expect(probeTcpPort).toHaveBeenCalledWith('www.google.com', 443);
    expect(res.body.data.verdict).toMatch(/blocked/i);
    expect(res.body.data.verdict).toMatch(/not a credentials or code problem/i);
  });

  test('returns a "reachable" verdict when SMTP ports actually connect', async () => {
    probeTcpPort.mockResolvedValue({ ok: true, detail: 'TCP connected', ms: 50 });

    const res = await request(buildApp()).post('/test-smtp-connectivity').send({});

    expect(res.body.data.verdict).toMatch(/reachable at the network level/i);
  });

  test('returns a "general network problem" verdict when even the control port fails', async () => {
    probeTcpPort.mockResolvedValue({ ok: false, detail: 'ECONNREFUSED', ms: 5 });

    const res = await request(buildApp()).post('/test-smtp-connectivity').send({});

    expect(res.body.data.verdict).toMatch(/general outbound network problem/i);
  });
});
