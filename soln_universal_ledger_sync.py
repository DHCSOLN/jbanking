import json
import uuid
from datetime import datetime

# Central Monetary Authority Constants (SOLN-FRS-CB)
CURRENCY_CODE = "LND"
FIXED_PARITY_RATE = 750.00  # Stated reference rate
MINIMUM_BALANCE_CENTS = 1333  # Liquidity floor (13.33 LND)

class UniversalLedgerAdapter:
    def __init__(self, transaction_id=None, timestamp=None):
        self.tx_id = transaction_id or str(uuid.uuid4())
        self.timestamp = timestamp or f"{datetime.utcnow().isoformat()}Z"

    def format_transaction(self, usd_amount, sender_node, recipient_node, description):
        """Processes the core transaction data across all software languages."""
        # Enforce Fixed Parity Rule math safely
        lnd_amount = round(usd_amount / FIXED_PARITY_RATE, 4)
        lnd_cents = int(lnd_amount * 100)
        
        # Enforce ledger state thresholds
        state = "ACTIVE_INTEROPERABLE" if lnd_amount < 5.0 else "MANUAL_REVIEW_PENDING"
        status = "SETTLED" if state == "ACTIVE_INTEROPERABLE" else "MANUAL_REVIEW"

        # 1. ENTERPRISE REST API / SQL JSON PAYLOAD (QuickBooks, NetSuite, Apps Script)
        # Directly compatible with your core database schemas (USSGL Map aligned)
        json_payload = {
            "transaction_id": self.tx_id,
            "timestamp": self.timestamp,
            "sender": sender_node,
            "recipient": recipient_node,
            "amount_usd": float(usd_amount),
            "amount_lnd": lnd_amount,
            "amount_lnd_cents": lnd_cents,
            "state_flag": state,
            "status": status,
            "description": description,
            "compliance_footer": "All values follow SOLN dual-currency policy. Context determines which unit is external."
        }

        # 2. PLAIN-TEXT ACCOUNTING JOURNAL FORMAT (Ledger-CLI, hledger, Beancount)
        # Emits a strictly balanced, deterministic double-entry transaction block
        plain_text_journal = (
            f"{self.timestamp[:10]} * {description}\n"
            f"    ; SOLN_TX_ID: {self.tx_id}\n"
            f"    ; Mapped State: {state}\n"
            f"    Assets:Sovereign:Wallets:{sender_node}      -{lnd_amount:.4f} {CURRENCY_CODE} @@ {usd_amount:.2f} USD\n"
            f"    Assets:Sovereign:Wallets:{recipient_node}       {lnd_amount:.4f} {CURRENCY_CODE} @@ {usd_amount:.2f} USD\n"
        )

        # 3. CSV RECORD ROW ENTRY (For DataEntry Staging / Master Ledger Sheets)
        # Flat format optimized for append-only data streams
        csv_row = [
            self.tx_id, self.timestamp, sender_node, recipient_node, 
            float(usd_amount), lnd_amount, state, status, description
        ]

        # 4. ISO 20022 PAYLOAD METADATA BLOCK (SWIFT / pacs.008 Canonical Maps)
        # Formats parameters to talking straight to core central banking adapters
        iso_xml_metadata = {
            "MsgId": self.tx_id,
            "CreDtTm": self.timestamp,
            "EndToEndId": self.tx_id,
            "IntrBkSttlmAmt": f"{lnd_amount:.2f}",
            "Ccy": CURRENCY_CODE,
            "XchgRate": f"{FIXED_PARITY_RATE:.4f}",
            "Dbtr": sender_node,
            "Cdtr": recipient_node,
            "ReportingValueUsd": f"{usd_amount:.2f}"
        }

        return {
            "api_json": json_payload,
            "cli_ledger": plain_text_journal,
            "flat_csv": csv_row,
            "iso_metadata": iso_xml_metadata
        }

# ==========================================
# Execution / Dispatch Loop Demonstration
# ==========================================
if __name__ == "__main__":
    adapter = UniversalLedgerAdapter()
    
    # Process a sample retail transaction ($30.00 USD -> 0.04 LND)
    bundled_formats = adapter.format_transaction(
        usd_amount=30.00,
        sender_node="Node_SOLN_8832",
        recipient_node="SOLN_M_101",
        description="Standard Retail Point-of-Sale Purchase"
    )

    print("=================================================================")
    print("🚀 TARGET 1: DISPATCH TO ENTERPRISE REST APIS (JSON PAYLOAD)")
    print("=================================================================")
    print(json.dumps(bundled_formats["api_json"], indent=2))

    print("\n=================================================================")
    print("📝 TARGET 2: WRITE TO PLAIN-TEXT ACCOUNTING LEDGER FILE (.LEDGER)")
    print("=================================================================")
    print(bundled_formats["cli_ledger"])

    print("=================================================================")
    print("📊 TARGET 3: FLAT CSV FOR SPREADSHEETS / STAGING QUEUES")
    print("=================================================================")
    print(f"Row Array: {bundled_formats['flat_csv']}")

    print("\n=================================================================")
    print("🏦 TARGET 4: CANONICAL CENTRAL BANK ISO 20022 MESSAGE DATA")
    print("=================================================================")
    print(json.dumps(bundled_formats["iso_metadata"], indent=2))
    print("=================================================================")
