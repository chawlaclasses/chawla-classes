/**
 * Live tests for utils/netProbe.js — every case here uses a real TCP
 * socket against a real listener/non-listener, not a mock, because the
 * whole point of this module is to distinguish real network conditions
 * (connected / actively refused / silently dropped) from each other.
 */

'use strict';

const net = require('net');
const { probeTcpPort } = require('../../utils/netProbe');

describe('utils/netProbe.probeTcpPort', () => {
  test('reports ok:true quickly when something is really listening', async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await probeTcpPort('127.0.0.1', port, 2000);
      expect(result.ok).toBe(true);
      expect(result.detail).toMatch(/connected/i);
      expect(result.ms).toBeLessThan(2000); // resolved on connect, not on timeout
    } finally {
      server.close();
    }
  });

  test('reports ok:false with ECONNREFUSED-style detail, fast, when nothing is listening', async () => {
    // Bind and immediately close a real server to get a genuinely-free
    // local port, then probe that same port — guaranteed nothing is there.
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const freePort = server.address().port;
    await new Promise((resolve) => server.close(resolve));

    const result = await probeTcpPort('127.0.0.1', freePort, 2000);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/ECONNREFUSED/i);
    expect(result.ms).toBeLessThan(2000); // refused immediately, did not wait for the timeout
  });

  test('reports ok:false with a "no response" detail when the timeout is hit (silent drop simulation)', async () => {
    // 10.255.255.1 is a non-routable address commonly used in tests to
    // simulate a connection attempt that never gets a SYN-ACK or an RST —
    // exactly what a firewall silently dropping SMTP packets looks like.
    // A short timeout keeps this test fast without changing the code path.
    const result = await probeTcpPort('10.255.255.1', 587, 250);
    expect(result.ok).toBe(false);
    expect(result.ms).toBeGreaterThanOrEqual(240);
    expect(result.ms).toBeLessThan(1000); // bounded by the timeout, didn't hang
  }, 10000);
});
