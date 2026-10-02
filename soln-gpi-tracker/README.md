# SOLN GPI Tracker (End-to-End Visibility)

This component is responsible for external payment-event visibility. Its
current code is an append-only, in-memory event-tracking foundation. It does
not initiate, approve, or settle payments. A confirmed handshake remains a
handshake; it does not imply that a payment was submitted, credited, or settled.

The tracker accepts only `SWIFT_GPI` events after an injected verifier accepts
the provider event. Settlement also requires a valid UETR. Provider-specific
authentication, status mapping, persistence, access control, and audit-log
retention are not implemented, so this component is not production-ready.

## SOLNFX Components

- **SOLN GPI Tracker (End-to-End Visibility):** External payment-event visibility.
- **SOLN PMI (Local Clearing Integration):** Verified local-clearing event tracking; provider connection is not implemented.
- **SOLNFX Settlement:** Read-only correlation of GPI and PMI event histories; payment submission is not implemented.

The linked dashboard export contains no UETRs or settlement records, so no
transactions are preloaded. Connect only through an institution-approved SWIFT
gpi integration and validate the adapter against its sandbox contract.

Run the tracker unit tests with:

```sh
node --test soln-gpi-tracker/tracker.test.js
```