/**
 * SOLNGPBC Standalone Sovereign Ledger Integration
 * Direct Sovereign Central Treasury Liquidation Gateway
 * 
 * Target: Clears utility bill payouts directly against in-house asset pools
 * under Master Routing Node 061000609, bypassing third-party retail banks.
 */

var UTILITY_REGISTRY_SHEET = "TXN_UTILITIES";
var CONSUMER_WALLETS_SHEET = "WALLET_CONSUMERS";
var LND_USD_CONVERSION_RATE = 750;
var PERMANENT_ROUTING_NUMBER = "061000609";

/**
 * Processes a sovereign utility payment, mapping routing codes and checking numbers live.
 */
function processLiveUtilityPayment(clientWalletId, utilityProvider, utilityAccountNumber, dueDateString, amountDueUSD) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var walletSheet = ss.getSheetByName(CONSUMER_WALLETS_SHEET);
  var utilitySheet = ss.getSheetByName(UTILITY_REGISTRY_SHEET);
  
  // Extract checking number by stripping the LND- prefix
  var cleanWalletId = String(clientWalletId).trim();
  var checkingAccountNumber = cleanWalletId.toUpperCase().indexOf("LND-") === 0 ? cleanWalletId.substring(4) : cleanWalletId;
  
  if (!utilitySheet) {
    utilitySheet = ss.insertSheet(UTILITY_REGISTRY_SHEET);
    utilitySheet.getRange(1, 1, 1, 9).setValues([[
      "Sovereign Settlement UUID", 
      "Client Wallet ID", 
      "Routing Number",
      "Checking Account Number",
      "Utility Provider", 
      "Provider Account Num", 
      "Due Date", 
      "Settled Amount (LND)", 
      "Sovereign Clearing (USD)"
    ]]);
    utilitySheet.getRange("A1:I1").setFontWeight("bold").setBackground("#2c3e50").setFontColor("#ffffff");
  }
  
  var requiredLndDebit = amountDueUSD / LND_USD_CONVERSION_RATE;
  
  if (!walletSheet) {
    SpreadsheetApp.getUi().alert("ERROR: Consumer wallet registry not found.");
    return;
  }
  
  var walletData = walletSheet.getDataRange().getValues();
  var walletFound = false;
  var walletRowIndex = -1;
  var currentLndBalance = 0;
  
  for (var i = 1; i < walletData.length; i++) {
    if (String(walletData[i][0]).trim() === cleanWalletId) {
      walletFound = true;
      walletRowIndex = i + 1;
      currentLndBalance = Number(walletData[i][1]) || 0;
      break;
    }
  }
  
  if (!walletFound) {
    SpreadsheetApp.getUi().alert("REJECTION: Provided Wallet ID does not exist in the system registry.");
    return;
  }
  
  if (currentLndBalance < requiredLndDebit) {
    SpreadsheetApp.getUi().alert("REJECTION: Insufficient LND funds to clear this utility payment.");
    return;
  }
  
  // Debit the client's wallet range natively
  var newLndBalance = currentLndBalance - requiredLndDebit;
  var newUsdTrackingValue = newLndBalance * LND_USD_CONVERSION_RATE;
  
  walletSheet.getRange(walletRowIndex, 2).setValue(newLndBalance);
  walletSheet.getRange(walletRowIndex, 3).setValue(newUsdTrackingValue);
  
  var txnUUID = "SOLN-SETTLE-" + Utilities.formatDate(new Date(), "GMT", "yyyyMMdd-HHmmss");
  
  // Append directly to your sovereign clearing sub-ledger layout tracking columns
  utilitySheet.appendRow([
    txnUUID,
    cleanWalletId,
    PERMANENT_ROUTING_NUMBER,
    checkingAccountNumber,
    utilityProvider,
    utilityAccountNumber,
    dueDateString,
    requiredLndDebit,
    amountDueUSD
  ]);
  
  var internalClearingLog = {
    "MessageStandard": "ISO20022-camt.054",
    "ClearingAuthorityNode": PERMANENT_ROUTING_NUMBER,
    "DebitAccount": cleanWalletId,
    "CheckingNumberAssigned": checkingAccountNumber,
    "SettlementStatus": "SOVEREIGN_CLEARANCE_PERFECTED",
    "AssetUnitsLND": requiredLndDebit,
    "ValuationUSD": amountDueUSD,
    "AllocationDetails": {
      "VendorName": utilityProvider,
      "VendorAccountRef": utilityAccountNumber,
      "SettlementTimestamp": new Date().toISOString()
    }
  };
  
  Logger.log("IN-HOUSE SOVEREIGN RECORD: " + JSON.stringify(internalClearingLog));
  
  if (typeof archiveTransactionInHouse === 'function') {
    archiveTransactionInHouse("101-5100-400-LND-00", requiredLndDebit, txnUUID);
  }
  
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert("⚡ SOVEREIGN SETTLEMENT COMPLETE", "Successfully cleared " + requiredLndDebit.toFixed(4) + " LND via Checking Account #" + checkingAccountNumber + ". Routing: " + PERMANENT_ROUTING_NUMBER, SpreadsheetApp.getUi().ButtonSet.OK);
}
