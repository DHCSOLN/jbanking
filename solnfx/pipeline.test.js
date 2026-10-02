'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { SolnFxPipeline } = require('./pipeline');

const UETR = '550e8400-e29b-41d4-a716-446655440000';

function makePipeline(t, verifyGpiEvent = async () => true, verifyPmiEvent = async () => true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solnfx-pipeline-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new SolnFxPipeline({
    eventLogPath: path.join(directory, 'events.jsonl'),
    verifyGpiEvent,
    verifyPmiEvent
  });
}

function event(source, stage, providerEventId, index, extra = {}) {
  return {
    source,
    stage,
    providerEventId,
    paymentRef: 'synthetic-commerce-pipeline-1',
    providerStatus: `${source}_${stage}`,
    evidenceRef: `synthetic-evidence-${providerEventId}`,
    observedAt: `2026-10-02T10:0${index}:00.000Z`,
    ...extra
  };
}

test('runs GPI and PMI handshakes through to final correlated settlement', async (t) => {
  const pipeline = await makePipeline(t).open();

  let result = await pipeline.recordProviderEvent(
    event('SWIFT_GPI', 'HANDSHAKE_CONFIRMED', 'gpi-handshake', 0)
  );
  assert.equal(result.status, 'PARTIAL');

  result = await pipeline.recordProviderEvent(
    event('SOLN_PMI', 'HANDSHAKE_CONFIRMED', 'pmi-handshake', 1)
  );
  assert.equal(result.status, 'HANDSHAKE_CONFIRMED');

  await pipeline.recordProviderEvent(event('SWIFT_GPI', 'IN_PROGRESS', 'gpi-progress', 2));
  await pipeline.recordProviderEvent(event('SOLN_PMI', 'IN_PROGRESS', 'pmi-progress', 3));
  await pipeline.recordProviderEvent(event('SWIFT_GPI', 'SETTLED', 'gpi-settled', 4, { uetr: UETR }));
  result = await pipeline.recordProviderEvent(event('SOLN_PMI', 'SETTLED', 'pmi-settled', 5));

  assert.equal(result.status, 'SETTLED');
  assert.equal(result.gpi.uetr, UETR);
  assert.equal(result.gpi.events.length, 3);
  assert.equal(result.pmi.events.length, 3);
});

test('reloads both event histories from the local log after restart', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solnfx-replay-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const eventLogPath = path.join(directory, 'events.jsonl');
  const options = { eventLogPath, verifyGpiEvent: async () => true, verifyPmiEvent: async () => true };
  const firstRun = await new SolnFxPipeline(options).open();

  await firstRun.recordProviderEvent(event('SWIFT_GPI', 'HANDSHAKE_CONFIRMED', 'gpi-replay', 0));
  await firstRun.recordProviderEvent(event('SOLN_PMI', 'HANDSHAKE_CONFIRMED', 'pmi-replay', 1));

  const nextRun = await new SolnFxPipeline(options).open();
  const result = nextRun.get('synthetic-commerce-pipeline-1');

  assert.equal(result.status, 'HANDSHAKE_CONFIRMED');
  assert.equal(result.gpi.events.length, 1);
  assert.equal(result.pmi.events.length, 1);
});

test('rejects provider events not approved by their component verifier', async (t) => {
  const pipeline = await makePipeline(t, async () => false).open();

  await assert.rejects(
    pipeline.recordProviderEvent(event('SWIFT_GPI', 'HANDSHAKE_CONFIRMED', 'gpi-rejected', 0)),
    /could not be verified/
  );
  assert.equal(pipeline.get('synthetic-commerce-pipeline-1'), null);
});

test('requires both provider verifiers at initialization', () => {
  assert.throws(() => new SolnFxPipeline({ eventLogPath: '/tmp/events.jsonl' }), /verifiers are required/);
});