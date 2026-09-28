/**
 * Unit tests for routes/health.js (GET /health)
 *
 * services/jsonDb is mocked so this tests the route's own response
 * shaping (status code, payload fields) against known db.getStatus()
 * outputs, not a real MongoDB connection.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/jsonDb');

const db = require('../../services/jsonDb');
const healthRouter = require('../../routes/health');

function buildApp() {
  const app = express();
  app.use(healthRouter);
  return app;
}

describe('GET /health', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns 200 and status "ok" when Mongo is connected', async () => {
    db.getStatus.mockReturnValue({ connected: true, pendingWrites: 0 });

    const res = await request(buildApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.mongo).toEqual({ connected: true });
    expect(res.body.queue).toEqual({ pendingWrites: 0 });
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  test('returns 503 and status "degraded" when Mongo is disconnected', async () => {
    db.getStatus.mockReturnValue({ connected: false, pendingWrites: 3 });

    const res = await request(buildApp()).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.mongo).toEqual({ connected: false });
    expect(res.body.queue).toEqual({ pendingWrites: 3 });
  });

  test('reports the package.json version', async () => {
    db.getStatus.mockReturnValue({ connected: true, pendingWrites: 0 });
    const pkg = require('../../package.json');

    const res = await request(buildApp()).get('/health');

    expect(res.body.version).toBe(pkg.version);
  });
});
