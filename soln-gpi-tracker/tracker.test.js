'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SolnGpiTracker } = require('./tracker');

const UETR = '550e8400-e29b-41d4-a716-446655440000';

function providerEvent(overrides = {}) {
  return {
    source: 'SWIFT_GPI',
    providerEventId: 'event-001',
    paymentRef: 'internal-ref-001',
    stage: 'HANDSHAKE_CONFIRMED',
    providerStatus: 'HANDSHAKE_ACK',
    evidenceRef: 'provider-event-001',
    observedAt: '2026-10-02T10:00:00.000Z',
    ...overrides
  };
}

function createTracker(verifyProviderEvent = async () => true) {
  return new SolnGpiTracker({ verifyProviderEvent });
}

test('requires a provider event verifier', () => {
  assert.throws(() => new SolnGpiTracker({}), /verifier is required/);
});

test('records a verified handshake without treating it as settlement', async () => {
  const tracker = createTracker();
  const payment = await tracker.recordProviderEvent(providerEvent());

  assert.equal(payment.latestStage, 'HANDSHAKE_CONFIRMED');
  assert.equal(payment.uetr, null);
});

test('rejects events that fail provider verification', async () => {
  const tracker = createTracker(async () => false);

  await assert.rejects(
    tracker.recordProviderEvent(providerEvent()),
    /could not be verified/
  );
  assert.equal(tracker.list().length, 0);
});

test('records settlement only from a verified event with a valid UETR', async () => {
  const tracker = createTracker();
  const event = providerEvent({
    providerEventId: 'event-002',
    uetr: UETR,
    stage: 'SETTLED',
    providerStatus: 'FINAL_CREDIT_CONFIRMED'
  });
  const payment = await tracker.recordProviderEvent(event);

  assert.equal(payment.latestStage, 'SETTLED');
  assert.equal(payment.uetr, UETR);
});

test('rejects settlement events without a valid UETR', async () => {
  const tracker = createTracker();

  await assert.rejects(
    tracker.recordProviderEvent(providerEvent({ stage: 'SETTLED' })),
    /UETR is required/
  );
});

test('deduplicates provider event IDs and rejects conflicting reuse', async () => {
  const tracker = createTracker();
  const event = providerEvent();
  const first = await tracker.recordProviderEvent(event);
  const duplicate = await tracker.recordProviderEvent(event);

  assert.equal(duplicate.events.length, 1);
  assert.equal(duplicate.latestStage, first.latestStage);
  await assert.rejects(
    tracker.recordProviderEvent({ ...event, stage: 'IN_PROGRESS' }),
    /reused with different content/
  );
});

test('rejects non-provider status claims', async () => {
  const tracker = createTracker();

  await assert.rejects(
    tracker.recordProviderEvent(providerEvent({ source: 'EMAIL' })),
    /Only events from the configured SWIFT gpi adapter/
  );
});