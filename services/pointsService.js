/**
 * Punkte-Service für Wallet-basierte Punkte-Verwaltung
 * 💎 BOMBENSICHER: Dual-Write (PostgreSQL + JSON Fallback)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, isDatabaseAvailable } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 💎 Punkte-Konfiguration (VOLLSTÄNDIG)
export const POINTS_CONFIG = {
  'starter-pack': 5,       // 5 Punkte pro Starter Pack
  'premium-pack': 100,     // 100 Punkte pro Premium Pack
  'normal-mint': 5,        // 5 Punkte pro normaler Collection Mint
  'premium-mint': 10,      // 10 Punkte pro Premium Collection Mint
  'trade': 5,              // 5 Punkte pro abgeschlossener Trade
  'first-mint': 5,         // Bonus für ersten Mint
  'referral': 20,          // Punkte für Empfehlung (später)
  'daily-login': 1,        // Täglicher Login-Bonus (später)
  'game-win': 5,           // Punkte für Spiel-Sieg (später)
};

// Punkte-Datei
const DATA_DIR = path.join(__dirname, '../data');
const POINTS_FILE = path.join(DATA_DIR, 'points.json');

// Stelle sicher, dass data-Verzeichnis existiert
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Lade Punkte-Daten
 */
function loadPoints() {
  if (fs.existsSync(POINTS_FILE)) {
    try {
      const data = fs.readFileSync(POINTS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading points file:', error);
      return {};
    }
  }
  return {}; // { walletAddress: { total: 0, history: [] } }
}

/**
 * Speichere Punkte-Daten
 */
function savePoints(pointsData) {
  try {
    fs.writeFileSync(POINTS_FILE, JSON.stringify(pointsData, null, 2));
  } catch (error) {
    console.error('Error saving points file:', error);
    throw error;
  }
}

/**
 * 💎 BOMBENSICHER: Füge Punkte hinzu (mit DB + JSON Dual-Write)
 */
export async function addPoints(walletAddress, points, reason, details = {}) {
  let result = { total: 0, added: points, bonus: 0 };
  
  // ✅ EBENE 1: PostgreSQL (primär, bombensicher)
  if (isDatabaseAvailable()) {
    try {
      result = await addPointsDB(walletAddress, points, reason, details);
      console.log(`[Points] ✅ DB: Added ${points} points (+ ${result.bonus} bonus) to ${walletAddress}. Total: ${result.total}`);
    } catch (dbErr) {
      console.error(`[Points] ❌ DB error, falling back to JSON:`, dbErr);
      // Fallback zu JSON
      result = addPointsJSON(walletAddress, points, reason, details);
    }
  } else {
    // ⚠️ EBENE 2: JSON Fallback
    console.warn(`[Points] ⚠️ DB not available, using JSON`);
    result = addPointsJSON(walletAddress, points, reason, details);
  }
  
  return result;
}

/**
 * 💎 Füge Punkte hinzu (PostgreSQL)
 */
async function addPointsDB(walletAddress, points, reason, details) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Upsert: Erstelle oder update wallet points
    const upsertResult = await client.query(`
      INSERT INTO points (wallet_address, total_points, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (wallet_address) 
      DO UPDATE SET 
        total_points = points.total_points + $2,
        updated_at = CURRENT_TIMESTAMP
      RETURNING total_points, first_mint_at
    `, [walletAddress, points]);
    
    let totalPoints = parseInt(upsertResult.rows[0].total_points);
    const firstMintAt = upsertResult.rows[0].first_mint_at;
    
    // Insert history entry
    await client.query(`
      INSERT INTO points_history (wallet_address, points, reason, details)
      VALUES ($1, $2, $3, $4)
    `, [walletAddress, points, reason, JSON.stringify(details)]);
    
    // Check first mint bonus
    let bonus = 0;
    const isFirstMint = !firstMintAt && (reason.includes('mint') || reason.includes('minted'));
    
    if (isFirstMint) {
      bonus = POINTS_CONFIG['first-mint'];
      await client.query(`
        UPDATE points 
        SET first_mint_at = CURRENT_TIMESTAMP,
            total_points = total_points + $1
        WHERE wallet_address = $2
      `, [bonus, walletAddress]);
      
      await client.query(`
        INSERT INTO points_history (wallet_address, points, reason, details)
        VALUES ($1, $2, $3, $4)
      `, [walletAddress, bonus, 'first-mint-bonus', JSON.stringify({})]);
      
      totalPoints += bonus;
    }
    
    await client.query('COMMIT');
    
    return {
      total: totalPoints,
      added: points,
      bonus: bonus
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 💎 Füge Punkte hinzu (JSON Fallback)
 */
function addPointsJSON(walletAddress, points, reason, details) {
  const pointsData = loadPoints();
  
  if (!pointsData[walletAddress]) {
    pointsData[walletAddress] = {
      total: 0,
      history: [],
      firstMint: null,
      createdAt: new Date().toISOString()
    };
  }
  
  const userPoints = pointsData[walletAddress];
  const isFirstMint = !userPoints.firstMint && (reason.includes('mint') || reason.includes('minted'));
  
  // Füge Punkte hinzu
  userPoints.total += points;
  
  let bonus = 0;
  // Erste Mint-Bonus
  if (isFirstMint) {
    bonus = POINTS_CONFIG['first-mint'];
    userPoints.firstMint = new Date().toISOString();
    userPoints.total += bonus;
    userPoints.history.push({
      points: bonus,
      reason: 'first-mint-bonus',
      timestamp: new Date().toISOString(),
      details: {}
    });
  }
  
  // Füge zur Historie hinzu
  userPoints.history.push({
    points,
    reason,
    timestamp: new Date().toISOString(),
    details
  });
  
  // Aktualisiere letzte Aktivität
  userPoints.lastActivity = new Date().toISOString();
  
  savePoints(pointsData);
  
  return {
    total: userPoints.total,
    added: points,
    bonus: bonus
  };
}

/**
 * 💎 BOMBENSICHER: Hole Punkte für Wallet (DB + JSON Fallback)
 */
export async function getPoints(walletAddress) {
  // ✅ EBENE 1: PostgreSQL
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const result = await pool.query(`
        SELECT total_points, first_mint_at, created_at, updated_at
        FROM points
        WHERE wallet_address = $1
      `, [walletAddress]);
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        
        // Hole auch History
        const historyResult = await pool.query(`
          SELECT points, reason, details, created_at
          FROM points_history
          WHERE wallet_address = $1
          ORDER BY created_at DESC
          LIMIT 100
        `, [walletAddress]);
        
        return {
          total: parseInt(row.total_points),
          firstMint: row.first_mint_at,
          createdAt: row.created_at,
          lastActivity: row.updated_at,
          history: historyResult.rows.map(h => ({
            points: h.points,
            reason: h.reason,
            details: h.details,
            timestamp: h.created_at
          }))
        };
      }
      
      // User nicht in DB gefunden
      return {
        total: 0,
        history: [],
        firstMint: null,
        createdAt: null,
        lastActivity: null
      };
    } catch (dbErr) {
      console.error(`[Points] ❌ DB error, falling back to JSON:`, dbErr);
      // Fallback zu JSON
    }
  }
  
  // ⚠️ EBENE 2: JSON Fallback
  const pointsData = loadPoints();
  return pointsData[walletAddress] || {
    total: 0,
    history: [],
    firstMint: null,
    createdAt: null,
    lastActivity: null
  };
}

/**
 * 💎 BOMBENSICHER: Lade alle Punkte-Daten (für Leaderboard)
 */
export async function loadAllPoints() {
  // ✅ EBENE 1: PostgreSQL
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const result = await pool.query(`
        SELECT wallet_address, total_points, first_mint_at, created_at, updated_at
        FROM points
        ORDER BY total_points DESC
      `);
      
      const pointsData = {};
      result.rows.forEach(row => {
        pointsData[row.wallet_address] = {
          total: parseInt(row.total_points),
          firstMint: row.first_mint_at,
          createdAt: row.created_at,
          lastActivity: row.updated_at,
          history: [] // History nicht laden für Leaderboard (Performance)
        };
      });
      
      return pointsData;
    } catch (dbErr) {
      console.error(`[Points] ❌ DB error, falling back to JSON:`, dbErr);
    }
  }
  
  // ⚠️ EBENE 2: JSON Fallback
  return loadPoints();
}



