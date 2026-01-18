import * as bitcoin from 'bitcoinjs-lib';
import { 
  signPSBTWithAdmin, 
  createTransferPSBT, 
  broadcastPresignedTx,
  finalizeSignedPSBT
} from './ordinalTransferService.js';

/**
 * =====================================
 * MARKETPLACE LISTING SERVICE
 * Ord-Dropz Style Pre-Signed PSBTs
 * =====================================
 * 
 * Use-Case:
 * 1. Admin erstellt und signiert PSBT VORHER
 * 2. PSBT wird gespeichert (mit Preis)
 * 3. User kauft SPÄTER
 * 4. User fügt eigene Inputs für Zahlung + Fees hinzu
 * 5. User signiert seine Inputs
 * 6. User broadcastet die komplette Transaction
 * 
 * SigHash: SIGHASH_SINGLE | SIGHASH_ANYONECANPAY
 * - Signiert nur korrespondierenden Output (Input 0 → Output 0)
 * - Erlaubt anderen, weitere Inputs hinzuzufügen
 */

/**
 * Erstellt und signiert eine PSBT für Marketplace-Listing
 * 
 * @param {string} inscriptionId - Die Inscription ID
 * @param {string} buyerAddress - Adresse des Käufers (wohin die Inscription geht)
 * @param {string} sellerAddress - Adresse des Verkäufers (für Zahlungsempfang)
 * @param {number} priceInSats - Preis in Satoshis
 * @param {number} feeRate - Fee Rate (optional, default 5)
 * @returns {object} - { signedPsbtBase64, inscriptionId, sellerAddress, priceInSats, ... }
 */
export async function createMarketplaceListing(inscriptionId, buyerAddress, sellerAddress, priceInSats, feeRate = 5) {
  console.log('[MarketplaceListing] ========================================');
  console.log('[MarketplaceListing] 🏪 Creating Marketplace Listing');
  console.log('[MarketplaceListing] ========================================');
  console.log(`[MarketplaceListing] Inscription: ${inscriptionId}`);
  console.log(`[MarketplaceListing] Buyer (receives inscription): ${buyerAddress}`);
  console.log(`[MarketplaceListing] Seller (receives payment): ${sellerAddress}`);
  console.log(`[MarketplaceListing] Price: ${priceInSats} sats`);
  console.log(`[MarketplaceListing] Fee Rate: ${feeRate} sat/vB`);
  
  try {
    // Schritt 1: Erstelle unsigned PSBT
    // Output 0: Inscription (546 sats) → Buyer
    console.log(`[MarketplaceListing] Step 1: Creating unsigned PSBT...`);
    const { psbt, ownerAddress } = await createTransferPSBT(inscriptionId, buyerAddress, feeRate);
    
    console.log(`[MarketplaceListing] ✅ Unsigned PSBT created`);
    console.log(`[MarketplaceListing]   - Input: Inscription UTXO (owner: ${ownerAddress})`);
    console.log(`[MarketplaceListing]   - Output 0: 546 sats to ${buyerAddress} (inscription)`);
    
    // Schritt 2: Füge Output für Verkäufer-Zahlung hinzu
    // Output 1: Preis → Seller
    console.log(`[MarketplaceListing] Step 2: Adding seller payment output...`);
    psbt.addOutput({
      address: sellerAddress,
      value: BigInt(priceInSats),
    });
    console.log(`[MarketplaceListing] ✅ Added seller payment output:`);
    console.log(`[MarketplaceListing]   - Output 1: ${priceInSats} sats to ${sellerAddress} (payment)`);
    
    console.log(`[MarketplaceListing] PSBT Structure:`);
    console.log(`[MarketplaceListing]   - Inputs: ${psbt.inputCount} (inscription UTXO)`);
    console.log(`[MarketplaceListing]   - Outputs: ${psbt.outputCount}`);
    console.log(`[MarketplaceListing]     • Output 0: 546 sats to buyer (inscription)`);
    console.log(`[MarketplaceListing]     • Output 1: ${priceInSats} sats to seller (payment)`);
    console.log(`[MarketplaceListing]   ⚠️ Buyer must add: own inputs + change output + fees`);
    
    const unsignedPsbtBase64 = psbt.toBase64();
    
    // Schritt 3: Signiere mit SIGHASH_SINGLE | ANYONECANPAY
    console.log(`[MarketplaceListing] Step 3: Signing with SIGHASH_SINGLE|ANYONECANPAY...`);
    console.log(`[MarketplaceListing] 🔐 This allows buyer to add payment inputs later`);
    
    const signedPsbtBase64 = signPSBTWithAdmin(unsignedPsbtBase64, ownerAddress, { 
      sighashType: 'SINGLE_ANYONECANPAY' 
    });
    
    console.log('[MarketplaceListing] ========================================');
    console.log('[MarketplaceListing] ✅ Marketplace listing created successfully');
    console.log('[MarketplaceListing] ========================================');
    console.log('[MarketplaceListing] 📋 Next steps for BUYER:');
    console.log('[MarketplaceListing]   1. Parse this signed PSBT');
    console.log('[MarketplaceListing]   2. Add own UTXO inputs for payment');
    console.log('[MarketplaceListing]   3. Add change output (if needed)');
    console.log('[MarketplaceListing]   4. Add miner fees');
    console.log('[MarketplaceListing]   5. Sign own inputs');
    console.log('[MarketplaceListing]   6. Finalize and broadcast');
    console.log('[MarketplaceListing] ========================================');
    
    return {
      success: true,
      signedPsbtBase64,
      inscriptionId,
      buyerAddress,
      sellerAddress,
      priceInSats,
      ownerAddress,
      inputCount: psbt.inputCount,
      outputCount: psbt.outputCount,
      message: 'Pre-signed PSBT ready for marketplace. Buyer must add payment inputs and finalize.'
    };
  } catch (error) {
    console.error('[MarketplaceListing] ❌ Error creating marketplace listing:', error);
    throw error;
  }
}

