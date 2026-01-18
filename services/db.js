/**
 * PostgreSQL Datenbankverbindung
 * Bietet persistente Speicherung für Point Shop Items
 */

import pg from 'pg';
const { Pool } = pg;

let pool = null;

/**
 * Initialisiere Datenbankverbindung
 */
export function initDatabase() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.warn('[DB] ⚠️ DATABASE_URL nicht gesetzt - verwende JSON-Fallback');
    return null;
  }

  try {
    pool = new Pool({
      connectionString: connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test-Verbindung
    pool.query('SELECT NOW()', (err, res) => {
      if (err) {
        console.error('[DB] ❌ Datenbankverbindung fehlgeschlagen:', err.message);
        pool = null;
      } else {
        console.log('[DB] ✅ PostgreSQL verbunden:', res.rows[0].now);
      }
    });

    // Error-Handler
    pool.on('error', (err) => {
      console.error('[DB] ❌ Unerwarteter Datenbankfehler:', err);
      pool = null;
    });

    return pool;
  } catch (error) {
    console.error('[DB] ❌ Fehler beim Initialisieren der Datenbank:', error);
    pool = null;
    return null;
  }
}

/**
 * Hole Datenbankverbindung
 */
export function getPool() {
  return pool;
}

/**
 * Prüfe ob Datenbank verfügbar ist
 */
export function isDatabaseAvailable() {
  return pool !== null;
}

/**
 * Erstelle Tabellen falls nicht vorhanden
 */
export async function createTables() {
  if (!pool) {
    console.warn('[DB] ⚠️ Keine Datenbankverbindung - überspringe Tabellenerstellung');
    return false;
  }

  try {
    // Point Shop Items Tabelle
    await pool.query(`
      CREATE TABLE IF NOT EXISTS point_shop_items (
        id VARCHAR(255) PRIMARY KEY,
        item_type VARCHAR(50) NOT NULL,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        points_cost INTEGER NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        -- Felder für delegate/original Items
        delegate_inscription_id VARCHAR(255),
        original_inscription_id VARCHAR(255),
        
        -- Felder für series Items
        inscription_ids JSONB,
        current_index INTEGER DEFAULT 0,
        total_count INTEGER,
        series_title VARCHAR(500),
        inscription_item_type VARCHAR(50),
        
        -- Indexes für Performance
        CONSTRAINT check_item_type CHECK (item_type IN ('delegate', 'original', 'series'))
      );
    `);

    // Collections Tabelle
    await pool.query(`
      CREATE TABLE IF NOT EXISTS collections (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(500) NOT NULL,
        description TEXT,
        thumbnail TEXT,
        price DECIMAL(18, 8) NOT NULL,
        category VARCHAR(100) DEFAULT 'default',
        page VARCHAR(100) DEFAULT NULL,
        mint_type VARCHAR(20) DEFAULT 'individual',
        show_banner BOOLEAN DEFAULT false,
        items JSONB NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT check_mint_type CHECK (mint_type IN ('individual', 'random'))
      );
    `);
    
    // Füge 'page' Spalte hinzu falls sie nicht existiert (für bestehende Tabellen)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'collections' AND column_name = 'page'
        ) THEN
          ALTER TABLE collections ADD COLUMN page VARCHAR(100) DEFAULT NULL;
        END IF;
      END $$;
    `);

    // Füge 'show_banner' Spalte hinzu falls sie nicht existiert (für bestehende Tabellen)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'collections' AND column_name = 'show_banner'
        ) THEN
          ALTER TABLE collections ADD COLUMN show_banner BOOLEAN DEFAULT false;
        END IF;
      END $$;
    `);

    // Migration Status Tabelle (verhindert mehrfache Migrationen)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration_status (
        id VARCHAR(255) PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 💣 BOMBENSICHER: Minted Cards Tabelle (Hashlist aller geminteten Karten)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS minted_cards (
        id SERIAL PRIMARY KEY,
        inscription_id VARCHAR(255) UNIQUE NOT NULL,
        temp_id VARCHAR(255),
        card_id VARCHAR(100) NOT NULL,
        card_name VARCHAR(500) NOT NULL,
        rarity VARCHAR(50) NOT NULL,
        pack_type VARCHAR(100),
        collection_id VARCHAR(255),
        wallet_address VARCHAR(100) NOT NULL,
        original_inscription_id VARCHAR(255),
        card_type VARCHAR(50),
        effect TEXT,
        svg_icon TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        txid VARCHAR(100),
        minted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT check_status CHECK (status IN ('pending', 'confirmed', 'failed'))
      );
    `);

    // Indexes für bombensichere Performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_minted_cards_inscription_id ON minted_cards(inscription_id);
      CREATE INDEX IF NOT EXISTS idx_minted_cards_temp_id ON minted_cards(temp_id);
      CREATE INDEX IF NOT EXISTS idx_minted_cards_wallet ON minted_cards(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_minted_cards_status ON minted_cards(status);
      CREATE INDEX IF NOT EXISTS idx_minted_cards_wallet_status ON minted_cards(wallet_address, status);
      CREATE INDEX IF NOT EXISTS idx_minted_cards_pack_type ON minted_cards(pack_type);
      CREATE INDEX IF NOT EXISTS idx_minted_cards_collection ON minted_cards(collection_id);
      CREATE INDEX IF NOT EXISTS idx_minted_cards_created_at ON minted_cards(created_at DESC);
    `);

    // Indexes für bessere Performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_point_shop_items_active ON point_shop_items(active);
      CREATE INDEX IF NOT EXISTS idx_point_shop_items_item_type ON point_shop_items(item_type);
      CREATE INDEX IF NOT EXISTS idx_point_shop_items_created_at ON point_shop_items(created_at);
      CREATE INDEX IF NOT EXISTS idx_collections_active ON collections(active);
      CREATE INDEX IF NOT EXISTS idx_collections_category ON collections(category);
      CREATE INDEX IF NOT EXISTS idx_collections_created_at ON collections(created_at);
    `);
    
    console.log('[DB] ✅ minted_cards Tabelle bereit mit 8 Performance-Indexes');

    console.log('[DB] ✅ Tabellen erstellt/überprüft');
    return true;
  } catch (error) {
    console.error('[DB] ❌ Fehler beim Erstellen der Tabellen:', error);
    return false;
  }
}

/**
 * Schließe Datenbankverbindung
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[DB] ✅ Datenbankverbindung geschlossen');
  }
}
