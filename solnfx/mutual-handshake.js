'use strict';

const {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  createDiffieHellman,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual
} = require('node:crypto');

const SESSION_TTL_MS = 5 * 60 * 1000;
const ALLOWED_ENDPOINTS = new Set(['SWIFT_GPI', 'SOLN_PMI']);
const UETR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hmac(secret, content) {
  return createHmac('sha256', secret).update(content).digest();
}

function safeEqual(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicKeyText(key) {
  return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

function publicKeyFromText(value) {
  return createPublicKey({
    key: Buffer.from(value, 'base64'),
    type: 'spki',
    format: 'der'
  });
}

class MutualHandshakeCoordinator {
  #sessions = new Map();

  constructor({ now = () => Date.now(), sessionTtlMs = SESSION_TTL_MS } = {}) {
    this.now = now;
    this.sessionTtlMs = sessionTtlMs;
  }

  openSession({ transactionRef, paymentRef, uetr = null, gpiSecret, pmiSecret }) {
    if (typeof transactionRef !== 'string' || !transactionRef.trim()) {
      throw new TypeError('Transaction reference is required.');
    }
    if (typeof paymentRef !== 'string' || !paymentRef.trim()) {
      throw new TypeError('Payment reference is required.');
    }
    for (const [role, secret] of [['GPI', gpiSecret], ['PMI', pmiSecret]]) {
      if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
        throw new TypeError(`${role} handshake secret must be at least 32 bytes.`);
      }
    }
    if (uetr !== null && (typeof uetr !== 'string' || !UETR_PATTERN.test(uetr))) {
      throw new TypeError('UETR must be a UUID version 4 when provided.');
    }

    const sessionId = randomUUID();
    const createdAtMs = this.now();
    const context = {
      protocol: 'SOLNFX-MUTUAL-HANDSHAKE-V1',
      sessionId,
      transactionRef: transactionRef.trim(),
      paymentRef: paymentRef.trim(),
      uetr: uetr ? uetr.toLowerCase() : null,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + this.sessionTtlMs).toISOString(),
      gpiNonce: randomBytes(32).toString('hex'),
      pmiNonce: randomBytes(32).toString('hex')
    };

    const gpiEphemeral = generateKeyPairSync('x25519');
    const pmiEphemeral = generateKeyPairSync('x25519');
    context.gpiEphemeralPublicKey = publicKeyText(gpiEphemeral.publicKey);
    context.pmiEphemeralPublicKey = publicKeyText(pmiEphemeral.publicKey);

    const transcript = Buffer.from(JSON.stringify(context));
    const transcriptHash = createHash('sha256').update(transcript).digest();
    const gpiIdentityProof = hmac(gpiSecret, Buffer.concat([transcriptHash, Buffer.from('|SWIFT_GPI')]));
    const pmiIdentityProof = hmac(pmiSecret, Buffer.concat([transcriptHash, Buffer.from('|SOLN_PMI')]));

    if (!safeEqual(gpiIdentityProof, hmac(gpiSecret, Buffer.concat([transcriptHash, Buffer.from('|SWIFT_GPI')])))) {
      throw new Error('GPI identity proof failed.');
    }
    if (!safeEqual(pmiIdentityProof, hmac(pmiSecret, Buffer.concat([transcriptHash, Buffer.from('|SOLN_PMI')])))) {
      throw new Error('PMI identity proof failed.');
    }

    const gpiSharedSecret = diffieHellman({
      privateKey: gpiEphemeral.privateKey,
      publicKey: publicKeyFromText(context.pmiEphemeralPublicKey)
    });
    const pmiSharedSecret = diffieHellman({
      privateKey: pmiEphemeral.privateKey,
      publicKey: publicKeyFromText(context.gpiEphemeralPublicKey)
    });

    if (!safeEqual(gpiSharedSecret, pmiSharedSecret)) {
      throw new Error('GPI and PMI derived different handshake secrets.');
    }

    const sessionKey = Buffer.from(hkdfSync(
      'sha256',
      gpiSharedSecret,
      transcriptHash,
      Buffer.from('SOLNFX-TRANSACTION-STATE-SESSION-KEY-V1'),
      32
    ));
    const gpiKeyConfirmation = hmac(sessionKey, Buffer.concat([transcriptHash, Buffer.from('|CONFIRM|SWIFT_GPI')]));
    const pmiKeyConfirmation = hmac(sessionKey, Buffer.concat([transcriptHash, Buffer.from('|CONFIRM|SOLN_PMI')]));

    if (!safeEqual(gpiKeyConfirmation, hmac(sessionKey, Buffer.concat([transcriptHash, Buffer.from('|CONFIRM|SWIFT_GPI')])))) {
      throw new Error('GPI session-key confirmation failed.');
    }
    if (!safeEqual(pmiKeyConfirmation, hmac(sessionKey, Buffer.concat([transcriptHash, Buffer.from('|CONFIRM|SOLN_PMI')])))) {
      throw new Error('PMI session-key confirmation failed.');
    }

    const receipt = {
      sessionId,
      transactionRef: context.transactionRef,
      paymentRef: context.paymentRef,
      uetr: context.uetr,
      createdAt: context.createdAt,
      expiresAt: context.expiresAt,
      protocol: context.protocol,
      keyFingerprint: createHash('sha256').update(sessionKey).digest('hex'),
      endpoints: {
        SWIFT_GPI: { identityVerified: true, sessionKeyConfirmed: true },
        SOLN_PMI: { identityVerified: true, sessionKeyConfirmed: true }
      },
      handshakeStatus: 'CONFIRMED',
      settlementStatus: 'NOT_CONFIRMED'
    };

    this.#sessions.set(sessionId, {
      context,
      transcriptHash,
      sessionKey,
      receipt
    });
    gpiSharedSecret.fill(0);
    pmiSharedSecret.fill(0);

    return structuredClone(receipt);
  }

  createStateProof(sessionId, endpoint, state) {
    const session = this.getActiveSession(sessionId);
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      throw new Error('Endpoint must be SWIFT_GPI or SOLN_PMI.');
    }
    if (typeof state !== 'string' || !state.trim()) {
      throw new TypeError('A transaction state is required.');
    }

    const payload = JSON.stringify({
      sessionId,
      transactionRef: session.context.transactionRef,
      paymentRef: session.context.paymentRef,
      uetr: session.context.uetr,
      endpoint,
      state: state.trim()
    });
    return hmac(session.sessionKey, payload).toString('hex');
  }

  verifyStateProof(sessionId, endpoint, state, proof) {
    if (!ALLOWED_ENDPOINTS.has(endpoint) || typeof proof !== 'string' || !/^[a-f0-9]{64}$/i.test(proof)) {
      return false;
    }
    let expected;
    try {
      expected = this.createStateProof(sessionId, endpoint, state);
    } catch {
      return false;
    }
    return safeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'));
  }

  getReceipt(sessionId) {
    return structuredClone(this.getActiveSession(sessionId).receipt);
  }

  confirmEndpointStates(sessionId, confirmations) {
    const session = this.getActiveSession(sessionId);
    if (!confirmations || !Array.isArray(confirmations) || confirmations.length !== 2) {
      throw new TypeError('Exactly two endpoint state confirmations are required.');
    }

    const required = new Set(ALLOWED_ENDPOINTS);
    for (const confirmation of confirmations) {
      if (!required.delete(confirmation.endpoint)) {
        throw new Error('Endpoint confirmations must include GPI and PMI exactly once.');
      }
      if (confirmation.state !== 'HANDSHAKE_CONFIRMED' || !this.verifyStateProof(
        sessionId,
        confirmation.endpoint,
        confirmation.state,
        confirmation.proof
      )) {
        throw new Error(`${confirmation.endpoint} state proof is invalid.`);
      }
    }
    if (required.size) {
      throw new Error('Both GPI and PMI confirmations are required.');
    }

    session.receipt.endpointStates = {
      SWIFT_GPI: 'HANDSHAKE_CONFIRMED',
      SOLN_PMI: 'HANDSHAKE_CONFIRMED'
    };
    return structuredClone(session.receipt);
  }

  closeSession(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.sessionKey.fill(0);
    this.#sessions.delete(sessionId);
    return true;
  }

  getActiveSession(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new Error('Handshake session is not active.');
    }
    if (this.now() >= Date.parse(session.context.expiresAt)) {
      this.closeSession(sessionId);
      throw new Error('Handshake session has expired.');
    }
    return session;
  }
}

module.exports = { MutualHandshakeCoordinator };