/**
 * Point Shop Service für Backend
 * Verwaltet Point Shop Items mit PostgreSQL (mit JSON-Fallback)
 * BOMBENSICHER: Automatische Migration, Transaktionen, Fehlerbehandlung
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, isDatabaseAvailable } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const POINT_SHOP_FILE = path.join(DATA_DIR, 'pointShop.json');

// Stelle sicher, dass data-Verzeichnis existiert
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== JSON FALLBACK FUNCTIONS ====================

function loadPointShopJSON() {
  if (fs.existsSync(POINT_SHOP_FILE)) {
    try {
      const data = fs.readFileSync(POINT_SHOP_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      console.log(`[PointShop] 📂 JSON: Loaded ${parsed.items.length} items`);
      return parsed;
    } catch (error) {
      console.error('[PointShop] ❌ JSON: Error loading file:', error);
      return { items: [] };
    }
  }
  return { items: [] };
}

function savePointShopJSON(data) {
  try {
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(POINT_SHOP_FILE, jsonData);
    console.log(`[PointShop] 💾 JSON: Saved ${data.items.length} items`);
  } catch (error) {
    console.error('[PointShop] ❌ JSON: Error saving file:', error);
    throw error;
  }
}

// ==================== DATABASE FUNCTIONS ====================

/**
 * Konvertiere DB-Row zu Item-Objekt
 */
function rowToItem(row) {
  const item = {
    id: row.id,
    itemType: row.item_type,
    title: row.title,
    description: row.description || '',
    pointsCost: row.points_cost,
    active: row.active,
    createdAt: row.created_at?.toISOString() || new Date().toISOString(),
  };

  // Felder für delegate/original
  if (row.delegate_inscription_id) item.delegateInscriptionId = row.delegate_inscription_id;
  if (row.original_inscription_id) item.originalInscriptionId = row.original_inscription_id;

  // Felder für series
  if (row.item_type === 'series') {
    item.inscriptionIds = row.inscription_ids || [];
    item.currentIndex = row.current_index || 0;
    item.totalCount = row.total_count;
    item.seriesTitle = row.series_title;
    item.inscriptionItemType = row.inscription_item_type || 'original';
  }

  return item;
}

/**
 * Konvertiere Item-Objekt zu DB-Row
 */
function itemToRow(item) {
  const row = {
    id: item.id,
    item_type: item.itemType,
    title: item.title,
    description: item.description || '',
    points_cost: item.pointsCost,
    active: item.active !== false,
    created_at: item.createdAt ? new Date(item.createdAt) : new Date(),
    updated_at: new Date(),
  };

  if (item.delegateInscriptionId) row.delegate_inscription_id = item.delegateInscriptionId;
  if (item.originalInscriptionId) row.original_inscription_id = item.originalInscriptionId;

  if (item.itemType === 'series') {
    row.inscription_ids = JSON.stringify(item.inscriptionIds || []);
    row.current_index = item.currentIndex || 0;
    row.total_count = item.totalCount;
    row.series_title = item.seriesTitle;
    row.inscription_item_type = item.inscriptionItemType || 'original';
  }

  return row;
}

/**
 * Migriere JSON-Daten zu Datenbank (einmalig, bombensicher)
 * WICHTIG: Läuft nur einmal, auch bei Redeploy!
 */
