# Navy Federal Bill Pay Setup

The supplied document describes Navy Federal Mobile/Online Banking and Bill Pay
terms. It does not enroll a member, link a funding account, identify a biller,
or authorize a particular payment. The local profile is therefore configuration
metadata only; no credentials or account numbers are stored.

## Member-Authorized Setup

1. The member/account owner enrolls and verifies identity using Navy Federal's
   official channel.
2. If another person needs access, the account owner completes Navy Federal's
   separate Trusted User application and explicitly assigns account/service
   privileges. The terms leave the account owner financially responsible.
3. The member links or selects the Payment Account and Biller in the official
   channel, reviews amount, date, and any fees, and submits the Payment
   Instruction there.
4. Import the resulting official transaction notice or receipt for local
   reconciliation. A scheduled instruction is not proof of processing or
   settlement.

The supplied acceptable-use terms prohibit automated devices/processes used to
monitor or copy the service without prior written permission. No scraping,
automated login, credential collection, or payment submission is implemented.

The stated $5-$5,000 daily and $15,000 per five-business-day ACH limits apply to
transfers from a Navy Federal checking account to an external checking account.
Do not assume these are the limits for Bill Pay; the official service must show
the applicable limit and earliest payment date. Navy Federal states Bill Pay
payments may be canceled only before processing begins.

Local metadata: `VAULT/RECEIPTS/navy-federal-billpay-intake.json`.