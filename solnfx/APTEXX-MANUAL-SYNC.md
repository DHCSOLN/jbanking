# Aptexx Monthly Statement Intake

This workflow supports monthly statement imports only. It does not automate
Aptexx portal access, schedule recurring payments, or submit a payment.

## Monthly Procedure

1. The authorized account holder signs in to the official Aptexx portal and
   downloads the monthly statement/export.
2. Place the original export in the Git-ignored
   `VAULT/INBOX/APTEXX_EXPORTS` directory. Keep the Codespace access-controlled;
   Git ignore is not encryption.
3. Normalize the statement to
   [`schemas/aptexx-monthly-statement.schema.json`](schemas/aptexx-monthly-statement.schema.json).
   Preserve the original export and record its SHA-256 hash.
4. Classify each line as rent, recurring fee, variable utility, one-time fee,
   or other. Verify the integer-cent line-item sum equals `balanceDueMinorUnits`.
5. Deduplicate by provider statement reference and source-file hash. Never
   overwrite a prior month's statement with a new one.
6. Review the statement in the official portal and authorize payment there if
   desired. Record a confirmation/reference only after the portal reports its
   actual status. A statement export or queued request is not settlement proof.

The previously supplied $2,445.70 statement is recorded as one user-provided
intake. Its $1,965.00 rent line is distinct from fees, utilities, and other
charges; do not treat the full statement total as a recurring monthly amount.

Because the provided Aptexx terms restrict automated access and require an
eligible user account, no scraping, automated login, or credential sharing is
implemented. No raw statement should be committed to the public Git remote.