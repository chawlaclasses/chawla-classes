/**
 * utils/brevoMailer.js
 *
 * Sends email via Brevo's transactional HTTP API
 * (POST https://api.brevo.com/v3/smtp/email) instead of SMTP.
 *
 * Why this exists: Brevo's *SMTP relay* (smtp-relay.brevo.com:587) still
 * goes over the same outbound SMTP port that Render's free tier blocks —
 * switching mail providers doesn't help if you're still speaking SMTP.
 * This uses Brevo's HTTPS API (port 443) instead, which is unaffected by
 * that block.
 *
 * Uses Node's built-in `https` module rather than adding axios/node-fetch —
 * this app's package.json only requires Node >=16, and global fetch isn't
 * guaranteed before Node 18, so a zero-dependency implementation is safest.
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * @param {{ to: string, subject: string, html?: string, text?: string, fromName: string, fromEmail: string, apiKey: string, apiUrl?: string }} opts
 *   apiUrl defaults to Brevo's real endpoint; overridable so tests can point
 *   this at a real local HTTP server instead of mocking the network call.
 * @returns {Promise<{ messageId: string }>}
 */
function sendViaBrevoApi({ to, subject, html, text, fromName, fromEmail, apiKey, apiUrl = DEFAULT_API_URL }) {
    return new Promise((resolve, reject) => {
        if (!apiKey) return reject(Object.assign(new Error('BREVO_API_KEY is not set'), { code: 'NO_API_KEY' }));
        if (!fromEmail) return reject(Object.assign(new Error('No sender (from) email configured'), { code: 'NO_FROM' }));

        const payload = JSON.stringify({
            sender: { name: fromName || 'Chawla Classes', email: fromEmail },
            to: [{ email: to }],
            subject,
            ...(html ? { htmlContent: html } : { textContent: text || '' })
        });

        const target = new URL(apiUrl);
        const client = target.protocol === 'http:' ? http : https;

        const req = client.request(
            {
                hostname: target.hostname,
                port: target.port || undefined,
                path: target.pathname + target.search,
                method: 'POST',
                headers: {
                    'api-key': apiKey,
                    'content-type': 'application/json',
                    accept: 'application/json',
                    'content-length': Buffer.byteLength(payload)
                },
                timeout: 10000
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => {
                    let parsed = {};
                    try { parsed = body ? JSON.parse(body) : {}; } catch (_) { /* non-JSON error body, fall through */ }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ messageId: parsed.messageId });
                    } else {
                        const err = new Error(parsed.message || `Brevo API responded with HTTP ${res.statusCode}`);
                        err.code = parsed.code || `HTTP_${res.statusCode}`;
                        reject(err);
                    }
                });
            }
        );

        req.on('timeout', () => req.destroy(new Error('Brevo API request timed out')));
        req.on('error', (err) => reject(err));

        req.write(payload);
        req.end();
    });
}

module.exports = { sendViaBrevoApi, DEFAULT_API_URL };
