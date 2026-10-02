'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { SolnFxEventLog } = require('./event-log');
const { finalizeSettlement } = require('./finalize-settlement');

const UETR = '550e8400-e29b-41d4-a716-446655440000';
const FINGERPRINT = 'a'.repeat(64);

function makeDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solnfx-finalize-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function makeRecord(paymentRef = 'synthetic-commerce-1') {
  return {
    paymentRef,
    reportedTransactionType: 'COMMERCE',
    gpiUetr: UETR,
    gpiEvidenceRef: `gpi-final-${paymentRef}`,
    pmiEvidenceRef: `pmi-final-${paymentRef}`,
    verificationStatus: 'PROVIDER_VERIFIED',
    finalReconciliationEvidenceRef: `reconciliation-${paymentRef}`,
    settlementStatus: 'NOT_CONFIRMED'
  };
}

function makeEvents(record, sessionId = randomUUID()) {
  const common = {
    paymentRef: record.paymentRef,
    uetr: UETR,
    endToEndId: `e2e-${record.paymentRef}`
  };

  return [
    {
      source: 'SWIFT_GPI',
      providerEventId: `gpi-handshake-${record.paymentRef}`,
      ...common,
      stage: 'HANDSHAKE_CONFIRMED',
      providerStatus: 'LOCAL_MUTUAL_HANDSHAKE_CONFIRMED',
      evidenceRef: `gpi-handshake-${record.paymentRef}`,
      handshakeSessionId: sessionId,
      sessionKeyFingerprint: FINGERPRINT,
      endpointStateProof: 'b'.repeat(64),
      observedAt: '2026-10-02T10:00:00.000Z'
    },
    {
      source: 'SOLN_PMI',
      providerEventId: `pmi-handshake-${record.paymentRef}`,
      ...common,
      stage: 'HANDSHAKE_CONFIRMED',
      providerStatus: 'LOCAL_MUTUAL_HANDSHAKE_CONFIRMED',
      evidenceRef: `pmi-handshake-${record.paymentRef}`,
      handshakeSessionId: sessionId,
      sessionKeyFingerprint: FINGERPRINT,
      endpointStateProof: 'c'.repeat(64),
      observedAt: '2026-10-02T10:00:01.000Z'
    },
    {
      source: 'SWIFT_GPI',
      providerEventId: `gpi-final-${record.paymentRef}`,
      ...common,
      stage: 'SETTLED',
      providerStatus: 'ACSC',
      isoMessageType: 'pacs.002.001.12',
      isoStatusCode: 'ACSC',
      evidenceRef: record.gpiEvidenceRef,
      observedAt: '2026-10-02T10:01:00.000Z'
    },
    {
      source: 'SOLN_PMI',
      providerEventId: `pmi-final-${record.paymentRef}`,
      ...common,
      stage: 'SETTLED',
      providerStatus: 'CRDT',
      isoMessageType: 'camt.054.001.08',
      isoStatusCode: 'CRDT',
      evidenceRef: record.pmiEvidenceRef,
      observedAt: '2026-10-02T10:02:00.000Z'
    }
  ];
}

function writeLedger(t, directory, records) {
  const ledgerPath = path.join(directory, 'ledger.json');
  const eventLogPath = path.join(directory, 'events.jsonl');
  fs.writeFileSync(ledgerPath, `${JSON.stringify({ records }, null, 2)}\n`, { mode: 0o600 });
  const log = new SolnFxEventLog({
    filePath: eventLogPath,
    verifyProviderEvent: async () => true
  });
  t.after(() => {});
  return { ledgerPath, eventLogPath, log };
}

async function addEvents(log, records) {
  for (const record of records) {
    for (const event of makeEvents(record)) {
      await log.appendVerifiedEvent(event);
    }
  }
}

