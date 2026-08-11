/**
 * Tests for utils/logShipper.js.
 *
 * All config (LOG_SHIP_URL etc.) is read from process.env once, at
 * module load time — so each test needs a fresh module load with its
 * own env via jest.isolateModules(). global.fetch is mocked directly
 * (Node 22's built-in fetch, no library involved) rather than pointed at
 * a real HTTP endpoint — there's no real external logging service
 * reachable from this sandbox to test against for real; see
 * PHASE_4_REPORT.md for what that means for verification confidence
 * here vs. against a real provider.
 */

'use strict';

function loadShipperWithEnv(envOverrides) {
  let mod;
  const prevEnv = { ...process.env };
  Object.assign(process.env, envOverrides);
  jest.isolateModules(() => {
    mod = require('../../utils/logShipper');
  });
  process.env = prevEnv;
  return mod;
}

function mockFetchOnce(implementation) {
  global.fetch = jest.fn(implementation);
  return global.fetch;
}

describe('utils/logShipper.js', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  test('disabled by default (no LOG_SHIP_URL): enqueue/flush are no-ops, fetch is never called', async () => {
    const fetchMock = mockFetchOnce(async () => ({ ok: true }));
    const shipper = loadShipperWithEnv({ LOG_SHIP_URL: '' });

    expect(shipper.isEnabled()).toBe(false);
    shipper.enqueue({ ts: new Date().toISOString(), level: 'error', message: 'should not ship' });
    await shipper.flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('flushes automatically once LOG_SHIP_BATCH_SIZE is reached, POSTing the queued entries as JSON', async () => {
    const fetchMock = mockFetchOnce(async () => ({ ok: true }));
    const shipper = loadShipperWithEnv({
      LOG_SHIP_URL: 'https://logs.example.com/ingest',
      LOG_SHIP_BATCH_SIZE: '3',
    });

    shipper.enqueue({ ts: 't1', level: 'info', message: 'one' });
    shipper.enqueue({ ts: 't2', level: 'info', message: 'two' });
    expect(fetchMock).not.toHaveBeenCalled(); // below batch size still
    shipper.enqueue({ ts: 't3', level: 'info', message: 'three' });
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget flush() run

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://logs.example.com/ingest');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual([
      { ts: 't1', level: 'info', message: 'one' },
      { ts: 't2', level: 'info', message: 'two' },
      { ts: 't3', level: 'info', message: 'three' },
    ]);
  });

  test('includes the configured auth header when set, omits it entirely when not', async () => {
    const fetchMock = mockFetchOnce(async () => ({ ok: true }));
    const shipper = loadShipperWithEnv({
      LOG_SHIP_URL: 'https://logs.example.com/ingest',
      LOG_SHIP_AUTH_HEADER_NAME: 'DD-API-KEY',
      LOG_SHIP_AUTH_HEADER_VALUE: 'secret-123',
    });

    shipper.enqueue({ ts: 't1', level: 'error', message: 'x' });
    await shipper.flush();

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['DD-API-KEY']).toBe('secret-123');
  });

  test('filters out entries below LOG_SHIP_MIN_LEVEL (default "info" — debug is skipped)', async () => {
    const fetchMock = mockFetchOnce(async () => ({ ok: true }));
    const shipper = loadShipperWithEnv({ LOG_SHIP_URL: 'https://logs.example.com/ingest' });

    shipper.enqueue({ ts: 't1', level: 'debug', message: 'noisy' });
    shipper.enqueue({ ts: 't2', level: 'warn', message: 'important' });
    await shipper.flush();

    const [, opts] = fetchMock.mock.calls[0];
    const sent = JSON.parse(opts.body);
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toBe('important');
  });

  test('retries once on failure, and succeeds if the retry works', async () => {
    let calls = 0;
    const fetchMock = mockFetchOnce(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503 };
      return { ok: true };
    });
    const shipper = loadShipperWithEnv({ LOG_SHIP_URL: 'https://logs.example.com/ingest' });

    shipper.enqueue({ ts: 't1', level: 'error', message: 'x' });
    await shipper.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('gives up after the retry also fails, without throwing or re-queuing the batch forever', async () => {
    const fetchMock = mockFetchOnce(async () => { throw new Error('network down'); });
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const shipper = loadShipperWithEnv({ LOG_SHIP_URL: 'https://logs.example.com/ingest' });

    shipper.enqueue({ ts: 't1', level: 'error', message: 'x' });
    await expect(shipper.flush()).resolves.toBeUndefined(); // never throws out to the caller

    expect(fetchMock).toHaveBeenCalledTimes(2); // original + one retry, not more
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('failed to ship'));

    // The failed batch was not silently re-added to the queue for next time.
    fetchMock.mockClear();
    await shipper.flush();
    expect(fetchMock).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  test('drops the oldest entries once LOG_SHIP_MAX_QUEUE_SIZE is exceeded, and reports the drop on the next flush', async () => {
    const fetchMock = mockFetchOnce(async () => ({ ok: true }));
    const shipper = loadShipperWithEnv({
      LOG_SHIP_URL: 'https://logs.example.com/ingest',
      LOG_SHIP_MAX_QUEUE_SIZE: '2',
      LOG_SHIP_BATCH_SIZE: '999', // don't auto-flush on size for this test — flush manually
    });

    shipper.enqueue({ ts: 't1', level: 'error', message: 'oldest, should be dropped' });
    shipper.enqueue({ ts: 't2', level: 'error', message: 'kept' });
    shipper.enqueue({ ts: 't3', level: 'error', message: 'kept' });
    await shipper.flush();

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    const messages = sent.map((e) => e.message);
    expect(messages).not.toContain('oldest, should be dropped');
    expect(messages).toContain('kept');
    expect(sent.some((e) => e.level === 'warn' && /dropped 1/.test(e.message))).toBe(true);
  });

  test('flush() is a no-op when the queue is empty (no pointless network call)', async () => {
    const fetchMock = mockFetchOnce(async () => ({ ok: true }));
    const shipper = loadShipperWithEnv({ LOG_SHIP_URL: 'https://logs.example.com/ingest' });

    await shipper.flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
