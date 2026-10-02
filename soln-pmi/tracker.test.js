'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SolnPmiTracker } = require('./tracker');

test('accepts only verified SOLN PMI clearing events', async () => {
  const tracker = new SolnPmiTracker({ verifyProviderEvent: async () => true });
  const result = await tracker.recordProviderEvent({
    source: 'SOLN_PMI',
    providerEventId: 'pmi-event-1',
    paymentRef: 'test-payment-1',
    stage: 'HANDSHAKE_CONFIRMED',
    providerStatus: 'LOCAL_CHANNEL_ACK',
    evidenceRef: 'test-evidence-1',
    observedAt: '2026-10-02T10:00:00.000Z'
  });

  assert.equal(result.latestStage, 'HANDSHAKE_CONFIRMED');
  assert.equal(result.uetr, null);
});

test('does not accept SWIFT events as local clearing events', async () => {
  const tracker = new SolnPmiTracker({ verifyProviderEvent: async () => true });

  await assert.rejects(
    tracker.recordProviderEvent({
      source: 'SWIFT_GPI',
      providerEventId: 'gpi-event-1',
      paymentRef: 'test-payment-1',
      stage: 'HANDSHAKE_CONFIRMED',
      providerStatus: 'HANDSHAKE_ACK',
      evidenceRef: 'test-evidence-1',
      observedAt: '2026-10-02T10:00:00.000Z'
    }),
    /configured SOLN_PMI adapter/
  );
});