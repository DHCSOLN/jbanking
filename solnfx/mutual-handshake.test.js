'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MutualHandshakeCoordinator } = require('./mutual-handshake');

const GPI_SECRET = 'synthetic-only-gpi-handshake-secret-32-bytes-min';
const PMI_SECRET = 'synthetic-only-pmi-handshake-secret-32-bytes-min';

function openSession(coordinator, overrides = {}) {
  return coordinator.openSession({
    transactionRef: 'SYNTHETIC-COMMERCE-001',
    paymentRef: 'SYNTHETIC-COMMERCE-001',
    uetr: null,
    gpiSecret: GPI_SECRET,
    pmiSecret: PMI_SECRET,
    ...overrides
  });
}

test('derives a unique session key and confirms matching GPI/PMI state proofs', () => {
  const coordinator = new MutualHandshakeCoordinator();
  const receipt = openSession(coordinator);
  const gpiProof = coordinator.createStateProof(receipt.sessionId, 'SWIFT_GPI', 'HANDSHAKE_CONFIRMED');
  const pmiProof = coordinator.createStateProof(receipt.sessionId, 'SOLN_PMI', 'HANDSHAKE_CONFIRMED');
  const confirmed = coordinator.confirmEndpointStates(receipt.sessionId, [
    { endpoint: 'SWIFT_GPI', state: 'HANDSHAKE_CONFIRMED', proof: gpiProof },
    { endpoint: 'SOLN_PMI', state: 'HANDSHAKE_CONFIRMED', proof: pmiProof }
  ]);

  assert.match(receipt.sessionId, /^[0-9a-f-]{36}$/i);
  assert.match(receipt.keyFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(receipt, 'sessionKey'), false);
  assert.equal(confirmed.endpointStates.SWIFT_GPI, 'HANDSHAKE_CONFIRMED');
  assert.equal(confirmed.endpointStates.SOLN_PMI, 'HANDSHAKE_CONFIRMED');
  assert.equal(confirmed.settlementStatus, 'NOT_CONFIRMED');
});

test('creates different handshake sessions for repeated transaction references', () => {
  const coordinator = new MutualHandshakeCoordinator();
  const first = openSession(coordinator);
  const second = openSession(coordinator);

  assert.notEqual(first.sessionId, second.sessionId);
  assert.notEqual(first.keyFingerprint, second.keyFingerprint);
});

test('rejects tampered state, wrong endpoint, and duplicate endpoint confirmation', () => {
  const coordinator = new MutualHandshakeCoordinator();
  const receipt = openSession(coordinator);
  const gpiProof = coordinator.createStateProof(receipt.sessionId, 'SWIFT_GPI', 'HANDSHAKE_CONFIRMED');
  const pmiProof = coordinator.createStateProof(receipt.sessionId, 'SOLN_PMI', 'HANDSHAKE_CONFIRMED');

  assert.equal(coordinator.verifyStateProof(receipt.sessionId, 'SWIFT_GPI', 'SETTLED', gpiProof), false);
  assert.throws(() => coordinator.confirmEndpointStates(receipt.sessionId, [
    { endpoint: 'SWIFT_GPI', state: 'HANDSHAKE_CONFIRMED', proof: gpiProof },
    { endpoint: 'SWIFT_GPI', state: 'HANDSHAKE_CONFIRMED', proof: pmiProof }
  ]), /exactly once/);
});

test('expires sessions and clears their in-memory key', () => {
  let now = 1_800_000_000_000;
  const coordinator = new MutualHandshakeCoordinator({
    now: () => now,
    sessionTtlMs: 1000
  });
  const receipt = openSession(coordinator);
  now += 1001;

  assert.throws(
    () => coordinator.createStateProof(receipt.sessionId, 'SWIFT_GPI', 'HANDSHAKE_CONFIRMED'),
    /expired/
  );
  assert.equal(coordinator.closeSession(receipt.sessionId), false);
});

test('requires separate strong GPI and PMI handshake secrets', () => {
  const coordinator = new MutualHandshakeCoordinator();

  assert.throws(() => openSession(coordinator, { pmiSecret: 'too-short' }), /PMI handshake secret/);
  assert.throws(() => openSession(coordinator, { transactionRef: '' }), /Transaction reference/);
});