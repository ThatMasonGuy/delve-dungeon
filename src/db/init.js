// Run: node src/db/init.js
import { initDb, applySchema, closeDb } from './index.js';

try {
  console.log('[DB:INIT] Initializing database...');
  initDb();
  applySchema();
  console.log('[DB:INIT] Complete.');
} catch (err) {
  console.error('[DB:INIT] Failed:', err);
  process.exit(1);
} finally {
  closeDb();
}
