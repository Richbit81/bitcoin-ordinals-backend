/**
 * Skript zum Wiederherstellen von Point Shop Items
 * Führt eine Abfrage aus, um alle Items (auch inaktive) zu sehen
 */

import pg from 'pg';
import dotenv from 'dotenv';
const { Pool } = pg;

dotenv.config();

async function checkItems() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('❌ DATABASE_URL nicht gesetzt');
    return;
  }

  const pool = new Pool({
    connectionString: connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    // Hole ALLE Items (auch inaktive)
    const result = await pool.query(
      'SELECT * FROM point_shop_items ORDER BY created_at DESC'
    );
    
    console.log(`\n📊 Gefundene Items in Datenbank: ${result.rows.length}\n`);
    
    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.title} (${row.item_type})`);
      console.log(`   ID: ${row.id}`);
      console.log(`   Active: ${row.active}`);
      console.log(`   Created: ${row.created_at}`);
      console.log(`   Points: ${row.points_cost}`);
      if (row.item_type === 'series') {
        console.log(`   Series: ${row.current_index}/${row.total_count}`);
      }
      console.log('');
    });

    // Aktiviere alle Items wieder
    const activateResult = await pool.query(
      'UPDATE point_shop_items SET active = true WHERE active = false'
    );
    console.log(`✅ ${activateResult.rowCount} Items wurden reaktiviert\n`);

    // Zeige aktive Items
    const activeResult = await pool.query(
      'SELECT * FROM point_shop_items WHERE active = true ORDER BY created_at DESC'
    );
    console.log(`📊 Aktive Items: ${activeResult.rows.length}\n`);

  } catch (error) {
    console.error('❌ Fehler:', error);
  } finally {
    await pool.end();
  }
}

checkItems();
