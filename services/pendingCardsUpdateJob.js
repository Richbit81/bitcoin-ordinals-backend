/**
 * 💣 BOMBENSICHER: Automatisches Update von pending → confirmed Cards
 * Läuft alle 5 Minuten und prüft:
 * 1. Hole alle pending Cards (älter als 5 Minuten)
 * 2. Scanne Wallet für neue Inscriptions
 * 3. Matche Delegate-Metadaten mit pending Cards
 * 4. Update pending → confirmed
 */

import * as mintedCardsService from './mintedCardsService.js';
import * as blockchainDelegateService from './blockchainDelegateService.js';

let isRunning = false;

/**
 * 💣 BOMBENSICHER: Update Job (wird von Cron aufgerufen)
 */
export async function updatePendingCards() {
  // Verhindere parallele Ausführung
  if (isRunning) {
    console.log(`[PendingUpdate] ⚠️ Job already running, skipping...`);
    return { skipped: true };
  }
  
  isRunning = true;
  const startTime = Date.now();
  
  console.log(`[PendingUpdate] 🔄 Starting pending cards update job...`);
  
  const stats = {
    checked: 0,
    updated: 0,
    failed: 0,
    errors: []
  };
  
  try {
    // Hole alle pending Cards (älter als 5 Minuten)
    const pendingCards = await mintedCardsService.getPendingCards(5, 50);
    
    if (pendingCards.length === 0) {
      console.log(`[PendingUpdate] ✅ No pending cards to update`);
      isRunning = false;
      return { ...stats, message: 'No pending cards' };
    }
    
    console.log(`[PendingUpdate] 📋 Found ${pendingCards.length} pending cards to check`);
    
    // Gruppiere nach Wallet-Adresse (für Batch-Scan)
    const cardsByWallet = {};
    pendingCards.forEach(card => {
      if (!cardsByWallet[card.walletAddress]) {
        cardsByWallet[card.walletAddress] = [];
      }
      cardsByWallet[card.walletAddress].push(card);
    });
    
    console.log(`[PendingUpdate] 👛 Processing ${Object.keys(cardsByWallet).length} wallets...`);
    
    // Prüfe jede Wallet
    for (const [walletAddress, cards] of Object.entries(cardsByWallet)) {
      console.log(`[PendingUpdate] 🔍 Scanning wallet ${walletAddress} (${cards.length} pending cards)...`);
      
      try {
        // Hole ALLE Inscriptions von diesem Wallet
        const allInscriptions = await blockchainDelegateService.getAllInscriptionsByAddress(walletAddress);
        console.log(`[PendingUpdate] 📊 Found ${allInscriptions.length} total inscriptions in wallet`);
        
        // Prüfe nur die neuesten (letzte 100)
        const recentInscriptions = allInscriptions.slice(0, 100);
        
        for (const ins of recentInscriptions) {
          stats.checked++;
          
          try {
            // Prüfe ob diese Inscription bereits in DB ist
            const exists = await mintedCardsService.cardExists(ins.inscriptionId);
            if (exists) {
              continue; // Bereits bekannt
            }
            
            // Hole Content der Inscription
            const content = await blockchainDelegateService.getInscriptionContent(ins.inscriptionId);
            
            if (!content) {
              continue; // Kein Content
            }
            
            // Extrahiere Delegate-Metadaten
            const metadata = mintedCardsService.extractDelegateMetadata(content);
            
            if (!metadata || !metadata.cardId) {
              continue; // Keine gültigen Metadaten
            }
            
            console.log(`[PendingUpdate] ✅ Found delegate: ${metadata.cardName} (${ins.inscriptionId})`);
            
            // Suche matching pending Card in diesem Wallet
            const matchingCard = cards.find(card => 
              card.cardId === metadata.cardId &&
              card.walletAddress === walletAddress
            );
            
            if (matchingCard) {
              console.log(`[PendingUpdate] 🎯 Matched: ${matchingCard.cardName} → ${ins.inscriptionId}`);
              
              // Update: pending → confirmed
              const updateResult = await mintedCardsService.updatePendingToConfirmed(
                matchingCard.inscriptionId, // temp ID
                ins.inscriptionId,          // finale ID
                ins.txid
              );
              
              if (updateResult.success) {
                stats.updated++;
                console.log(`[PendingUpdate] ✅ Updated ${matchingCard.cardName} to confirmed`);
                
                // Entferne aus Liste (bereits updated)
                const index = cards.indexOf(matchingCard);
                if (index > -1) {
                  cards.splice(index, 1);
                }
              } else {
                stats.failed++;
                stats.errors.push({
                  card: matchingCard.cardName,
                  error: updateResult.error
                });
              }
            } else {
              console.log(`[PendingUpdate] ⚠️ No matching pending card for: ${metadata.cardName}`);
            }
            
          } catch (insErr) {
            console.error(`[PendingUpdate] ❌ Error processing inscription ${ins.inscriptionId}:`, insErr.message);
            stats.failed++;
            stats.errors.push({
              inscription: ins.inscriptionId,
              error: insErr.message
            });
          }
        }
        
      } catch (walletErr) {
        console.error(`[PendingUpdate] ❌ Error scanning wallet ${walletAddress}:`, walletErr.message);
        stats.failed += cards.length;
        stats.errors.push({
          wallet: walletAddress,
          error: walletErr.message
        });
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[PendingUpdate] ✅ Job complete in ${duration}s: ${stats.updated} updated, ${stats.failed} failed, ${stats.checked} checked`);
    
    isRunning = false;
    return { ...stats, duration, message: 'Job complete' };
    
  } catch (error) {
    isRunning = false;
    console.error(`[PendingUpdate] ❌ Job failed:`, error);
    stats.errors.push({
      global: error.message
    });
    return { ...stats, error: error.message };
  }
}

/**
 * Manual Trigger API (für Testing)
 */
export async function triggerManualUpdate() {
  console.log(`[PendingUpdate] 🔧 Manual trigger requested`);
  return await updatePendingCards();
}
