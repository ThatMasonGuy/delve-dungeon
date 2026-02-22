// Run: node src/db/reset.js
// WARNING: Destroys all data and recreates from scratch.
import { initDb, applySchema, getDb, closeDb } from './index.js';
import { seedAll } from './seed.js';

async function reset() {
  try {
    console.log('[DB:RESET] Resetting database...');
    initDb();

    const db = getDb();

    // Drop all tables in correct FK order
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    ).all();

    db.pragma('foreign_keys = OFF');
    for (const { name } of tables) {
      db.exec(`DROP TABLE IF EXISTS "${name}"`);
    }
    db.pragma('foreign_keys = ON');
    console.log(`[DB:RESET] Dropped ${tables.length} tables`);

    // Recreate schema
    applySchema();

    // Seed test data (includes async image generation)
    await seedAll();

    console.log('[DB:RESET] Complete.');
  } catch (err) {
    console.error('[DB:RESET] Failed:', err);
    process.exit(1);
  } finally {
    closeDb();
  }
}

reset();
