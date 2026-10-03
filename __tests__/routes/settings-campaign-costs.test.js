/**
 * Admin Settings -> "Campaign Costs" (cost per SMS / WhatsApp / Email, used by
 * the Marketing campaign cost estimate). Pins validation on PUT / and that the
 * settings service ships a sensible default and merges partial updates.
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
// Not exercised here — mocked so loading routes/settings.js stays light
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../services/r2Service', () => ({}));
jest.mock('../../services/mongoBackup', () => ({}));
jest.mock('../../utils/helpers', () => ({ validateBufferContent: jest.fn() }));
jest.mock('../../services/jsonDb', () => ({}));
jest.mock('../../services/settings', () => ({
  getSettings: jest.fn(),
  updateSettings: jest.fn((patch) => ({ ...patch })),
}));

const settingsService = require('../../services/settings');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userData = { role: 'super_admin' }; next(); });
  app.use(require('../../routes/settings'));
  return app;
}

describe('PUT / with campaignCosts', () => {
  beforeEach(() => jest.clearAllMocks());

  test('saves valid costs as real numbers (strings from the form are converted)', async () => {
    const res = await request(buildApp()).put('/').send({ campaignCosts: { sms: '0.25', whatsapp: 0.8, email: '0' } });
    expect(res.status).toBe(200);
    expect(settingsService.updateSettings).toHaveBeenCalledWith({ campaignCosts: { sms: 0.25, whatsapp: 0.8, email: 0 } });
  });

  test('a partial update only touches the keys sent', async () => {
    await request(buildApp()).put('/').send({ campaignCosts: { sms: 0.3 } });
    expect(settingsService.updateSettings).toHaveBeenCalledWith({ campaignCosts: { sms: 0.3 } });
  });

  test.each([
    ['negative', { sms: -1 }],
    ['not a number', { sms: 'abc' }],
    ['blank', { sms: '' }],
    ['absurdly large (likely a typo)', { sms: 20000 }],
    ['not an object', 'free'],
  ])('rejects %s with 400 and saves nothing', async (_n, costs) => {
    const res = await request(buildApp()).put('/').send({ campaignCosts: costs });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  test('unknown cost keys are ignored, not stored', async () => {
    await request(buildApp()).put('/').send({ campaignCosts: { sms: 0.2, pigeon: 5 } });
    expect(settingsService.updateSettings).toHaveBeenCalledWith({ campaignCosts: { sms: 0.2 } });
  });
});

describe('services/settings defaults + merge (real implementation)', () => {
  test('default SMS cost is ₹0.20 and partial saves keep the other channels', () => {
    jest.resetModules();
    jest.unmock('../../services/settings');
    const store = {};
    jest.doMock('../../services/jsonDb', () => ({
      findById: (c, id) => store[`${c}:${id}`] || null,
      insert: (c, d) => { store[`${c}:${d._id}`] = d; return d; },
      updateById: (c, id, d) => { store[`${c}:${id}`] = { _id: id, ...d }; return store[`${c}:${id}`]; },
    }));
    const real = require('../../services/settings');

    expect(real.getSettings().campaignCosts).toEqual({ sms: 0.2, whatsapp: 0, email: 0 });
    real.updateSettings({ campaignCosts: { sms: 0.35 } });
    expect(real.getSettings().campaignCosts).toEqual({ sms: 0.35, whatsapp: 0, email: 0 });
  });
});
