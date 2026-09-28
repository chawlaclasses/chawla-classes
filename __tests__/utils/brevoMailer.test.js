/**
 * Live tests for utils/brevoMailer.js — every case here does a real HTTP
 * request/response round trip against a real local server (via apiUrl
 * override), not a mocked https module, so the request shape and response
 * parsing are proven against actual bytes on the wire.
 */

'use strict';

const http = require('http');
const { sendViaBrevoApi } = require('../../utils/brevoMailer');

function startFakeBrevoServer(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => handler(req, res, body ? JSON.parse(body) : {}));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

describe('utils/brevoMailer.sendViaBrevoApi', () => {
  let server;
  afterEach(() => new Promise((resolve) => (server ? server.close(resolve) : resolve())));

  test('sends the correct request shape and resolves with messageId on 201', async () => {
    let received;
    server = await startFakeBrevoServer((req, res, parsedBody) => {
      received = { headers: req.headers, body: parsedBody };
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messageId: 'msg-real-123' }));
    });
    const apiUrl = `http://127.0.0.1:${server.address().port}/v3/smtp/email`;

    const result = await sendViaBrevoApi({
      to: 'parent@example.com',
      subject: 'Fee reminder',
      text: 'Please pay your fees.',
      fromName: 'Chawla Classes',
      fromEmail: 'no-reply@chawlaclasses.com',
      apiKey: 'fake-key-abc',
      apiUrl,
    });

    expect(result.messageId).toBe('msg-real-123');
    expect(received.headers['api-key']).toBe('fake-key-abc');
    expect(received.body.sender).toEqual({ name: 'Chawla Classes', email: 'no-reply@chawlaclasses.com' });
    expect(received.body.to).toEqual([{ email: 'parent@example.com' }]);
    expect(received.body.textContent).toBe('Please pay your fees.');
  });

  test('prefers htmlContent over textContent when html is given', async () => {
    let received;
    server = await startFakeBrevoServer((req, res, parsedBody) => {
      received = parsedBody;
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messageId: 'x' }));
    });
    const apiUrl = `http://127.0.0.1:${server.address().port}/v3/smtp/email`;

    await sendViaBrevoApi({
      to: 'a@example.com', subject: 'S', html: '<p>hi</p>', text: 'hi',
      fromName: 'X', fromEmail: 'x@y.com', apiKey: 'k', apiUrl,
    });

    expect(received.htmlContent).toBe('<p>hi</p>');
    expect(received.textContent).toBeUndefined();
  });

  test('rejects with a real error when the server returns a 401 (bad API key)', async () => {
    server = await startFakeBrevoServer((req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }));
    });
    const apiUrl = `http://127.0.0.1:${server.address().port}/v3/smtp/email`;

    await expect(
      sendViaBrevoApi({ to: 'a@b.com', subject: 'S', text: 'T', fromName: 'X', fromEmail: 'x@y.com', apiKey: 'bad', apiUrl })
    ).rejects.toMatchObject({ code: 'unauthorized', message: 'Key not found' });
  });

  test('rejects with a sender-specific message when the server reports an unverified sender', async () => {
    server = await startFakeBrevoServer((req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'invalid_parameter', message: 'Sender not valid' }));
    });
    const apiUrl = `http://127.0.0.1:${server.address().port}/v3/smtp/email`;

    await expect(
      sendViaBrevoApi({ to: 'a@b.com', subject: 'S', text: 'T', fromName: 'X', fromEmail: 'unverified@y.com', apiKey: 'k', apiUrl })
    ).rejects.toMatchObject({ message: 'Sender not valid' });
  });

  test('rejects immediately, without any HTTP call, when apiKey is missing', async () => {
    await expect(
      sendViaBrevoApi({ to: 'a@b.com', subject: 'S', text: 'T', fromName: 'X', fromEmail: 'x@y.com', apiKey: '' })
    ).rejects.toMatchObject({ code: 'NO_API_KEY' });
  });

  test('rejects immediately when fromEmail is missing', async () => {
    await expect(
      sendViaBrevoApi({ to: 'a@b.com', subject: 'S', text: 'T', fromName: 'X', fromEmail: '', apiKey: 'k' })
    ).rejects.toMatchObject({ code: 'NO_FROM' });
  });
});
