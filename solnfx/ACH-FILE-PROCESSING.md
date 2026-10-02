# SOLNFX ACH File Processing Setup

## Local Paths

- `VAULT/OUTBOX/ACH`: validated, not-yet-dispatched instruction drafts.
- `VAULT/INBOX/ACH_ACKS`: acknowledgments imported from the approved ACH provider.
- `VAULT/QUARANTINE/ACH`: malformed, unmatched, duplicate, or unverifiable files.

All three paths are Codespace-local and Git-ignored. They are not encrypted by
Git ignore; keep the Codespace and its storage access-controlled.

## Aptexx Portal Import

The provided Aptexx Terms of Use require an eligible user account and prohibit
robot/automated access. Do not scrape the portal, automate sign-in, or store
portal credentials in this repository. For a user-directed manual sync:

1. The authorized account holder signs in and exports the statement or payment
	history using the official portal UI.
2. Place the unchanged export in `VAULT/INBOX/APTEXX_EXPORTS`.
3. Import only the fields needed for reconciliation into the local draft ledger;
	keep raw exports private and Git-ignored.
4. Treat an exported statement or a submitted payment as non-final. Update
	settlement only from the portal/provider's actual posted/cleared confirmation
	matched to the correct request and amount.

This workspace has a private import drop but no Aptexx API or automated portal
connector. Portal payment submission remains a user action in the official UI.
The monthly statement workflow and normalized import schema are documented in
[`APTEXX-MANUAL-SYNC.md`](APTEXX-MANUAL-SYNC.md).

## Current State

The directories are prepared, but ACH dispatch remains disabled. No ODFI or
processor adapter, NACHA file specification, company/originator identifiers,
ACH SEC-code policy, or acknowledgment schema has been configured. Do not
generate a production ACH file until these values come from the authorized
financial institution and its implementation guide.

## Required Intake Before File Creation

Each authorized request needs a unique internal payment reference, debtor
account and authorization, creditor account and routing details, amount and
currency, requested effective date, remittance data, and the institution's
required SEC code and company identifiers. Store account data only in the
approved local secure store, not in source-controlled files or chat.

## Processing States

1. `DRAFT`: request data is incomplete or awaiting authorization.
2. `VALIDATED`: schema, authorization, account references, and amount pass local checks.
3. `STAGED`: a provider-format file is written to the private outbox; no dispatch is implied.
4. `SUBMITTED`: the configured adapter reports successful transfer and supplies a provider file/trace reference.
5. `ACKNOWLEDGED`: a matching provider acknowledgment is authenticated and correlated; this alone may not mean settlement.
6. `SETTLED`: the provider's authoritative final status confirms settlement.
7. `RETURNED` or `REJECTED`: retain the provider code and quarantine/reconcile; never silently retry.

Only an approved adapter may advance `STAGED` to `SUBMITTED`. Only an
authenticated, correlated provider acknowledgment can advance provider states.
An outbox file, email, local handshake, or endpoint reachability report is not
settlement evidence.