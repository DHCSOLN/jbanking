'use strict';

const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SolnFxEventLog } = require('./event-log');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LEDGER_PATH = path.join(
  REPO_ROOT,
  'VAULT',
  'RECEIPTS',
  'solnfx-reported-endpoint-acks.json'
);
const DEFAULT_EVENT_LOG_PATH = path.join(REPO_ROOT, 'VAULT', 'RECEIPTS', 'solnfx-events.jsonl');
const UETR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function addEvidenceBlockers(record, events) {
  const blockers = [];
  const related = events.filter((event) => event.paymentRef === record.paymentRef);
  const gpiFinals = related.filter((event) =>
    event.source === 'SWIFT_GPI' &&
    event.stage === 'SETTLED' &&
    event.isoMessageType === 'pacs.002.001.12' &&
    event.isoStatusCode === 'ACSC'
  );
  const pmiFinals = related.filter((event) =>
    event.source === 'SOLN_PMI' &&
    event.stage === 'SETTLED' &&
    event.isoMessageType === 'camt.054.001.08' &&
    event.isoStatusCode === 'CRDT'
  );
  const gpiHandshakes = related.filter((event) => event.source === 'SWIFT_GPI' && event.stage === 'HANDSHAKE_CONFIRMED');
  const pmiHandshakes = related.filter((event) => event.source === 'SOLN_PMI' && event.stage === 'HANDSHAKE_CONFIRMED');

  if (typeof record.paymentRef !== 'string' || !record.paymentRef.trim()) {
    blockers.push('PAYMENT_REFERENCE_MISSING');
  }
  if (gpiFinals.length !== 1) {
    blockers.push(gpiFinals.length ? 'GPI_FINAL_EVENT_AMBIGUOUS' : 'GPI_PACS002_ACSC_MISSING');
  }
  if (pmiFinals.length !== 1) {
    blockers.push(pmiFinals.length ? 'PMI_FINAL_EVENT_AMBIGUOUS' : 'PMI_CAMT054_CRDT_MISSING');
  }
  if (gpiHandshakes.length !== 1 || pmiHandshakes.length !== 1) {
    blockers.push('MUTUAL_HANDSHAKE_EVENT_PAIR_MISSING_OR_AMBIGUOUS');
  }
  if (gpiFinals.length === 1) {
    if (!UETR_PATTERN.test(gpiFinals[0].uetr || '')) {
      blockers.push('GPI_FINAL_UETR_MISSING_OR_INVALID');
    }
    if (!gpiFinals[0].evidenceRef) {
      blockers.push('GPI_FINAL_EVIDENCE_REFERENCE_MISSING');
    }
  }
  if (pmiFinals.length === 1 && !pmiFinals[0].evidenceRef) {
    blockers.push('PMI_FINAL_EVIDENCE_REFERENCE_MISSING');
  }
  if (gpiFinals.length === 1 && pmiFinals.length === 1) {
    if (!gpiFinals[0].uetr || gpiFinals[0].uetr !== pmiFinals[0].uetr) {
      blockers.push('GPI_PMI_UETR_MISMATCH');
    }
    if (!gpiFinals[0].endToEndId || gpiFinals[0].endToEndId !== pmiFinals[0].endToEndId) {
      blockers.push('GPI_PMI_END_TO_END_ID_MISMATCH');
    }
    if (record.gpiUetr && record.gpiUetr !== gpiFinals[0].uetr) {
      blockers.push('LEDGER_GPI_UETR_MISMATCH');
    }
  }
  if (gpiHandshakes.length === 1 && pmiHandshakes.length === 1) {
    const gpi = gpiHandshakes[0];
    const pmi = pmiHandshakes[0];
    if (
      !gpi.handshakeSessionId || gpi.handshakeSessionId !== pmi.handshakeSessionId ||
      !gpi.sessionKeyFingerprint || gpi.sessionKeyFingerprint !== pmi.sessionKeyFingerprint ||
      !gpi.endpointStateProof || !pmi.endpointStateProof
    ) {
      blockers.push('MUTUAL_HANDSHAKE_PROOFS_MISSING_OR_MISMATCHED');
    }
  }
  if (related.some((event) => event.stage === 'REJECTED' || event.stage === 'RETURNED')) {
    blockers.push('REJECTION_OR_RETURN_EVENT_PRESENT');
  }
  if (record.verificationStatus !== 'PROVIDER_VERIFIED') {
    blockers.push('LEDGER_PROVIDER_VERIFICATION_MISSING');
  }
  if (!record.finalReconciliationEvidenceRef) {
    blockers.push('FINAL_RECONCILIATION_EVIDENCE_MISSING');
  }

  return { blockers, related, gpiFinal: gpiFinals[0], pmiFinal: pmiFinals[0] };
}

