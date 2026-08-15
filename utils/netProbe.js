// utils/netProbe.js
//
// Raw TCP reachability probe — opens a socket to host:port with no
// protocol handshake (no SMTP, no TLS) and reports whether it connected,
// was refused, or got no response at all within the timeout.
//
// Used to diagnose "is this specific port blocked by the network" as a
// question separate from "are the SMTP credentials/config correct" — a
// firewall silently dropping packets produces a *timeout* with no error,
// which is otherwise indistinguishable from "the mail server is just slow"
// unless you test the raw connection on its own.

'use strict';

const net = require('net');

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<{host: string, port: number, ok: boolean, detail: string, ms: number}>}
 */
function probeTcpPort(host, port, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const socket = new net.Socket();
        let settled = false;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve({ host, port, ms: Date.now() - start, ...result });
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish({ ok: true, detail: 'TCP connected' }));
        socket.once('timeout', () => finish({ ok: false, detail: `No response after ${timeoutMs}ms — packets are likely being silently dropped by a firewall` }));
        socket.once('error', (err) => finish({ ok: false, detail: err.code || err.message }));

        socket.connect(port, host);
    });
}

module.exports = { probeTcpPort };
