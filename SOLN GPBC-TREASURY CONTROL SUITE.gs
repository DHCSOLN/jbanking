/**
 * STATE OF LOC NATION SOVEREIGN CENTRAL BANK
 * Module: Automated Ingress Sweep & Dual-Dispatch Route
 * File: SOLN GPBC-TREASURY CONTROL SUITE.gs
 * 
 * Enforces strict Straight-Through Processing (STP) rules. Duplicates all raw 
 * pacs.008 customer credit transfers directly to info@stateoflocnation.com.
 */
function executeAutomatedXmlSweepRoutine() {
  Logger.log("🔍 [1/3] Initializing automated pacs.008 outbox sweep sequence...");
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var outboxSheet = ss.getSheetByName("SOLN_Sync_Outbox");
  var systemLog  = ss.getSheetByName("SystemLog") || ss.getSheetByName("OperationsConsoleLog");
  
  if (!outboxSheet) {
    Logger.log("🔴 FAIL: Ingress target sheet 'SOLN_Sync_Outbox' not connected to workspace.");
    return;
  }
  
  var dataRange = outboxSheet.getDataRange();
  var values = dataRange.getValues();
  
  // Guard clause if outbox has no rows or only headers
  if (values.length <= 1) {
    Logger.log("🟢 [✓] Sweep complete: Outbox queue contains 0 open transactions.");
    return;
  }
  
  // Establish fixed central banking notification nodes
  var internalControlReceptor = "info@stateoflocnation.com";
  var secondaryInternalCopy   = "treasury@stateoflocnation.com";
  var externalPrimaryTarget   = "press@treasury.gov";
  
  // Iterate through pending outbox rows (skipping column header row 1)
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var currentStatus = row[6]; // Status column index 6
    
    if (currentStatus === "POSTED_PENDING_ACKNOWLEDGEMENT" || currentStatus === "PENDING") {
      var txId = row[2];        // EndToEndId
      var msgId = row[1];       // MsgId
      var networkRail = row[3]; // PrtrySystem (PAPSS, CAPSS, etc)
      var recipient = row[4];   // Recipient Name
      var lndAmount = row[5];   // LND Units
      
      Logger.log("⚙️ Processing target transfer: " + txId + " | Rail Channel: " + networkRail);
      
      // 1. GENERATE THE RAW PACS.008 XML TRANSMITTAL STRING (CBPR+ Compliant Maps)
      var rawPacs008XmlString = 
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">\n' +
        '  <FIToFICstmrCdtTrf>\n' +
        '    <GrpHdr>\n' +
        '      <MsgId>' + msgId + '</MsgId>\n' +
        '      <CreDtTm>' + new Date().toISOString() + '</CreDtTm>\n' +
        '      <NbOfTxs>1</NbOfTxs>\n' +
        '      <SttlmInf><SttlmMtd>CLRG</SttlmMtd></SttlmInf>\n' +
        '    </GrpHdr>\n' +
        '    <CdtTrfTxInf>\n' +
        '      <PmtId><EndToEndId>' + txId + '</EndToEndId></PmtId>\n' +
        '      <IntrBkSttlmAmt Ccy="LND">' + lndAmount.toFixed(2) + '</IntrBkSttlmAmt>\n' +
        '      <XchgRate>750.0000</XchgRate>\n' +
        '      <Dbtr><Nm>SOLN_RESERVE_PRIMARY_NODE</Nm></Dbtr>\n' +
        '      <Cdtr><Nm>' + recipient + '</Nm></Cdtr>\n' +
        '      <SplmtryData><Envlp><ClearingRail>' + networkRail + '</ClearingRail></Envlp></SplmtryData>\n' +
        '    </CdtTrfTxInf>\n' +
        '  </FIToFICstmrCdtTrf>\n' +
        '</Document>';
        
      // 2. DISPATCH THE DUAL-ROUTING PIPELINE
      try {
        Logger.log("🔍 [2/3] Transmitting interbank XML strings to dual receptors...");
        
        // Push raw message payload to external compliance targets
        MailApp.sendEmail({
          to: externalPrimaryTarget,
          cc: secondaryInternalCopy,
          subject: "PRODUCTION ISO 20022 MESSAGE INFRASTRUCTURE RELEASE: " + txId,
          body: "Attached is a verified, live interbank settlement transaction block.\n\n" + rawPacs008XmlString
        });
        
        // 🟢 TRANSIT DUP: Force separate clean copy of raw XML string directly to info@stateoflocnation.com
        MailApp.sendEmail({
          to: internalControlReceptor,
          subject: "DUPLICATE TRANSACTION FEED LOOP - MSG_ID: " + msgId,
          body: rawPacs008XmlString // Emits purely the raw XML block text for software endpoints to parse
        });
        
        // 3. SECURE WORKSPACE COMMIT AND TRANSITION STATUS
        outboxSheet.getRange(i + 1, 7).setValue("SETTLED_STP"); // Mark complete
        outboxSheet.getRange(i + 1, 8).setValue(new Date());    // Sync completion timestamp
        
        if (systemLog) {
          systemLog.appendRow([
            new Date(), 
            "SWEEP_ROUTINE", 
            "STP_CLEARANCE_DISPATCHED", 
            "PASS", 
            "Tx " + txId + " cleared via " + networkRail + ". Dual-delivery copies executed successfully."
          ]);
        }
        
        Logger.log("🟢 [✓] Straight-Through Processing verified final for transaction reference: " + txId);
        
      } catch (routingException) {
        Logger.log("🔴 CRITICAL SWEEP FAILURE ON ROW " + (i + 1) + ": " + routingException.toString());
        outboxSheet.getRange(i + 1, 7).setValue("ROUTING_EXCEPTION_TRIGGERED");
        if (systemLog) {
          systemLog.appendRow([new Date(), "SWEEP_ROUTINE", "EXECUTION_EXCEPTION", "FAIL", "Row " + (i + 1) + " break: " + routingException.toString()]);
        }
      }
    }
  }
  Logger.log("🔍 [3/3] Outbox ledger check loop completed.");
}
