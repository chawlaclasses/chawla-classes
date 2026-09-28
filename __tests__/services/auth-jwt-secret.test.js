/**
 * Tests for services/auth.js's JWT_SECRET loading behavior.
 *
 * JWT_SECRET is resolved once, at module require time, and the
 * production-missing-secret path calls process.exit(1) — neither of
 * those is safe to trigger inside the Jest worker process itself
 * (module caching would make "missing" un-testable across cases, and
 * process.exit(1) would kill the whole worker). Each case is run in a
 * real, separate `node -e` child process instead, which is also a more
 * faithful reproduction of an actual production boot.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function runInChildProcess(env) {
  return spawnSync(
    process.execPath,
    ['-e', "require('./services/auth'); console.log('LOADED_OK');"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 10000,
    }
  );
}

describe('services/auth.js JWT_SECRET loading', () => {
  test('production + missing JWT_SECRET: fails fast with exit code 1, does not load', () => {
    const result = runInChildProcess({
      NODE_ENV: 'production',
      JWT_SECRET: '',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'a-very-long-admin-password-123',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).not.toMatch(/LOADED_OK/);
    expect(result.stderr + result.stdout).toMatch(/FATAL.*JWT_SECRET/i);
  });

  test('production + valid JWT_SECRET: loads normally', () => {
    const result = runInChildProcess({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'a-very-long-admin-password-123',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/LOADED_OK/);
  });

  test('development + missing JWT_SECRET: still loads (dev fallback unaffected)', () => {
    const result = runInChildProcess({
      NODE_ENV: 'development',
      JWT_SECRET: '',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/LOADED_OK/);
  });
});
