'use strict';

const { SolnGpiTracker } = require('../soln-gpi-tracker/tracker');

class SolnPmiTracker extends SolnGpiTracker {
  constructor(options = {}) {
    super({ ...options, source: 'SOLN_PMI', requireUetrForSettlement: false });
  }
}

module.exports = { SolnPmiTracker };