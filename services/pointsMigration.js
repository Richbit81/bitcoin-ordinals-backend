/**
 * 💎 PUNKTESYSTEM MIGRATION
 * Migriert bestehende Points von JSON zu PostgreSQL
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, isDatabaseAvailable } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POINTS_FILE = path.join(__dirname, '../data/points.json');
const MIGRATION_FLAG_FILE = path.join(__dirname, '../data/.points_migration_done');

/**
 * Lade Points aus JSON (falls vorhanden)
 */
function loadPointsFromJSON() {
  try {
    if (!fs.existsSync(POINTS_FILE)) {
      console.log('[PointsMigration] No points.json file found, nothing to migrate');
      return {};
    }
    
    const data = fs.readFileSync(POINTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[PointsMigration] ❌ Error loading points.json:', error);
    return {};
  }
}

/**
 * 💎 Migriere Points von JSON zu PostgreSQL
 */
export async function migratePointsJSONToDB() {
  // Prüfe ob Migration bereits durchgeführt wurde
  if (fs.existsSync(MIGRATION_FLAG_FILE)) {
    console.log('[PointsMigration] ✅ Migration bereits durchgeführt, überspringe');
    return { success: true, alreadyDone: true };
  }
  
  // Prüfe ob DB verfügbar ist
  if (!isDatabaseAvailable()) {
    console.warn('[PointsMigration] ⚠️ DB not available, skipping migration');
    return { success: false, error: 'Database not available' };
  }
  
  console.log('[PointsMigration] 🚀 Starte Migration von points.json zu PostgreSQL...');
  
  const pointsData = loadPointsFromJSON();
  const walletAddresses = Object.keys(pointsData);
  
  if (walletAddresses.length === 0) {
    console.log('[PointsMigration] ✅ Keine Punkte zum Migrieren gefunden');
    // Erstelle Flag-File auch wenn keine Daten da sind
    fs.writeFileSync(MIGRATION_FLAG_FILE, new Date().toISOString());
    return { success: true, migratedCount: 0 };
  }
  
  console.log(`[PointsMigration] Gefunden: ${walletAddresses.length} Wallets mit Punkten`);
  
  const pool = getPool();
  let migratedCount = 0;
  let errorCount = 0;
  
  for (const walletAddress of walletAddresses) {
    const userData = pointsData[walletAddress];
    
    try {
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Insert wallet points
        await client.query(`
          INSERT INTO points (wallet_address, total_points, first_mint_at, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (wallet_address) DO NOTHING
        `, [
          walletAddress,
          userData.total || 0,
          userData.firstMint ? new Date(userData.firstMint) : null,
          userData.createdAt ? new Date(userData.createdAt) : new Date(),
          userData.lastActivity ? new Date(userData.lastActivity) : new Date()
        ]);
        
        // Insert history entries
        if (userData.history && Array.isArray(userData.history)) {
          for (const historyEntry of userData.history) {
            await client.query(`
              INSERT INTO points_history (wallet_address, points, reason, details, created_at)
              VALUES ($1, $2, $3, $4, $5)
            `, [
              walletAddress,
              historyEntry.points || 0,
              historyEntry.reason || 'unknown',
              JSON.stringify(historyEntry.details || {}),
              historyEntry.timestamp ? new Date(historyEntry.timestamp) : new Date()
            ]);
          }
        }
        
        await client.query('COMMIT');
        migratedCount++;
        console.log(`[PointsMigration] ✅ Migriert: ${walletAddress} (${userData.total} Punkte, ${userData.history?.length || 0} History-Einträge)`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`[PointsMigration] ❌ Fehler bei Migration von ${walletAddress}:`, error);
      errorCount++;
    }
  }
  
  console.log(`[PointsMigration] 🎉 Migration abgeschlossen:`);
  console.log(`   ✅ Erfolgreich migriert: ${migratedCount} Wallets`);
  console.log(`   ❌ Fehler: ${errorCount} Wallets`);
  
  // Erstelle Flag-File
  fs.writeFileSync(MIGRATION_FLAG_FILE, new Date().toISOString());
  console.log('[PointsMigration] 💾 Migration-Flag erstellt');
  
  return {
    success: true,
    migratedCount,
    errorCount
  };
}

/**
 * Reset Migration (nur für Testing/Development)
 */
export function resetMigrationFlag() {
  if (fs.existsSync(MIGRATION_FLAG_FILE)) {
    fs.unlinkSync(MIGRATION_FLAG_FILE);
    console.log('[PointsMigration] 🔄 Migration-Flag zurückgesetzt');
  }
}
