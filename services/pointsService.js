/**
 * Punkte-Service für Wallet-basierte Punkte-Verwaltung
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Punkte-Konfiguration
export const POINTS_CONFIG = {
  'starter-pack': 5,       // 5 Punkte pro Starter Pack (normales Pack)
  'premium-pack': 100,     // 100 Punkte pro Premium Pack
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
 * Füge Punkte hinzu
 */
export function addPoints(walletAddress, points, reason, details = {}) {
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
  const isFirstMint = !userPoints.firstMint && reason.includes('minted');
  
  // Füge Punkte hinzu
  userPoints.total += points;
  
  // Erste Mint-Bonus
  if (isFirstMint) {
    userPoints.firstMint = new Date().toISOString();
    userPoints.total += POINTS_CONFIG['first-mint'];
    userPoints.history.push({
      points: POINTS_CONFIG['first-mint'],
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
    bonus: isFirstMint ? POINTS_CONFIG['first-mint'] : 0
  };
}

/**
 * Hole Punkte für Wallet
 */
export function getPoints(walletAddress) {
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
 * Lade alle Punkte-Daten (für Leaderboard)
 */
export function loadAllPoints() {
  return loadPoints();
}



