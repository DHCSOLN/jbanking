'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SolnGpiTracker } = require('../soln-gpi-tracker/tracker');
const { SolnPmiTracker } = require('../soln-pmi/tracker');
const { SolnFxSettlement } = require('./settlement');

const UETR = '550e8400-e29b-41d4-a716-446655440000';

function createSystem() {
  const gpiTracker = new SolnGpiTracker({ verifyProviderEvent: async () => true });
  const pmiTracker = new SolnPmiTracker({ verifyProviderEvent: async () => true });
  return {
    gpiTracker,
    pmiTracker,
    settlement: new SolnFxSettlement({ gpiTracker, pmiTracker })
  };
}

function event(source, stage, providerEventId, extra = {}) {
  return {
    source,
    stage,
    providerEventId,
    paymentRef: 'synthetic-payment-1',
    providerStatus: `${source}_${stage}`,
    evidenceRef: `synthetic-evidence-${providerEventId}`,
    observedAt: '2026-10-02T10:00:00.000Z',
    ...extra
  };
}

test('combines both handshakes without reporting settlement', async () => {
  const { gpiTracker, pmiTracker, settlement } = createSystem();

  await gpiTracker.recordProviderEvent(event('SWIFT_GPI', 'HANDSHAKE_CONFIRMED', 'gpi-1'));
  assert.equal(settlement.get('synthetic-payment-1').status, 'PARTIAL');

  await pmiTracker.recordProviderEvent(event('SOLN_PMI', 'HANDSHAKE_CONFIRMED', 'pmi-1'));
  assert.equal(settlement.get('synthetic-payment-1').status, 'HANDSHAKE_CONFIRMED');
});

test('reports settlement only after both verified components are settled', async () => {
  const { gpiTracker, pmiTracker, settlement } = createSystem();

  await gpiTracker.recordProviderEvent(event('SWIFT_GPI', 'SETTLED', 'gpi-2', { uetr: UETR }));
  await pmiTracker.recordProviderEvent(event('SOLN_PMI', 'IN_PROGRESS', 'pmi-2'));
  assert.equal(settlement.get('synthetic-payment-1').status, 'IN_PROGRESS');

  await pmiTracker.recordProviderEvent(event('SOLN_PMI', 'SETTLED', 'pmi-3'));
  assert.equal(settlement.get('synthetic-payment-1').status, 'SETTLED');
});

test('propagates a rejection instead of reporting settlement', async () => {
  const { gpiTracker, pmiTracker, settlement } = createSystem();

  await gpiTracker.recordProviderEvent(event('SWIFT_GPI', 'SETTLED', 'gpi-3', { uetr: UETR }));
  await pmiTracker.recordProviderEvent(event('SOLN_PMI', 'REJECTED', 'pmi-4'));

  assert.equal(settlement.get('synthetic-payment-1').status, 'REJECTED');
});

test('returns null when neither component has events', () => {
  const { settlement } = createSystem();
  assert.equal(settlement.get('unknown-payment'), null);
});