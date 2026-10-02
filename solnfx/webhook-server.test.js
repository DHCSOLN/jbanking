'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createSolnFxWebhookServer, verifySignature } = require('./webhook-server');

const GPI_SECRET = 'synthetic-gpi-webhook-secret-at-least-32-bytes';
const PMI_SECRET = 'synthetic-pmi-webhook-secret-at-least-32-bytes';

async function startServer(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solnfx-webhook-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = await createSolnFxWebhookServer({
    eventLogPath: path.join(directory, 'events.jsonl'),
    gpiSecret: GPI_SECRET,
    pmiSecret: PMI_SECRET,
    ...options
  });
  await new Promise((resolve) => result.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => result.server.close(resolve)));
  return {
    ...result,
    port: result.server.address().port
  };
}

function signedHeaders(body, secret, options = {}) {
  const timestamp = options.timestamp || String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(body)
    .digest('hex');
  return {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-SOLN-Timestamp': timestamp,
    'X-SOLN-Signature': options.signature || signature
  };
}

function post(port, route, body, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method: 'POST',
      headers
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function event(source, providerEventId) {
  return {
    source,
    providerEventId,
    paymentRef: 'synthetic-webhook-commerce-1',
    stage: 'HANDSHAKE_CONFIRMED',
    providerStatus: `${source}_HANDSHAKE`,
    evidenceRef: `synthetic-${providerEventId}`,
    observedAt: new Date().toISOString()
  };
}

test('accepts signed GPI and PMI events and returns combined status', async (t) => {
  const { port, pipeline } = await startServer(t);
  const gpiBody = JSON.stringify(event('SWIFT_GPI', 'gpi-webhook-1'));
  const gpi = await post(port, '/v1/events/gpi', gpiBody, signedHeaders(gpiBody, GPI_SECRET));
  assert.equal(gpi.statusCode, 202);
  assert.equal(gpi.body.status, 'PARTIAL');

  const pmiBody = JSON.stringify(event('SOLN_PMI', 'pmi-webhook-1'));
  const pmi = await post(port, '/v1/events/pmi', pmiBody, signedHeaders(pmiBody, PMI_SECRET));
  assert.equal(pmi.statusCode, 202);
  assert.equal(pmi.body.status, 'HANDSHAKE_CONFIRMED');
  assert.equal(pipeline.get('synthetic-webhook-commerce-1').status, 'HANDSHAKE_CONFIRMED');
});

test('rejects invalid signatures without recording the event', async (t) => {
  const { port, pipeline } = await startServer(t);
  const body = JSON.stringify(event('SWIFT_GPI', 'gpi-bad-signature'));
  const response = await post(port, '/v1/events/gpi', body, signedHeaders(body, GPI_SECRET, {
    signature: '0'.repeat(64)
  }));

  assert.equal(response.statusCode, 401);
  assert.equal(pipeline.get('synthetic-webhook-commerce-1'), null);
});

test('rejects stale signatures and route/source mismatches', async (t) => {
  const { port, pipeline } = await startServer(t);
  const staleBody = JSON.stringify(event('SWIFT_GPI', 'gpi-stale'));
  const stale = await post(port, '/v1/events/gpi', staleBody, signedHeaders(staleBody, GPI_SECRET, {
    timestamp: '1'
  }));
  assert.equal(stale.statusCode, 401);

  const mismatchBody = JSON.stringify(event('SWIFT_GPI', 'gpi-wrong-route'));
  const mismatch = await post(port, '/v1/events/pmi', mismatchBody, signedHeaders(mismatchBody, PMI_SECRET));
  assert.equal(mismatch.statusCode, 400);
  assert.equal(pipeline.get('synthetic-webhook-commerce-1'), null);
});

test('rejects oversized requests and weak secrets', async (t) => {
  await assert.rejects(
    createSolnFxWebhookServer({
      eventLogPath: '/tmp/solnfx-unused-test.jsonl',
      gpiSecret: 'short',
      pmiSecret: PMI_SECRET
    }),
    /at least 32 bytes/
  );

  const { port } = await startServer(t, { maxBodyBytes: 32 });
  const body = JSON.stringify(event('SWIFT_GPI', 'gpi-too-large'));
  const response = await post(port, '/v1/events/gpi', body, signedHeaders(body, GPI_SECRET));
  assert.equal(response.statusCode, 413);
});

test('verifies timestamp-bound signatures with constant-time comparison', () => {
  const timestamp = '1790935200';
  const body = Buffer.from('{"test":true}');
  const signature = createHmac('sha256', GPI_SECRET)
    .update(timestamp)
    .update('.')
    .update(body)
    .digest('hex');

  assert.equal(verifySignature(GPI_SECRET, timestamp, body, signature, {
    nowMs: Number(timestamp) * 1000
  }), true);
  assert.equal(verifySignature(GPI_SECRET, timestamp, body, signature, {
    nowMs: (Number(timestamp) + 600) * 1000
  }), false);
});