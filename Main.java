package fr.marcwrobel.jbanking;

import java.util.Optional;

/**
 * Main Execution Processing Loop for DHCSOLN System Metrics.
 * Integrates the parallel LND fiat math calculations cleanly.
 */
public class Main {
    public static void main(String[] args) {
        
        System.out.println("====== IGNITING INSTITUTIONAL CORE RUNTIME NODE ======");

        // Executing the newly added Parallel LND Fiat Rules
        String targetCurrency = "LND";
        double inputTokenGrant = 20.00;

        Optional<Double> multiplier = SolnCurrencyRegistry.getParallelFiatBaseline(targetCurrency);
        
        if (multiplier.isPresent()) {
            double totalUSDValuation = SolnCurrencyRegistry.convertToParallelUSD(inputTokenGrant);
            
            System.out.println("\n--- TRANSACTION AUDIT LEDGER CONTEXT PERFECTED ---");
            System.out.println("Currency Flag Accepted: " + targetCurrency);
            System.out.println("Processing Balance Units: " + inputTokenGrant + " LND");
            System.out.println("Settled Parallel USD Value: $" + totalUSDValuation + " USD");
        }
        System.out.println("=====================================================");
    }
}