function atomicReplace(filePath, expectedDigest, contents) {
  const current = fs.readFileSync(filePath);
  const currentDigest = createHash('sha256').update(current).digest('hex');
  if (currentDigest !== expectedDigest) {
    throw new Error('Ledger changed during finalization; refusing to overwrite it.');
  }

  const mode = fs.statSync(filePath).mode & 0o777;
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  );
  const descriptor = fs.openSync(temporaryPath, 'wx', mode);
  try {
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }

  try {
    fs.renameSync(temporaryPath, filePath);
    const directoryDescriptor = fs.openSync(path.dirname(filePath), 'r');
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

async function finalizeSettlement({
  ledgerPath = DEFAULT_LEDGER_PATH,
  eventLogPath = DEFAULT_EVENT_LOG_PATH,
  verifyProviderSettlement
} = {}) {
  const absoluteLedgerPath = path.resolve(ledgerPath);
  const originalBytes = fs.readFileSync(absoluteLedgerPath);
  const originalDigest = createHash('sha256').update(originalBytes).digest('hex');
  const ledger = JSON.parse(originalBytes.toString('utf8'));
  if (!ledger || !Array.isArray(ledger.records) || ledger.records.length === 0) {
    throw new TypeError('Ledger must contain at least one transaction record.');
  }

  const eventLog = new SolnFxEventLog({
    filePath: path.resolve(eventLogPath),
    verifyProviderEvent: async () => false
  });
  const events = eventLog.readVerifiedEvents();
  const checks = [];

  for (const record of ledger.records) {
    const evidence = addEvidenceBlockers(record, events);
    let attestation = null;
    if (evidence.blockers.length === 0) {
      if (typeof verifyProviderSettlement !== 'function') {
        evidence.blockers.push('TRUSTED_PROVIDER_VERIFIER_REQUIRED');
      } else {
        try {
          attestation = await verifyProviderSettlement({
            record,
            events: evidence.related,
            gpiFinal: evidence.gpiFinal,
            pmiFinal: evidence.pmiFinal
          });
          if (
            !attestation ||
            attestation.verified !== true ||
            typeof attestation.attestationRef !== 'string' ||
            !attestation.attestationRef.trim()
          ) {
            evidence.blockers.push('PROVIDER_SETTLEMENT_ATTESTATION_INVALID');
          }
        } catch {
          evidence.blockers.push('PROVIDER_SETTLEMENT_VERIFICATION_FAILED');
        }
      }
    }

    checks.push({
      paymentRef: record.paymentRef || null,
      ready: evidence.blockers.length === 0,
      blockers: evidence.blockers,
      attestation
    });
  }

  const blocked = checks.filter((check) => !check.ready).length;
  if (blocked > 0) {
    return {
      mode: 'PREFLIGHT_NO_MUTATION',
      updated: false,
      transactionCount: checks.length,
      blocked,
      records: checks.map(({ paymentRef, ready, blockers }) => ({ paymentRef, ready, blockers }))
    };
  }

  const finalizedAt = new Date().toISOString();
  const updatedLedger = {
    ...ledger,
    records: ledger.records.map((record, index) => ({
      ...record,
      settlementStatus: 'CONFIRMED',
      verificationStatus: 'PROVIDER_VERIFIED',
      settlementVerifiedAt: finalizedAt,
      settlementAttestationRef: checks[index].attestation.attestationRef
    }))
  };
  atomicReplace(absoluteLedgerPath, originalDigest, `${JSON.stringify(updatedLedger, null, 2)}\n`);

  return {
    mode: 'ATOMIC_SETTLEMENT_FINALIZATION',
    updated: true,
    transactionCount: checks.length,
    blocked: 0,
    settlementStatus: 'CONFIRMED',
    finalizedAt
  };
}

async function loadProviderVerifier(modulePath) {
  if (!modulePath) {
    return undefined;
  }
  const absolutePath = path.resolve(modulePath);
  const verifierModule = require(absolutePath);
  if (typeof verifierModule.verifyProviderSettlement !== 'function') {
    throw new TypeError('Verifier module must export verifyProviderSettlement.');
  }
  return verifierModule.verifyProviderSettlement;
}

async function runFromEnvironment(environment = process.env, args = process.argv.slice(2)) {
  if (args.length > 2) {
    throw new TypeError('Usage: node solnfx/finalize-settlement.js [ledger.json] [events.jsonl]');
  }
  const verifyProviderSettlement = await loadProviderVerifier(environment.SOLNFX_SETTLEMENT_VERIFIER_MODULE);
  const result = await finalizeSettlement({
    ledgerPath: args[0] || DEFAULT_LEDGER_PATH,
    eventLogPath: args[1] || DEFAULT_EVENT_LOG_PATH,
    verifyProviderSettlement
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.updated) {
    process.exitCode = 2;
  }
  return result;
}

if (require.main === module) {
  runFromEnvironment().catch((error) => {
    console.error(`Settlement finalization failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { addEvidenceBlockers, finalizeSettlement, runFromEnvironment };