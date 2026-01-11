/**
 * Point Shop Service für Backend
 * Verwaltet Point Shop Items (Delegate-Inskriptionen die gegen Punkte gemintet werden können)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const POINT_SHOP_FILE = path.join(DATA_DIR, 'pointShop.json');

// Stelle sicher, dass data-Verzeichnis existiert
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Lade Point Shop Daten
 */
function loadPointShop() {
  if (fs.existsSync(POINT_SHOP_FILE)) {
    try {
      const data = fs.readFileSync(POINT_SHOP_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('[PointShop] Error loading point shop file:', error);
      return { items: [] };
    }
  }
  return { items: [] };
}

/**
 * Speichere Point Shop Daten
 */
function savePointShop(data) {
  try {
    fs.writeFileSync(POINT_SHOP_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[PointShop] Error saving point shop file:', error);
    throw error;
  }
}

/**
 * Füge ein neues Point Shop Item hinzu
 * @param {string} inscriptionId - Delegate-Inskription-ID (für delegate) oder Original-Inskription-ID (für original)
 * @param {string} itemType - 'delegate' oder 'original'
 * @param {string} title - Titel des Items
 * @param {string} description - Beschreibung
 * @param {number} pointsCost - Punkte-Kosten
 */
export function addPointShopItem(inscriptionId, itemType, title, description, pointsCost) {
  const data = loadPointShop();
  
  // Validiere itemType
  if (itemType !== 'delegate' && itemType !== 'original') {
    throw new Error('Invalid itemType. Must be "delegate" or "original"');
  }
  
  const newItem = {
    id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    itemType: itemType, // 'delegate' oder 'original'
    title,
    description: description || '',
    pointsCost: parseInt(pointsCost, 10),
    createdAt: new Date().toISOString(),
    active: true,
  };
  
  // Je nach Typ das entsprechende Feld setzen
  if (itemType === 'delegate') {
    newItem.delegateInscriptionId = inscriptionId;
  } else {
    newItem.originalInscriptionId = inscriptionId;
  }
  
  data.items.push(newItem);
  savePointShop(data);
  console.log(`[PointShop] ✅ Item hinzugefügt: ${newItem.id} - ${title} (Type: ${itemType})`);
  return newItem;
}

/**
 * Hole alle aktiven Point Shop Items
 */
export function getPointShopItems() {
  const data = loadPointShop();
  return data.items.filter(item => item.active);
}

/**
 * Hole ein spezifisches Point Shop Item
 */
export function getPointShopItem(itemId) {
  const data = loadPointShop();
  return data.items.find(item => item.id === itemId && item.active);
}

/**
 * Aktualisiere ein Point Shop Item
 */
export function updatePointShopItem(itemId, updates) {
  const data = loadPointShop();
  const item = data.items.find(item => item.id === itemId);
  if (item) {
    Object.assign(item, updates);
    savePointShop(data);
    console.log(`[PointShop] ✅ Item aktualisiert: ${itemId}`);
    return item;
  }
  return null;
}

/**
 * Lösche ein Point Shop Item (setzt active auf false)
 */
export function deletePointShopItem(itemId) {
  const data = loadPointShop();
  const item = data.items.find(item => item.id === itemId);
  if (item) {
    item.active = false;
    savePointShop(data);
    console.log(`[PointShop] ✅ Item deaktiviert: ${itemId}`);
    return true;
  }
  return false;
}

/**
 * Füge eine Serie hinzu (mehrere Inskriptionen → ein Item mit "1/N - N/N")
 * @param {string[]} inscriptionIds - Array von Inskription-IDs
 * @param {string} title - Titel der Serie
 * @param {string} description - Beschreibung
 * @param {number} pointsCost - Punkte-Kosten pro Mint
 * @param {number} totalCount - Gesamtanzahl (wird normalerweise aus inscriptionIds.length berechnet)
 * @param {string} inscriptionItemType - 'delegate' oder 'original' (Typ der Inskriptionen in der Serie)
 */
export function addPointShopSeries(inscriptionIds, title, description, pointsCost, totalCount, inscriptionItemType = 'original') {
  const data = loadPointShop();
  
  if (!Array.isArray(inscriptionIds) || inscriptionIds.length === 0) {
    throw new Error('inscriptionIds must be a non-empty array');
  }
  
  const finalTotalCount = totalCount || inscriptionIds.length;
  
  const item = {
    id: `series-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    itemType: 'series',
    inscriptionIds: inscriptionIds,
    currentIndex: 0,
    totalCount: finalTotalCount,
    seriesTitle: `${title} (1/${finalTotalCount} - ${finalTotalCount}/${finalTotalCount})`,
    inscriptionItemType: inscriptionItemType, // 'delegate' oder 'original'
    title: title,
    description: description || '',
    pointsCost: parseInt(pointsCost, 10),
    createdAt: new Date().toISOString(),
    active: true,
  };
  
  data.items.push(item);
  savePointShop(data);
  console.log(`[PointShop] ✅ Serie hinzugefügt: ${item.id} - ${title} (${inscriptionIds.length} Items, Type: ${inscriptionItemType})`);
  return item;
}

/**
 * Füge mehrere Items auf einmal hinzu (Bulk - jede Inskription wird zu einem separaten Item)
 * @param {string} itemType - 'delegate' oder 'original'
 * @param {string[]} inscriptionIds - Array von Inskription-IDs
 * @param {string} baseTitle - Basistitel (wird für jedes Item verwendet, z.B. "Exclusive Art #1", "Exclusive Art #2")
 * @param {string} description - Beschreibung
 * @param {number} pointsCost - Punkte-Kosten pro Item
 */
export function addPointShopBulk(itemType, inscriptionIds, baseTitle, description, pointsCost) {
  const data = loadPointShop();
  
  if (itemType !== 'delegate' && itemType !== 'original') {
    throw new Error('Invalid itemType. Must be "delegate" or "original"');
  }
  
  if (!Array.isArray(inscriptionIds) || inscriptionIds.length === 0) {
    throw new Error('inscriptionIds must be a non-empty array');
  }
  
  const items = [];
  
  inscriptionIds.forEach((inscriptionId, index) => {
    const item = {
      id: `bulk-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
      itemType: itemType,
      title: `${baseTitle} #${index + 1}`,
      description: description || '',
      pointsCost: parseInt(pointsCost, 10),
      createdAt: new Date().toISOString(),
      active: true,
    };
    
    // Je nach Typ das entsprechende Feld setzen
    if (itemType === 'delegate') {
      item.delegateInscriptionId = inscriptionId;
    } else {
      item.originalInscriptionId = inscriptionId;
    }
    
    data.items.push(item);
    items.push(item);
  });
  
  savePointShop(data);
  console.log(`[PointShop] ✅ ${items.length} Bulk-Items hinzugefügt: "${baseTitle}" (Type: ${itemType})`);
  return items;
}

/**
 * Hole die nächste Inskription aus einer Serie (sequenziell)
 * @param {string} itemId - Item-ID der Serie
 * @returns {Object} - { inscriptionId, currentNumber, totalCount, inscriptionItemType } oder null
 */
export function getNextSeriesInscription(itemId) {
  const data = loadPointShop();
  const item = data.items.find(item => item.id === itemId && item.active);
  
  if (!item || item.itemType !== 'series') {
    return null;
  }
  
  if (item.currentIndex >= item.inscriptionIds.length) {
    return null; // Serie ist ausverkauft
  }
  
  const currentInscriptionId = item.inscriptionIds[item.currentIndex];
  const currentNumber = item.currentIndex + 1; // 1-based für Anzeige
  
  // Update currentIndex (nächste Ausgabe)
  item.currentIndex += 1;
  savePointShop(data);
  
  return {
    inscriptionId: currentInscriptionId,
    currentNumber: currentNumber,
    totalCount: item.totalCount,
    inscriptionItemType: item.inscriptionItemType || 'original',
    remaining: item.totalCount - item.currentIndex,
  };
}

