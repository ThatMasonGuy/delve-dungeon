// ═══════════════════════════════════════════════════════════════
// SEED DATA — Test Dungeon: The Sunken Crypt
// ═══════════════════════════════════════════════════════════════
// A 3-floor introductory dungeon with 4 enemy types, a boss,
// basic loot, and enough variety to prove the core loop.
// ═══════════════════════════════════════════════════════════════

import { getDb, insert, transaction, queries } from './index.js';
import { generateDungeonImage } from '../ai/image-gen.js';
import { config } from '../config.js';

export async function seedAll() {
  console.log('[SEED] Seeding v1 test data...');

  let dungeonId;
  transaction(() => {
    seedDamageTypes();
    seedStatusEffects();
    const itemIds = seedItems();
    const enemyIds = seedEnemies();
    dungeonId = seedDungeons();
    seedEnemyRules(dungeonId, enemyIds);
    seedLootRules(dungeonId, itemIds, enemyIds);
  });

  console.log('[SEED] Done.');

  // Generate images async (non-blocking — dungeon works without them)
  if (config.game.generateDungeonImages) {
    console.log('[SEED] Generating dungeon images...');
    try {
      const dungeon = queries.getDungeon(dungeonId);
      const imagePath = await generateDungeonImage(dungeon);
      if (imagePath) {
        queries.setDungeonImage(dungeonId, imagePath);
        console.log(`[SEED] Image set for dungeon ${dungeonId}`);
      }
    } catch (err) {
      console.error('[SEED] Image generation failed (non-fatal):', err.message);
    }
  } else {
    console.log('[SEED] Image generation disabled (set GENERATE_DUNGEON_IMAGES=true to enable)');
  }
}

// ──────── DAMAGE TYPES ────────

function seedDamageTypes() {
  const types = [
    { name: 'slashing',  display_name: 'Slashing',  description: 'Cutting damage from bladed weapons.' },
    { name: 'piercing',  display_name: 'Piercing',  description: 'Puncture damage from pointed weapons and arrows.' },
    { name: 'blunt',     display_name: 'Blunt',     description: 'Crushing damage from hammers and impacts.' },
    { name: 'fire',      display_name: 'Fire',      description: 'Flames and heat.' },
    { name: 'ice',       display_name: 'Ice',       description: 'Frost and cold.' },
    { name: 'arcane',    display_name: 'Arcane',    description: 'Raw magical energy.' },
    { name: 'poison',    display_name: 'Poison',    description: 'Toxic substances and venoms.' },
    { name: 'radiant',   display_name: 'Radiant',   description: 'Holy light and divine energy.' },
    { name: 'necrotic',  display_name: 'Necrotic',  description: 'Death energy and life drain.' },
    { name: 'psychic',   display_name: 'Psychic',   description: 'Mental damage and hallucinations.' },
    { name: 'thunder',   display_name: 'Thunder',   description: 'Sonic force and shockwaves.' },
  ];

  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO damage_types (name, display_name, description) VALUES (?, ?, ?)`
  );
  for (const t of types) {
    stmt.run(t.name, t.display_name, t.description);
  }
  console.log(`  [SEED] ${types.length} damage types`);
}

// ──────── STATUS EFFECTS ────────

function seedStatusEffects() {
  const effects = [
    {
      name: 'burn', effect_category: 'damage', damage_type: 'fire',
      damage_formula: JSON.stringify({ mode: 'flat', value: 3 }),
      tick_timing: 'start_of_action', max_stacks: 3,
      clears_on_combat_end: 1, default_resolution_order: 10,
      tags: JSON.stringify(['dot', 'elemental']),
      description: 'Taking fire damage each action.',
    },
    {
      name: 'bleed', effect_category: 'damage', damage_type: 'slashing',
      damage_formula: JSON.stringify({ mode: 'flat', value: 2 }),
      tick_timing: 'start_of_action', max_stacks: 3,
      clears_on_combat_end: 1, default_resolution_order: 11,
      tags: JSON.stringify(['dot', 'physical']),
      description: 'Bleeding from open wounds.',
    },
    {
      name: 'poison', effect_category: 'damage', damage_type: 'poison',
      damage_formula: JSON.stringify({ mode: 'flat', value: 4 }),
      tick_timing: 'start_of_action', max_stacks: 1,
      clears_on_combat_end: 0, default_resolution_order: 12,
      tags: JSON.stringify(['dot', 'cleansable']),
      description: 'Poison coursing through your veins.',
    },
    {
      name: 'stun', effect_category: 'control', damage_type: null,
      damage_formula: null, tick_timing: 'start_of_action', max_stacks: 1,
      clears_on_combat_end: 1, default_resolution_order: 5,
      tags: JSON.stringify(['control']),
      description: 'Unable to act.',
    },
    {
      name: 'silence', effect_category: 'control', damage_type: null,
      damage_formula: null, tick_timing: 'start_of_action', max_stacks: 1,
      blocks_speech: 1, clears_on_combat_end: 1, default_resolution_order: 6,
      tags: JSON.stringify(['control', 'magical']),
      description: 'Unable to speak or cast verbal spells.',
    },
    {
      name: 'fortify', effect_category: 'buff', damage_type: null,
      damage_formula: null, tick_timing: 'start_of_action', max_stacks: 1,
      clears_on_combat_end: 1, default_resolution_order: 50,
      tags: JSON.stringify(['buff']),
      description: 'Armor increased temporarily.',
    },
  ];

  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO status_effect_definitions
     (name, effect_category, damage_type, damage_formula, tick_timing, max_stacks,
      blocks_speech, clears_on_combat_end, default_resolution_order, tags, description)
     VALUES (@name, @effect_category, @damage_type, @damage_formula, @tick_timing, @max_stacks,
             @blocks_speech, @clears_on_combat_end, @default_resolution_order, @tags, @description)`
  );
  for (const e of effects) {
    stmt.run({ blocks_speech: 0, ...e });
  }
  console.log(`  [SEED] ${effects.length} status effects`);
}