/**
 * Bulk-Erstellung von Marketplace-Listings
 * Wie bei Ord-Dropz: Signiert 100 Inscriptions auf einmal
 * 
 * @param {Array} inscriptions - Array von { inscriptionId, buyerAddress, sellerAddress, priceInSats }
 * @param {number} feeRate - Fee Rate (optional)
 * @returns {Array} - Array von { signedPsbtBase64, inscriptionId, ... }
 */
export async function createBulkMarketplaceListings(inscriptions, feeRate = 5) {
  console.log('[MarketplaceListing] ========================================');
  console.log(`[MarketplaceListing] 🏪 Creating ${inscriptions.length} Marketplace Listings (BULK)`);
  console.log('[MarketplaceListing] ========================================');
  
  const results = [];
  const errors = [];
  
  for (let i = 0; i < inscriptions.length; i++) {
    const inscription = inscriptions[i];
    console.log(`[MarketplaceListing] Processing ${i + 1}/${inscriptions.length}: ${inscription.inscriptionId}`);
    
    try {
      const result = await createMarketplaceListing(
        inscription.inscriptionId,
        inscription.buyerAddress,
        inscription.sellerAddress,
        inscription.priceInSats,
        feeRate
      );
      results.push(result);
    } catch (error) {
      console.error(`[MarketplaceListing] ❌ Failed to create listing for ${inscription.inscriptionId}:`, error.message);
      errors.push({
        inscriptionId: inscription.inscriptionId,
        error: error.message
      });
    }
  }
  
  console.log('[MarketplaceListing] ========================================');
  console.log(`[MarketplaceListing] ✅ Bulk listing creation complete`);
  console.log(`[MarketplaceListing]   - Successful: ${results.length}/${inscriptions.length}`);
  console.log(`[MarketplaceListing]   - Failed: ${errors.length}/${inscriptions.length}`);
  console.log('[MarketplaceListing] ========================================');
  
  return {
    success: errors.length === 0,
    results,
    errors,
    summary: {
      total: inscriptions.length,
      successful: results.length,
      failed: errors.length
    }
  };
}

/**
 * Buyer komplettiert den Kauf (Client-Side)
 * Diese Funktion zeigt, was der Buyer machen muss
 * (In der Realität wird das im Frontend implementiert)
 * 
 * @param {string} signedPsbtBase64 - Die vorsignierte PSBT vom Seller
 * @param {object} buyerPayment - { utxos, changeAddress, keyPair }
 * @returns {string} - Transaction Hex (ready to broadcast)
 */
export async function completePurchase(signedPsbtBase64, buyerPayment) {
  console.log('[MarketplaceListing] ========================================');
  console.log('[MarketplaceListing] 💰 Buyer completing purchase...');
  console.log('[MarketplaceListing] ========================================');
  
  try {
    // Parse the pre-signed PSBT
    const psbt = bitcoin.Psbt.fromBase64(signedPsbtBase64, { network: bitcoin.networks.bitcoin });
    
    console.log(`[MarketplaceListing] Pre-signed PSBT:`);
    console.log(`[MarketplaceListing]   - Inputs: ${psbt.inputCount} (inscription, already signed)`);
    console.log(`[MarketplaceListing]   - Outputs: ${psbt.outputCount}`);
    
    // TODO: Add buyer's payment inputs
    // TODO: Add buyer's change output
    // TODO: Sign buyer's inputs
    // TODO: Finalize all inputs
    // TODO: Extract and return transaction hex
    
    console.log('[MarketplaceListing] ⚠️ completePurchase is not yet implemented');
    console.log('[MarketplaceListing] This will be implemented in the frontend using sats-connect or unisat');
    
    return {
      success: false,
      message: 'Buyer-side completion to be implemented in frontend'
    };
  } catch (error) {
    console.error('[MarketplaceListing] ❌ Error completing purchase:', error);
    throw error;
  }
}
