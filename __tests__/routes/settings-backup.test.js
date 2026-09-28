/**
 * Tests for routes/settings.js's backup/restore endpoints — the route-
 * level response shaping, permission gating, and the maintenance-mode /
 * write-drain wrapping around restore. services/mongoBackup is mocked
 * (its own real orchestration logic is covered by mongoBackup.test.js);
 * this file is about what the HTTP layer does with what that service
 * returns.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/mongoBackup');
jest.mock('../../services/jsonDb');
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../middleware/upload', () => ({
  diskStorage: () => ({ _handleFile: (_r, _f, cb) => cb(null, {}), _removeFile: (_r, _f, cb) => cb(null) }),
}));

const mongoBackup = require('../../services/mongoBackup');
const db = require('../../services/jsonDb');

// A minimal real settings service backed by an in-memory object, so the
// maintenance-mode toggle-and-restore behavior is genuinely observable
// (not just "was updateSettings called with X").
jest.mock('../../services/settings', () => {
  let state = { maintenanceMode: false, maintenanceMessage: 'default message' };
  return {
    getSettings: jest.fn(() => ({ ...state })),
    updateSettings: jest.fn((patch) => {
      state = { ...state, ...patch };
      return { ...state };
    }),
    __resetForTest: () => {
      state = { maintenanceMode: false, maintenanceMessage: 'default message' };
    },
  };
});
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

describe('routes/settings.js backup/restore endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsService.__resetForTest();
    db.getStatus.mockReturnValue({ connected: true, pendingWrites: 0 });
  });

  test('POST /backup creates a backup and reports its name', async () => {
    mongoBackup.createBackup.mockResolvedValue({
      name: 'backup-2026-01-01T00-00-00-000Z',
      createdAt: new Date('2026-01-01'),
      collections: [{ name: 'students', docCount: 2 }],
      totalDocs: 2,
    });

    const res = await request(buildApp()).post('/backup');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('backup-2026-01-01T00-00-00-000Z');
    expect(mongoBackup.createBackup).toHaveBeenCalledWith({ kind: 'manual' });
  });

  test('GET /backups lists backups newest first, response is a superset of the old {name, createdAt} shape', async () => {
    mongoBackup.listBackups.mockResolvedValue([
      { name: 'backup-b', createdAt: new Date('2026-01-02'), kind: 'manual', collections: [{ name: 'x', docCount: 1 }], totalDocs: 1 },
    ]);

    const res = await request(buildApp()).get('/backups');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ name: 'backup-b', collections: 1, totalDocs: 1 });
  });

  test('POST /backups/:name/restore enables maintenance mode during the restore and restores it after (was off before)', async () => {
    let maintenanceModeDuringRestore;
    mongoBackup.restoreBackup.mockImplementation(async () => {
      maintenanceModeDuringRestore = settingsService.getSettings().maintenanceMode;
      return { success: true, backupName: 'b1', preRestoreBackupName: 'pre-1', results: [], attempted: 0, totalCollections: 0 };
    });

    expect(settingsService.getSettings().maintenanceMode).toBe(false);

    const res = await request(buildApp()).post('/backups/b1/restore');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(maintenanceModeDuringRestore).toBe(true);
    expect(settingsService.getSettings().maintenanceMode).toBe(false); // restored after
  });

  test('POST /backups/:name/restore leaves maintenance mode ON if it was already on beforehand', async () => {
    settingsService.updateSettings({ maintenanceMode: true, maintenanceMessage: 'already on for another reason' });
    mongoBackup.restoreBackup.mockResolvedValue({ success: true, backupName: 'b1', preRestoreBackupName: 'pre-1', results: [], attempted: 0, totalCollections: 0 });

    await request(buildApp()).post('/backups/b1/restore');

    expect(settingsService.getSettings().maintenanceMode).toBe(true);
  });

  test('POST /backups/:name/restore reports failure (not success) when the service reports a partial restore', async () => {
    mongoBackup.restoreBackup.mockResolvedValue({
      success: false,
      backupName: 'b1',
      preRestoreBackupName: 'pre-1',
      results: [{ name: 'students', success: true, docCount: 2 }, { name: 'fees', success: false, error: 'boom' }],
      attempted: 2,
      totalCollections: 3,
    });

    const res = await request(buildApp()).post('/backups/b1/restore');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.data.results).toHaveLength(2);
    expect(res.body.message).toMatch(/pre-1/); // safety-net backup name surfaced to the admin
  });

  test('POST /backups/:name/restore returns 404 for an unknown backup', async () => {
    const err = new Error('Backup not found: nope');
    err.code = 'NOT_FOUND';
    mongoBackup.restoreBackup.mockRejectedValue(err);

    const res = await request(buildApp()).post('/backups/nope/restore');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('DELETE /backups/:name returns 404 when the backup does not exist, 200 when deleted', async () => {
    mongoBackup.deleteBackup.mockResolvedValueOnce(false);
    const missing = await request(buildApp()).delete('/backups/nope');
    expect(missing.status).toBe(404);

    mongoBackup.deleteBackup.mockResolvedValueOnce(true);
    const ok = await request(buildApp()).delete('/backups/backup-1');
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
  });
});
