# Verizon Monthly Statement Intake

The provided Verizon Customer Agreement describes monthly billing and portal
payment terms; it is not a bill, payment instruction, or authorization to set up
automatic payment.

## Manual Import

1. The Verizon account owner or a properly designated account manager downloads
   the monthly Bill Ready Notice and itemized bill through the official My
   Verizon portal/app.
2. Place the user-downloaded export in `VAULT/INBOX/VERIZON_EXPORTS`.
3. Reconcile plan charges, optional services, usage, taxes, and fees separately.
   Record the statement date, due date, and exact amount in integer USD cents.
4. The account owner reviews applicable fees and authorizes any payment through
   Verizon's official payment flow. This local intake does not configure
   autopay, submit payment, or access Verizon credentials.
5. Update payment/settlement state only from the official portal's posted
   confirmation or provider receipt matched to the account and statement.

The Verizon terms assign account activity responsibility to the Account Owner,
including activity by an Account Manager. Keep credentials in Verizon's
official account controls; do not place passwords, payment tokens, or full
payment-account numbers in this repository or chat. Git ignore is not
encryption.

The local intake is initialized at
`VAULT/RECEIPTS/verizon-monthly-intake.json`. No monthly bill data was included
in the agreement text, so its amount, dates, line items, and authorization remain
empty/unverified.