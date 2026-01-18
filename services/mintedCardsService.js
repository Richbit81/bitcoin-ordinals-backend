/**
 * 💣 BOMBENSICHER: Minted Cards Service
 * Verwaltet alle geminteten Karten mit 3-Ebenen-System:
 * 1. PostgreSQL (primär) - Hashlist aller Karten
 * 2. Registry (Cache) - Schneller Zugriff
 * 3. Blockchain (Fallback) - Letzte Instanz
 */

import { getPool, isDatabaseAvailable } from './db.js';
import * as delegateRegistry from './delegateRegistry.js';

/**
 * 💣 EBENE 1: Speichere gemintete Karte in DB (bombensicher)
 * @param {Object} cardData - Kartendaten
 * @param {string} cardData.inscriptionId - Finale oder temp ID (pending-...)
 * @param {string} cardData.cardId - Karten-ID (z.B. "TIGER-001")
 * @param {string} cardData.cardName - Kartenname
 * @param {string} cardData.rarity - Seltenheit
 * @param {string} cardData.walletAddress - Wallet-Adresse
 * @param {string} [cardData.packType] - Pack-Typ (z.B. "starter-pack")
 * @param {string} [cardData.collectionId] - Collection-ID
 * @param {string} [cardData.originalInscriptionId] - Original-ID
 * @param {string} [cardData.cardType] - Karten-Typ
 * @param {string} [cardData.effect] - Effekt
 * @param {string} [cardData.svgIcon] - SVG-Icon
 * @param {string} [cardData.txid] - Transaction ID
 */
