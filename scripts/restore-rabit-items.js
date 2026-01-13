/**
 * Skript zum Wiederherstellen der RaBIT 01-05 Items
 * Sucht nach Items mit diesem Titel und reaktiviert sie oder erstellt sie neu
 */

import pg from 'pg';
import dotenv from 'dotenv';
const { Pool } = pg;

dotenv.config();

async function restoreRabitItems() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('❌ DATABASE_URL nicht gesetzt');
    console.log('💡 Tipp: Setze DATABASE_URL als Environment Variable');
    return;
  }

  const pool = new Pool({
    connectionString: connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    // Suche nach Items mit "RaBIT" im Titel
    const searchResult = await pool.query(
      "SELECT * FROM point_shop_items WHERE title LIKE '%RaBIT%' OR title LIKE '%rabit%' ORDER BY created_at DESC"
    );
    
    console.log(`\n📊 Gefundene RaBIT Items: ${searchResult.rows.length}\n`);
    
    if (searchResult.rows.length > 0) {
      searchResult.rows.forEach((row, index) => {
        console.log(`${index + 1}. ${row.title} (${row.item_type})`);
        console.log(`   ID: ${row.id}`);
        console.log(`   Active: ${row.active}`);
        console.log(`   Points: ${row.points_cost}`);
        console.log(`   Created: ${row.created_at}`);
        if (row.delegate_inscription_id) {
          console.log(`   Delegate ID: ${row.delegate_inscription_id}`);
        }
        if (row.original_inscription_id) {
          console.log(`   Original ID: ${row.original_inscription_id}`);
        }
        console.log('');
      });

      // Reaktiviere alle RaBIT Items
      const activateResult = await pool.query(
        "UPDATE point_shop_items SET active = true, updated_at = $1 WHERE (title LIKE '%RaBIT%' OR title LIKE '%rabit%') AND active = false",
        [new Date()]
      );
      console.log(`✅ ${activateResult.rowCount} RaBIT Items wurden reaktiviert\n`);
    } else {
      console.log('⚠️ Keine RaBIT Items gefunden. Müssen neu erstellt werden.\n');
      console.log('💡 Bitte gib mir folgende Informationen:');
      console.log('   - Inscription IDs (5 Stück)');
      console.log('   - Item Type (delegate oder original)');
      console.log('   - Beschreibung');
      console.log('   - Points Cost (wahrscheinlich 1)\n');
    }

    // Zeige alle aktiven Items
    const activeResult = await pool.query(
      'SELECT * FROM point_shop_items WHERE active = true ORDER BY created_at DESC'
    );
    console.log(`📊 Gesamt aktive Items: ${activeResult.rows.length}\n`);

  } catch (error) {
    console.error('❌ Fehler:', error);
  } finally {
    await pool.end();
  }
}

restoreRabitItems();
