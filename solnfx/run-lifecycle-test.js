'use strict';

const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createSolnFxWebhookServer } = require('./webhook-server');

const GPI_SECRET = 'synthetic-only-gpi-secret-for-local-lifecycle-test';
const PMI_SECRET = 'synthetic-only-pmi-secret-for-local-lifecycle-test';

function signBody(secret, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(body)
    .digest('hex');

  return {
    timestamp,
    signature,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-SOLN-Timestamp': timestamp,
      'X-SOLN-Signature': signature
    }
  };
}

function postEvent(port, route, secret, event) {
  const body = JSON.stringify(event);
  const { headers } = signBody(secret, body);

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
      response.on('end', () => {
        let responseBody;
        try {
          responseBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (error) {
          reject(error);
          return;
        }
        resolve({ statusCode: response.statusCode, body: responseBody });
      });
    });

    request.on('error', reject);
    request.end(body);
  });
}

function buildLifecycleEvents(paymentRef, uetr, endToEndId) {
  const observedAt = (offsetSeconds) => new Date(Date.now() + offsetSeconds * 1000).toISOString();
  const gpiStatuses = [
    { messageType: 'pacs.008.001.08', stage: 'SUBMITTED', code: 'INIT' },
    { messageType: 'pacs.002.001.12', stage: 'SUBMITTED', code: 'RCVD' },
    { messageType: 'pacs.002.001.12', stage: 'IN_PROGRESS', code: 'ACTC' },
    { messageType: 'pacs.002.001.12', stage: 'IN_PROGRESS', code: 'ACCP' },
    { messageType: 'pacs.002.001.12', stage: 'IN_PROGRESS', code: 'ACSP' },
    { messageType: 'pacs.002.001.12', stage: 'SETTLED', code: 'ACSC' }
  ];

  const gpiEvents = gpiStatuses.map((status, index) => ({
    source: 'SWIFT_GPI',
    providerEventId: `synthetic-gpi-${index + 1}-${randomUUID()}`,
    paymentRef,
    uetr,
    endToEndId,
    stage: status.stage,
    providerStatus: status.code,
    isoMessageType: status.messageType,
    isoStatusCode: status.code,
    evidenceRef: `synthetic-gpi-evidence-${index + 1}`,
    observedAt: observedAt(index)
  }));

  const pmiEvent = {
    source: 'SOLN_PMI',
    providerEventId: `synthetic-pmi-${randomUUID()}`,
    paymentRef,
    uetr,
    endToEndId,
    stage: 'SETTLED',
    providerStatus: 'LOCAL_CREDIT_BOOKED',
    isoMessageType: 'camt.054.001.08',
    isoStatusCode: 'CRDT',
    evidenceRef: 'synthetic-pmi-credit-notification',
    observedAt: observedAt(6)
  };

  return [...gpiEvents, pmiEvent];
}

async function runLifecycleTest() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'solnfx-lifecycle-'));
  const eventLogPath = path.join(temporaryDirectory, 'events.jsonl');
  const paymentRef = `SYNTHETIC-COMMERCE-${randomUUID()}`;
  const uetr = randomUUID();
  const endToEndId = `SOLNFX-E2E-${randomUUID()}`;
  let server;

  try {
    const created = await createSolnFxWebhookServer({
      eventLogPath,
      gpiSecret: GPI_SECRET,
      pmiSecret: PMI_SECRET
    });
    server = created.server;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const port = server.address().port;
    const events = buildLifecycleEvents(paymentRef, uetr, endToEndId);

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const isPmi = event.source === 'SOLN_PMI';
      const route = isPmi ? '/v1/evts/pmi' : '/v1/events/gpi';
      const secret = isPmi ? PMI_SECRET : GPI_SECRET;
      const response = await postEvent(port, route, secret, event);

      assert.equal(response.statusCode, 202, `checkpoint ${index + 1} was rejected`);
      assert.equal(response.body.accepted, true);
      if (index < events.length - 1) {
        assert.notEqual(response.body.status, 'SETTLED', 'SOLNFX settled before the complete lifecycle');
      }
      console.log(`${index + 1}/7 ${event.isoMessageType} ${event.isoStatusCode} -> ${response.body.status}`);
    }

    const combined = created.pipeline.get(paymentRef);
    assert.equal(combined.status, 'SETTLED');
    assert.equal(combined.gpi.latestStage, 'SETTLED');
    assert.equal(combined.pmi.latestStage, 'SETTLED');
    assert.equal(combined.gpi.uetr, uetr);
    assert.equal(combined.gpi.events.length, 6);
    assert.equal(combined.pmi.events.length, 1);
    assert.ok(combined.gpi.events.every((event) => event.endToEndId === endToEndId));
    assert.ok(combined.pmi.events.every((event) => event.endToEndId === endToEndId));

    console.log('PASS: synthetic GPI + PMI lifecycle reached combined SOLNFX SETTLED.');
    console.log('NOTE: This validates local code and synthetic events only; it is not a bank/SWIFT settlement confirmation.');
    return combined;
  } finally {
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runLifecycleTest().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildLifecycleEvents, runLifecycleTest };