# SOLN PMI (Local Clearing Integration)

SOLN PMI records verified local-clearing events separately from SWIFT gpi
events. It does not initiate or release payments. The current event ledger is
in-memory; local-provider authentication, persistence, access control, and
production status mapping require an approved clearing-provider contract.

Run the unit tests with:

```sh
node --test soln-pmi/tracker.test.js
```