// ──────── ITEMS ────────

function seedItems() {
  const items = [
    // -- Weapons --
    {
      name: 'Rusty Shortsword', type: 'weapon', subtype: 'melee', rarity: 'common',
      base_value: 15, stat_modifiers: JSON.stringify({ damage_bonus: 3 }),
      damage_type: 'slashing', base_crit_range: 20, hand_requirement: 'one_handed',
      description: 'A dull blade with spots of rust. Better than bare fists.',
    },
    {
      name: 'Crypt Warden\'s Mace', type: 'weapon', subtype: 'melee', rarity: 'uncommon',
      base_value: 45, stat_modifiers: JSON.stringify({ damage_bonus: 6 }),
      damage_type: 'blunt', base_crit_range: 19, hand_requirement: 'one_handed',
      description: 'A heavy flanged mace, once wielded by the wardens of this crypt.',
    },
    {
      name: 'Bone Longbow', type: 'weapon', subtype: 'ranged', rarity: 'uncommon',
      base_value: 40, stat_modifiers: JSON.stringify({ damage_bonus: 5, hit_chance: 0.05 }),
      damage_type: 'piercing', base_crit_range: 19, hand_requirement: 'two_handed',
      ammo_type: 'arrow',
      description: 'A longbow carved from a giant\'s rib. Disturbingly flexible.',
    },
    // -- Armor --
    {
      name: 'Tattered Leather Vest', type: 'armor', subtype: 'light_armor', rarity: 'common',
      base_value: 20, stat_modifiers: JSON.stringify({ armor: 2 }),
      description: 'Barely holds together. The smell alone provides some defense.',
    },
    {
      name: 'Chainmail of the Fallen', type: 'armor', subtype: 'medium_armor', rarity: 'uncommon',
      base_value: 60, stat_modifiers: JSON.stringify({ armor: 5, resistance: { slashing: 0.8 } }),
      description: 'Chainmail stripped from one of the crypt\'s less fortunate visitors.',
    },
    {
      name: 'Bone Shield', type: 'armor', subtype: 'shield', rarity: 'common',
      base_value: 25, stat_modifiers: JSON.stringify({ armor: 3 }),
      hand_requirement: 'off_hand',
      description: 'A crude shield fashioned from interlocking bones. Surprisingly sturdy.',
    },
    // -- Consumables --
    {
      name: 'Health Potion', type: 'consumable', subtype: 'potion', rarity: 'common',
      base_value: 10, is_stackable: 1,
      use_effect: JSON.stringify([{ effect_type: 'heal', value: 20, min_value: 10, mode: 'range' }]),
      description: 'A murky red liquid. Tastes terrible, works wonders.',
    },
    {
      name: 'Antidote', type: 'consumable', subtype: 'potion', rarity: 'common',
      base_value: 12, is_stackable: 1,
      use_effect: JSON.stringify([{ effect_type: 'cleanse', value: ['poison'], mode: 'remove_by_name' }]),
      description: 'A chalky green paste dissolved in water. Neutralizes most toxins.',
    },
    {
      name: 'Torch', type: 'consumable', subtype: 'food', rarity: 'common',
      base_value: 3, is_stackable: 1,
      use_effect: JSON.stringify([{ effect_type: 'perception_bonus', value: 3, mode: 'flat', duration_actions: 10 }]),
      description: 'Illuminates dark corridors, revealing hidden details.',
    },
    // -- Ammo --
    {
      name: 'Iron Arrow', type: 'consumable', subtype: 'ammo', rarity: 'common',
      base_value: 1, is_stackable: 1, ammo_type: 'arrow',
      damage_type: 'piercing',
      description: 'Standard iron-tipped arrows. Nothing fancy.',
    },
    // -- Valuables (vendor trash / crafting mats) --
    {
      name: 'Crypt Dust', type: 'valuable', subtype: 'food', rarity: 'common',
      base_value: 5, is_stackable: 1,
      description: 'Fine powder from ancient bones. Alchemists might want this.',
    },
    {
      name: 'Glowing Fungus', type: 'valuable', subtype: 'food', rarity: 'common',
      base_value: 8, is_stackable: 1,
      description: 'Bioluminescent mushroom from the crypt walls. Pulsates softly.',
    },
    {
      name: 'Warden\'s Sigil', type: 'valuable', subtype: 'food', rarity: 'uncommon',
      base_value: 30, is_stackable: 1,
      description: 'A tarnished bronze medallion bearing the crypt warden\'s mark.',
    },
    {
      name: 'Skeleton Key Fragment', type: 'valuable', subtype: 'food', rarity: 'rare',
      base_value: 50, is_stackable: 1,
      description: 'Part of a key forged from bone. Something about it feels important.',
    },
    // -- Lockpick --
    {
      name: 'Thieves\' Pick', type: 'consumable', subtype: 'lockpick', rarity: 'common',
      base_value: 8, is_stackable: 1,
      description: 'A thin metal pick. Breaks easily in inexperienced hands.',
    },
  ];

  const ids = {};
  for (const item of items) {
    const id = insert('items', {
      is_stackable: 0, is_quest_item: 0, base_crit_range: 20,
      stat_modifiers: '{}', ...item,
    });
    ids[item.name] = id;
  }
  console.log(`  [SEED] ${items.length} items`);
  return ids;
}