test('leaves live-style pending records unchanged when settlement evidence is absent', async (t) => {
  const directory = makeDirectory(t);
  const record = {
    paymentRef: 'pending-commerce-1',
    reportedTransactionType: 'COMMERCE',
    reportedEndpointResult: 'REACHED_ENDPOINT_SUCCESSFULLY',
    settlementStatus: 'NOT_CONFIRMED'
  };
  const { ledgerPath, eventLogPath } = writeLedger(t, directory, [record]);
  const before = fs.readFileSync(ledgerPath, 'utf8');

  const report = await finalizeSettlement({ ledgerPath, eventLogPath });

  assert.equal(report.updated, false);
  assert.equal(report.blocked, 1);
  assert.ok(report.records[0].blockers.includes('GPI_PACS002_ACSC_MISSING'));
  assert.ok(report.records[0].blockers.includes('PMI_CAMT054_CRDT_MISSING'));
  assert.equal(fs.readFileSync(ledgerPath, 'utf8'), before);
});

test('requires a trusted provider verifier and atomically finalizes every verified record', async (t) => {
  const directory = makeDirectory(t);
  const records = [makeRecord('verified-commerce-1'), makeRecord('verified-commerce-2')];
  const { ledgerPath, eventLogPath, log } = writeLedger(t, directory, records);
  await addEvents(log, records);

  const noVerifier = await finalizeSettlement({ ledgerPath, eventLogPath });
  assert.equal(noVerifier.updated, false);
  assert.ok(noVerifier.records.every((record) => record.blockers.includes('TRUSTED_PROVIDER_VERIFIER_REQUIRED')));

  const finalized = await finalizeSettlement({
    ledgerPath,
    eventLogPath,
    verifyProviderSettlement: async ({ record, events }) => ({
      verified: events.length === 4,
      attestationRef: `trusted-attestation-${record.paymentRef}`
    })
  });
  const updated = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

  assert.equal(finalized.updated, true);
  assert.equal(finalized.transactionCount, 2);
  assert.ok(updated.records.every((record) => record.settlementStatus === 'CONFIRMED'));
  assert.ok(updated.records.every((record) => record.verificationStatus === 'PROVIDER_VERIFIED'));
  assert.ok(updated.records.every((record) => record.settlementAttestationRef.startsWith('trusted-attestation-')));
});

test('does not partially finalize when any record fails provider verification', async (t) => {
  const directory = makeDirectory(t);
  const records = [makeRecord('verified-commerce-1'), makeRecord('unverified-commerce-2')];
  const { ledgerPath, eventLogPath, log } = writeLedger(t, directory, records);
  await addEvents(log, records);
  const before = fs.readFileSync(ledgerPath, 'utf8');

  const result = await finalizeSettlement({
    ledgerPath,
    eventLogPath,
    verifyProviderSettlement: async ({ record }) => ({
      verified: record.paymentRef === 'verified-commerce-1',
      attestationRef: 'test-attestation'
    })
  });

  assert.equal(result.updated, false);
  assert.equal(fs.readFileSync(ledgerPath, 'utf8'), before);
});

test('blocks mismatched handshake sessions before calling the provider verifier', async (t) => {
  const directory = makeDirectory(t);
  const record = makeRecord();
  const { ledgerPath, eventLogPath, log } = writeLedger(t, directory, [record]);
  const events = makeEvents(record);
  events[1].handshakeSessionId = randomUUID();
  for (const event of events) {
    await log.appendVerifiedEvent(event);
  }
  let verifierCalled = false;

  const result = await finalizeSettlement({
    ledgerPath,
    eventLogPath,
    verifyProviderSettlement: async () => {
      verifierCalled = true;
      return { verified: true, attestationRef: 'unexpected' };
    }
  });

  assert.equal(verifierCalled, false);
  assert.equal(result.updated, false);
  assert.ok(result.records[0].blockers.includes('MUTUAL_HANDSHAKE_PROOFS_MISSING_OR_MISMATCHED'));
});