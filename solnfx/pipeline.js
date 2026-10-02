'use strict';

const { SolnGpiTracker } = require('../soln-gpi-tracker/tracker');
const { SolnPmiTracker } = require('../soln-pmi/tracker');
const { SolnFxEventLog } = require('./event-log');
const { SolnFxSettlement } = require('./settlement');

class SolnFxPipeline {
  #eventLog;
  #gpiTracker;
  #pmiTracker;
  #settlement;
  #verifyGpiEvent;
  #verifyPmiEvent;

  constructor({ eventLogPath, verifyGpiEvent, verifyPmiEvent }) {
    if (typeof verifyGpiEvent !== 'function' || typeof verifyPmiEvent !== 'function') {
      throw new TypeError('Approved GPI and PMI event verifiers are required.');
    }

    this.#verifyGpiEvent = verifyGpiEvent;
    this.#verifyPmiEvent = verifyPmiEvent;
    this.#eventLog = new SolnFxEventLog({
      filePath: eventLogPath,
      verifyProviderEvent: (event) => this.verifyProviderEvent(event)
    });
    this.#gpiTracker = new SolnGpiTracker({ verifyProviderEvent: async () => true });
    this.#pmiTracker = new SolnPmiTracker({ verifyProviderEvent: async () => true });
    this.#settlement = new SolnFxSettlement({
      gpiTracker: this.#gpiTracker,
      pmiTracker: this.#pmiTracker
    });
  }

  async open() {
    for (const event of this.#eventLog.readVerifiedEvents()) {
      await this.getTracker(event.source).recordProviderEvent(event);
    }
    return this;
  }

  async recordProviderEvent(event) {
    await this.#eventLog.appendVerifiedEvent(event);
    await this.getTracker(event.source).recordProviderEvent(event);
    return this.#settlement.get(event.paymentRef);
  }

  get(paymentRef) {
    return this.#settlement.get(paymentRef);
  }

  async verifyProviderEvent(event) {
    if (!event || typeof event !== 'object') {
      return false;
    }
    if (event.source === 'SWIFT_GPI') {
      return this.#verifyGpiEvent(event);
    }
    if (event.source === 'SOLN_PMI') {
      return this.#verifyPmiEvent(event);
    }
    return false;
  }

  getTracker(source) {
    if (source === 'SWIFT_GPI') {
      return this.#gpiTracker;
    }
    if (source === 'SOLN_PMI') {
      return this.#pmiTracker;
    }
    throw new Error('Event source must be SWIFT_GPI or SOLN_PMI.');
  }
}

module.exports = { SolnFxPipeline };