// ──────── ENEMIES ────────

function seedEnemies() {
  const enemies = [
    {
      name: 'Crypt Rat', description: 'A bloated rat with glowing eyes.',
      lore_text: 'The crypt rats have fed on the dead for centuries, growing large and bold.',
      base_hp: 12, base_damage: 4, base_armor: 0,
      stat_scaling: JSON.stringify({ hp_per_tier: 1.3, damage_per_tier: 1.15, armor_per_tier: 1.0 }),
      abilities: JSON.stringify([
        { name: 'Bite', effect_type: 'damage', damage_type: 'piercing', targeting_shape: 'single',
          check_type: 'melee', base_dc: 8, damage_multiplier: 1.0, trigger_condition: { type: 'always' } },
      ]),
      resistances: JSON.stringify({}), weaknesses: JSON.stringify({ fire: 1.5 }),
      effect_immunities: JSON.stringify([]),
      is_boss: 0, xp_reward: 8, gold_reward_min: 1, gold_reward_max: 3,
      ai_descriptor: 'Skittish vermin. Bites and retreats. Attacks in packs of 2-3. Flees when alone and below half health.',
    },
    {
      name: 'Shambling Skeleton', description: 'A reanimated skeleton wielding a rusted blade.',
      lore_text: 'The dead do not rest easy in the Sunken Crypt. Old bones stir at the slightest disturbance.',
      base_hp: 25, base_damage: 7, base_armor: 2,
      stat_scaling: JSON.stringify({ hp_per_tier: 1.3, damage_per_tier: 1.15, armor_per_tier: 1.1 }),
      abilities: JSON.stringify([
        { name: 'Rusty Slash', effect_type: 'damage', damage_type: 'slashing', targeting_shape: 'single',
          check_type: 'melee', base_dc: 10, damage_multiplier: 1.0, trigger_condition: { type: 'always' } },
        { name: 'Bone Throw', effect_type: 'damage', damage_type: 'blunt', targeting_shape: 'single',
          check_type: 'ranged', base_dc: 12, damage_multiplier: 0.6, trigger_condition: { type: 'always' } },
      ]),
      resistances: JSON.stringify({ piercing: 0.5, necrotic: 0.0 }),
      weaknesses: JSON.stringify({ blunt: 1.5, radiant: 2.0 }),
      effect_immunities: JSON.stringify(['poison', 'bleed']),
      is_boss: 0, xp_reward: 15, gold_reward_min: 3, gold_reward_max: 8,
      ai_descriptor: 'Mindless undead. Approaches slowly, attacks predictably. Resistant to piercing (arrows go through gaps). Vulnerable to being smashed.',
    },
    {
      name: 'Venomous Spider', description: 'A dog-sized spider lurking in the shadows.',
      lore_text: 'Thick webs drape the corners of the crypt, evidence of the spiders that have made it their hunting ground.',
      base_hp: 18, base_damage: 6, base_armor: 1,
      stat_scaling: JSON.stringify({ hp_per_tier: 1.2, damage_per_tier: 1.2, armor_per_tier: 1.0 }),
      abilities: JSON.stringify([
        { name: 'Venomous Bite', effect_type: 'damage', damage_type: 'piercing', targeting_shape: 'single',
          check_type: 'melee', base_dc: 11, damage_multiplier: 0.8,
          effect_category: 'poison', effect_chance: 0.4, effect_target: 'enemy',
          effect_value: { type: 'apply_status', status: 'poison', duration_actions: 5 },
          trigger_condition: { type: 'always' } },
        { name: 'Web Spit', effect_type: 'status_apply', damage_type: null, targeting_shape: 'single',
          check_type: 'ranged', base_dc: 13,
          effect_category: 'stun', effect_chance: 0.6, effect_target: 'enemy',
          effect_value: { type: 'apply_status', status: 'stun', duration_actions: 1 },
          trigger_condition: { type: 'always' }, cooldown_rounds: 3 },
      ]),
      resistances: JSON.stringify({ poison: 0.0 }),
      weaknesses: JSON.stringify({ fire: 2.0 }),
      effect_immunities: JSON.stringify(['poison']),
      is_boss: 0, xp_reward: 18, gold_reward_min: 2, gold_reward_max: 6,
      ai_descriptor: 'Ambush predator. Drops from ceilings. Leads with web spit to immobilize, then bites for poison. Terrified of fire.',
    },
    {
      name: 'The Hollow Warden', description: 'A towering armored revenant bound to guard the crypt.',
      lore_text: 'Once the captain of the crypt guard, the Warden was cursed to defend these halls for eternity. His armor has fused to his bones.',
      base_hp: 80, base_damage: 14, base_armor: 8,
      stat_scaling: JSON.stringify({ hp_per_tier: 1.4, damage_per_tier: 1.2, armor_per_tier: 1.15 }),
      abilities: JSON.stringify([
        { name: 'Warden\'s Cleave', effect_type: 'damage', damage_type: 'slashing', targeting_shape: 'single',
          check_type: 'melee', base_dc: 14, damage_multiplier: 1.5, trigger_condition: { type: 'always' } },
        { name: 'Shield Bash', effect_type: 'damage', damage_type: 'blunt', targeting_shape: 'single',
          check_type: 'melee', base_dc: 12, damage_multiplier: 0.8,
          effect_category: 'stun', effect_chance: 0.5, effect_target: 'enemy',
          effect_value: { type: 'apply_status', status: 'stun', duration_actions: 1 },
          trigger_condition: { type: 'always' }, cooldown_rounds: 2 },
        { name: 'Deathly Roar', effect_type: 'status_apply', damage_type: 'necrotic', targeting_shape: 'room_wide',
          check_type: 'wisdom_save', base_dc: 15,
          on_save_effect: { type: 'no_effect' },
          effect_category: 'silence', effect_chance: 1.0, effect_target: 'enemy',
          effect_value: { type: 'apply_status', status: 'silence', duration_actions: 2 },
          trigger_condition: { type: 'hp_threshold_below', value: 0.5 }, max_charges: 1 },
      ]),
      resistances: JSON.stringify({ slashing: 0.7, piercing: 0.5, necrotic: 0.0 }),
      weaknesses: JSON.stringify({ radiant: 2.0, blunt: 1.3 }),
      effect_immunities: JSON.stringify(['poison', 'bleed', 'stun']),
      is_boss: 1, xp_reward: 75, gold_reward_min: 25, gold_reward_max: 50,
      ai_descriptor: 'Imposing and deliberate. Speaks in hollow echoes. Opens with Cleave, uses Shield Bash to punish aggressive players. Below 50% HP, unleashes Deathly Roar once — a desperate, terrifying scream that silences magic. Fights with grim purpose, not rage.',
    },
  ];

  const ids = {};
  for (const enemy of enemies) {
    const id = insert('enemies', enemy);
    ids[enemy.name] = id;
  }
  console.log(`  [SEED] ${enemies.length} enemies`);
  return ids;
}

