// ═══════════════════════════════════════════════════════════════
// DATABASE SCHEMA — V1
// ═══════════════════════════════════════════════════════════════
// Faithful to the schema design doc, trimmed to v1 tables only.
// Deferred: enchantments, spells, skill_perks, crafting_recipes,
//   quests, npcs, dungeon_npc_rules, npc_shop_stock,
//   dungeon_objectives, active_run_objectives,
//   player_spells, player_spell_records, player_known_recipes,
//   player_quests, player_stats_summary, player_enemy_stats,
//   room_visual_themes, run_history
// ═══════════════════════════════════════════════════════════════

export const SCHEMA_VERSION = '0.2.0';

export const V1_TABLES = [

  // ──────── STATIC WORLD ────────

  `CREATE TABLE IF NOT EXISTS damage_types (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL UNIQUE,
    display_name  TEXT    NOT NULL,
    description   TEXT    NOT NULL,
    added_in_version TEXT NOT NULL DEFAULT '0.1.0',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    type            TEXT    NOT NULL CHECK(type IN ('weapon','armor','consumable','scroll','spellbook','valuable','quest')),
    subtype         TEXT    NOT NULL CHECK(subtype IN ('melee','ranged','focus','potion','food','ammo','lockpick','grenade','light_armor','medium_armor','heavy_armor','shield','ring','amulet')),
    rarity          TEXT    NOT NULL CHECK(rarity IN ('common','uncommon','rare','epic','legendary')),
    base_value      INTEGER NOT NULL DEFAULT 0 CHECK(base_value >= 0),
    stat_modifiers  TEXT    NOT NULL DEFAULT '{}',      -- JSON: {armor?, damage_bonus?, hit_chance?, resistance?}
    damage_type     TEXT    REFERENCES damage_types(name),
    ammo_type       TEXT,
    damage_type_rule TEXT   CHECK(damage_type_rule IN ('override','combine','add') OR damage_type_rule IS NULL),
    bonus_damage    TEXT,                                -- JSON: {amount, damage_type}
    use_effect      TEXT,                                -- JSON: [{effect_type, value, mode, ...}]
    aoe_range       TEXT    CHECK(aoe_range IN ('melee_range','short','medium') OR aoe_range IS NULL),
    base_crit_range INTEGER NOT NULL DEFAULT 20 CHECK(base_crit_range BETWEEN 1 AND 20),
    hand_requirement TEXT   CHECK(hand_requirement IN ('one_handed','two_handed','off_hand') OR hand_requirement IS NULL),
    is_stackable    INTEGER NOT NULL DEFAULT 0,
    is_quest_item   INTEGER NOT NULL DEFAULT 0,
    description     TEXT    NOT NULL DEFAULT '',
    added_in_version TEXT   NOT NULL DEFAULT '0.1.0',
    contributor_credit TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS enemies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    description     TEXT    NOT NULL,
    lore_text       TEXT    NOT NULL DEFAULT '',
    base_hp         INTEGER NOT NULL CHECK(base_hp >= 1),
    base_damage     INTEGER NOT NULL CHECK(base_damage >= 0),
    base_armor      INTEGER NOT NULL CHECK(base_armor >= 0),
    stat_scaling    TEXT    NOT NULL DEFAULT '{"hp_per_tier":1.3,"damage_per_tier":1.15,"armor_per_tier":1.1}',
    abilities       TEXT    NOT NULL DEFAULT '[]',       -- JSON array of ability objects
    resistances     TEXT    NOT NULL DEFAULT '{}',       -- JSON: {damage_type: multiplier}
    weaknesses      TEXT    NOT NULL DEFAULT '{}',
    effect_immunities TEXT  NOT NULL DEFAULT '[]',       -- JSON array of effect names
    is_boss         INTEGER NOT NULL DEFAULT 0,
    xp_reward       INTEGER NOT NULL DEFAULT 0 CHECK(xp_reward >= 0),
    gold_reward_min INTEGER NOT NULL DEFAULT 0 CHECK(gold_reward_min >= 0),
    gold_reward_max INTEGER NOT NULL DEFAULT 0,
    ai_descriptor   TEXT    NOT NULL DEFAULT '',
    added_in_version TEXT   NOT NULL DEFAULT '0.1.0',
    contributor_credit TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS dungeons (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    difficulty_tier     INTEGER NOT NULL CHECK(difficulty_tier >= 1),
    floor_count         INTEGER NOT NULL CHECK(floor_count >= 1),
    entry_cost          INTEGER NOT NULL DEFAULT 0 CHECK(entry_cost >= 0),
    dc_range            TEXT    NOT NULL DEFAULT '{"min":8,"max":18}',
    theme               TEXT    NOT NULL,
    ai_context_seed     TEXT    NOT NULL,
    image_path          TEXT,
    is_secret           INTEGER NOT NULL DEFAULT 0,
    completion_condition TEXT   NOT NULL DEFAULT '{"type":"boss_killed"}',
    added_in_version    TEXT    NOT NULL DEFAULT '0.1.0',
    contributor_credit  TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS loot_rules (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type             TEXT    NOT NULL CHECK(source_type IN ('dungeon_completion','chest','room_drop','boss','enemy_kill')),
    source_id               INTEGER NOT NULL,
    item_id                 INTEGER NOT NULL REFERENCES items(id),
    drop_type               TEXT    NOT NULL CHECK(drop_type IN ('guaranteed','weighted','conditional','never')),
    base_weight             INTEGER NOT NULL DEFAULT 0 CHECK(base_weight >= 0),
    condition_type          TEXT    NOT NULL DEFAULT 'none' CHECK(condition_type IN ('none','min_skill','min_completions','has_item','has_not_item')),
    condition_skill_name    TEXT,
    condition_skill_min     INTEGER,
    condition_min_completions INTEGER,
    condition_requires_item_id INTEGER,
    enchantment_rule        TEXT    NOT NULL DEFAULT 'none' CHECK(enchantment_rule IN ('none','random','skill_based')),
    enchantment_skill_name  TEXT,
    enchantment_skill_min   INTEGER,
    requires_perception     INTEGER NOT NULL DEFAULT 0,
    perception_dc           INTEGER,
    added_in_version        TEXT    NOT NULL DEFAULT '0.1.0',
    contributor_credit      TEXT,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS enemy_rules (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type         TEXT    NOT NULL CHECK(source_type IN ('dungeon','floor','room_type')),
    source_id           INTEGER NOT NULL,
    enemy_id            INTEGER NOT NULL REFERENCES enemies(id),
    spawn_weight        INTEGER NOT NULL DEFAULT 1 CHECK(spawn_weight >= 0),
    condition_type      TEXT    NOT NULL DEFAULT 'none' CHECK(condition_type IN ('none','min_skill','min_completions')),
    condition_skill_name TEXT,
    condition_skill_min INTEGER,
    added_in_version    TEXT    NOT NULL DEFAULT '0.1.0',
    contributor_credit  TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS status_effect_definitions (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT    NOT NULL UNIQUE,
    effect_category         TEXT    NOT NULL CHECK(effect_category IN ('damage','control','meta','buff','debuff')),
    damage_type             TEXT    REFERENCES damage_types(name),
    damage_formula          TEXT,                         -- JSON: {mode, value}
    tier_scaling_multiplier REAL,
    tick_timing             TEXT    NOT NULL CHECK(tick_timing IN ('start_of_action','end_of_action','on_hit','on_cast')),
    max_stacks              INTEGER,
    blocks_speech           INTEGER NOT NULL DEFAULT 0,
    clears_on_combat_end    INTEGER NOT NULL DEFAULT 1,
    default_resolution_order INTEGER NOT NULL DEFAULT 50,
    is_removable            INTEGER NOT NULL DEFAULT 1,
    tags                    TEXT    NOT NULL DEFAULT '[]', -- JSON array
    description             TEXT    NOT NULL DEFAULT '',
    added_in_version        TEXT    NOT NULL DEFAULT '0.1.0',
    contributor_credit      TEXT,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  // ──────── PLAYER ────────

  `CREATE TABLE IF NOT EXISTS players (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id          TEXT    NOT NULL,
    character_name      TEXT    NOT NULL,
    character_slot      INTEGER NOT NULL DEFAULT 1 CHECK(character_slot BETWEEN 1 AND 3),
    is_active           INTEGER NOT NULL DEFAULT 1,
    username            TEXT    NOT NULL,
    gold                INTEGER NOT NULL DEFAULT 100 CHECK(gold >= 0),
    hp_current          INTEGER NOT NULL DEFAULT 50,
    hp_max              INTEGER NOT NULL DEFAULT 50 CHECK(hp_max >= 1),
    reminder_enabled    INTEGER NOT NULL DEFAULT 0,
    reminder_time       TEXT    NOT NULL DEFAULT '18:00:00',
    max_inventory_slots INTEGER NOT NULL DEFAULT 20 CHECK(max_inventory_slots >= 1),
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(discord_id, character_slot)
  )`,

  `CREATE TABLE IF NOT EXISTS player_base_stats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id   INTEGER NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
    strength    INTEGER NOT NULL CHECK(strength BETWEEN 3 AND 18),
    dexterity   INTEGER NOT NULL CHECK(dexterity BETWEEN 3 AND 18),
    constitution INTEGER NOT NULL CHECK(constitution BETWEEN 3 AND 18),
    intelligence INTEGER NOT NULL CHECK(intelligence BETWEEN 3 AND 18),
    wisdom      INTEGER NOT NULL CHECK(wisdom BETWEEN 3 AND 18),
    charisma    INTEGER NOT NULL CHECK(charisma BETWEEN 3 AND 18)
  )`,

  `CREATE TABLE IF NOT EXISTS player_skills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    skill_name  TEXT    NOT NULL CHECK(skill_name IN ('melee','ranged','magic','stealth','perception','persuasion','lockpicking','survival','crafting','alchemy')),
    xp          INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0),
    level       INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 0 AND 100),
    true_level  INTEGER NOT NULL DEFAULT 1 CHECK(true_level >= 0),
    prestige_xp INTEGER NOT NULL DEFAULT 0 CHECK(prestige_xp >= 0),
    UNIQUE(player_id, skill_name)
  )`,

  `CREATE TABLE IF NOT EXISTS player_status_effects (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id                   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    run_id                      INTEGER REFERENCES active_runs(id) ON DELETE CASCADE,
    effect_type                 TEXT    NOT NULL,
    value                       TEXT    NOT NULL DEFAULT '{}',
    current_stacks              INTEGER NOT NULL DEFAULT 1 CHECK(current_stacks >= 1),
    source                      TEXT    NOT NULL,
    source_id                   INTEGER,
    source_type                 TEXT,
    resolution_order            INTEGER NOT NULL DEFAULT 50,
    on_stack_behaviour          TEXT    NOT NULL DEFAULT 'refresh' CHECK(on_stack_behaviour IN ('refresh','upgrade','waste','block')),
    grants_immunity             TEXT,
    clears_on_combat_end_override INTEGER,
    clock_type                  TEXT    NOT NULL DEFAULT 'sequence' CHECK(clock_type IN ('sequence','round','floor','room','compound','permanent')),
    expires_at_floor            INTEGER,
    expires_at_sequence         INTEGER,
    applied_at                  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  // ──────── BRIDGE / RELATIONAL ────────

  `CREATE TABLE IF NOT EXISTS player_inventory (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id         INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_id           INTEGER NOT NULL REFERENCES items(id),
    quantity          INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 1),
    is_equipped       INTEGER NOT NULL DEFAULT 0,
    is_cursed         INTEGER NOT NULL DEFAULT 0,
    acquired_in_run_id INTEGER,
    acquired_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS player_dungeon_history (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id         INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    dungeon_id        INTEGER NOT NULL REFERENCES dungeons(id),
    times_attempted   INTEGER NOT NULL DEFAULT 0,
    times_completed   INTEGER NOT NULL DEFAULT 0,
    times_died        INTEGER NOT NULL DEFAULT 0,
    first_completed_at TEXT,
    shop_unlocked     INTEGER NOT NULL DEFAULT 0,
    UNIQUE(player_id, dungeon_id)
  )`,

  // ──────── RUN / SESSION ────────

  `CREATE TABLE IF NOT EXISTS active_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id           INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    dungeon_id          INTEGER NOT NULL REFERENCES dungeons(id),
    status              TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','processing','completed','dead','abandoned')),
    current_floor       INTEGER NOT NULL DEFAULT 1 CHECK(current_floor >= 1),
    current_room        INTEGER NOT NULL DEFAULT 1 CHECK(current_room >= 1),
    room_state          TEXT    NOT NULL DEFAULT '{}',
    ai_context          TEXT    NOT NULL DEFAULT '[]',
    run_summary         TEXT,
    started_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    last_action_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    pending_action_text TEXT,
    pending_since       TEXT,
    perks_dirty         INTEGER NOT NULL DEFAULT 0,
    skip_next_action    INTEGER NOT NULL DEFAULT 0,
    generation_seed     TEXT    NOT NULL,
    generation_params   TEXT    NOT NULL DEFAULT '{}',
    run_stats           TEXT    NOT NULL DEFAULT '{"damage_taken":0,"damage_dealt":0,"enemies_killed":0,"rooms_cleared":0}'
  )`,

  `CREATE TABLE IF NOT EXISTS run_floor_maps (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        INTEGER NOT NULL REFERENCES active_runs(id) ON DELETE CASCADE,
    floor_number  INTEGER NOT NULL CHECK(floor_number >= 1),
    floor_map     TEXT    NOT NULL,                      -- JSON: {rooms:[...]}
    generated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(run_id, floor_number)
  )`,

  `CREATE TABLE IF NOT EXISTS run_action_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER NOT NULL REFERENCES active_runs(id),
    player_id       INTEGER NOT NULL REFERENCES players(id),
    sequence        INTEGER NOT NULL CHECK(sequence >= 1),
    floor_number    INTEGER NOT NULL,
    room_number     INTEGER NOT NULL,
    action_type     TEXT    NOT NULL CHECK(action_type IN ('player_action','room_entry','death','run_complete','loot_drop')),
    player_action   TEXT    NOT NULL DEFAULT '',
    checks_rolled   TEXT    NOT NULL DEFAULT '{}',
    dice_results    TEXT    NOT NULL DEFAULT '{}',
    outcome         TEXT    NOT NULL DEFAULT 'success' CHECK(outcome IN ('success','failure','partial','critical_success','critical_failure')),
    ai_response     TEXT    NOT NULL DEFAULT '',
    xp_gained       TEXT    NOT NULL DEFAULT '{}',
    level_ups       TEXT    NOT NULL DEFAULT '[]',
    items_found     TEXT    NOT NULL DEFAULT '[]',
    items_lost      TEXT    NOT NULL DEFAULT '[]',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  // ──────── INDEXES ────────

  `CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)`,
  `CREATE INDEX IF NOT EXISTS idx_items_rarity ON items(rarity)`,
  `CREATE INDEX IF NOT EXISTS idx_enemies_is_boss ON enemies(is_boss)`,
  `CREATE INDEX IF NOT EXISTS idx_loot_rules_source ON loot_rules(source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loot_rules_item ON loot_rules(item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_enemy_rules_source ON enemy_rules(source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_enemy_rules_enemy ON enemy_rules(enemy_id)`,
  `CREATE INDEX IF NOT EXISTS idx_player_skills_player ON player_skills(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_player_inventory_player ON player_inventory(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_player_inventory_equipped ON player_inventory(player_id, is_equipped)`,
  `CREATE INDEX IF NOT EXISTS idx_player_status_player ON player_status_effects(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_player_status_run ON player_status_effects(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_active_runs_player ON active_runs(player_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_run_floor_maps_run ON run_floor_maps(run_id, floor_number)`,
  `CREATE INDEX IF NOT EXISTS idx_run_action_log_run ON run_action_log(run_id, sequence)`,

  // ──────── META ────────

  `CREATE TABLE IF NOT EXISTS _schema_version (
    version TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];