'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GENESIS_HASH = '0'.repeat(64);
const ALLOWED_SOURCES = new Set(['SWIFT_GPI', 'SOLN_PMI']);
const ALLOWED_STAGES = new Set([
  'HANDSHAKE_CONFIRMED',
  'SUBMITTED',
  'IN_PROGRESS',
  'SETTLED',
  'REJECTED',
  'RETURNED'
]);
const UETR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_MESSAGE_TYPE_PATTERN = /^(pacs|camt)\.\d{3}\.\d{3}\.\d{2}$/;

function hashEntry(sequence, previousHash, event) {
  return createHash('sha256')
    .update(JSON.stringify({ sequence, previousHash, event }))
    .digest('hex');
}

class SolnFxEventLog {
  constructor({ filePath, verifyProviderEvent }) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new TypeError('An event log path is required.');
    }
    if (typeof verifyProviderEvent !== 'function') {
      throw new TypeError('A provider event verifier is required.');
    }

    this.filePath = path.resolve(filePath);
    this.verifyProviderEvent = verifyProviderEvent;
    this.writeQueue = Promise.resolve();
  }

  appendVerifiedEvent(input) {
    const operation = this.writeQueue.then(() => this.appendEvent(input));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async appendEvent(input) {
    const event = this.normalizeEvent(input);
    const entries = this.readEntries();
    const existing = entries.find((entry) =>
      entry.event.source === event.source && entry.event.providerEventId === event.providerEventId
    );

    if (existing) {
      if (JSON.stringify(existing.event) !== JSON.stringify(event)) {
        throw new Error('Provider event ID was reused with different content.');
      }
      return { appended: false, sequence: existing.sequence, hash: existing.hash };
    }

    const existingUetr = entries
      .map((entry) => entry.event)
      .find((storedEvent) => storedEvent.paymentRef === event.paymentRef && storedEvent.uetr);
    if (existingUetr && event.uetr && existingUetr.uetr !== event.uetr) {
      throw new Error('Payment reference cannot be associated with multiple UETRs.');
    }

    if (!(await this.verifyProviderEvent(input))) {
      throw new Error('Provider event could not be verified.');
    }

    const previousHash = entries.length ? entries[entries.length - 1].hash : GENESIS_HASH;
    const sequence = entries.length + 1;
    const entry = {
      sequence,
      previousHash,
      event,
      hash: hashEntry(sequence, previousHash, event)
    };

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const descriptor = fs.openSync(this.filePath, 'a', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(entry)}\n`, 'utf8');
    } finally {
      fs.closeSync(descriptor);
    }
    fs.chmodSync(this.filePath, 0o600);

    return { appended: true, sequence, hash: entry.hash };
  }

  readVerifiedEvents() {
    return this.readEntries().map((entry) => ({ ...entry.event }));
  }

  readEntries() {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const contents = fs.readFileSync(this.filePath, 'utf8');
    if (contents && !contents.endsWith('\n')) {
      throw new Error('Event log has an incomplete trailing record.');
    }

    const lines = contents.split('\n').filter(Boolean);
    const entries = [];
    const providerEventIds = new Set();
    let previousHash = GENESIS_HASH;

    for (let index = 0; index < lines.length; index += 1) {
      let entry;
      try {
        entry = JSON.parse(lines[index]);
      } catch {
        throw new Error(`Event log record ${index + 1} is not valid JSON.`);
      }

      if (
        entry.sequence !== index + 1 ||
        entry.previousHash !== previousHash ||
        entry.hash !== hashEntry(entry.sequence, entry.previousHash, entry.event)
      ) {
        throw new Error(`Event log integrity check failed at record ${index + 1}.`);
      }
      const eventKey = `${entry.event.source}:${entry.event.providerEventId}`;
      if (providerEventIds.has(eventKey)) {
        throw new Error(`Duplicate provider event ID at record ${index + 1}.`);
      }

      providerEventIds.add(eventKey);
      previousHash = entry.hash;
      entries.push(entry);
    }

    return entries;
  }

  normalizeEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Provider event must be an object.');
    }
    if (!ALLOWED_SOURCES.has(input.source)) {
      throw new Error('Event source must be SWIFT_GPI or SOLN_PMI.');
    }
    if (typeof input.providerEventId !== 'string' || !input.providerEventId.trim()) {
      throw new Error('Provider event ID is required.');
    }
    if (typeof input.paymentRef !== 'string' || !input.paymentRef.trim()) {
      throw new Error('Internal payment reference is required.');
    }
    if (!ALLOWED_STAGES.has(input.stage)) {
      throw new Error('Unsupported payment stage.');
    }
    if (typeof input.providerStatus !== 'string' || !input.providerStatus.trim()) {
      throw new Error('Original provider status is required.');
    }
    if (typeof input.evidenceRef !== 'string' || !input.evidenceRef.trim()) {
      throw new Error('Provider evidence reference is required.');
    }
    if (typeof input.observedAt !== 'string' || Number.isNaN(Date.parse(input.observedAt))) {
      throw new Error('A valid provider observation timestamp is required.');
    }
    if (input.uetr && (typeof input.uetr !== 'string' || !UETR_PATTERN.test(input.uetr))) {
      throw new Error('UETR must be a UUID version 4.');
    }
    if (input.isoMessageType && !ISO_MESSAGE_TYPE_PATTERN.test(input.isoMessageType)) {
      throw new Error('ISO 20022 message type is malformed.');
    }
    if (input.isoStatusCode && (typeof input.isoStatusCode !== 'string' || !/^[A-Z0-9]{3,8}$/.test(input.isoStatusCode))) {
      throw new Error('ISO 20022 status code is malformed.');
    }
    if (input.endToEndId && (typeof input.endToEndId !== 'string' || !input.endToEndId.trim())) {
      throw new Error('End-to-end ID must be a non-empty string.');
    }
    if (input.handshakeSessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.handshakeSessionId)) {
      throw new Error('Handshake session ID must be a UUID version 4.');
    }
    if (input.sessionKeyFingerprint && !/^[a-f0-9]{64}$/i.test(input.sessionKeyFingerprint)) {
      throw new Error('Handshake key fingerprint must be a SHA-256 hex digest.');
    }
    if (input.endpointStateProof && !/^[a-f0-9]{64}$/i.test(input.endpointStateProof)) {
      throw new Error('Endpoint state proof must be a SHA-256 HMAC hex digest.');
    }
    if (input.source === 'SWIFT_GPI' && input.stage === 'SETTLED' && !input.uetr) {
      throw new Error('A UETR is required for a settled SWIFT gpi event.');
    }

    return {
      source: input.source,
      providerEventId: input.providerEventId.trim(),
      paymentRef: input.paymentRef.trim(),
      uetr: input.uetr ? input.uetr.toLowerCase() : null,
      stage: input.stage,
      providerStatus: input.providerStatus.trim(),
      evidenceRef: input.evidenceRef.trim(),
      ...(input.isoMessageType ? { isoMessageType: input.isoMessageType } : {}),
      ...(input.isoStatusCode ? { isoStatusCode: input.isoStatusCode } : {}),
      ...(input.endToEndId ? { endToEndId: input.endToEndId.trim() } : {}),
      ...(input.handshakeSessionId ? { handshakeSessionId: input.handshakeSessionId } : {}),
      ...(input.sessionKeyFingerprint ? { sessionKeyFingerprint: input.sessionKeyFingerprint.toLowerCase() } : {}),
      ...(input.endpointStateProof ? { endpointStateProof: input.endpointStateProof.toLowerCase() } : {}),
      observedAt: new Date(input.observedAt).toISOString()
    };
  }
}

module.exports = { SolnFxEventLog };