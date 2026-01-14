/**
 * Collection Service für Backend
 * Verwaltet Kollektionen von Ordinals
 * JETZT MIT PostgreSQL Support für persistente Speicherung
 * BOMBENSICHER: Dual-Write (PostgreSQL + JSON) für maximale Sicherheit
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, isDatabaseAvailable } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');

// Stelle sicher, dass data-Verzeichnis existiert
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Lade Collections Daten (JSON Fallback)
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
 * Speichere Collections Daten (JSON Fallback)
 */
function saveCollections(data) {
  try {
    fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[CollectionService] Error saving collections file:', error);
    throw error;
  }
}

// Exportiere für Admin-Endpoints
export { loadCollections, saveCollections };

/**
 * Erstelle eine neue Kollektion
 * BOMBENSICHER: Speichert IMMER in PostgreSQL UND JSON (Dual-Write)
 */
export async function createCollection(data) {
  // Wenn ID vorhanden, verwende sie (für Restore), sonst erstelle neue
  const newCollection = {
    id: data.id || `collection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: data.name,
    description: data.description || '',
    thumbnail: data.thumbnail || '',
    price: parseFloat(data.price) || 0,
    items: data.items || [],
    category: data.category || 'default',
    page: data.page || null,
    mintType: data.mintType || 'individual',
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: data.active !== false,
  };
  
  let dbSuccess = false;
  let jsonSuccess = false;
  
  // BOMBENSICHER: Speichere IMMER in PostgreSQL wenn verfügbar
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      await pool.query(`
        INSERT INTO collections (id, name, description, thumbnail, price, category, page, mint_type, items, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          thumbnail = EXCLUDED.thumbnail,
          price = EXCLUDED.price,
          category = EXCLUDED.category,
          page = EXCLUDED.page,
          mint_type = EXCLUDED.mint_type,
          items = EXCLUDED.items,
          active = EXCLUDED.active,
          updated_at = EXCLUDED.updated_at
      `, [
        newCollection.id,
        newCollection.name,
        newCollection.description,
        newCollection.thumbnail,
        newCollection.price,
        newCollection.category,
        newCollection.page,
        newCollection.mintType,
        JSON.stringify(newCollection.items),
        newCollection.active,
        newCollection.createdAt,
        newCollection.updatedAt,
      ]);
      dbSuccess = true;
      console.log(`[CollectionService] ✅ Collection saved to PostgreSQL: ${newCollection.id}`);
    } catch (error) {
      console.error('[CollectionService] ❌ Error saving to PostgreSQL:', error);
      dbSuccess = false;
    }
  }
  
  // BOMBENSICHER: Speichere IMMER auch in JSON (Dual-Write für maximale Sicherheit)
  try {
    const collectionsData = loadCollections();
    // Entferne alte Collection mit gleicher ID falls vorhanden
    collectionsData.collections = collectionsData.collections.filter(c => c.id !== newCollection.id);
    collectionsData.collections.push(newCollection);
    saveCollections(collectionsData);
    jsonSuccess = true;
    console.log(`[CollectionService] ✅ Collection saved to JSON: ${newCollection.id}`);
  } catch (error) {
    console.error('[CollectionService] ❌ Error saving to JSON:', error);
    jsonSuccess = false;
  }
  
  // Wenn beide fehlschlagen, werfe Fehler
  if (!dbSuccess && !jsonSuccess) {
    throw new Error('Failed to save collection to both PostgreSQL and JSON');
  }
  
  // Wenn nur einer fehlschlägt, logge Warnung aber returniere trotzdem
  if (!dbSuccess) {
    console.warn(`[CollectionService] ⚠️ Collection saved only to JSON (PostgreSQL failed): ${newCollection.id}`);
  }
  if (!jsonSuccess) {
    console.warn(`[CollectionService] ⚠️ Collection saved only to PostgreSQL (JSON failed): ${newCollection.id}`);
  }
  
  console.log(`[CollectionService] ✅ Collection created: ${newCollection.id} - ${newCollection.name}`);
  return newCollection;
}

/**
 * Hole alle aktiven Kollektionen
 * Unterstützt Filterung nach category, page oder beidem
 */
export async function getAllCollections(category = null, page = null) {
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      let query = 'SELECT * FROM collections WHERE active = true';
      const params = [];
      let paramIndex = 1;
      
      if (category) {
        query += ` AND category = $${paramIndex}`;
        params.push(category);
        paramIndex++;
      }
      
      if (page) {
        query += ` AND page = $${paramIndex}`;
        params.push(page);
        paramIndex++;
      }
      
      query += ' ORDER BY created_at DESC';
      
      const result = await pool.query(query, params);
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description || '',
        thumbnail: row.thumbnail || '',
        price: parseFloat(row.price) || 0,
        items: row.items || [],
        category: row.category || 'default',
        page: row.page || null,
        mintType: row.mint_type || 'individual',
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
        updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
        active: row.active !== false,
      }));
    } catch (error) {
      console.error('[CollectionService] ❌ Error loading from PostgreSQL:', error);
      // Fallback zu JSON
    }
  }
  
  // JSON Fallback
  const collectionsData = loadCollections();
  let collections = collectionsData.collections.filter(collection => collection.active);
  
  if (category) {
    collections = collections.filter(c => (c.category || 'default') === category);
  }
  
  if (page) {
    collections = collections.filter(c => c.page === page);
  }
  
  return collections.map(c => ({
    ...c,
    page: c.page || null,
    mintType: c.mintType || 'individual', // Default für alte Collections
  }));
}

/**
 * Hole eine spezifische Kollektion
 */
export async function getCollection(collectionId) {
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const result = await pool.query('SELECT * FROM collections WHERE id = $1 AND active = true', [collectionId]);
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          id: row.id,
          name: row.name,
          description: row.description || '',
          thumbnail: row.thumbnail || '',
          price: parseFloat(row.price) || 0,
          items: row.items || [],
          category: row.category || 'default',
          page: row.page || null,
          mintType: row.mint_type || 'individual',
          createdAt: row.created_at?.toISOString() || new Date().toISOString(),
          updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
          active: row.active !== false,
        };
      }
    } catch (error) {
      console.error('[CollectionService] ❌ Error loading from PostgreSQL:', error);
      // Fallback zu JSON
    }
  }
  
  // JSON Fallback
  const collectionsData = loadCollections();
  const collection = collectionsData.collections.find(c => c.id === collectionId && c.active);
  
  if (collection) {
    return {
      ...collection,
      page: collection.page || null,
      mintType: collection.mintType || 'individual', // Default für alte Collections
    };
  }
  
  return null;
}

/**
 * Aktualisiere eine Kollektion
 * BOMBENSICHER: Aktualisiert IMMER PostgreSQL UND JSON (Dual-Write)
 */
export async function updateCollection(collectionId, updates) {
  const updatedCollection = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  let dbSuccess = false;
  let jsonSuccess = false;
  
  // BOMBENSICHER: Aktualisiere IMMER in PostgreSQL wenn verfügbar
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      await pool.query(`
        UPDATE collections SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          thumbnail = COALESCE($3, thumbnail),
          price = COALESCE($4, price),
          category = COALESCE($5, category),
          page = COALESCE($6, page),
          mint_type = COALESCE($7, mint_type),
          items = COALESCE($8, items),
          active = COALESCE($9, active),
          updated_at = $10
        WHERE id = $11
      `, [
        updates.name || null,
        updates.description !== undefined ? updates.description : null,
        updates.thumbnail !== undefined ? updates.thumbnail : null,
        updates.price !== undefined ? parseFloat(updates.price) : null,
        updates.category || null,
        updates.page !== undefined ? updates.page : null,
        updates.mintType || null,
        updates.items ? JSON.stringify(updates.items) : null,
        updates.active !== undefined ? updates.active : null,
        updatedCollection.updatedAt,
        collectionId,
      ]);
      dbSuccess = true;
      console.log(`[CollectionService] ✅ Collection updated in PostgreSQL: ${collectionId}`);
    } catch (error) {
      console.error('[CollectionService] ❌ Error updating in PostgreSQL:', error);
      dbSuccess = false;
    }
  }
  
  // BOMBENSICHER: Aktualisiere IMMER auch in JSON (Dual-Write)
  try {
    const collectionsData = loadCollections();
    const collection = collectionsData.collections.find(c => c.id === collectionId);
    if (collection) {
      Object.assign(collection, updatedCollection);
      saveCollections(collectionsData);
      jsonSuccess = true;
      console.log(`[CollectionService] ✅ Collection updated in JSON: ${collectionId}`);
    } else {
      console.warn(`[CollectionService] ⚠️ Collection not found in JSON for update: ${collectionId}`);
    }
  } catch (error) {
    console.error('[CollectionService] ❌ Error updating in JSON:', error);
    jsonSuccess = false;
  }
  
  // Wenn beide fehlschlagen, werfe Fehler
  if (!dbSuccess && !jsonSuccess) {
    throw new Error(`Failed to update collection ${collectionId} in both PostgreSQL and JSON`);
  }
  
  // Wenn nur einer fehlschlägt, logge Warnung
  if (!dbSuccess) {
    console.warn(`[CollectionService] ⚠️ Collection updated only in JSON (PostgreSQL failed): ${collectionId}`);
  }
  if (!jsonSuccess) {
    console.warn(`[CollectionService] ⚠️ Collection updated only in PostgreSQL (JSON failed): ${collectionId}`);
  }
  
  return updatedCollection;
}

/**
 * Deaktiviere eine Kollektion (soft delete)
 */
export async function deactivateCollection(collectionId) {
  return await updateCollection(collectionId, { active: false });
}

/**
 * Hole alle Kollektionen (auch inaktive) - für Admin
 */
export async function getAllCollectionsAdmin(category = null) {
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      let query = 'SELECT * FROM collections';
      const params = [];
      
      if (category) {
        query += ' WHERE category = $1';
        params.push(category);
      }
      
      query += ' ORDER BY created_at DESC';
      
      const result = await pool.query(query, params);
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description || '',
        thumbnail: row.thumbnail || '',
        price: parseFloat(row.price) || 0,
        items: row.items || [],
        category: row.category || 'default',
        page: row.page || null,
        mintType: row.mint_type || 'individual',
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
        updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
        active: row.active !== false,
      }));
    } catch (error) {
      console.error('[CollectionService] ❌ Error loading from PostgreSQL:', error);
      // Fallback zu JSON
    }
  }
  
  // JSON Fallback
  const collectionsData = loadCollections();
  let collections = collectionsData.collections;
  
  if (category) {
    collections = collections.filter(c => (c.category || 'default') === category);
  }
  
  return collections.map(c => ({
    ...c,
    page: c.page || null,
    mintType: c.mintType || 'individual', // Default für alte Collections
  }));
}

/**
 * Migriere Collections von JSON zu PostgreSQL
 */
export async function migrateCollectionsToDB() {
  if (!isDatabaseAvailable()) {
    console.log('[CollectionService] ⚠️ Database not available, skipping migration');
    return;
  }
  
  const pool = getPool();
  
  // Prüfe ob Migration bereits durchgeführt wurde
  const migrationCheck = await pool.query(
    'SELECT * FROM migration_status WHERE migration_name = $1',
    ['collections_json_to_db']
  );
  
  if (migrationCheck.rows.length > 0 && migrationCheck.rows[0].completed) {
    console.log('[CollectionService] ✅ Collections migration already completed');
    return;
  }
  
  // Prüfe ob bereits Collections in DB existieren
  const existingCount = await pool.query('SELECT COUNT(*) FROM collections');
  if (parseInt(existingCount.rows[0].count) > 0) {
    console.log('[CollectionService] ✅ Collections already exist in database, skipping migration');
    await pool.query(`
      INSERT INTO migration_status (id, migration_name, completed, completed_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (migration_name) DO UPDATE SET completed = $3, completed_at = $4
    `, [
      `migration-${Date.now()}`,
      'collections_json_to_db',
      true,
      new Date().toISOString(),
    ]);
    return;
  }
  
  console.log('[CollectionService] 🔄 Starting collections migration from JSON to PostgreSQL...');
  
  try {
    const collectionsData = loadCollections();
    const collections = collectionsData.collections || [];
    
    if (collections.length === 0) {
      console.log('[CollectionService] ⚠️ No collections to migrate');
      await pool.query(`
        INSERT INTO migration_status (id, migration_name, completed, completed_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (migration_name) DO UPDATE SET completed = $3, completed_at = $4
      `, [
        `migration-${Date.now()}`,
        'collections_json_to_db',
        true,
        new Date().toISOString(),
      ]);
      return;
    }
    
    for (const collection of collections) {
      await pool.query(`
        INSERT INTO collections (id, name, description, thumbnail, price, category, page, mint_type, items, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
      `, [
        collection.id,
        collection.name,
        collection.description || '',
        collection.thumbnail || '',
        parseFloat(collection.price) || 0,
        collection.category || 'default',
        collection.page || null,
        collection.mintType || 'individual',
        JSON.stringify(collection.items || []),
        collection.active !== false,
        collection.createdAt || new Date().toISOString(),
        collection.updatedAt || new Date().toISOString(),
      ]);
    }
    
    console.log(`[CollectionService] ✅ Migrated ${collections.length} collections to PostgreSQL`);
    
    // Markiere Migration als abgeschlossen
    await pool.query(`
      INSERT INTO migration_status (id, migration_name, completed, completed_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (migration_name) DO UPDATE SET completed = $3, completed_at = $4
    `, [
      `migration-${Date.now()}`,
      'collections_json_to_db',
      true,
      new Date().toISOString(),
    ]);
  } catch (error) {
    console.error('[CollectionService] ❌ Error during migration:', error);
    throw error;
  }
}