// ──────── DUNGEONS ────────

function seedDungeons() {
  const id = insert('dungeons', {
    name: 'The Sunken Crypt',
    difficulty_tier: 1,
    floor_count: 3,
    entry_cost: 10,
    dc_range: JSON.stringify({ min: 8, max: 16 }),
    theme: 'Flooded ancient catacombs with bioluminescent fungi, dripping ceilings, and crumbling stone. The air is damp and heavy. Water pools in low corridors.',
    ai_context_seed: `You are the narrator of The Sunken Crypt, an ancient catacomb beneath a forgotten temple. The air is thick with moisture and the smell of decay. Bioluminescent fungi cast an eerie blue-green glow along the walls. Water seeps through cracked stone, pooling in corridors and chambers. The dead were entombed here centuries ago, but something has disturbed their rest.

Narrate in second person present tense. Be atmospheric but concise — 2-3 paragraphs max per response. Describe what the player sees, hears, and feels. When combat occurs, describe attacks and their effects vividly. When checks are rolled, weave the mechanical result into the narrative naturally.

You must NEVER invent items, enemies, or room contents that aren't in the provided game state. You can describe the environment and atmosphere freely, but all mechanical elements (enemies present, items available, exits) come from the room data you're given.`,
    is_secret: 0,
    completion_condition: JSON.stringify({ type: 'boss_killed', enemy_id: null }), // Updated after enemy insert
  });

  console.log(`  [SEED] 1 dungeon: The Sunken Crypt (id: ${id})`);
  return id;
}

