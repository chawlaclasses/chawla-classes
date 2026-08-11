/**
 * Tests for config/index.js's PERSISTENT_ROOT_DIR support (issue #4).
 *
 * config/index.js reads process.env and computes its constants once, at
 * require time — so each case here needs a fresh module load with a
 * different env, via jest.isolateModules() (same pattern as
 * mongoBackup.test.js's loadMongoBackupWithFreshEnv).
 *
 * NOTE on the failure-path test: this environment runs as root, which
 * bypasses ordinary Unix permission checks — a real "permission denied"
 * scenario (e.g. a Render disk mounted read-only, or a misconfigured
 * IAM/user context) could not be reproduced here for that reason. What IS
 * tested is a real, root-immune mkdir failure (a plain file blocking the
 * path, which is invalid regardless of permissions) to prove the
 * fail-fast check actually works when mkdir genuinely fails — not just
 * that the code compiles. See PHASE_3_REPORT.md.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function loadConfigWithEnv(envOverrides) {
  let mod;
  jest.isolateModules(() => {
    const prev = { ...process.env };
    Object.assign(process.env, envOverrides);
    mod = require('../../config');
    process.env = prev;
  });
  return mod;
}

describe('config/index.js — PERSISTENT_ROOT_DIR (issue #4)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('without PERSISTENT_DATA_DIR set, every upload dir stays under ROOT_DIR — unchanged from before this feature existed', () => {
    const config = loadConfigWithEnv({ PERSISTENT_DATA_DIR: '' });

    expect(config.NOTES_DIR).toBe(path.join(config.ROOT_DIR, 'notes'));
    expect(config.UPLOADS_DIR).toBe(path.join(config.ROOT_DIR, 'uploads'));
    expect(config.HOMEWORK_DIR).toBe(path.join(config.ROOT_DIR, 'homework'));
    expect(config.IMAGES_DIR).toBe(path.join(config.ROOT_DIR, 'images'));
  });

  test('with PERSISTENT_DATA_DIR set, every upload dir (and only those) moves there', () => {
    const config = loadConfigWithEnv({ PERSISTENT_DATA_DIR: tmpDir });

    expect(config.NOTES_DIR).toBe(path.join(tmpDir, 'notes'));
    expect(config.UPLOADS_DIR).toBe(path.join(tmpDir, 'uploads'));
    expect(config.HOMEWORK_DIR).toBe(path.join(tmpDir, 'homework'));
    expect(config.HOMEWORK_SUBMISSIONS_DIR).toBe(path.join(tmpDir, 'homework-submissions'));
    expect(config.DOUBTS_DIR).toBe(path.join(tmpDir, 'doubts'));
    expect(config.FACULTY_APPLICATIONS_DIR).toBe(path.join(tmpDir, 'faculty-applications'));
    expect(config.IMAGES_DIR).toBe(path.join(tmpDir, 'images'));

    // Deliberately NOT moved — see config/index.js's comment on why.
    expect(config.DATA_DIR).toBe(path.join(config.ROOT_DIR, 'Data'));
    expect(config.LOGS_DIR).toBe(path.join(config.ROOT_DIR, 'logs'));
    expect(config.PUBLIC_DIR).toBe(path.join(config.ROOT_DIR, 'public'));
  });

  test('validateConfig() creates PERSISTENT_DATA_DIR if it does not exist yet (a fresh, empty disk mount)', () => {
    const freshPath = path.join(tmpDir, 'not-created-yet');
    let config;
    const prevEnv = { ...process.env };
    Object.assign(process.env, {
      PERSISTENT_DATA_DIR: freshPath,
      MONGODB_URI: 'mongodb://example/test',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'a-very-long-admin-password-123',
    });
    try {
      jest.isolateModules(() => {
        config = require('../../config');
      });
      expect(fs.existsSync(freshPath)).toBe(false);
      config.validateConfig(); // validateConfig() reads process.env live, so env must still be set here
      expect(fs.existsSync(freshPath)).toBe(true);
    } finally {
      process.env = prevEnv;
    }
  });

  test('validateConfig() fails fast (exit 1) when PERSISTENT_DATA_DIR cannot actually be created', () => {
    // A plain file blocking the path is a real, root-immune mkdir
    // failure (ENOTDIR) — see file header for why a permissions-based
    // failure couldn't be used here instead.
    const blockingFile = path.join(tmpDir, 'blocking-file');
    fs.writeFileSync(blockingFile, 'x');
    const badPath = path.join(blockingFile, 'sub');

    let config;
    const prevEnv = { ...process.env };
    Object.assign(process.env, {
      PERSISTENT_DATA_DIR: badPath,
      MONGODB_URI: 'mongodb://example/test',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'a-very-long-admin-password-123',
    });
    const realExit = process.exit;
    const exitSpy = jest.fn();
    try {
      jest.isolateModules(() => {
        config = require('../../config');
      });
      process.exit = exitSpy;
      config.validateConfig();
    } finally {
      process.exit = realExit;
      process.env = prevEnv;
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
