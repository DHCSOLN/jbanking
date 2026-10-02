'use strict';

const PAYMENT_STAGES = new Set([
  'HANDSHAKE_CONFIRMED',
  'SUBMITTED',
  'IN_PROGRESS',
  'SETTLED',
  'REJECTED',
  'RETURNED'
]);

const UETR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_MESSAGE_TYPE_PATTERN = /^(pacs|camt)\.\d{3}\.\d{3}\.\d{2}$/;

class SolnGpiTracker {
  constructor({
    verifyProviderEvent,
    source = 'SWIFT_GPI',
    requireUetrForSettlement = source === 'SWIFT_GPI'
  }) {
    if (typeof verifyProviderEvent !== 'function') {
      throw new TypeError('A provider event verifier is required.');
    }

    this.verifyProviderEvent = verifyProviderEvent;
    this.source = source;
    this.requireUetrForSettlement = requireUetrForSettlement;
    this.payments = new Map();
    this.eventFingerprints = new Map();
  }

  async recordProviderEvent(event) {
    const normalized = this.validateEvent(event);
    const fingerprint = JSON.stringify(normalized);
    const previousFingerprint = this.eventFingerprints.get(normalized.providerEventId);

    if (previousFingerprint) {
      if (previousFingerprint !== fingerprint) {
        throw new Error('Provider event ID was reused with different content.');
      }
      return this.get(normalized.paymentRef);
    }

    if (!(await this.verifyProviderEvent(event))) {
      throw new Error('Provider event could not be verified.');
    }

    const payment = this.payments.get(normalized.paymentRef) || {
      paymentRef: normalized.paymentRef,
      uetr: null,
      events: []
    };

    if (payment.uetr && normalized.uetr && payment.uetr !== normalized.uetr) {
      throw new Error('Payment reference cannot be associated with multiple UETRs.');
    }

    if (this.requireUetrForSettlement && normalized.stage === 'SETTLED' && !normalized.uetr) {
      throw new Error('A verified UETR is required before recording settlement.');
    }

    payment.uetr = payment.uetr || normalized.uetr;
    payment.events.push(normalized);
    this.payments.set(payment.paymentRef, payment);
    this.eventFingerprints.set(normalized.providerEventId, fingerprint);

    return this.get(payment.paymentRef);
  }

  get(paymentRef) {
    const payment = this.payments.get(paymentRef);
    if (!payment) {
      return null;
    }

    const events = payment.events.map((event) => ({ ...event }));
    const latestEvent = events.reduce((latest, event) => {
      if (!latest || Date.parse(event.observedAt) >= Date.parse(latest.observedAt)) {
        return event;
      }
      return latest;
    }, null);

    return {
      paymentRef: payment.paymentRef,
      uetr: payment.uetr,
      latestStage: latestEvent ? latestEvent.stage : null,
      latestHandshakeSessionId: latestEvent ? latestEvent.handshakeSessionId || null : null,
      latestSessionKeyFingerprint: latestEvent ? latestEvent.sessionKeyFingerprint || null : null,
      events
    };
  }

  list() {
    return [...this.payments.keys()].sort().map((paymentRef) => this.get(paymentRef));
  }

  validateEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError('Provider event must be an object.');
    }
    if (event.source !== this.source) {
      const sourceLabel = this.source === 'SWIFT_GPI' ? 'SWIFT gpi' : this.source;
      throw new Error(`Only events from the configured ${sourceLabel} adapter are accepted.`);
    }
    if (typeof event.providerEventId !== 'string' || !event.providerEventId.trim()) {
      throw new Error('Provider event ID is required.');
    }
    if (typeof event.paymentRef !== 'string' || !event.paymentRef.trim()) {
      throw new Error('Internal payment reference is required.');
    }
    if (!PAYMENT_STAGES.has(event.stage)) {
      throw new Error('Unsupported payment stage.');
    }
    if (typeof event.providerStatus !== 'string' || !event.providerStatus.trim()) {
      throw new Error('Original provider status is required for audit.');
    }
    if (typeof event.evidenceRef !== 'string' || !event.evidenceRef.trim()) {
      throw new Error('Provider evidence reference is required.');
    }
    if (typeof event.observedAt !== 'string' || Number.isNaN(Date.parse(event.observedAt))) {
      throw new Error('A valid provider observation timestamp is required.');
    }
    if (event.uetr && (typeof event.uetr !== 'string' || !UETR_PATTERN.test(event.uetr))) {
      throw new Error('UETR must be a UUID version 4.');
    }
    if (event.isoMessageType && !ISO_MESSAGE_TYPE_PATTERN.test(event.isoMessageType)) {
      throw new Error('ISO 20022 message type is malformed.');
    }
    if (event.isoStatusCode && (typeof event.isoStatusCode !== 'string' || !/^[A-Z0-9]{3,8}$/.test(event.isoStatusCode))) {
      throw new Error('ISO 20022 status code is malformed.');
    }
    if (event.endToEndId && (typeof event.endToEndId !== 'string' || !event.endToEndId.trim())) {
      throw new Error('End-to-end ID must be a non-empty string.');
    }
    if (event.handshakeSessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.handshakeSessionId)) {
      throw new Error('Handshake session ID must be a UUID version 4.');
    }
    if (event.sessionKeyFingerprint && !/^[a-f0-9]{64}$/i.test(event.sessionKeyFingerprint)) {
      throw new Error('Handshake key fingerprint must be a SHA-256 hex digest.');
    }
    if (event.endpointStateProof && !/^[a-f0-9]{64}$/i.test(event.endpointStateProof)) {
      throw new Error('Endpoint state proof must be a SHA-256 HMAC hex digest.');
    }

    return {
      source: event.source,
      providerEventId: event.providerEventId.trim(),
      paymentRef: event.paymentRef.trim(),
      uetr: event.uetr ? event.uetr.toLowerCase() : null,
      stage: event.stage,
      providerStatus: event.providerStatus.trim(),
      evidenceRef: event.evidenceRef.trim(),
      ...(event.isoMessageType ? { isoMessageType: event.isoMessageType } : {}),
      ...(event.isoStatusCode ? { isoStatusCode: event.isoStatusCode } : {}),
      ...(event.endToEndId ? { endToEndId: event.endToEndId.trim() } : {}),
      ...(event.handshakeSessionId ? { handshakeSessionId: event.handshakeSessionId } : {}),
      ...(event.sessionKeyFingerprint ? { sessionKeyFingerprint: event.sessionKeyFingerprint.toLowerCase() } : {}),
      ...(event.endpointStateProof ? { endpointStateProof: event.endpointStateProof.toLowerCase() } : {}),
      observedAt: new Date(event.observedAt).toISOString()
    };
  }
}

module.exports = { SolnGpiTracker };