// ──────── ENEMY RULES ────────

function seedEnemyRules(dungeonId, enemyIds) {
  const rules = [
    // Floor 1-2: rats and spiders
    { source_type: 'dungeon', source_id: dungeonId, enemy_id: enemyIds['Crypt Rat'], spawn_weight: 40 },
    { source_type: 'dungeon', source_id: dungeonId, enemy_id: enemyIds['Venomous Spider'], spawn_weight: 25 },
    // Floor 2-3: skeletons join
    { source_type: 'dungeon', source_id: dungeonId, enemy_id: enemyIds['Shambling Skeleton'], spawn_weight: 30 },
    // Boss: The Hollow Warden (floor 3 boss room only — handled by generation, not spawn weight)
    { source_type: 'dungeon', source_id: dungeonId, enemy_id: enemyIds['The Hollow Warden'], spawn_weight: 0 },
  ];

  for (const rule of rules) {
    insert('enemy_rules', { condition_type: 'none', ...rule });
  }

  // Update dungeon completion condition with boss enemy id
  getDb().prepare(
    `UPDATE dungeons SET completion_condition = ? WHERE id = ?`
  ).run(JSON.stringify({ type: 'boss_killed', enemy_id: enemyIds['The Hollow Warden'] }), dungeonId);

  console.log(`  [SEED] ${rules.length} enemy rules`);
}

