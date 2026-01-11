import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Registry-Datei für Delegate-Inskriptionen
const REGISTRY_FILE = path.join(__dirname, '../data/delegate-registry.json');

// Lade Registry
function loadRegistry() {
  if (fs.existsSync(REGISTRY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
    } catch (error) {
      console.error('Error loading delegate registry:', error);
      return {};
    }
  }
  return {}; // { delegateInscriptionId: { originalInscriptionId, cardId, name, rarity, walletAddress, timestamp } }
}

// Speichere Registry
function saveRegistry(registry) {
  const dataDir = path.dirname(REGISTRY_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

/**
 * Registriert eine neue Delegate-Inskription
 */
export function registerDelegate(delegateInscriptionId, originalInscriptionId, cardId, name, rarity, walletAddress, cardType, effect, svgIcon) {
  const registry = loadRegistry();
  registry[delegateInscriptionId] = {
    originalInscriptionId,
    cardId,
    name,
    rarity,
    walletAddress,
    cardType,
    effect,
    svgIcon,
    timestamp: new Date().toISOString(),
  };
  saveRegistry(registry);
  console.log(`[DelegateRegistry] Registered: ${delegateInscriptionId} -> ${originalInscriptionId} (${name})`);
}

/**
 * Hole alle Delegate-Inskriptionen für eine Wallet-Adresse
 */
export function getDelegatesByWallet(walletAddress) {
  const registry = loadRegistry();
  return Object.entries(registry)
    .filter(([_, data]) => data.walletAddress === walletAddress)
    .map(([delegateInscriptionId, data]) => ({
      delegateInscriptionId,
      ...data,
    }));
}

/**
 * Hole alle Delegate-Inskriptionen
 */
export function getAllDelegates() {
  return loadRegistry();
}

/**
 * Prüfe ob eine Inskription-ID eine registrierte Delegate-Inskription ist
 */
export function isRegisteredDelegate(inscriptionId) {
  const registry = loadRegistry();
  return registry.hasOwnProperty(inscriptionId);
}

/**
 * Hole Kartendaten für eine Delegate-Inskription
 */
export function getDelegateCardData(delegateInscriptionId) {
  const registry = loadRegistry();
  return registry[delegateInscriptionId] || null;
}

/**
 * Aktualisiert die Inskription-ID einer Delegate-Inskription
 * (z.B. von "pending-..." zu finaler ID)
 */
export function updateDelegateInscriptionId(oldInscriptionId, newInscriptionId) {
  const registry = loadRegistry();
  if (registry[oldInscriptionId]) {
    // Verschiebe Eintrag von alter zu neuer ID
    registry[newInscriptionId] = {
      ...registry[oldInscriptionId],
      // Behalte timestamp der ursprünglichen Registrierung
    };
    delete registry[oldInscriptionId];
    saveRegistry(registry);
    console.log(`[DelegateRegistry] Updated inscription ID: ${oldInscriptionId} -> ${newInscriptionId}`);
    return true;
  }
  return false;
}