export async function saveMintedCard(cardData) {
  const isPending = cardData.inscriptionId.startsWith('pending-');
  const status = isPending ? 'pending' : 'confirmed';
  
  console.log(`[MintedCards] 💾 Saving ${status} card: ${cardData.cardName} (${cardData.inscriptionId})`);
  
  // ✅ EBENE 1: PostgreSQL (primär)
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const query = `
        INSERT INTO minted_cards (
          inscription_id, temp_id, card_id, card_name, rarity,
          pack_type, collection_id, wallet_address,
          original_inscription_id, card_type, effect, svg_icon,
          status, txid, confirmed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (inscription_id) 
        DO UPDATE SET
          status = EXCLUDED.status,
          confirmed_at = EXCLUDED.confirmed_at,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;
      
      const values = [
        cardData.inscriptionId,
        isPending ? cardData.inscriptionId : null,
        cardData.cardId,
        cardData.cardName,
        cardData.rarity,
        cardData.packType || null,
        cardData.collectionId || null,
        cardData.walletAddress,
        cardData.originalInscriptionId || null,
        cardData.cardType || null,
        cardData.effect || null,
        cardData.svgIcon || null,
        status,
        cardData.txid || null,
        isPending ? null : new Date()
      ];
      
      const result = await pool.query(query, values);
      console.log(`[MintedCards] ✅ DB: Saved ${status} card ${cardData.cardName}`);
      
      // ✅ EBENE 2: Registry (nur confirmed)
      if (!isPending) {
        try {
          delegateRegistry.registerDelegate(
            cardData.inscriptionId,
            cardData.originalInscriptionId,
            cardData.cardId,
            cardData.cardName,
            cardData.rarity,
            cardData.walletAddress,
            cardData.cardType,
            cardData.effect,
            cardData.svgIcon
          );
          console.log(`[MintedCards] ✅ Registry: Cached ${cardData.cardName}`);
        } catch (regErr) {
          console.warn(`[MintedCards] ⚠️ Registry failed (non-critical):`, regErr.message);
        }
      }
      
      return result.rows[0];
    } catch (dbErr) {
      console.error(`[MintedCards] ❌ DB error:`, dbErr);
      throw dbErr;
    }
  }
  
  // ❌ Keine DB - Fallback auf Registry
  console.warn(`[MintedCards] ⚠️ DB not available, using Registry only`);
  if (!isPending) {
    delegateRegistry.registerDelegate(
      cardData.inscriptionId,
      cardData.originalInscriptionId,
      cardData.cardId,
      cardData.cardName,
      cardData.rarity,
      cardData.walletAddress,
      cardData.cardType,
      cardData.effect,
      cardData.svgIcon
    );
  }
  
  return cardData;
}

/**
 * 💣 BOMBENSICHER: Update pending → confirmed
 * @param {string} tempId - Temporäre ID (pending-...)
 * @param {string} finalInscriptionId - Finale Inscription ID
 * @param {string} [txid] - Transaction ID
 */
export async function updatePendingToConfirmed(tempId, finalInscriptionId, txid = null) {
  console.log(`[MintedCards] 🔄 Updating: ${tempId} → ${finalInscriptionId}`);
  
  if (!isDatabaseAvailable()) {
    console.warn(`[MintedCards] ⚠️ DB not available, using Registry only`);
    // Fallback: Registry update
    try {
      delegateRegistry.updateDelegateInscriptionId(tempId, finalInscriptionId);
      return { success: true, method: 'registry' };
    } catch (err) {
      console.error(`[MintedCards] ❌ Registry update failed:`, err);
      return { success: false, error: err.message };
    }
  }
  
  try {
    const pool = getPool();
    
    // Hole Card-Daten aus temp_id
    const selectQuery = `
      SELECT * FROM minted_cards 
      WHERE temp_id = $1 OR inscription_id = $1
      LIMIT 1
    `;
    const selectResult = await pool.query(selectQuery, [tempId]);
    
    if (selectResult.rows.length === 0) {
      console.warn(`[MintedCards] ⚠️ No card found with temp_id: ${tempId}`);
      return { success: false, error: 'Card not found' };
    }
    
    const cardData = selectResult.rows[0];
    
    // Update: Setze finale ID + confirmed Status
    const updateQuery = `
      UPDATE minted_cards 
      SET inscription_id = $1,
          status = 'confirmed',
          confirmed_at = CURRENT_TIMESTAMP,
          txid = COALESCE($2, txid),
          updated_at = CURRENT_TIMESTAMP
      WHERE temp_id = $3 OR inscription_id = $3
      RETURNING *
    `;
    
    const updateResult = await pool.query(updateQuery, [
      finalInscriptionId,
      txid,
      tempId
    ]);
    
    console.log(`[MintedCards] ✅ DB: Updated to confirmed: ${finalInscriptionId}`);
    
    // Update Registry
    try {
      delegateRegistry.updateDelegateInscriptionId(tempId, finalInscriptionId);
      console.log(`[MintedCards] ✅ Registry: Updated ${tempId} → ${finalInscriptionId}`);
    } catch (regErr) {
      console.warn(`[MintedCards] ⚠️ Registry update failed (non-critical):`, regErr.message);
    }
    
    // Registriere finale ID in Registry (falls noch nicht vorhanden)
    try {
      delegateRegistry.registerDelegate(
        finalInscriptionId,
        cardData.original_inscription_id,
        cardData.card_id,
        cardData.card_name,
        cardData.rarity,
        cardData.wallet_address,
        cardData.card_type,
        cardData.effect,
        cardData.svg_icon
      );
    } catch (regErr) {
      // Ignoriere "already exists" Fehler
      if (!regErr.message?.includes('already')) {
        console.warn(`[MintedCards] ⚠️ Registry register failed (non-critical):`, regErr.message);
      }
    }
    
    return {
      success: true,
      method: 'database',
      card: updateResult.rows[0]
    };
  } catch (dbErr) {
    console.error(`[MintedCards] ❌ DB update error:`, dbErr);
    throw dbErr;
  }
}

/**
 * 💣 BOMBENSICHER: Hole alle Karten eines Wallets (mit 3-Ebenen-Fallback)
 * @param {string} walletAddress - Wallet-Adresse
 * @param {boolean} confirmedOnly - Nur bestätigte Karten
 * @returns {Array} Array von Karten
 */
export async function getWalletCards(walletAddress, confirmedOnly = true) {
  console.log(`[MintedCards] 🔍 Getting cards for ${walletAddress} (confirmedOnly: ${confirmedOnly})`);
  
  // ✅ EBENE 1: PostgreSQL (primär, bombensicher)
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const query = `
        SELECT 
          inscription_id as "inscriptionId",
          card_id as "cardId",
          card_name as "name",
          rarity,
          pack_type as "packType",
          collection_id as "collectionId",
          wallet_address as "walletAddress",
          original_inscription_id as "originalInscriptionId",
          card_type as "cardType",
          effect,
          svg_icon as "svgIcon",
          status,
          minted_at as "mintedAt",
          confirmed_at as "confirmedAt"
        FROM minted_cards
        WHERE wallet_address = $1
        ${confirmedOnly ? "AND status = 'confirmed'" : ''}
        ORDER BY minted_at DESC
      `;
      
      const result = await pool.query(query, [walletAddress]);
      console.log(`[MintedCards] ✅ DB: Found ${result.rows.length} cards (${confirmedOnly ? 'confirmed only' : 'all'})`);
      
      return result.rows.map(card => ({
        delegateInscriptionId: card.inscriptionId,
        cardId: card.cardId,
        name: card.name,
        rarity: card.rarity,
        packType: card.packType,
        collectionId: card.collectionId,
        walletAddress: card.walletAddress,
        originalInscriptionId: card.originalInscriptionId,
        cardType: card.cardType,
        effect: card.effect,
        svgIcon: card.svgIcon,
        status: card.status,
        timestamp: card.confirmedAt || card.mintedAt
      }));
    } catch (dbErr) {
      console.error(`[MintedCards] ❌ DB error, falling back to Registry:`, dbErr);
      // Fallback zu Ebene 2
    }
  }
  
  // ⚠️ EBENE 2: Registry (Cache-Fallback)
  console.log(`[MintedCards] 📋 Falling back to Registry...`);
  try {
    const cards = delegateRegistry.getDelegatesByWallet(walletAddress);
    console.log(`[MintedCards] ✅ Registry: Found ${cards.length} cards`);
    return cards;
  } catch (regErr) {
    console.error(`[MintedCards] ❌ Registry error:`, regErr);
    return [];
  }
}

/**
 * 💣 BOMBENSICHER: Bulk Save (für Pack Minting)
 * @param {Array} cardsArray - Array von Kartendaten
 * @returns {Object} { saved: number, failed: number, errors: [] }
 */
export async function saveMintedCardsBulk(cardsArray) {
  console.log(`[MintedCards] 💾 Bulk saving ${cardsArray.length} cards...`);
  
  const results = {
    saved: 0,
    failed: 0,
    errors: []
  };
  
  for (const cardData of cardsArray) {
    try {
      await saveMintedCard(cardData);
      results.saved++;
    } catch (err) {
      results.failed++;
      results.errors.push({
        card: cardData.cardName,
        error: err.message
      });
      console.error(`[MintedCards] ❌ Failed to save ${cardData.cardName}:`, err);
    }
  }
  
  console.log(`[MintedCards] ✅ Bulk save complete: ${results.saved} saved, ${results.failed} failed`);
  return results;
}

/**
 * 💣 BOMBENSICHER: Prüfe ob Inscription ID existiert
 * @param {string} inscriptionId - Inscription ID
 * @returns {boolean}
 */
export async function cardExists(inscriptionId) {
  if (!isDatabaseAvailable()) {
    // Fallback: Registry
    return delegateRegistry.isRegisteredDelegate(inscriptionId);
  }
  
  try {
    const pool = getPool();
    const query = `
      SELECT COUNT(*) as count
      FROM minted_cards
      WHERE inscription_id = $1 OR temp_id = $1
    `;
    const result = await pool.query(query, [inscriptionId]);
    return parseInt(result.rows[0].count) > 0;
  } catch (err) {
    console.error(`[MintedCards] ❌ cardExists error:`, err);
    return false;
  }
}
