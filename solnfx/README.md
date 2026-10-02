# SOLNFX Settlement

SOLNFX Settlement combines **SOLN GPI Tracker (End-to-End Visibility)** with
**SOLN PMI (Local Clearing Integration)** into a read-only status view.

## Lifecycle

1. Each component records authenticated, append-only events against the same internal payment reference.
2. A handshake is reported only as `HANDSHAKE_CONFIRMED`; it is not treated as a submitted or settled payment.
3. A component rejection or return is propagated to the combined view.
4. The combined view reports `SETTLED` only when both verified event streams report `SETTLED`.
5. Provider evidence references, original statuses, timestamps, and the GPI UETR remain available in each component history.

## Seven-Checkpoint Local Integration Test

Run the self-contained synthetic lifecycle with:

```sh
node solnfx/run-lifecycle-test.js
```

The runner starts an ephemeral loopback server and signs each test payload with
test-only secrets. It sends:

| Step | Component | ISO 20022 message | Checkpoint |
| --- | --- | --- | --- |
| 1 | GPI | `pacs.008.001.08` | Synthetic initiation (`INIT`) |
| 2 | GPI | `pacs.002.001.12` | Received (`RCVD`) |
| 3 | GPI | `pacs.002.001.12` | Technical acceptance (`ACTC`) |
| 4 | GPI | `pacs.002.001.12` | Acceptance (`ACCP`) |
| 5 | GPI | `pacs.002.001.12` | Settlement in process (`ACSP`) |
| 6 | GPI | `pacs.002.001.12` | Settlement completed (`ACSC`) |
| 7 | PMI | `camt.054.001.08` | Matching local credit notification (`CRDT`) |

Steps 1–6 are posted to `/v1/events/gpi`; step 7 is posted to
`/v1/evts/pmi`. All seven carry the same synthetic payment reference, UETR,
and end-to-end ID. The runner asserts that the combined status is not settled
before the PMI event and is settled only after both component histories reach
their terminal state.

This is a test sequence using ISO 20022 message/status vocabulary, not a claim
that ISO 20022 mandates exactly seven steps or that a real payment was sent.
It validates the local bridge, trackers, and SOLNFX join only.

The current implementation verifies events through injected provider adapters,
correlates GPI and PMI histories, and can persist and replay them locally. It
does not create payment instructions, move funds, or connect to SWIFT or a local
clearing network by itself. Production use requires approved provider
contracts, real signature verification, access controls, backups, and
operational monitoring.

`SolnFxPipeline` takes separate `verifyGpiEvent` and `verifyPmiEvent` callbacks
and an `eventLogPath`. Open it with `await pipeline.open()` to replay the local
event log, then call `recordProviderEvent(event)` for provider events. Configure
the path as `VAULT/RECEIPTS/solnfx-events.jsonl`; it is Git-ignored and written
with owner-only file permissions. Writes are serialized within one process, so
do not run multiple writers against the same log.

## Normalized Event Bridge

Start the local HTTP bridge with `node solnfx/serve-webhooks.js` after setting
`SOLN_GPI_WEBHOOK_SECRET` and `SOLN_PMI_WEBHOOK_SECRET` in the Codespace secret
store. Each secret must be at least 32 bytes. The server binds to `127.0.0.1`
by default and accepts signed JSON at `/v1/events/gpi` and `/v1/events/pmi`.

The bridge requires `X-SOLN-Timestamp` (Unix seconds) and
`X-SOLN-Signature` (hex HMAC-SHA256 over `timestamp + "." + raw request body`).
Signatures expire after five minutes; bodies are limited to 64 KiB. This is an
internal normalized-event contract, not SWIFT's native API or signature format.
An upstream adapter must authenticate the official provider message, map it to
the canonical event fields used by the tracker, then sign the normalized body
for this bridge. Use TLS at a trusted ingress before allowing network access;
never expose the local server directly to the public internet.

There are no payment-submission routes. These endpoints only append and report
provider events.

## Mutual Handshake Execution

To create a fresh transaction-bound session for each record in the ignored
local ledger, set the separate `SOLN_GPI_HANDSHAKE_SECRET` and
`SOLN_PMI_HANDSHAKE_SECRET` Codespace secrets (each at least 32 bytes), then
run:

```sh
node solnfx/execute-mutual-handshake.js
```

The runner performs ephemeral X25519 key agreement, checks GPI and PMI
role-specific HMAC proofs, and confirms both endpoint-state proofs against the
same session key. It writes one `HANDSHAKE_CONFIRMED` event per component into
the shared pipeline log and appends a redacted receipt to the ignored
`VAULT/RECEIPTS/solnfx-handshake-sessions.jsonl`. The events share the session
ID and key fingerprint; the receipt stores only the fingerprint, never the
session key. Transaction and settlement status are not modified. The handshake
is local and in-process; it does not contact a remote SWIFT or PMI service. Use
mutually pinned endpoint identity keys and an approved secure transport before
treating remote peers as authenticated.

The SHA-256 chain detects accidental or unsophisticated edits; it is not a
signature, a tamper-proof ledger, or a replacement for a protected database.
The injected verifiers must validate actual provider signatures/statuses; the
synthetic test verifiers are not suitable for production.

Run the synthetic end-to-end tests with:

```sh
node --test soln-gpi-tracker/tracker.test.js soln-pmi/tracker.test.js solnfx/*.test.js
```

Run a non-mutating ledger preflight with:

```sh
node solnfx/execute-ledger.js
```

The preflight reports the Git-ignore reason, per-record evidence blockers, and
all seven ISO 20022 checkpoints (`pacs.008`, five `pacs.002` statuses, and
`camt.054`). Checkpoints without matching event records are `NOT_EVIDENCED`;
events copied into an import without provider verification are
`REPORTED_UNVERIFIED`. It exits with status `2` while records are blocked and
never changes payment status or submits payments.
Tests use the synthetic [commerce example](fixtures/commerce-ledger.example.json),
not the Git-ignored Codespace ledger. The default run reads the local vault file;
pass a different path as the first argument to inspect another import.