/**
 * Collection Service für Backend
 * Verwaltet Kollektionen von Ordinals
 * JETZT MIT PostgreSQL Support für persistente Speicherung
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

// Exportiere für Admin-Endpoints
export { loadCollections };

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

/**
 * Erstelle eine neue Kollektion
 */
export async function createCollection(data) {
  const newCollection = {
    id: `collection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: data.name,
    description: data.description || '',
    thumbnail: data.thumbnail || '',
    price: parseFloat(data.price) || 0,
    items: data.items || [],
    category: data.category || 'default',
    mintType: data.mintType || 'individual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: true,
  };
  
  // Speichere in PostgreSQL wenn verfügbar
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      await pool.query(`
        INSERT INTO collections (id, name, description, thumbnail, price, category, mint_type, items, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          thumbnail = EXCLUDED.thumbnail,
          price = EXCLUDED.price,
          category = EXCLUDED.category,
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
        newCollection.mintType,
        JSON.stringify(newCollection.items),
        newCollection.active,
        newCollection.createdAt,
        newCollection.updatedAt,
      ]);
      console.log(`[CollectionService] ✅ Collection saved to PostgreSQL: ${newCollection.id}`);
    } catch (error) {
      console.error('[CollectionService] ❌ Error saving to PostgreSQL:', error);
      // Fallback zu JSON
      const collectionsData = loadCollections();
      collectionsData.collections.push(newCollection);
      saveCollections(collectionsData);
    }
  } else {
    // JSON Fallback
    const collectionsData = loadCollections();
    collectionsData.collections.push(newCollection);
    saveCollections(collectionsData);
  }
  
  console.log(`[CollectionService] ✅ Collection created: ${newCollection.id} - ${newCollection.name}`);
  return newCollection;
}

/**
 * Hole alle aktiven Kollektionen
 */
export async function getAllCollections(category = null) {
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      let query = 'SELECT * FROM collections WHERE active = true';
      const params = [];
      
      if (category) {
        query += ' AND category = $1';
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
  
  return collections.map(c => ({
    ...c,
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
      mintType: collection.mintType || 'individual', // Default für alte Collections
    };
  }
  
  return null;
}

/**
 * Aktualisiere eine Kollektion
 */
export async function updateCollection(collectionId, updates) {
  const updatedCollection = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  // Speichere in PostgreSQL wenn verfügbar
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
          mint_type = COALESCE($6, mint_type),
          items = COALESCE($7, items),
          active = COALESCE($8, active),
          updated_at = $9
        WHERE id = $10
      `, [
        updates.name || null,
        updates.description !== undefined ? updates.description : null,
        updates.thumbnail !== undefined ? updates.thumbnail : null,
        updates.price !== undefined ? parseFloat(updates.price) : null,
        updates.category || null,
        updates.mintType || null,
        updates.items ? JSON.stringify(updates.items) : null,
        updates.active !== undefined ? updates.active : null,
        updatedCollection.updatedAt,
        collectionId,
      ]);
      console.log(`[CollectionService] ✅ Collection updated in PostgreSQL: ${collectionId}`);
    } catch (error) {
      console.error('[CollectionService] ❌ Error updating in PostgreSQL:', error);
      // Fallback zu JSON
      const collectionsData = loadCollections();
      const collection = collectionsData.collections.find(c => c.id === collectionId);
      if (collection) {
        Object.assign(collection, updatedCollection);
        saveCollections(collectionsData);
      }
    }
  } else {
    // JSON Fallback
    const collectionsData = loadCollections();
    const collection = collectionsData.collections.find(c => c.id === collectionId);
    if (collection) {
      Object.assign(collection, updatedCollection);
      saveCollections(collectionsData);
    }
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
        INSERT INTO collections (id, name, description, thumbnail, price, category, mint_type, items, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING
      `, [
        collection.id,
        collection.name,
        collection.description || '',
        collection.thumbnail || '',
        parseFloat(collection.price) || 0,
        collection.category || 'default',
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
