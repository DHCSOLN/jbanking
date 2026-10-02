'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const http = require('node:http');
const { SolnFxPipeline } = require('./pipeline');

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 300;
const ROUTES = new Map([
  ['/v1/events/gpi', 'SWIFT_GPI'],
  ['/v1/events/pmi', 'SOLN_PMI'],
  ['/v1/evts/pmi', 'SOLN_PMI']
]);

class RequestBodyTooLargeError extends Error {}

function isFreshTimestamp(value, nowMs, maxClockSkewSeconds) {
  if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) {
    return false;
  }
  const timestampMs = Number(value) * 1000;
  return Math.abs(nowMs - timestampMs) <= maxClockSkewSeconds * 1000;
}

function verifySignature(secret, timestamp, rawBody, signature, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const maxClockSkewSeconds = options.maxClockSkewSeconds ?? DEFAULT_MAX_CLOCK_SKEW_SECONDS;
  if (!isFreshTimestamp(timestamp, nowMs, maxClockSkewSeconds)) {
    return false;
  }
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(rawBody)
    .digest();
  return timingSafeEqual(Buffer.from(signature, 'hex'), expected);
}

function readRequestBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;

    request.on('data', (chunk) => {
      if (rejected) {
        return;
      }
      size += chunk.length;
      if (size > maxBodyBytes) {
        rejected = true;
        reject(new RequestBodyTooLargeError());
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks));
      }
    });
    request.on('error', (error) => {
      if (!rejected) {
        reject(error);
      }
    });
  });
}

function respond(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': payload.length,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(payload);
}

async function createSolnFxWebhookServer({
  eventLogPath,
  gpiSecret,
  pmiSecret,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  maxClockSkewSeconds = DEFAULT_MAX_CLOCK_SKEW_SECONDS
}) {
  for (const [name, secret] of [['GPI', gpiSecret], ['PMI', pmiSecret]]) {
    if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
      throw new TypeError(`${name} webhook secret must be at least 32 bytes.`);
    }
  }

  const verifyEvent = (source, secret) => (event) =>
    Boolean(event._webhook) && verifySignature(
      secret,
      event._webhook.timestamp,
      event._webhook.rawBody,
      event._webhook.signature,
      { maxClockSkewSeconds }
    );

  const pipeline = await new SolnFxPipeline({
    eventLogPath,
    verifyGpiEvent: verifyEvent('SWIFT_GPI', gpiSecret),
    verifyPmiEvent: verifyEvent('SOLN_PMI', pmiSecret)
  }).open();

  const server = http.createServer(async (request, response) => {
    const source = ROUTES.get(request.url);
    if (request.method !== 'POST' || !source) {
      respond(response, 404, { error: 'Not found.' });
      return;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
      respond(response, 415, { error: 'Content-Type must be application/json.' });
      return;
    }

    let rawBody;
    try {
      rawBody = await readRequestBody(request, maxBodyBytes);
    } catch (error) {
      respond(response, error instanceof RequestBodyTooLargeError ? 413 : 400, {
        error: error instanceof RequestBodyTooLargeError ? 'Request body is too large.' : 'Request body could not be read.'
      });
      return;
    }

    const timestamp = request.headers['x-soln-timestamp'];
    const signature = request.headers['x-soln-signature'];
    const secret = source === 'SWIFT_GPI' ? gpiSecret : pmiSecret;
    if (!verifySignature(secret, timestamp, rawBody, signature, { maxClockSkewSeconds })) {
      respond(response, 401, { error: 'Webhook signature is invalid or expired.' });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      respond(response, 400, { error: 'Request body must be valid JSON.' });
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.source !== source) {
      respond(response, 400, { error: 'Event source does not match the webhook route.' });
      return;
    }

    try {
      const result = await pipeline.recordProviderEvent({
        ...payload,
        _webhook: { timestamp, signature, rawBody }
      });
      respond(response, 202, { accepted: true, status: result.status });
    } catch {
      respond(response, 422, { error: 'Provider event failed validation.' });
    }
  });

  return { server, pipeline };
}

module.exports = { createSolnFxWebhookServer, verifySignature };