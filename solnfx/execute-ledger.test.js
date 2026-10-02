'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildExecutionReport } = require('./execute-ledger');

const PRIVATE_LEDGER_PATH = path.resolve(
  __dirname,
  '../VAULT/RECEIPTS/solnfx-reported-endpoint-acks.json'
);
const EXAMPLE_LEDGER_PATH = path.join(__dirname, 'fixtures/commerce-ledger.example.json');

test('explains the Git-ignore reason without implying encryption', () => {
  const report = buildExecutionReport({ records: [] }, PRIVATE_LEDGER_PATH);

  assert.equal(report.visibility.gitIgnored, true);
  assert.match(report.visibility.reason, /\.gitignore/);
  assert.match(report.visibility.reason, /does not encrypt/);
});

test('classifies synthetic commerce records and blocks missing evidence', () => {
  const ledger = JSON.parse(fs.readFileSync(EXAMPLE_LEDGER_PATH, 'utf8'));
  const report = buildExecutionReport(ledger, EXAMPLE_LEDGER_PATH);

  assert.equal(report.mode, 'PREFLIGHT_ONLY_NO_PAYMENT_SUBMISSION');
  assert.equal(report.summary.transactionCount, 3);
  assert.equal(report.summary.blocked, 3);
  for (const record of report.records) {
    assert.equal(record.transactionType, 'COMMERCE');
    assert.equal(record.status, 'BLOCKED');
    assert.equal(record.settlementStatus, 'NOT_CONFIRMED');
    assert.ok(record.blockers.includes('GPI_UETR_MISSING_OR_INVALID'));
    assert.ok(record.blockers.includes('GPI_PROVIDER_EVIDENCE_MISSING'));
    assert.ok(record.blockers.includes('PMI_CLEARING_EVIDENCE_MISSING'));
    assert.ok(record.blockers.includes('FINAL_RECONCILIATION_EVIDENCE_MISSING'));
    assert.ok(record.blockers.includes('ISO_20022_LIFECYCLE_NOT_PROVIDER_VERIFIED'));
    assert.equal(record.iso20022Lifecycle.length, 7);
    assert.ok(record.iso20022Lifecycle.every((checkpoint) => checkpoint.evidenceStatus === 'NOT_EVIDENCED'));
  }
});

test('reported ISO events remain unverified until a provider verifier validates them', () => {
  const ledger = {
    reportedTransactionType: 'COMMERCE',
    records: [{
      paymentRef: 'SYNTHETIC-COMMERCE-REPORTED',
      iso20022Events: [{
        source: 'SWIFT_GPI',
        isoMessageType: 'pacs.008.001.08',
        isoStatusCode: 'INIT'
      }]
    }]
  };
  const report = buildExecutionReport(ledger, EXAMPLE_LEDGER_PATH);

  assert.equal(report.records[0].iso20022Lifecycle[0].evidenceStatus, 'REPORTED_UNVERIFIED');
  assert.equal(report.records[0].settlementStatus, 'NOT_CONFIRMED');
});

test('rejects malformed ledger input', () => {
  assert.throws(() => buildExecutionReport({}, EXAMPLE_LEDGER_PATH), /records array/);
});