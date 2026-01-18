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
 * WICHTIG: Speichert KEINE pending IDs - nur bestätigte Inscriptions!
 */
export function registerDelegate(delegateInscriptionId, originalInscriptionId, cardId, name, rarity, walletAddress, cardType, effect, svgIcon) {
  // ✅ KRITISCH: Speichere KEINE pending IDs
  if (delegateInscriptionId.startsWith('pending-')) {
    console.log(`[DelegateRegistry] ⚠️ Skipping pending inscription (will be registered when confirmed): ${delegateInscriptionId}`);
    return; // Nicht speichern!
  }
  
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
  console.log(`[DelegateRegistry] ✅ Registered CONFIRMED delegate: ${delegateInscriptionId} -> ${originalInscriptionId} (${name})`);
}

/**
 * Hole alle Delegate-Inskriptionen für eine Wallet-Adresse
 * WICHTIG: Filtert pending IDs raus - nur bestätigte Inscriptions!
 */
export function getDelegatesByWallet(walletAddress) {
  const registry = loadRegistry();
  const allDelegates = Object.entries(registry)
    .filter(([_, data]) => data.walletAddress === walletAddress)
    .map(([delegateInscriptionId, data]) => ({
      delegateInscriptionId,
      ...data,
    }));
  
  // ✅ KRITISCH: Filtere pending IDs raus (nur echte Inscription IDs mit 'i')
  const confirmedDelegates = allDelegates.filter(d => 
    !d.delegateInscriptionId.startsWith('pending-')
  );
  
  const pendingCount = allDelegates.length - confirmedDelegates.length;
  if (pendingCount > 0) {
    console.log(`[DelegateRegistry] ⚠️ Filtered out ${pendingCount} pending inscriptions for ${walletAddress}`);
    console.log(`[DelegateRegistry] ✅ Returning ${confirmedDelegates.length} confirmed delegates`);
  }
  
  return confirmedDelegates;
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

/**
 * Cleanup: Entfernt ALLE pending Inscriptions aus der Registry
 * Sollte regelmäßig aufgerufen werden oder beim Server-Start
 */
export function cleanupPendingDelegates() {
  const registry = loadRegistry();
  const allIds = Object.keys(registry);
  const pendingIds = allIds.filter(id => id.startsWith('pending-'));
  
  if (pendingIds.length === 0) {
    console.log(`[DelegateRegistry] ✅ No pending IDs to clean up`);
    return { cleaned: 0, remaining: allIds.length };
  }
  
  console.log(`[DelegateRegistry] 🧹 Cleaning up ${pendingIds.length} pending IDs from registry...`);
  
  // Lösche alle pending IDs
  pendingIds.forEach(id => {
    delete registry[id];
  });
  
  saveRegistry(registry);
  
  const remainingCount = Object.keys(registry).length;
  console.log(`[DelegateRegistry] ✅ Cleanup complete: Removed ${pendingIds.length} pending, ${remainingCount} confirmed delegates remaining`);
  
  return { 
    cleaned: pendingIds.length, 
    remaining: remainingCount,
    cleanedIds: pendingIds.slice(0, 5) // Zeige erste 5 als Beispiel
  };
}