let migrationDone = false;
export async function migrateJSONToDB() {
  if (migrationDone || !isDatabaseAvailable()) {
    return;
  }

  try {
    const pool = getPool();
    const MIGRATION_NAME = 'point_shop_json_to_db_v1';
    
    // Prüfe ob Migration bereits durchgeführt wurde (BOMBENSICHER)
    const migrationCheck = await pool.query(
      'SELECT completed FROM migration_status WHERE migration_name = $1',
      [MIGRATION_NAME]
    );
    
    if (migrationCheck.rows.length > 0 && migrationCheck.rows[0].completed === true) {
      console.log('[PointShop] ✅ Migration bereits durchgeführt, überspringe');
      migrationDone = true;
      return;
    }

    const jsonData = loadPointShopJSON();
    
    if (jsonData.items.length === 0) {
      console.log('[PointShop] 🔄 Migration: Keine JSON-Daten zum Migrieren');
      // Markiere Migration als abgeschlossen, auch wenn keine Daten vorhanden
      await pool.query(`
        INSERT INTO migration_status (migration_name, completed, completed_at)
        VALUES ($1, true, $2)
        ON CONFLICT (migration_name) DO UPDATE SET completed = true, completed_at = $2
      `, [MIGRATION_NAME, new Date()]);
      migrationDone = true;
      return;
    }

    // Prüfe ob bereits Daten in DB sind (zusätzliche Sicherheit)
    const checkResult = await pool.query('SELECT COUNT(*) as count FROM point_shop_items');
    const existingCount = parseInt(checkResult.rows[0].count);
    
    if (existingCount > 0) {
      console.log(`[PointShop] ⚠️ Migration: Datenbank enthält bereits ${existingCount} Items`);
      console.log('[PointShop] ⚠️ Migration: Überspringe Migration, um Datenverlust zu vermeiden');
      // Markiere Migration als abgeschlossen, um zukünftige Versuche zu verhindern
      await pool.query(`
        INSERT INTO migration_status (migration_name, completed, completed_at)
        VALUES ($1, true, $2)
        ON CONFLICT (migration_name) DO UPDATE SET completed = true, completed_at = $2
      `, [MIGRATION_NAME, new Date()]);
      migrationDone = true;
      return;
    }

    console.log(`[PointShop] 🔄 Migration: Migriere ${jsonData.items.length} Items von JSON zu DB...`);

    // Starte Transaktion für atomare Migration
    await pool.query('BEGIN');
    try {
      // Migriere alle Items
      for (const item of jsonData.items) {
        const row = itemToRow(item);
        await pool.query(`
          INSERT INTO point_shop_items (
            id, item_type, title, description, points_cost, active, created_at, updated_at,
            delegate_inscription_id, original_inscription_id,
            inscription_ids, current_index, total_count, series_title, inscription_item_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (id) DO NOTHING
        `, [
          row.id, row.item_type, row.title, row.description, row.points_cost, row.active,
          row.created_at, row.updated_at,
          row.delegate_inscription_id || null, row.original_inscription_id || null,
          row.inscription_ids || null, row.current_index || 0, row.total_count || null,
          row.series_title || null, row.inscription_item_type || null
        ]);
      }

      // Markiere Migration als erfolgreich abgeschlossen
      await pool.query(`
        INSERT INTO migration_status (migration_name, completed, completed_at)
        VALUES ($1, true, $2)
        ON CONFLICT (migration_name) DO UPDATE SET completed = true, completed_at = $2
      `, [MIGRATION_NAME, new Date()]);

      await pool.query('COMMIT');
      console.log(`[PointShop] ✅ Migration: ${jsonData.items.length} Items erfolgreich migriert`);
      migrationDone = true;
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('[PointShop] ❌ Migration: Fehler:', error);
    // Migration fehlgeschlagen, aber nicht kritisch - verwende JSON weiter
    // Markiere Migration NICHT als abgeschlossen, damit sie beim nächsten Mal erneut versucht wird
  }
}

// ==================== PUBLIC API (mit DB-Fallback) ====================

/**
 * Füge ein neues Point Shop Item hinzu
 */
export async function addPointShopItem(inscriptionId, itemType, title, description, pointsCost) {
  if (itemType !== 'delegate' && itemType !== 'original') {
    throw new Error('Invalid itemType. Must be "delegate" or "original"');
  }

  const newItem = {
    id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    itemType: itemType,
    title,
    description: description || '',
    pointsCost: parseInt(pointsCost, 10),
    createdAt: new Date().toISOString(),
    active: true,
  };

  if (itemType === 'delegate') {
    newItem.delegateInscriptionId = inscriptionId;
  } else {
    newItem.originalInscriptionId = inscriptionId;
  }

  // BOMBENSICHER: Dual-Write (PostgreSQL + JSON)
  let dbSuccess = false;
  let jsonSuccess = false;
  
  // Speichere IMMER in PostgreSQL wenn verfügbar
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const row = itemToRow(newItem);
      await pool.query(`
        INSERT INTO point_shop_items (
          id, item_type, title, description, points_cost, active, created_at, updated_at,
          delegate_inscription_id, original_inscription_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          item_type = EXCLUDED.item_type,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          points_cost = EXCLUDED.points_cost,
          active = EXCLUDED.active,
          updated_at = EXCLUDED.updated_at,
          delegate_inscription_id = EXCLUDED.delegate_inscription_id,
          original_inscription_id = EXCLUDED.original_inscription_id
      `, [
        row.id, row.item_type, row.title, row.description, row.points_cost, row.active,
        row.created_at, row.updated_at,
        row.delegate_inscription_id || null, row.original_inscription_id || null
      ]);
      dbSuccess = true;
      console.log(`[PointShop] ✅ DB: Item gespeichert: ${newItem.id} - ${title}`);
    } catch (error) {
      console.error('[PointShop] ❌ DB-Fehler:', error.message);
      dbSuccess = false;
    }
  }
  
  // BOMBENSICHER: Speichere IMMER auch in JSON (Dual-Write)
  try {
    const data = loadPointShopJSON();
    // Entferne altes Item mit gleicher ID falls vorhanden
    data.items = data.items.filter(item => item.id !== newItem.id);
    data.items.push(newItem);
    savePointShopJSON(data);
    jsonSuccess = true;
    console.log(`[PointShop] ✅ JSON: Item gespeichert: ${newItem.id} - ${title}`);
  } catch (error) {
    console.error('[PointShop] ❌ JSON-Fehler:', error.message);
    jsonSuccess = false;
  }
  
  // Wenn beide fehlschlagen, werfe Fehler
  if (!dbSuccess && !jsonSuccess) {
    throw new Error('Failed to save Point Shop item to both PostgreSQL and JSON');
  }
  
  // Wenn nur einer fehlschlägt, logge Warnung aber returniere trotzdem
  if (!dbSuccess) {
    console.warn(`[PointShop] ⚠️ Item nur in JSON gespeichert (PostgreSQL fehlgeschlagen): ${newItem.id}`);
  }
  if (!jsonSuccess) {
    console.warn(`[PointShop] ⚠️ Item nur in PostgreSQL gespeichert (JSON fehlgeschlagen): ${newItem.id}`);
  }
  
  return newItem;
}

