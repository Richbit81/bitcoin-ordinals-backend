/**
 * 📊 DB MIGRATION SCRIPT
 * Fügt project_id Spalten zu minted_cards und collections Tabellen hinzu
 */

import { getPool, isDatabaseAvailable } from '../services/db.js';

export async function addProjectIdColumns() {
  if (!isDatabaseAvailable()) {
    console.error('[Migration] ❌ Database not available');
    return false;
  }

  const pool = getPool();
  
  try {
    console.log('[Migration] 🔧 Adding project_id columns to tables...');
    
    // 1. Füge project_id zu minted_cards hinzu
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'minted_cards' AND column_name = 'project_id'
        ) THEN
          ALTER TABLE minted_cards 
          ADD COLUMN project_id VARCHAR(100) DEFAULT NULL;
          
          CREATE INDEX IF NOT EXISTS idx_minted_cards_project_id ON minted_cards(project_id);
          
          RAISE NOTICE 'Added project_id column to minted_cards';
        ELSE
          RAISE NOTICE 'project_id column already exists in minted_cards';
        END IF;
      END $$;
    `);
    
    // 2. Füge project_id zu collections hinzu
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'collections' AND column_name = 'project_id'
        ) THEN
          ALTER TABLE collections 
          ADD COLUMN project_id VARCHAR(100) DEFAULT NULL;
          
          CREATE INDEX IF NOT EXISTS idx_collections_project_id ON collections(project_id);
          
          RAISE NOTICE 'Added project_id column to collections';
        ELSE
          RAISE NOTICE 'project_id column already exists in collections';
        END IF;
      END $$;
    `);
    
    console.log('[Migration] ✅ Migration completed successfully');
    return true;
  } catch (error) {
    console.error('[Migration] ❌ Migration failed:', error);
    return false;
  }
}

// Wenn direkt ausgeführt
if (import.meta.url === `file://${process.argv[1]}`) {
  import('../services/db.js').then(async ({ initDatabase }) => {
    initDatabase();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Warte auf DB-Verbindung
    await addProjectIdColumns();
    process.exit(0);
  });
}
