'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { inspectGitVisibility } = require('./execute-ledger');
const { MutualHandshakeCoordinator } = require('./mutual-handshake');
const { SolnFxPipeline } = require('./pipeline');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LEDGER_PATH = path.join(
  REPO_ROOT,
  'VAULT',
  'RECEIPTS',
  'solnfx-reported-endpoint-acks.json'
);
const DEFAULT_RECEIPTS_PATH = path.join(
  REPO_ROOT,
  'VAULT',
  'RECEIPTS',
  'solnfx-handshake-sessions.jsonl'
);
const DEFAULT_EVENT_LOG_PATH = path.join(REPO_ROOT, 'VAULT', 'RECEIPTS', 'solnfx-events.jsonl');

function appendPrivateReceipt(filePath, receipt) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(filePath, 'a', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(receipt)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.chmodSync(filePath, 0o600);
}

function parseArgs(args) {
  if (args.includes('--help')) {
    return { help: true };
  }
  if (args.length > 3) {
    throw new TypeError('Usage: node solnfx/execute-mutual-handshake.js [ledger.json] [receipts.jsonl] [event-log.jsonl]');
  }
  return {
    ledgerPath: path.resolve(args[0] || DEFAULT_LEDGER_PATH),
    receiptsPath: path.resolve(args[1] || DEFAULT_RECEIPTS_PATH),
    eventLogPath: path.resolve(args[2] || DEFAULT_EVENT_LOG_PATH)
  };
}

async function openAndConfirm(coordinator, pipeline, proofRegistry, record, secrets) {
  const transactionRef = record.paymentRef;
  const paymentRef = record.paymentRef;
  const receipt = coordinator.openSession({
    transactionRef,
    paymentRef,
    uetr: record.gpiUetr || null,
    gpiSecret: secrets.gpiSecret,
    pmiSecret: secrets.pmiSecret
  });

  try {
    const confirmations = ['SWIFT_GPI', 'SOLN_PMI'].map((endpoint) => ({
      endpoint,
      state: 'HANDSHAKE_CONFIRMED',
      proof: coordinator.createStateProof(receipt.sessionId, endpoint, 'HANDSHAKE_CONFIRMED')
    }));
    const confirmed = coordinator.confirmEndpointStates(receipt.sessionId, confirmations);
    const events = confirmations.map((confirmation) => ({
      source: confirmation.endpoint,
      providerEventId: randomUUID(),
      paymentRef,
      uetr: receipt.uetr,
      stage: 'HANDSHAKE_CONFIRMED',
      providerStatus: 'LOCAL_MUTUAL_HANDSHAKE_CONFIRMED',
      evidenceRef: `local-mutual-handshake:${receipt.sessionId}:${confirmation.endpoint}`,
      handshakeSessionId: receipt.sessionId,
      sessionKeyFingerprint: receipt.keyFingerprint,
      endpointStateProof: confirmation.proof,
      observedAt: new Date().toISOString()
    }));

    for (const event of events) {
      proofRegistry.set(`${event.handshakeSessionId}:${event.source}`, {
        receipt,
        proof: event.endpointStateProof,
        evidenceRef: event.evidenceRef
      });
    }

    await pipeline.recordProviderEvent(events[0]);
    const combined = await pipeline.recordProviderEvent(events[1]);
    if (combined.status !== 'HANDSHAKE_CONFIRMED') {
      throw new Error(`SOLNFX did not confirm the matching handshake: ${combined.status}`);
    }

    return {
      ...confirmed,
      combinedStatus: combined.status,
      transactionType: record.reportedTransactionType || 'UNSPECIFIED',
      verificationMode: 'LOCAL_IN_PROCESS_SHARED_SECRET_CONFIRMATION',
      transactionStateChanged: false,
      settlementStatus: record.settlementStatus || 'NOT_CONFIRMED'
    };
  } finally {
    proofRegistry.delete(`${receipt.sessionId}:SWIFT_GPI`);
    proofRegistry.delete(`${receipt.sessionId}:SOLN_PMI`);
    coordinator.closeSession(receipt.sessionId);
  }
}