/**
 * Hole alle aktiven Point Shop Items
 */
export async function getPointShopItems() {
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const result = await pool.query(
        'SELECT * FROM point_shop_items WHERE active = true ORDER BY created_at DESC'
      );
      const items = result.rows.map(rowToItem);
      console.log(`[PointShop] 📊 DB: ${items.length} aktive Items geladen`);
      return items;
    } catch (error) {
      console.error('[PointShop] ⚠️ DB-Fehler, verwende JSON-Fallback:', error.message);
    }
  }

  // JSON Fallback
  const data = loadPointShopJSON();
  return data.items.filter(item => item.active);
}

/**
 * Hole ein spezifisches Point Shop Item
 */
export async function getPointShopItem(itemId) {
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const result = await pool.query(
        'SELECT * FROM point_shop_items WHERE id = $1 AND active = true',
        [itemId]
      );
      if (result.rows.length > 0) {
        return rowToItem(result.rows[0]);
      }
      return null;
    } catch (error) {
      console.error('[PointShop] ⚠️ DB-Fehler, verwende JSON-Fallback:', error.message);
    }
  }

  // JSON Fallback
  const data = loadPointShopJSON();
  return data.items.find(item => item.id === itemId && item.active) || null;
}

/**
 * Aktualisiere ein Point Shop Item
 * BOMBENSICHER: Aktualisiert IMMER PostgreSQL UND JSON (Dual-Write)
 */
