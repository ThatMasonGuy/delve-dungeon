// ═══════════════════════════════════════════════════════════════
// DATABASE — Connection, Init, Query Helpers
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config.js';
import { V1_TABLES, SCHEMA_VERSION } from './schema.js';

let db = null;

// ──────── CONNECTION ────────

export function getDb() {
  if (db) return db;
  throw new Error('Database not initialized. Call initDb() first.');
}

export function initDb(dbPath = config.db.path) {
  if (db) return db;

  // Ensure directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000'); // 64MB cache

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// ──────── SCHEMA INIT ────────

export function applySchema() {
  const database = getDb();

  database.exec('BEGIN');
  try {
    for (const sql of V1_TABLES) {
      database.exec(sql);
    }

    // Check if schema version already recorded
    const existing = database.prepare(
      `SELECT version FROM _schema_version ORDER BY rowid DESC LIMIT 1`
    ).get();

    if (!existing) {
      database.prepare(
        `INSERT INTO _schema_version (version) VALUES (?)`
      ).run(SCHEMA_VERSION);
      console.log(`[DB] Schema v${SCHEMA_VERSION} applied (fresh)`);
    } else if (existing.version !== SCHEMA_VERSION) {
      database.prepare(
        `INSERT INTO _schema_version (version) VALUES (?)`
      ).run(SCHEMA_VERSION);
      console.log(`[DB] Schema upgraded ${existing.version} → ${SCHEMA_VERSION}`);
    } else {
      console.log(`[DB] Schema v${SCHEMA_VERSION} already current`);
    }

    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

// ──────── QUERY HELPERS ────────
// Thin wrappers that handle JSON parsing and common patterns.

/** Run a SELECT and return all rows. JSON columns auto-parsed. */
export function queryAll(sql, params = {}) {
  return getDb().prepare(sql).all(params);
}

/** Run a SELECT and return first row. */
export function queryOne(sql, params = {}) {
  return getDb().prepare(sql).get(params);
}

/** Run INSERT/UPDATE/DELETE. Returns { changes, lastInsertRowid }. */
export function execute(sql, params = {}) {
  return getDb().prepare(sql).run(params);
}

/** Insert a row from an object. Returns lastInsertRowid. */
export function insert(table, data) {
  const keys = Object.keys(data);
  const placeholders = keys.map(k => `@${k}`).join(', ');
  const columns = keys.join(', ');
  const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
  const result = getDb().prepare(sql).run(data);
  return result.lastInsertRowid;
}

/** Update rows matching a WHERE clause. */
export function update(table, data, where, whereParams = {}) {
  const setClauses = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  const sql = `UPDATE ${table} SET ${setClauses} WHERE ${where}`;
  return getDb().prepare(sql).run({ ...data, ...whereParams });
}

/** Run multiple statements in a transaction. */
export function transaction(fn) {
  const database = getDb();
  const wrapped = database.transaction(fn);
  return wrapped();
}

/** Parse JSON columns on a row object. Mutates in place. */
export function parseJsonFields(row, ...fields) {
  if (!row) return row;
  for (const field of fields) {
    if (row[field] && typeof row[field] === 'string') {
      try {
        row[field] = JSON.parse(row[field]);
      } catch {
        // Leave as string if not valid JSON
      }
    }
  }
  return row;
}

/** Stringify JSON fields for insertion. Returns new object. */
export function stringifyJsonFields(data, ...fields) {
  const out = { ...data };
  for (const field of fields) {
    if (out[field] !== undefined && out[field] !== null && typeof out[field] !== 'string') {
      out[field] = JSON.stringify(out[field]);
    }
  }
  return out;
}

// ──────── TABLE-SPECIFIC QUERIES ────────
// These are the bread-and-butter queries the engine will call.

export const queries = {

  // ── Players (multi-character) ──

  getPlayerByDiscordId(discordId) {
    // Returns active character — backwards compatible
    return queryOne(`SELECT * FROM players WHERE discord_id = ? AND is_active = 1`, [discordId]);
  },

  getAllCharacters(discordId) {
    return queryAll(`SELECT * FROM players WHERE discord_id = ? ORDER BY character_slot`, [discordId]);
  },

  getCharacterBySlot(discordId, slot) {
    return queryOne(`SELECT * FROM players WHERE discord_id = ? AND character_slot = ?`, [discordId, slot]);
  },

  getCharacterById(playerId) {
    return queryOne(`SELECT * FROM players WHERE id = ?`, [playerId]);
  },

  setActiveCharacter(discordId, slot) {
    // Deactivate all, then activate the chosen slot
    execute(`UPDATE players SET is_active = 0 WHERE discord_id = ?`, [discordId]);
    execute(`UPDATE players SET is_active = 1 WHERE discord_id = ? AND character_slot = ?`, [discordId, slot]);
  },

  getNextAvailableSlot(discordId) {
    const chars = queryAll(`SELECT character_slot FROM players WHERE discord_id = ? ORDER BY character_slot`, [discordId]);
    const used = new Set(chars.map(c => c.character_slot));
    for (let i = 1; i <= 3; i++) {
      if (!used.has(i)) return i;
    }
    return null; // All slots full
  },

  createPlayer(discordId, username, characterName, slot, gold, hpMax, inventorySlots) {
    // Deactivate other characters first
    execute(`UPDATE players SET is_active = 0 WHERE discord_id = ?`, [discordId]);
    return insert('players', {
      discord_id: discordId,
      character_name: characterName,
      character_slot: slot,
      is_active: 1,
      username,
      gold,
      hp_current: hpMax,
      hp_max: hpMax,
      max_inventory_slots: inventorySlots,
    });
  },

  deleteCharacter(discordId, slot) {
    const char = queryOne(`SELECT id FROM players WHERE discord_id = ? AND character_slot = ?`, [discordId, slot]);
    if (!char) return false;
    // CASCADE will clean up base_stats, skills, inventory, etc.
    execute(`DELETE FROM players WHERE id = ?`, [char.id]);
    // If we deleted the active character, activate the first remaining one
    const remaining = queryOne(`SELECT character_slot FROM players WHERE discord_id = ? ORDER BY character_slot LIMIT 1`, [discordId]);
    if (remaining) {
      execute(`UPDATE players SET is_active = 1 WHERE discord_id = ? AND character_slot = ?`, [discordId, remaining.character_slot]);
    }
    return true;
  },

  createBaseStats(playerId, stats) {
    return insert('player_base_stats', { player_id: playerId, ...stats });
  },

  getBaseStats(playerId) {
    return queryOne(`SELECT * FROM player_base_stats WHERE player_id = ?`, [playerId]);
  },

  initPlayerSkills(playerId) {
    const skills = ['melee','ranged','magic','stealth','perception','persuasion','lockpicking','survival','crafting','alchemy'];
    const stmt = getDb().prepare(
      `INSERT INTO player_skills (player_id, skill_name, xp, level, true_level, prestige_xp) VALUES (?, ?, 0, 1, 1, 0)`
    );
    const insertAll = getDb().transaction(() => {
      for (const skill of skills) {
        stmt.run(playerId, skill);
      }
    });
    insertAll();
  },

  getPlayerSkills(playerId) {
    return queryAll(`SELECT * FROM player_skills WHERE player_id = ? ORDER BY skill_name`, [playerId]);
  },

  getPlayerSkill(playerId, skillName) {
    return queryOne(`SELECT * FROM player_skills WHERE player_id = ? AND skill_name = ?`, [playerId, skillName]);
  },

  updateSkillXp(playerId, skillName, xpGain) {
    return execute(
      `UPDATE player_skills SET xp = xp + ? WHERE player_id = ? AND skill_name = ?`,
      [xpGain, playerId, skillName]
    );
  },

  // ── Inventory ──

  getInventory(playerId) {
    return queryAll(
      `SELECT pi.*, i.name as item_name, i.type as item_type, i.subtype, i.rarity,
              i.stat_modifiers, i.damage_type, i.base_value, i.description as item_description,
              i.is_stackable, i.is_quest_item, i.use_effect, i.base_crit_range,
              i.hand_requirement, i.aoe_range, i.ammo_type, i.bonus_damage
       FROM player_inventory pi
       JOIN items i ON pi.item_id = i.id
       WHERE pi.player_id = ?
       ORDER BY i.type, i.name`,
      [playerId]
    );
  },

  getEquippedItems(playerId) {
    return queryAll(
      `SELECT pi.*, i.name as item_name, i.type as item_type, i.subtype, i.rarity,
              i.stat_modifiers, i.damage_type, i.base_value, i.base_crit_range,
              i.hand_requirement, i.aoe_range, i.ammo_type, i.bonus_damage
       FROM player_inventory pi
       JOIN items i ON pi.item_id = i.id
       WHERE pi.player_id = ? AND pi.is_equipped = 1`,
      [playerId]
    );
  },

  addItem(playerId, itemId, quantity = 1, runId = null) {
    // Check if stackable item already exists
    const existing = queryOne(
      `SELECT pi.id, pi.quantity FROM player_inventory pi
       JOIN items i ON pi.item_id = i.id
       WHERE pi.player_id = ? AND pi.item_id = ? AND i.is_stackable = 1`,
      [playerId, itemId]
    );
    if (existing) {
      execute(`UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?`, [quantity, existing.id]);
      return existing.id;
    }
    return insert('player_inventory', {
      player_id: playerId,
      item_id: itemId,
      quantity,
      is_equipped: 0,
      is_cursed: 0,
      acquired_in_run_id: runId,
    });
  },

  removeItem(inventoryRowId, quantity = 1) {
    const row = queryOne(`SELECT quantity FROM player_inventory WHERE id = ?`, [inventoryRowId]);
    if (!row) return;
    if (row.quantity <= quantity) {
      execute(`DELETE FROM player_inventory WHERE id = ?`, [inventoryRowId]);
    } else {
      execute(`UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?`, [quantity, inventoryRowId]);
    }
  },

  countInventorySlots(playerId) {
    const result = queryOne(
      `SELECT COUNT(*) as count FROM player_inventory WHERE player_id = ?`,
      [playerId]
    );
    return result?.count || 0;
  },

  // ── Dungeon & Runs ──

  getDungeon(dungeonId) {
    const row = queryOne(`SELECT * FROM dungeons WHERE id = ?`, [dungeonId]);
    return parseJsonFields(row, 'dc_range', 'completion_condition');
  },

  getAvailableDungeons() {
    return queryAll(`SELECT * FROM dungeons WHERE is_secret = 0`);
  },

  setDungeonImage(dungeonId, imagePath) {
    return execute(`UPDATE dungeons SET image_path = ? WHERE id = ?`, [imagePath, dungeonId]);
  },

  getActiveRun(playerId) {
    const row = queryOne(
      `SELECT * FROM active_runs WHERE player_id = ? AND status IN ('active','processing')`,
      [playerId]
    );
    return parseJsonFields(row, 'room_state', 'ai_context', 'run_stats', 'generation_params');
  },

  createRun(playerId, dungeonId, seed, generationParams = {}) {
    return insert('active_runs', stringifyJsonFields({
      player_id: playerId,
      dungeon_id: dungeonId,
      status: 'active',
      current_floor: 1,
      current_room: 1,
      room_state: { is_combat_active: false, round_number: 0, enemies: [], allies: [], npcs_present: [] },
      ai_context: [],
      generation_seed: seed,
      generation_params: generationParams,
      run_stats: { damage_taken: 0, damage_dealt: 0, enemies_killed: 0, rooms_cleared: 0, torch_lit: false, fungus_lit: false, status_effects: [] },
    }, 'room_state', 'ai_context', 'generation_params', 'run_stats'));
  },

  updateRunState(runId, updates) {
    const jsonified = stringifyJsonFields(updates, 'room_state', 'ai_context', 'run_stats', 'generation_params');
    return update('active_runs', { ...jsonified, last_action_at: new Date().toISOString() }, 'id = @_id', { _id: runId });
  },

  endRun(runId, status) {
    return execute(`UPDATE active_runs SET status = ? WHERE id = ?`, [status, runId]);
  },

  // ── Floor Maps ──

  getFloorMap(runId, floorNumber) {
    const row = queryOne(
      `SELECT * FROM run_floor_maps WHERE run_id = ? AND floor_number = ?`,
      [runId, floorNumber]
    );
    return parseJsonFields(row, 'floor_map');
  },

  saveFloorMap(runId, floorNumber, floorMap) {
    return insert('run_floor_maps', stringifyJsonFields({
      run_id: runId,
      floor_number: floorNumber,
      floor_map: floorMap,
    }, 'floor_map'));
  },

  updateFloorMap(runId, floorNumber, floorMap) {
    return execute(
      `UPDATE run_floor_maps SET floor_map = ? WHERE run_id = ? AND floor_number = ?`,
      [JSON.stringify(floorMap), runId, floorNumber]
    );
  },

  // ── Action Log ──

  getNextSequence(runId) {
    const row = queryOne(`SELECT MAX(sequence) as max_seq FROM run_action_log WHERE run_id = ?`, [runId]);
    return (row?.max_seq || 0) + 1;
  },

  logAction(data) {
    return insert('run_action_log', stringifyJsonFields(data,
      'checks_rolled', 'dice_results', 'xp_gained', 'level_ups', 'items_found', 'items_lost'
    ));
  },

  // ── Enemy & Loot Rules ──

  getEnemyRulesForDungeon(dungeonId) {
    return queryAll(
      `SELECT er.*, e.name as enemy_name, e.base_hp, e.base_damage, e.base_armor,
              e.abilities, e.resistances, e.weaknesses, e.effect_immunities,
              e.is_boss, e.xp_reward, e.gold_reward_min, e.gold_reward_max,
              e.ai_descriptor, e.stat_scaling
       FROM enemy_rules er
       JOIN enemies e ON er.enemy_id = e.id
       WHERE er.source_type = 'dungeon' AND er.source_id = ?`,
      [dungeonId]
    );
  },

  getLootRulesForSource(sourceType, sourceId) {
    return queryAll(
      `SELECT lr.*, i.name as item_name, i.type as item_type, i.rarity, i.base_value
       FROM loot_rules lr
       JOIN items i ON lr.item_id = i.id
       WHERE lr.source_type = ? AND lr.source_id = ?`,
      [sourceType, sourceId]
    );
  },

  getEnemy(enemyId) {
    const row = queryOne(`SELECT * FROM enemies WHERE id = ?`, [enemyId]);
    return parseJsonFields(row, 'stat_scaling', 'abilities', 'resistances', 'weaknesses', 'effect_immunities');
  },

  getItem(itemId) {
    const row = queryOne(`SELECT * FROM items WHERE id = ?`, [itemId]);
    return parseJsonFields(row, 'stat_modifiers', 'use_effect', 'bonus_damage');
  },

  // ── Dungeon History ──

  getDungeonHistory(playerId, dungeonId) {
    return queryOne(
      `SELECT * FROM player_dungeon_history WHERE player_id = ? AND dungeon_id = ?`,
      [playerId, dungeonId]
    );
  },

  upsertDungeonHistory(playerId, dungeonId, field) {
    const existing = queryOne(
      `SELECT id FROM player_dungeon_history WHERE player_id = ? AND dungeon_id = ?`,
      [playerId, dungeonId]
    );
    if (existing) {
      execute(
        `UPDATE player_dungeon_history SET ${field} = ${field} + 1 WHERE id = ?`,
        [existing.id]
      );
    } else {
      insert('player_dungeon_history', {
        player_id: playerId,
        dungeon_id: dungeonId,
        times_attempted: field === 'times_attempted' ? 1 : 0,
        times_completed: field === 'times_completed' ? 1 : 0,
        times_died: field === 'times_died' ? 1 : 0,
      });
    }
  },

  // ── Status Effects ──

  getPlayerStatusEffects(playerId, runId = null) {
    if (runId) {
      return queryAll(
        `SELECT pse.*, sed.effect_category, sed.damage_formula, sed.tick_timing,
                sed.clears_on_combat_end as def_clears_on_combat_end
         FROM player_status_effects pse
         JOIN status_effect_definitions sed ON pse.effect_type = sed.name
         WHERE pse.player_id = ? AND (pse.run_id = ? OR pse.run_id IS NULL)
         ORDER BY pse.resolution_order`,
        [playerId, runId]
      );
    }
    return queryAll(
      `SELECT pse.*, sed.effect_category, sed.damage_formula, sed.tick_timing
       FROM player_status_effects pse
       JOIN status_effect_definitions sed ON pse.effect_type = sed.name
       WHERE pse.player_id = ? AND pse.run_id IS NULL
       ORDER BY pse.resolution_order`,
      [playerId]
    );
  },

  clearCombatStatusEffects(playerId, runId) {
    return execute(
      `DELETE FROM player_status_effects
       WHERE player_id = ? AND run_id = ?
       AND (
         (clears_on_combat_end_override = 1)
         OR (clears_on_combat_end_override IS NULL AND effect_type IN (
           SELECT name FROM status_effect_definitions WHERE clears_on_combat_end = 1
         ))
       )`,
      [playerId, runId]
    );
  },

  // ── Shop ──

  getItemByName(name) {
    return queryOne(`SELECT * FROM items WHERE name = ?`, [name]);
  },

  getCompletedDungeonIds(playerId) {
    return queryAll(
      `SELECT dungeon_id FROM player_dungeon_history WHERE player_id = ? AND times_completed > 0`,
      [playerId]
    ).map(r => r.dungeon_id);
  },
};