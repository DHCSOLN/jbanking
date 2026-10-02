'use strict';

function getOverallStatus(gpi, pmi) {
  const stages = [gpi && gpi.latestStage, pmi && pmi.latestStage];

  if (stages.includes('REJECTED')) {
    return 'REJECTED';
  }
  if (stages.includes('RETURNED')) {
    return 'RETURNED';
  }
  if (stages.every((stage) => stage === 'SETTLED')) {
    return 'SETTLED';
  }
  if (stages.every((stage) => stage === 'HANDSHAKE_CONFIRMED')) {
    const hasSessionLink = gpi.latestHandshakeSessionId || pmi.latestHandshakeSessionId ||
      gpi.latestSessionKeyFingerprint || pmi.latestSessionKeyFingerprint;
    if (
      hasSessionLink &&
      (!gpi.latestHandshakeSessionId || !pmi.latestHandshakeSessionId ||
        gpi.latestHandshakeSessionId !== pmi.latestHandshakeSessionId ||
        !gpi.latestSessionKeyFingerprint || !pmi.latestSessionKeyFingerprint ||
        gpi.latestSessionKeyFingerprint !== pmi.latestSessionKeyFingerprint)
    ) {
      return 'HANDSHAKE_MISMATCH';
    }
    return 'HANDSHAKE_CONFIRMED';
  }
  if (stages.every((stage) => stage === null)) {
    return 'AWAITING_COMPONENTS';
  }
  if (stages.some((stage) => stage === null)) {
    return 'PARTIAL';
  }
  return 'IN_PROGRESS';
}

class SolnFxSettlement {
  constructor({ gpiTracker, pmiTracker }) {
    if (!gpiTracker || typeof gpiTracker.get !== 'function') {
      throw new TypeError('A SOLN GPI tracker is required.');
    }
    if (!pmiTracker || typeof pmiTracker.get !== 'function') {
      throw new TypeError('A SOLN PMI tracker is required.');
    }

    this.gpiTracker = gpiTracker;
    this.pmiTracker = pmiTracker;
  }

  get(paymentRef) {
    const gpi = this.gpiTracker.get(paymentRef);
    const pmi = this.pmiTracker.get(paymentRef);

    if (!gpi && !pmi) {
      return null;
    }

    return {
      paymentRef,
      status: getOverallStatus(gpi, pmi),
      gpi,
      pmi
    };
  }
}

module.exports = { SolnFxSettlement };