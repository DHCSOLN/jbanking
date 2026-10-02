'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { run } = require('./execute-mutual-handshake');

const GPI_SECRET = 'synthetic-only-gpi-handshake-secret-32-bytes-min';
const PMI_SECRET = 'synthetic-only-pmi-handshake-secret-32-bytes-min';

function withTempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solnfx-handshake-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('creates one bilateral handshake receipt per commerce transaction without mutating ledger state', async (t) => {
  const directory = withTempDirectory(t);
  const ledgerPath = path.join(directory, 'ledger.json');
  const receiptsPath = path.join(directory, 'receipts.jsonl');
  const eventLogPath = path.join(directory, 'events.jsonl');
  const ledger = {
    ledger: 'synthetic',
    reportedTransactionType: 'COMMERCE',
    records: ['commerce-1', 'commerce-2', 'commerce-3'].map((paymentRef) => ({
      paymentRef,
      settlementStatus: 'NOT_CONFIRMED'
    }))
  };
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  const before = fs.readFileSync(ledgerPath, 'utf8');
  const originalLog = console.log;
  console.log = () => {};

  try {
    const reportPromise = run({
      ledgerPath,
      receiptsPath,
      eventLogPath,
      gpiSecret: GPI_SECRET,
      pmiSecret: PMI_SECRET
    });
    const report = await reportPromise;

    assert.equal(report.mode, 'LOCAL_MUTUAL_HANDSHAKE_RECORDED_IN_GPI_PMI_PIPELINE');
    assert.equal(report.transactionCount, 3);
    assert.equal(report.allEndpointProofsConfirmed, true);
    assert.equal(report.settlementStatusChanged, false);
    assert.notEqual(report.receipts[0].keyFingerprint, report.receipts[1].keyFingerprint);
    assert.notEqual(report.receipts[1].keyFingerprint, report.receipts[2].keyFingerprint);
    assert.ok(report.receipts.every((receipt) => receipt.settlementStatus === 'NOT_CONFIRMED'));
  } finally {
    console.log = originalLog;
  }

  assert.equal(fs.readFileSync(ledgerPath, 'utf8'), before);
  const receiptLines = fs.readFileSync(receiptsPath, 'utf8').trim().split('\n');
  assert.equal(receiptLines.length, 3);
  assert.ok(receiptLines.every((line) => !Object.hasOwn(JSON.parse(line), 'sessionKey')));
  assert.equal(fs.statSync(receiptsPath).mode & 0o777, 0o600);

  const events = fs.readFileSync(eventLogPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line).event);
  assert.equal(events.length, 6);
  assert.equal(events.filter((event) => event.source === 'SWIFT_GPI').length, 3);
  assert.equal(events.filter((event) => event.source === 'SOLN_PMI').length, 3);
  for (const paymentRef of ['commerce-1', 'commerce-2', 'commerce-3']) {
    const paymentEvents = events.filter((event) => event.paymentRef === paymentRef);
    assert.equal(paymentEvents.length, 2);
    assert.equal(paymentEvents[0].handshakeSessionId, paymentEvents[1].handshakeSessionId);
    assert.equal(paymentEvents[0].sessionKeyFingerprint, paymentEvents[1].sessionKeyFingerprint);
    assert.ok(paymentEvents.every((event) => event.endpointStateProof));
  }
});

test('fails closed without endpoint handshake secrets', async (t) => {
  const directory = withTempDirectory(t);
  const ledgerPath = path.join(directory, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify({ records: [{ paymentRef: 'commerce-1' }] }));

  await assert.rejects(
    run({
      ledgerPath,
      receiptsPath: path.join(directory, 'receipts.jsonl'),
      eventLogPath: path.join(directory, 'events.jsonl')
    }),
    /GPI handshake secret/
  );
  assert.equal(fs.existsSync(path.join(directory, 'receipts.jsonl')), false);
});