// ──────── LOOT RULES ────────

function seedLootRules(dungeonId, itemIds, enemyIds) {
  const rules = [
    // -- Rat drops --
    { source_type: 'enemy_kill', source_id: enemyIds['Crypt Rat'],
      item_id: itemIds['Crypt Dust'], drop_type: 'weighted', base_weight: 60 },

    // -- Skeleton drops --
    { source_type: 'enemy_kill', source_id: enemyIds['Shambling Skeleton'],
      item_id: itemIds['Rusty Shortsword'], drop_type: 'weighted', base_weight: 15 },
    { source_type: 'enemy_kill', source_id: enemyIds['Shambling Skeleton'],
      item_id: itemIds['Bone Shield'], drop_type: 'weighted', base_weight: 10 },
    { source_type: 'enemy_kill', source_id: enemyIds['Shambling Skeleton'],
      item_id: itemIds['Crypt Dust'], drop_type: 'weighted', base_weight: 40 },

    // -- Spider drops --
    { source_type: 'enemy_kill', source_id: enemyIds['Venomous Spider'],
      item_id: itemIds['Glowing Fungus'], drop_type: 'weighted', base_weight: 50 },
    { source_type: 'enemy_kill', source_id: enemyIds['Venomous Spider'],
      item_id: itemIds['Antidote'], drop_type: 'weighted', base_weight: 20 },

    // -- Boss drops --
    { source_type: 'boss', source_id: enemyIds['The Hollow Warden'],
      item_id: itemIds['Crypt Warden\'s Mace'], drop_type: 'guaranteed', base_weight: 0 },
    { source_type: 'boss', source_id: enemyIds['The Hollow Warden'],
      item_id: itemIds['Warden\'s Sigil'], drop_type: 'guaranteed', base_weight: 0 },
    { source_type: 'boss', source_id: enemyIds['The Hollow Warden'],
      item_id: itemIds['Chainmail of the Fallen'], drop_type: 'weighted', base_weight: 30 },
    { source_type: 'boss', source_id: enemyIds['The Hollow Warden'],
      item_id: itemIds['Skeleton Key Fragment'], drop_type: 'weighted', base_weight: 10 },

    // -- Chest loot (source_id = dungeon for generic chests) --
    { source_type: 'chest', source_id: dungeonId,
      item_id: itemIds['Health Potion'], drop_type: 'weighted', base_weight: 40 },
    { source_type: 'chest', source_id: dungeonId,
      item_id: itemIds['Antidote'], drop_type: 'weighted', base_weight: 20 },
    { source_type: 'chest', source_id: dungeonId,
      item_id: itemIds['Torch'], drop_type: 'weighted', base_weight: 25 },
    { source_type: 'chest', source_id: dungeonId,
      item_id: itemIds['Iron Arrow'], drop_type: 'weighted', base_weight: 30 },
    { source_type: 'chest', source_id: dungeonId,
      item_id: itemIds['Thieves\' Pick'], drop_type: 'weighted', base_weight: 20 },
    { source_type: 'chest', source_id: dungeonId,
      item_id: itemIds['Tattered Leather Vest'], drop_type: 'weighted', base_weight: 10 },
    { source_type: 'chest', source_id: dungeonId,
      item_id: itemIds['Bone Longbow'], drop_type: 'weighted', base_weight: 5 },
    { source_type: 'chest', source_id: dungeonId,
      item_id: itemIds['Crypt Warden\'s Mace'], drop_type: 'weighted', base_weight: 3,
      requires_perception: 1, perception_dc: 16 },

    // -- Room drops (ambient loot, source_id = dungeon) --
    { source_type: 'room_drop', source_id: dungeonId,
      item_id: itemIds['Crypt Dust'], drop_type: 'weighted', base_weight: 30 },
    { source_type: 'room_drop', source_id: dungeonId,
      item_id: itemIds['Glowing Fungus'], drop_type: 'weighted', base_weight: 20 },
  ];

  for (const rule of rules) {
    insert('loot_rules', {
      condition_type: 'none', enchantment_rule: 'none',
      requires_perception: 0, ...rule,
    });
  }
  console.log(`  [SEED] ${rules.length} loot rules`);
}