function createEndpointVerifier(endpoint, coordinator, proofRegistry) {
  return async (event) => {
    if (!event || event.source !== endpoint || event.stage !== 'HANDSHAKE_CONFIRMED') {
      return false;
    }
    const entry = proofRegistry.get(`${event.handshakeSessionId}:${endpoint}`);
    if (!entry) {
      return false;
    }

    let receipt;
    try {
      receipt = coordinator.getReceipt(event.handshakeSessionId);
    } catch {
      return false;
    }

    return event.paymentRef === receipt.paymentRef &&
      event.sessionKeyFingerprint === receipt.keyFingerprint &&
      event.endpointStateProof === entry.proof &&
      event.evidenceRef === entry.evidenceRef &&
      coordinator.verifyStateProof(event.handshakeSessionId, endpoint, event.stage, event.endpointStateProof);
  };
}

async function run({
  ledgerPath = DEFAULT_LEDGER_PATH,
  receiptsPath = DEFAULT_RECEIPTS_PATH,
  eventLogPath = DEFAULT_EVENT_LOG_PATH,
  gpiSecret = process.env.SOLN_GPI_HANDSHAKE_SECRET,
  pmiSecret = process.env.SOLN_PMI_HANDSHAKE_SECRET
} = {}) {
  if (!fs.existsSync(ledgerPath)) {
    throw new Error(`Local ledger not found: ${ledgerPath}`);
  }
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (!ledger || !Array.isArray(ledger.records)) {
    throw new TypeError('Ledger must contain a records array.');
  }
  if (!ledger.records.length) {
    throw new Error('No transactions found in the local ledger.');
  }

  const coordinator = new MutualHandshakeCoordinator();
  const proofRegistry = new Map();
  const pipeline = await new SolnFxPipeline({
    eventLogPath,
    verifyGpiEvent: createEndpointVerifier('SWIFT_GPI', coordinator, proofRegistry),
    verifyPmiEvent: createEndpointVerifier('SOLN_PMI', coordinator, proofRegistry)
  }).open();
  const receipts = [];

  for (const record of ledger.records) {
    if (!record || typeof record.paymentRef !== 'string' || !record.paymentRef.trim()) {
      throw new TypeError('Each transaction must have a paymentRef.');
    }
    const receipt = await openAndConfirm(coordinator, pipeline, proofRegistry, record, { gpiSecret, pmiSecret });
    appendPrivateReceipt(receiptsPath, receipt);
    receipts.push(receipt);
  }

  const report = {
    mode: 'LOCAL_MUTUAL_HANDSHAKE_RECORDED_IN_GPI_PMI_PIPELINE',
    transactionCount: receipts.length,
    receiptsPath,
    eventLogPath,
    receiptsVisibility: inspectGitVisibility(receiptsPath),
    allEndpointProofsConfirmed: receipts.every((receipt) =>
      receipt.endpointStates.SWIFT_GPI === 'HANDSHAKE_CONFIRMED' &&
      receipt.endpointStates.SOLN_PMI === 'HANDSHAKE_CONFIRMED'
    ),
    settlementStatusChanged: false,
    receipts: receipts.map(({ sessionId, paymentRef, keyFingerprint, endpointStates, combinedStatus, settlementStatus }) => ({
      sessionId,
      paymentRef,
      keyFingerprint,
      endpointStates,
      combinedStatus,
      settlementStatus
    }))
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log('Usage: SOLN_GPI_HANDSHAKE_SECRET=... SOLN_PMI_HANDSHAKE_SECRET=... node solnfx/execute-mutual-handshake.js [ledger.json] [receipts.jsonl] [event-log.jsonl]');
    } else {
      run(args).catch((error) => {
        console.error(`Handshake execution failed: ${error.message}`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    console.error(`Handshake execution failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { openAndConfirm, run };