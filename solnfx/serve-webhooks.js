'use strict';

const path = require('node:path');
const { createSolnFxWebhookServer } = require('./webhook-server');

const DEFAULT_EVENT_LOG_PATH = path.resolve(
  __dirname,
  '../VAULT/RECEIPTS/solnfx-events.jsonl'
);

async function startFromEnvironment(environment = process.env) {
  const host = environment.SOLNFX_WEBHOOK_HOST || '127.0.0.1';
  const port = Number(environment.SOLNFX_WEBHOOK_PORT || '4400');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('SOLNFX_WEBHOOK_PORT must be an integer from 1 to 65535.');
  }

  const result = await createSolnFxWebhookServer({
    eventLogPath: environment.SOLNFX_EVENT_LOG_PATH || DEFAULT_EVENT_LOG_PATH,
    gpiSecret: environment.SOLN_GPI_WEBHOOK_SECRET,
    pmiSecret: environment.SOLN_PMI_WEBHOOK_SECRET
  });

  await new Promise((resolve, reject) => {
    result.server.once('error', reject);
    result.server.listen(port, host, resolve);
  });

  return { ...result, host, port: result.server.address().port };
}

if (require.main === module) {
  startFromEnvironment()
    .then(({ server, host, port }) => {
      console.log(`SOLNFX normalized-event bridge listening on ${host}:${port}.`);
      const shutdown = () => server.close(() => process.exit(0));
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch((error) => {
      console.error(`SOLNFX webhook server could not start: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { startFromEnvironment };