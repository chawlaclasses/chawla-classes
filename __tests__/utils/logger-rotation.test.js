/**
 * Tests for utils/logger.js's rotation fix.
 *
 * The old rotation check ran once at module load and never again, so a
 * long-running process's app.log grew unbounded after that first check.
 * This drives the real logger against the real filesystem (logs/ under
 * the project root, same as production) with LOG_MAX_BYTES/LOG_MAX_BACKUPS
 * set low via env vars so rotation triggers in milliseconds instead of at
 * 10MB, then asserts a .bak file actually appears and old backups beyond
 * the cap get pruned.
 *
 * Run in a child process per test (via a small script) because the
 * module-load-time LOGS_DIR/LOG_FILE and the LOG_MAX_BYTES/LOG_MAX_BACKUPS
 * constants are all read once at require time — a fresh process per case
 * is the simplest way to get a clean slate without fighting Jest's module
 * cache, and it's also a more faithful reproduction of real usage (the
 * logger is only ever required once per real process too).
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'app.log');

function listBackups() {
  if (!fs.existsSync(LOGS_DIR)) return [];
  return fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith('app.log.') && f.endsWith('.bak'));
}

function cleanupBackups() {
  for (const f of listBackups()) {
    fs.unlinkSync(path.join(LOGS_DIR, f));
  }
}

describe('utils/logger.js rotation', () => {
  beforeEach(() => {
    cleanupBackups();
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  });

  afterAll(() => {
    cleanupBackups();
  });

  test('rotates the log file once the size threshold is crossed, and resets it', () => {
    const script = `
      const logger = require('./utils/logger');
      for (let i = 0; i < 50; i++) {
        logger.info('x'.repeat(500));
      }
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, LOG_MAX_BYTES: '5000', LOG_MAX_BACKUPS: '5' },
      encoding: 'utf8',
      timeout: 10000,
    });

    expect(result.status).toBe(0);
    expect(listBackups().length).toBeGreaterThanOrEqual(1);
    // The live log file should have been reset well below the threshold,
    // not left to grow past it.
    const liveSize = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
    expect(liveSize).toBeLessThan(5000);
  });

  test('prunes backups beyond LOG_MAX_BACKUPS', () => {
    const script = `
      const logger = require('./utils/logger');
      for (let i = 0; i < 200; i++) {
        logger.info('y'.repeat(500));
      }
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, LOG_MAX_BYTES: '2000', LOG_MAX_BACKUPS: '3' },
      encoding: 'utf8',
      timeout: 10000,
    });

    expect(result.status).toBe(0);
    expect(listBackups().length).toBeLessThanOrEqual(3);
    expect(listBackups().length).toBeGreaterThan(0);
  });
});
