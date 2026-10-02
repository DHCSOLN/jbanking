'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { SolnFxEventLog } = require('./event-log');

const UETR = '550e8400-e29b-41d4-a716-446655440000';

function makeLog(t, verifier = async () => true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solnfx-event-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new SolnFxEventLog({
    filePath: path.join(directory, 'events.jsonl'),
    verifyProviderEvent: verifier
  });
}

function event(overrides = {}) {
  return {
    source: 'SWIFT_GPI',
    providerEventId: 'event-1',
    paymentRef: 'synthetic-commerce-1',
    stage: 'HANDSHAKE_CONFIRMED',
    providerStatus: 'HANDSHAKE_ACK',
    evidenceRef: 'synthetic-evidence-1',
    observedAt: '2026-10-02T10:00:00.000Z',
    ...overrides
  };
}

test('appends verified events and reads them back in sequence', async (t) => {
  const log = makeLog(t);
  const first = await log.appendVerifiedEvent(event());
  const second = await log.appendVerifiedEvent(event({
    source: 'SOLN_PMI',
    providerEventId: 'event-2',
    stage: 'IN_PROGRESS'
  }));

  assert.equal(first.appended, true);
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.deepEqual(log.readVerifiedEvents().map((item) => item.providerEventId), ['event-1', 'event-2']);
});

test('serializes concurrent appends into one valid hash chain', async (t) => {
  const log = makeLog(t);
  const results = await Promise.all([
    log.appendVerifiedEvent(event({ providerEventId: 'concurrent-1' })),
    log.appendVerifiedEvent(event({ providerEventId: 'concurrent-2' }))
  ]);

  assert.deepEqual(results.map((result) => result.sequence), [1, 2]);
  assert.equal(log.readVerifiedEvents().length, 2);
});

test('rejects events unless the provider verifier approves them', async (t) => {
  const log = makeLog(t, async () => false);

  await assert.rejects(log.appendVerifiedEvent(event()), /could not be verified/);
  assert.deepEqual(log.readVerifiedEvents(), []);
});

test('makes provider event IDs idempotent and rejects conflicting reuse', async (t) => {
  const log = makeLog(t);
  const first = event();

  await log.appendVerifiedEvent(first);
  const duplicate = await log.appendVerifiedEvent(first);
  assert.equal(duplicate.appended, false);
  await assert.rejects(
    log.appendVerifiedEvent(event({ stage: 'IN_PROGRESS' })),
    /reused with different content/
  );
});

test('scopes provider event IDs by source and keeps one UETR per payment', async (t) => {
  const log = makeLog(t);
  await log.appendVerifiedEvent(event({ providerEventId: 'shared-id', uetr: UETR }));
  await log.appendVerifiedEvent(event({
    source: 'SOLN_PMI',
    providerEventId: 'shared-id',
    stage: 'IN_PROGRESS'
  }));

  await assert.rejects(
    log.appendVerifiedEvent(event({
      providerEventId: 'gpi-conflict',
      uetr: '123e4567-e89b-42d3-a456-426614174000'
    })),
    /multiple UETRs/
  );
  assert.equal(log.readVerifiedEvents().length, 2);
});

test('detects changes to persisted event records', async (t) => {
  const log = makeLog(t);
  await log.appendVerifiedEvent(event());
  const contents = fs.readFileSync(log.filePath, 'utf8');
  fs.writeFileSync(log.filePath, contents.replace('HANDSHAKE_ACK', 'ALTERED_STATUS'));

  assert.throws(() => log.readVerifiedEvents(), /integrity check failed/);
});

test('requires a UETR for settled GPI events but not local PMI events', async (t) => {
  const log = makeLog(t);

  await assert.rejects(
    log.appendVerifiedEvent(event({ stage: 'SETTLED' })),
    /UETR is required/
  );
  const result = await log.appendVerifiedEvent(event({
    source: 'SOLN_PMI',
    providerEventId: 'pmi-settled-1',
    stage: 'SETTLED'
  }));

  assert.equal(result.appended, true);
  assert.equal(log.readVerifiedEvents()[0].uetr, null);
});

test('rejects malformed UETRs and invalid sources', async (t) => {
  const log = makeLog(t);

  await assert.rejects(
    log.appendVerifiedEvent(event({ uetr: 'not-a-uetr' })),
    /UETR must be a UUID version 4/
  );
  await assert.rejects(
    log.appendVerifiedEvent(event({ source: 'EMAIL' })),
    /source must be SWIFT_GPI or SOLN_PMI/
  );
});