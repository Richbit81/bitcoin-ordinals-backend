/**
 * Collection Service für Backend
 * Verwaltet Kollektionen von Ordinals
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');

// Stelle sicher, dass data-Verzeichnis existiert
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Lade Collections Daten
 */
function loadCollections() {
  if (fs.existsSync(COLLECTIONS_FILE)) {
    try {
      const data = fs.readFileSync(COLLECTIONS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('[CollectionService] Error loading collections file:', error);
      return { collections: [] };
    }
  }
  return { collections: [] };
}

/**
 * Speichere Collections Daten
 */
function saveCollections(data) {
  try {
    fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[CollectionService] Error saving collections file:', error);
    throw error;
  }
}

/**
 * Erstelle eine neue Kollektion
 */
export function createCollection(data) {
  const collectionsData = loadCollections();
  const newCollection = {
    id: `collection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: data.name,
    description: data.description || '',
    thumbnail: data.thumbnail || '',
    price: parseFloat(data.price) || 0,
    items: data.items || [],
    category: data.category || 'default', // Unterstützung für Kategorien (z.B. 'smileabit')
    mintType: data.mintType || 'individual', // 'individual' = einzeln auswählbar, 'random' = zufällig
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: true,
  };
  
  collectionsData.collections.push(newCollection);
  saveCollections(collectionsData);
  console.log(`[CollectionService] ✅ Collection created: ${newCollection.id} - ${newCollection.name}`);
  return newCollection;
}

/**
 * Hole alle aktiven Kollektionen
 */
export function getAllCollections() {
  const collectionsData = loadCollections();
  return collectionsData.collections.filter(collection => collection.active);
}

/**
 * Hole eine spezifische Kollektion
 */
export function getCollection(collectionId) {
  const collectionsData = loadCollections();
  return collectionsData.collections.find(c => c.id === collectionId && c.active);
}

/**
 * Aktualisiere eine Kollektion
 */
export function updateCollection(collectionId, updates) {
  const collectionsData = loadCollections();
  const collection = collectionsData.collections.find(c => c.id === collectionId);
  
  if (collection) {
    Object.assign(collection, updates, {
      updatedAt: new Date().toISOString(),
    });
    saveCollections(collectionsData);
    console.log(`[CollectionService] ✅ Collection updated: ${collectionId}`);
    return collection;
  }
  
  return null;
}

/**
 * Lösche/Deaktiviere eine Kollektion
 */
export function deleteCollection(collectionId) {
  const collectionsData = loadCollections();
  const collection = collectionsData.collections.find(c => c.id === collectionId);
  
  if (collection) {
    collection.active = false;
    collection.updatedAt = new Date().toISOString();
    saveCollections(collectionsData);
    console.log(`[CollectionService] ✅ Collection deactivated: ${collectionId}`);
    return true;
  }
  
  return false;
}

/**
 * Hole alle Kollektionen (auch inaktive) - für Admin
 */
export function getAllCollectionsAdmin() {
  const collectionsData = loadCollections();
  return collectionsData.collections;
}

