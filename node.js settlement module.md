// Node.js Settlement Module
const BigNumber = require('bignumber.js'); // Standard for blockchain/fintech ledgers

const PARITY_RATE = new BigNumber(750); // 1 LND = 750 USD

/**
 * Converts USD amount to exact LND for settlement
 * @param {string|number} usdAmount - The invoice bill amount in USD (e.g., 346.00)
 * @returns {string} LND amount string fixed to 6 decimal places
 */
function convertUsdToLndForSettlement(usdAmount) {
    const usd = new BigNumber(usdAmount);
    
    // Divide USD by the reference rate (750) and truncate/round to 6 decimals
    const lndAmount = usd.dividedBy(PARITY_RATE);
    
    return lndAmount.toFixed(6, BigNumber.ROUND_DOWN); // Result: "0.461333"
}

// Example Execution matching Sandbox Ledger:
const billAmountUSD = 346.00;
const settlementLND = convertUsdToLndForSettlement(billAmountUSD);
console.log(`Settling: ${billAmountUSD} USD -> ${settlementLND} LND`); 
// Output: Settling: 346 USD -> 0.461333 LND
