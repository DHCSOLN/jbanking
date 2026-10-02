'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LEDGER_PATH = path.join(
  REPO_ROOT,
  'VAULT',
  'RECEIPTS',
  'solnfx-reported-endpoint-acks.json'
);
const UETR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_20022_LIFECYCLE = [
  { source: 'SWIFT_GPI', messageType: 'pacs.008.001.08', statusCode: 'INIT', stage: 'SUBMITTED' },
  { source: 'SWIFT_GPI', messageType: 'pacs.002.001.12', statusCode: 'RCVD', stage: 'SUBMITTED' },
  { source: 'SWIFT_GPI', messageType: 'pacs.002.001.12', statusCode: 'ACTC', stage: 'IN_PROGRESS' },
  { source: 'SWIFT_GPI', messageType: 'pacs.002.001.12', statusCode: 'ACCP', stage: 'IN_PROGRESS' },
  { source: 'SWIFT_GPI', messageType: 'pacs.002.001.12', statusCode: 'ACSP', stage: 'IN_PROGRESS' },
  { source: 'SWIFT_GPI', messageType: 'pacs.002.001.12', statusCode: 'ACSC', stage: 'SETTLED' },
  { source: 'SOLN_PMI', messageType: 'camt.054.001.08', statusCode: 'CRDT', stage: 'SETTLED' }
];

function mapIso20022Lifecycle(record) {
  const events = Array.isArray(record.iso20022Events) ? record.iso20022Events : [];

  return ISO_20022_LIFECYCLE.map((checkpoint, index) => {
    const matches = events.filter((event) =>
      event.source === checkpoint.source &&
      event.isoMessageType === checkpoint.messageType &&
      event.isoStatusCode === checkpoint.statusCode
    );
    let evidenceStatus = 'NOT_EVIDENCED';
    if (matches.length === 1) {
      evidenceStatus = 'REPORTED_UNVERIFIED';
    } else if (matches.length > 1) {
      evidenceStatus = 'AMBIGUOUS_DUPLICATE_EVENTS';
    }

    return {
      step: index + 1,
      source: checkpoint.source,
      messageType: checkpoint.messageType,
      statusCode: checkpoint.statusCode,
      expectedStage: checkpoint.stage,
      evidenceStatus
    };
  });
}

function inspectGitVisibility(filePath) {
  const relativePath = path.relative(REPO_ROOT, path.resolve(filePath));

  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', relativePath], {
      cwd: REPO_ROOT,
      stdio: 'ignore'
    });
    return {
      gitIgnored: true,
      reason: 'The path matches .gitignore, so Git omits it from status and commits. This does not encrypt the file.'
    };
  } catch (error) {
    if (error.status === 1) {
      return {
        gitIgnored: false,
        reason: 'The path is not ignored by Git.'
      };
    }
    return {
      gitIgnored: null,
      reason: 'Git ignore status could not be checked.'
    };
  }
}

function analyzeRecord(record, ledgerType, seenPaymentRefs) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('Each ledger record must be an object.');
  }

  const blockers = [];
  const transactionType = record.reportedTransactionType || ledgerType || 'UNSPECIFIED';
  const lifecycle = mapIso20022Lifecycle(record);

  if (transactionType !== 'COMMERCE') {
    blockers.push('TRANSACTION_TYPE_NOT_CONFIRMED_COMMERCE');
  }
  if (typeof record.paymentRef !== 'string' || !record.paymentRef.trim()) {
    blockers.push('PAYMENT_REFERENCE_MISSING');
  } else if (seenPaymentRefs.has(record.paymentRef)) {
    blockers.push('DUPLICATE_PAYMENT_REFERENCE');
  } else {
    seenPaymentRefs.add(record.paymentRef);
  }
  if (typeof record.gpiUetr !== 'string' || !UETR_PATTERN.test(record.gpiUetr)) {
    blockers.push('GPI_UETR_MISSING_OR_INVALID');
  }
  if (typeof record.gpiEvidenceRef !== 'string' || !record.gpiEvidenceRef.trim()) {
    blockers.push('GPI_PROVIDER_EVIDENCE_MISSING');
  }
  if (typeof record.pmiEvidenceRef !== 'string' || !record.pmiEvidenceRef.trim()) {
    blockers.push('PMI_CLEARING_EVIDENCE_MISSING');
  }
  if (record.verificationStatus !== 'PROVIDER_VERIFIED') {
    blockers.push('PROVIDER_EVENTS_NOT_VERIFIED');
  }
  if (!record.finalReconciliationEvidenceRef) {
    blockers.push('FINAL_RECONCILIATION_EVIDENCE_MISSING');
  }
  if (record.settlementStatus !== 'CONFIRMED') {
    blockers.push('SETTLEMENT_NOT_CONFIRMED');
  }
  if (lifecycle.some((checkpoint) => checkpoint.evidenceStatus !== 'PROVIDER_VERIFIED')) {
    blockers.push('ISO_20022_LIFECYCLE_NOT_PROVIDER_VERIFIED');
  }

  return {
    paymentRef: record.paymentRef || null,
    transactionType,
    reportedEndpointResult: record.reportedEndpointResult || null,
    iso20022Lifecycle: lifecycle,
    status: blockers.length === 0 ? 'READY_FOR_PROVIDER_ADAPTER' : 'BLOCKED',
    settlementStatus: 'NOT_CONFIRMED',
    blockers
  };
}

function buildExecutionReport(ledger, ledgerPath = DEFAULT_LEDGER_PATH) {
  if (!ledger || !Array.isArray(ledger.records)) {
    throw new TypeError('Ledger must contain a records array.');
  }

  const seenPaymentRefs = new Set();
  const records = ledger.records.map((record) =>
    analyzeRecord(record, ledger.reportedTransactionType, seenPaymentRefs)
  );
  const blocked = records.filter((record) => record.status === 'BLOCKED').length;

  return {
    mode: 'PREFLIGHT_ONLY_NO_PAYMENT_SUBMISSION',
    ledger: ledger.ledger || 'UNNAMED',
    visibility: inspectGitVisibility(ledgerPath),
    reportedConnectedSheetCount: ledger.reportedConnectedSheetCount || null,
    connectedSheetCountVerification: ledger.connectedSheetCountVerification || 'UNVERIFIED',
    summary: {
      transactionCount: records.length,
      readyForProviderAdapter: records.length - blocked,
      blocked
    },
    records
  };
}

function run(ledgerPath = DEFAULT_LEDGER_PATH) {
  const absolutePath = path.resolve(ledgerPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      'Ledger file not found. The default input is Git-ignored; add the local ledger in Codespace or pass an input path.'
    );
  }
  const ledger = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  const report = buildExecutionReport(ledger, absolutePath);

  console.log(JSON.stringify(report, null, 2));
  if (report.summary.blocked > 0) {
    process.exitCode = 2;
  }
  return report;
}

if (require.main === module) {
  try {
    run(process.argv[2] || DEFAULT_LEDGER_PATH);
  } catch (error) {
    console.error(`Ledger preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildExecutionReport, inspectGitVisibility, mapIso20022Lifecycle, run };