/**
 * 🧹 DB CLEANUP SCRIPT
 * Entfernt fehlerhafte Einträge (Tech & Games Karten mit Black & Wild IDs)
 * 
 * ⚠️ VORSICHT: Dieses Script löscht Daten! Nur mit Admin-Berechtigung ausführen!
 */

import { getPool, isDatabaseAvailable } from '../services/db.js';
import { BLACK_AND_WILD_CONFIG } from '../config/projects/black-and-wild.js';

const BLACK_WILD_IDS = BLACK_AND_WILD_CONFIG.originals.map(o => o.inscriptionId);

// Karten die NICHT zu Black & Wild gehören, aber fälschlicherweise deren IDs haben
const CORRUPTED_CARD_NAMES = [
  'BLOCKTRIS', 'TimeBIT', 'Slot Machine',
  // Diese haben möglicherweise die falschen IDs, prüfen wir separat:
  // 'Cat', 'Gecko', 'Grasshopper', 'Koala' 
];

export async function analyzeCorruptedData() {
  if (!isDatabaseAvailable()) {
    console.error('[Cleanup] ❌ Database not available');
    return null;
  }

  const pool = getPool();
  
  try {
    console.log('[Cleanup] 🔍 Analyzing corrupted data...\n');
    
    // 1. Finde alle Tech & Games Karten mit Black & Wild IDs
    const result = await pool.query(`
      SELECT 
        id,
        inscription_id,
        card_name,
        original_inscription_id,
        pack_type,
        collection_id,
        wallet_address,
        status,
        minted_at
      FROM minted_cards 
      WHERE card_name = ANY($1::text[])
        AND original_inscription_id = ANY($2::text[])
      ORDER BY minted_at DESC
    `, [CORRUPTED_CARD_NAMES, BLACK_WILD_IDS]);
    
    console.log(`[Cleanup] 📊 Found ${result.rows.length} corrupted entries:\n`);
    
    if (result.rows.length > 0) {
      console.table(result.rows.map(row => ({
        ID: row.id,
        CardName: row.card_name,
        InscriptionID: row.inscription_id.substring(0, 20) + '...',
        OriginalID: row.original_inscription_id.substring(0, 20) + '...',
        Status: row.status,
        Wallet: row.wallet_address.substring(0, 15) + '...',
        MintedAt: new Date(row.minted_at).toISOString().split('T')[0]
      })));
      
      console.log('\n[Cleanup] ⚠️ These entries have WRONG originalInscriptionId values!');
      console.log('[Cleanup] ⚠️ They reference Black & Wild cards but are Tech & Games cards.\n');
    } else {
      console.log('[Cleanup] ✅ No corrupted entries found!\n');
    }
    
    return {
      corruptedEntries: result.rows,
      count: result.rows.length
    };
  } catch (error) {
    console.error('[Cleanup] ❌ Analysis failed:', error);
    return null;
  }
}

export async function deleteCorruptedData(dryRun = true) {
  if (!isDatabaseAvailable()) {
    console.error('[Cleanup] ❌ Database not available');
    return false;
  }

  const pool = getPool();
  
  try {
    if (dryRun) {
      console.log('[Cleanup] 🔍 DRY RUN MODE - No data will be deleted\n');
      const analysis = await analyzeCorruptedData();
      
      if (analysis && analysis.count > 0) {
        console.log(`[Cleanup] ⚠️ Would delete ${analysis.count} entries`);
        console.log('[Cleanup] 💡 Run with dryRun=false to actually delete\n');
      }
      
      return true;
    }
    
    // ECHTES LÖSCHEN
    console.log('[Cleanup] ⚠️⚠️⚠️ REAL DELETE MODE - Data will be permanently deleted! ⚠️⚠️⚠️\n');
    console.log('[Cleanup] Waiting 5 seconds... Press Ctrl+C to cancel\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const result = await pool.query(`
      DELETE FROM minted_cards 
      WHERE card_name = ANY($1::text[])
        AND original_inscription_id = ANY($2::text[])
      RETURNING id, card_name, inscription_id
    `, [CORRUPTED_CARD_NAMES, BLACK_WILD_IDS]);
    
    console.log(`[Cleanup] ✅ Deleted ${result.rows.length} corrupted entries`);
    
    if (result.rows.length > 0) {
      console.log('\n[Cleanup] Deleted entries:');
      result.rows.forEach(row => {
        console.log(`  - ${row.card_name} (${row.inscription_id})`);
      });
    }
    
    // Cleanup auch in delegate-registry.json (manuell erforderlich)
    console.log('\n[Cleanup] ⚠️ WICHTIG: Bereinige auch data/delegate-registry.json manuell!');
    console.log('[Cleanup] 📝 Entferne dort alle Einträge mit card_name in:', CORRUPTED_CARD_NAMES);
    
    return true;
  } catch (error) {
    console.error('[Cleanup] ❌ Cleanup failed:', error);
    return false;
  }
}

// Helper: Zeige alle Karten mit ihren originalInscriptionIds
export async function showAllCardsWithOriginals() {
  if (!isDatabaseAvailable()) {
    console.error('[Cleanup] ❌ Database not available');
    return;
  }

  const pool = getPool();
  
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        card_name,
        original_inscription_id,
        COUNT(*) as count
      FROM minted_cards 
      WHERE original_inscription_id IS NOT NULL
      GROUP BY card_name, original_inscription_id
      ORDER BY card_name
    `);
    
    console.log('\n[Cleanup] 📊 All cards with their originalInscriptionIds:\n');
    console.table(result.rows);
    
    // Prüfe welche davon zu Black & Wild gehören
    console.log('\n[Cleanup] 🐻 Cards with Black & Wild IDs:\n');
    const blackWildCards = result.rows.filter(row => 
      BLACK_WILD_IDS.includes(row.original_inscription_id)
    );
    console.table(blackWildCards);
    
  } catch (error) {
    console.error('[Cleanup] ❌ Failed to show cards:', error);
  }
}

// Wenn direkt ausgeführt
if (import.meta.url === `file://${process.argv[1]}`) {
  import('../services/db.js').then(async ({ initDatabase }) => {
    initDatabase();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  🧹 DB CLEANUP UTILITY - Corrupted Data Analysis');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    const command = process.argv[2] || 'analyze';
    
    switch (command) {
      case 'analyze':
        await analyzeCorruptedData();
        break;
      case 'show-all':
        await showAllCardsWithOriginals();
        break;
      case 'delete-dry-run':
        await deleteCorruptedData(true);
        break;
      case 'delete':
        await deleteCorruptedData(false);
        break;
      default:
        console.log('Usage:');
        console.log('  node scripts/cleanup-corrupted-data.js analyze        - Analyze corrupted data');
        console.log('  node scripts/cleanup-corrupted-data.js show-all       - Show all cards with originals');
        console.log('  node scripts/cleanup-corrupted-data.js delete-dry-run - Dry run deletion');
        console.log('  node scripts/cleanup-corrupted-data.js delete         - REAL deletion (⚠️ DANGER!)');
    }
    
    process.exit(0);
  });
}

export default {
  analyzeCorruptedData,
  deleteCorruptedData,
  showAllCardsWithOriginals
};
