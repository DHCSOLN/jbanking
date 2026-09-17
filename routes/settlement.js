// routes/settlement.js
const express = require('express');
const router = express.Router();
const BigNumber = require('bignumber.js');

// Global System Constants (SOLN Treasury Framework)
const PARITY_RATE = new BigNumber(750); // 1 LND = 750 USD
const LEDGER_SCALE = 6;                // 6-decimal internal precision

/**
 * @route   POST /api/settle/usd-to-lnd
 * @desc    Inward Settlement Operations (e.g., Accepting USD invoice and reserving LND)
 */
router.post('/usd-to-lnd', (req, res) => {
    const { vendorName, vendorAccount, billAmountUSD, makerStatus, checkerStatus, targetWallet } = req.body;

    // 1. Mirror Fed Operations: Strict Access & Validation Control
    if (!vendorName || !vendorAccount || !billAmountUSD) {
        return res.status(400).json({ error: "Missing required core clearing telemetry fields." });
    }

    // 2. Dual-Control Risk Framework (Maker-Checker Protocol)
    if (makerStatus !== 'PASS' || checkerStatus !== 'PASS') {
        return res.status(403).json({ 
            error: "Settlement Denied: Operation failed Maker-Checker dual-authorization guidelines." 
        });
    }

    try {
        const usd = new BigNumber(billAmountUSD);
        
        // 3. Precision Settlement Exchange Calculation
        const lndCalculated = usd.dividedBy(PARITY_RATE).toFixed(LEDGER_SCALE, BigNumber.ROUND_DOWN);

        // 4. Return Transaction Clearing Advice Payload
        return res.status(200).json({
            status: "CLEARED_AND_SETTLED",
            timestamp: new Date().toISOString(),
            clearing_house: "SOLN TREASURY WINDOW",
            details: {
                wallet_id: targetWallet || "LND-9CB971D86EE6414B",
                vendor: vendorName.toUpperCase(),
                account_num: vendorAccount,
                currency_pair: "USD/LND",
                funding_source_units: `$${usd.toFixed(2)} USD`,
                settled_ledger_units: `${lndCalculated} LND`
            },
            compliance: {
                footer: "All values follow SOLN dual-currency policy. Context determines which unit is external."
            }
        });
    } catch (error) {
        return res.status(500).json({ error: "Internal Clearance Deficit Error", details: error.message });
    }
});

/**
 * @route   POST /api/settle/lnd-to-usd
 * @desc    Outward Bank Clearance Operations (e.g., Debiting LND balance to release USD wire)
 */
router.post('/lnd-to-usd', (req, res) => {
    const { lndAmount, routingNumber, makerStatus, checkerStatus } = req.body;

    if (!lndAmount || !routingNumber) {
        return res.status(400).json({ error: "Missing required ledger or route identifiers." });
    }

    if (makerStatus !== 'PASS' || checkerStatus !== 'PASS') {
        return res.status(403).json({ error: "Settlement Denied: Unauthorized ledger release state." });
    }

    try {
        const lnd = new BigNumber(lndAmount);
        
        // Multiply by fixed 750 rate, round to standard banking cents (HALF_UP)
        const usdCalculated = lnd.multipliedBy(PARITY_RATE).toFixed(2, BigNumber.ROUND_HALF_UP);

        return res.status(200).json({
            status: "DISPATCHED_TO_ACH_GRID",
            routing_transit_number: routingNumber, // e.g., 61000609
            cleared_value_usd: `$${usdCalculated}`,
            compliance_notice: "All values follow SOLN dual-currency policy. Context determines which unit is external."
        });
    } catch (error) {
        return res.status(500).json({ error: "Outward Wire Dispatch Fault", details: error.message });
    }
});

module.exports = router;