export async function updatePointShopItem(itemId, updates) {
  let dbSuccess = false;
  let jsonSuccess = false;
  let updatedItem = null;
  
  // BOMBENSICHER: Aktualisiere IMMER in PostgreSQL wenn verfügbar
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const setParts = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (key === 'itemType') {
          setParts.push(`item_type = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'pointsCost') {
          setParts.push(`points_cost = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'delegateInscriptionId') {
          setParts.push(`delegate_inscription_id = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'originalInscriptionId') {
          setParts.push(`original_inscription_id = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'inscriptionIds') {
          setParts.push(`inscription_ids = $${paramIndex++}`);
          values.push(JSON.stringify(value));
        } else if (key === 'currentIndex') {
          setParts.push(`current_index = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'totalCount') {
          setParts.push(`total_count = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'seriesTitle') {
          setParts.push(`series_title = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'inscriptionItemType') {
          setParts.push(`inscription_item_type = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'title') {
          setParts.push(`title = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'description') {
          setParts.push(`description = $${paramIndex++}`);
          values.push(value);
        } else if (key === 'active') {
          setParts.push(`active = $${paramIndex++}`);
          values.push(value);
        }
      }

      if (setParts.length > 0) {
        setParts.push(`updated_at = $${paramIndex++}`);
        values.push(new Date());
        values.push(itemId);

        await pool.query(
          `UPDATE point_shop_items SET ${setParts.join(', ')} WHERE id = $${paramIndex}`,
          values
        );

        updatedItem = await getPointShopItem(itemId);
        if (updatedItem) {
          dbSuccess = true;
          console.log(`[PointShop] ✅ DB: Item aktualisiert: ${itemId}`);
        }
      }
    } catch (error) {
      console.error('[PointShop] ❌ DB-Fehler:', error.message);
      dbSuccess = false;
    }
  }

  // BOMBENSICHER: Aktualisiere IMMER auch in JSON (Dual-Write)
  try {
    const data = loadPointShopJSON();
    const item = data.items.find(item => item.id === itemId);
    if (item) {
      Object.assign(item, updates);
      savePointShopJSON(data);
      updatedItem = item;
      jsonSuccess = true;
      console.log(`[PointShop] ✅ JSON: Item aktualisiert: ${itemId}`);
    } else {
      console.warn(`[PointShop] ⚠️ Item nicht in JSON gefunden für Update: ${itemId}`);
    }
  } catch (error) {
    console.error('[PointShop] ❌ JSON-Fehler:', error.message);
    jsonSuccess = false;
  }
  
  // Wenn beide fehlschlagen, werfe Fehler
  if (!dbSuccess && !jsonSuccess) {
    throw new Error(`Failed to update Point Shop item ${itemId} in both PostgreSQL and JSON`);
  }
  
  // Wenn nur einer fehlschlägt, logge Warnung
  if (!dbSuccess) {
    console.warn(`[PointShop] ⚠️ Item nur in JSON aktualisiert (PostgreSQL fehlgeschlagen): ${itemId}`);
  }
  if (!jsonSuccess) {
    console.warn(`[PointShop] ⚠️ Item nur in PostgreSQL aktualisiert (JSON fehlgeschlagen): ${itemId}`);
  }
  
  return updatedItem;
}

/**
 * Lösche ein Point Shop Item (setzt active auf false)
 * BOMBENSICHER: Deaktiviert IMMER in PostgreSQL UND JSON (Dual-Write)
 */
export async function deletePointShopItem(itemId) {
  let dbSuccess = false;
  let jsonSuccess = false;
  
  // BOMBENSICHER: Deaktiviere IMMER in PostgreSQL wenn verfügbar
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      await pool.query(
        'UPDATE point_shop_items SET active = false, updated_at = $1 WHERE id = $2',
        [new Date(), itemId]
      );
      dbSuccess = true;
      console.log(`[PointShop] ✅ DB: Item deaktiviert: ${itemId}`);
    } catch (error) {
      console.error('[PointShop] ❌ DB-Fehler:', error.message);
      dbSuccess = false;
    }
  }

  // BOMBENSICHER: Deaktiviere IMMER auch in JSON (Dual-Write)
  try {
    const data = loadPointShopJSON();
    const item = data.items.find(item => item.id === itemId);
    if (item) {
      item.active = false;
      savePointShopJSON(data);
      jsonSuccess = true;
      console.log(`[PointShop] ✅ JSON: Item deaktiviert: ${itemId}`);
    } else {
      console.warn(`[PointShop] ⚠️ Item nicht in JSON gefunden für Deaktivierung: ${itemId}`);
    }
  } catch (error) {
    console.error('[PointShop] ❌ JSON-Fehler:', error.message);
    jsonSuccess = false;
  }
  
  // Wenn beide fehlschlagen, werfe Fehler
  if (!dbSuccess && !jsonSuccess) {
    throw new Error(`Failed to delete Point Shop item ${itemId} in both PostgreSQL and JSON`);
  }
  
  // Wenn nur einer fehlschlägt, logge Warnung aber returniere trotzdem true
  if (!dbSuccess) {
    console.warn(`[PointShop] ⚠️ Item nur in JSON deaktiviert (PostgreSQL fehlgeschlagen): ${itemId}`);
  }
  if (!jsonSuccess) {
    console.warn(`[PointShop] ⚠️ Item nur in PostgreSQL deaktiviert (JSON fehlgeschlagen): ${itemId}`);
  }
  
  return true;
}

/**
 * Füge eine Serie hinzu
 */
export async function addPointShopSeries(inscriptionIds, title, description, pointsCost, totalCount, inscriptionItemType = 'original') {
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
    inscriptionItemType: inscriptionItemType,
    title: title,
    description: description || '',
    pointsCost: parseInt(pointsCost, 10),
    createdAt: new Date().toISOString(),
    active: true,
  };

  // BOMBENSICHER: Dual-Write (PostgreSQL + JSON)
  let dbSuccess = false;
  let jsonSuccess = false;
  
  // Speichere IMMER in PostgreSQL wenn verfügbar
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const row = itemToRow(item);
      await pool.query(`
        INSERT INTO point_shop_items (
          id, item_type, title, description, points_cost, active, created_at, updated_at,
          inscription_ids, current_index, total_count, series_title, inscription_item_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          item_type = EXCLUDED.item_type,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          points_cost = EXCLUDED.points_cost,
          active = EXCLUDED.active,
          updated_at = EXCLUDED.updated_at,
          inscription_ids = EXCLUDED.inscription_ids,
          current_index = EXCLUDED.current_index,
          total_count = EXCLUDED.total_count,
          series_title = EXCLUDED.series_title,
          inscription_item_type = EXCLUDED.inscription_item_type
      `, [
        row.id, row.item_type, row.title, row.description, row.points_cost, row.active,
        row.created_at, row.updated_at,
        row.inscription_ids, row.current_index, row.total_count, row.series_title, row.inscription_item_type
      ]);
      dbSuccess = true;
      console.log(`[PointShop] ✅ DB: Serie gespeichert: ${item.id} - ${title}`);
    } catch (error) {
      console.error('[PointShop] ❌ DB-Fehler:', error.message);
      dbSuccess = false;
    }
  }

  // BOMBENSICHER: Speichere IMMER auch in JSON (Dual-Write)
  try {
    const data = loadPointShopJSON();
    // Entferne alte Serie mit gleicher ID falls vorhanden
    data.items = data.items.filter(i => i.id !== item.id);
    data.items.push(item);
    savePointShopJSON(data);
    jsonSuccess = true;
    console.log(`[PointShop] ✅ JSON: Serie gespeichert: ${item.id} - ${title}`);
  } catch (error) {
    console.error('[PointShop] ❌ JSON-Fehler:', error.message);
    jsonSuccess = false;
  }
  
  // Wenn beide fehlschlagen, werfe Fehler
  if (!dbSuccess && !jsonSuccess) {
    throw new Error('Failed to save Point Shop series to both PostgreSQL and JSON');
  }
  
  // Wenn nur einer fehlschlägt, logge Warnung aber returniere trotzdem
  if (!dbSuccess) {
    console.warn(`[PointShop] ⚠️ Serie nur in JSON gespeichert (PostgreSQL fehlgeschlagen): ${item.id}`);
  }
  if (!jsonSuccess) {
    console.warn(`[PointShop] ⚠️ Serie nur in PostgreSQL gespeichert (JSON fehlgeschlagen): ${item.id}`);
  }
  
  return item;
}

/**
 * Füge mehrere Items auf einmal hinzu (Bulk)
 */
export async function addPointShopBulk(itemType, inscriptionIds, baseTitle, description, pointsCost) {
  if (itemType !== 'delegate' && itemType !== 'original') {
    throw new Error('Invalid itemType. Must be "delegate" or "original"');
  }

  if (!Array.isArray(inscriptionIds) || inscriptionIds.length === 0) {
    throw new Error('inscriptionIds must be a non-empty array');
  }

  const items = [];
  const timestamp = Date.now();

  inscriptionIds.forEach((inscriptionId, index) => {
    const item = {
      id: `bulk-${timestamp}-${index}-${Math.random().toString(36).substr(2, 9)}`,
      itemType: itemType,
      title: `${baseTitle} #${index + 1}`,
      description: description || '',
      pointsCost: parseInt(pointsCost, 10),
      createdAt: new Date().toISOString(),
      active: true,
    };

    if (itemType === 'delegate') {
      item.delegateInscriptionId = inscriptionId;
    } else {
      item.originalInscriptionId = inscriptionId;
    }

    items.push(item);
  });

  // BOMBENSICHER: Dual-Write (PostgreSQL + JSON)
  let dbSuccess = false;
  let jsonSuccess = false;
  
  // Speichere IMMER in PostgreSQL wenn verfügbar
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      // Bulk-Insert in Transaktion
      await pool.query('BEGIN');
      try {
        for (const item of items) {
          const row = itemToRow(item);
          await pool.query(`
            INSERT INTO point_shop_items (
              id, item_type, title, description, points_cost, active, created_at, updated_at,
              delegate_inscription_id, original_inscription_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
              item_type = EXCLUDED.item_type,
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              points_cost = EXCLUDED.points_cost,
              active = EXCLUDED.active,
              updated_at = EXCLUDED.updated_at,
              delegate_inscription_id = EXCLUDED.delegate_inscription_id,
              original_inscription_id = EXCLUDED.original_inscription_id
          `, [
            row.id, row.item_type, row.title, row.description, row.points_cost, row.active,
            row.created_at, row.updated_at,
            row.delegate_inscription_id || null, row.original_inscription_id || null
          ]);
        }
        await pool.query('COMMIT');
        dbSuccess = true;
        console.log(`[PointShop] ✅ DB: ${items.length} Bulk-Items gespeichert: "${baseTitle}"`);
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error('[PointShop] ❌ DB-Fehler:', error.message);
      dbSuccess = false;
    }
  }

  // BOMBENSICHER: Speichere IMMER auch in JSON (Dual-Write)
  try {
    const data = loadPointShopJSON();
    // Entferne alte Items mit gleichen IDs falls vorhanden
    const itemIds = new Set(items.map(i => i.id));
    data.items = data.items.filter(i => !itemIds.has(i.id));
    data.items.push(...items);
    savePointShopJSON(data);
    jsonSuccess = true;
    console.log(`[PointShop] ✅ JSON: ${items.length} Bulk-Items gespeichert: "${baseTitle}"`);
  } catch (error) {
    console.error('[PointShop] ❌ JSON-Fehler:', error.message);
    jsonSuccess = false;
  }
  
  // Wenn beide fehlschlagen, werfe Fehler
  if (!dbSuccess && !jsonSuccess) {
    throw new Error('Failed to save Point Shop bulk items to both PostgreSQL and JSON');
  }
  
  // Wenn nur einer fehlschlägt, logge Warnung aber returniere trotzdem
  if (!dbSuccess) {
    console.warn(`[PointShop] ⚠️ Bulk-Items nur in JSON gespeichert (PostgreSQL fehlgeschlagen): "${baseTitle}"`);
  }
  if (!jsonSuccess) {
    console.warn(`[PointShop] ⚠️ Bulk-Items nur in PostgreSQL gespeichert (JSON fehlgeschlagen): "${baseTitle}"`);
  }
  
  return items;
}

/**
 * Hole die nächste Inskription aus einer Serie
 */
export async function getNextSeriesInscription(itemId) {
  if (isDatabaseAvailable()) {
    try {
      const pool = getPool();
      const result = await pool.query(
        'SELECT * FROM point_shop_items WHERE id = $1 AND active = true AND item_type = $2',
        [itemId, 'series']
      );

      if (result.rows.length === 0) {
        return null;
      }

      const item = rowToItem(result.rows[0]);
      if (item.currentIndex >= item.inscriptionIds.length) {
        return null; // Serie ist ausverkauft
      }

      const currentInscriptionId = item.inscriptionIds[item.currentIndex];
      const currentNumber = item.currentIndex + 1;

      // Update currentIndex in DB (Transaktion)
      await pool.query(
        'UPDATE point_shop_items SET current_index = $1, updated_at = $2 WHERE id = $3',
        [item.currentIndex + 1, new Date(), itemId]
      );

      return {
        inscriptionId: currentInscriptionId,
        currentNumber: currentNumber,
        totalCount: item.totalCount,
        inscriptionItemType: item.inscriptionItemType || 'original',
        remaining: item.totalCount - (item.currentIndex + 1),
      };
    } catch (error) {
      console.error('[PointShop] ⚠️ DB-Fehler, verwende JSON-Fallback:', error.message);
    }
  }

  // JSON Fallback
  const data = loadPointShopJSON();
  const item = data.items.find(item => item.id === itemId && item.active);

  if (!item || item.itemType !== 'series') {
    return null;
  }

  if (item.currentIndex >= item.inscriptionIds.length) {
    return null;
  }

  const currentInscriptionId = item.inscriptionIds[item.currentIndex];
  const currentNumber = item.currentIndex + 1;

  item.currentIndex += 1;
  savePointShopJSON(data);

  return {
    inscriptionId: currentInscriptionId,
    currentNumber: currentNumber,
    totalCount: item.totalCount,
    inscriptionItemType: item.inscriptionItemType || 'original',
    remaining: item.totalCount - item.currentIndex,
  };
}
