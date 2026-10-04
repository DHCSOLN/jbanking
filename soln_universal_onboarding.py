import json
import uuid
from datetime import datetime

class SolnUniversalLedgerAdapter:
    """
    Stabilizes merchant onboarding by providing local verification hooks,
    handling context-aware dual-currency parameters, and structuring ISO 20022 feeds.
    """
    def __init__(self):
        self.declared_rate = 750.00   # 1 LND = 750 USD
        self.currency_scale = 100     # Cents-based standard
        self.liquidity_floor = 1333   # 13.33 LND Minimum Balance Floor

    def process_merchant_payload(self, amount_usd, sender_node, merchant_node, context="INSIDE_SOLN"):
        """
        Translates merchant credit totals into balanced dual-currency entry fields.
        Applies context-aware definitions: Inside SOLN (LND External), Outside SOLN (USD External).
        """
        # Execute precise mathematical conversion into LND Cents
        lnd_raw = amount_usd / self.declared_rate
        lnd_cents = int(round(lnd_raw * self.currency_scale))
        lnd_fractional = round(lnd_cents / self.currency_scale, 2)

        # Enforce automated system risk filters
        if lnd_cents < self.liquidity_floor:
            status = "REJECTED_LIQUIDITY_SHIELD"
            msg = f"Transaction amount falls below the mandated system floor of {self.liquidity_floor} cents."
        elif lnd_fractional < 5.0:
            status = "SETTLED_STP"
            msg = "Straight-Through Processing Complete (Auto-Approved)."
        else:
            status = "MANUAL_REVIEW_REQUIRED"
            msg = "Transaction volume flags core treasury manual control thresholds."

        tx_id = str(uuid.uuid4())
        timestamp = f"{datetime.utcnow().isoformat()}Z"

        # 1. CANONICAL ENTERPRISE DATABASE STRUCT (Maps to DATAENTRY/SOLN_CTL_Journal)
        db_payload = {
            "Transaction ID": tx_id,
            "Transaction Date": timestamp[:10],
            "Entry Timestamp": timestamp,
            "Functional Currency": "LND",
            "Reporting Currency": "USD",
            "Debit (LND Cents)": lnd_cents,
            "Credit (USD Cents)": int(amount_usd * 100),
            "Exchange Rate": self.declared_rate,
            "AUDIT STATUS": "PASS" if "SETTLED" in status else "HOLD",
            "Notes": f"{msg} Context: {context}."
        }

        # 2. CANONICAL ISO 20022 PAYLOAD (SWIFT/Fedwire Interoperability)
        iso_pacs008 = {
            "Document": {
                "FIToFICstmrCdtTrf": {
                    "GrpHdr": {
                        "MsgId": f"MSG-{int(datetime.utcnow().timestamp())}",
                        "CreDtTm": timestamp,
                        "NbOfTxs": 1,
                        "SttlmInf": {"SttlmMtd": "CLRG"}
                    },
                    "CdtTrfTxInf": {
                        "PmtId": {"EndToEndId": tx_id},
                        "IntrBkSttlmAmt": {
                            "@Ccy": "LND",
                            "#text": f"{lnd_fractional:.2f}"
                        },
                        "XchgRate": f"{self.declared_rate:.4f}",
                        "Dbtr": {"Nm": sender_node},
                        "Cdtr": {"Nm": merchant_node},
                        "SplmtryData": {
                            "Envlp": {
                                "ReportingValueUsd": f"{amount_usd:.2f}",
                                "JurisdictionStatus": status,
                                "ComplianceFooter": "All values follow SOLN dual-currency policy. Context determines which unit is external."
                            }
                        }
                    }
                }
            }
        }

        return {"database_record": db_payload, "iso_xml_payload": iso_pacs008}

if __name__ == "__main__":
    adapter = SolnUniversalLedgerAdapter()
    
    print("=================================================================")
    print("🚀 TARGET 1: MERCHANTS DEPLOYING INSIDE JURISDICTION (RETAIL)")
    print("=================================================================")
    retail = adapter.process_merchant_payload(45.00, "WLT-MEMBER-99", "MCH-STORE-101", context="INSIDE_SOLN")
    print(json.dumps(retail["database_record"], indent=2))

    print("\n=================================================================")
    print("🏦 TARGET 2: OUTBOUND SWIFT / BANKING INTEROPERABILITY RAW DATA")
    print("=================================================================")
    print(json.dumps(retail["iso_xml_payload"], indent=2))
    print("=================================================================")
