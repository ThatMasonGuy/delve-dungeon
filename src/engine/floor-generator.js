// ═══════════════════════════════════════════════════════════════
// FLOOR GENERATOR — Procedural room layout
// ═══════════════════════════════════════════════════════════════
// Generates a floor_map JSON matching the run_floor_maps schema.
// Each floor is a connected graph of rooms with types, enemies,
// chests, and connections between rooms.
// ═══════════════════════════════════════════════════════════════

import { roll, weightedRandom, randomDC } from './dice.js';
import { queries, parseJsonFields } from '../db/index.js';

const ROOM_TYPES = ['standard', 'treasure', 'trap', 'rest', 'locked'];
const BOSS_ROOM_TYPE = 'boss';

/**
 * Generate a complete floor map for a dungeon run.
 *
 * @param {object} params
 * @param {object} params.dungeon - Dungeon row (parsed JSON fields)
 * @param {number} params.floorNumber - Which floor (1-indexed)
 * @param {boolean} params.isFinalFloor - Whether this is the last floor
 * @param {object[]} params.enemyRules - Enemy rules for this dungeon
 * @param {string} params.seed - Generation seed (for logging, not yet deterministic)
 * @returns {{ rooms: object[] }}
 */
export function generateFloor({ dungeon, floorNumber, isFinalFloor, enemyRules, seed }) {
  const dcRange = dungeon.dc_range;

  // Room count: 4-6 for early floors, 5-8 for later floors
  const baseRoomCount = 4 + Math.floor(floorNumber / 2);
  const roomCount = baseRoomCount + roll(3) - 1; // ±1 variance

  const rooms = [];

  // Room 1 is always the entrance
  rooms.push(createRoom({
    room_number: 1,
    type: 'standard',
    dcRange,
    floorNumber,
    enemyRules,
    isEntrance: true,
    dungeon,
  }));

  // Generate middle rooms
  for (let i = 2; i < roomCount; i++) {
    let type = pickRoomType(floorNumber, i, roomCount);
    // Room 2 can't be locked — it's the only path from the entrance
    if (i === 2 && type === 'locked') type = 'standard';
    rooms.push(createRoom({
      room_number: i,
      type,
      dcRange,
      floorNumber,
      enemyRules,
      isEntrance: false,
      dungeon,
    }));
  }

  // Last room: boss room on final floor, otherwise standard/exit
  if (isFinalFloor) {
    rooms.push(createRoom({
      room_number: roomCount,
      type: BOSS_ROOM_TYPE,
      dcRange,
      floorNumber,
      enemyRules,
      isEntrance: false,
      dungeon,
      isBossRoom: true,
    }));
  } else {
    rooms.push(createRoom({
      room_number: roomCount,
      type: 'standard',
      dcRange,
      floorNumber,
      enemyRules,
      isEntrance: false,
      dungeon,
      isExit: true,
    }));
  }

  // Generate connections (linear with some branches)
  generateConnections(rooms);

  return { rooms };
}

/**
 * Pick a room type for a middle room.
 */
function pickRoomType(floorNumber, roomIndex, totalRooms) {
  const pool = [
    { weight: 45, item: 'standard' },
    { weight: 15, item: 'treasure' },
    { weight: 15, item: 'trap' },
    { weight: 10, item: 'rest' },
    { weight: 10, item: 'locked' },
  ];

  // Increase trap/locked chance on deeper floors
  if (floorNumber >= 2) {
    pool.find(p => p.item === 'trap').weight += 5;
    pool.find(p => p.item === 'locked').weight += 5;
    pool.find(p => p.item === 'standard').weight -= 10;
  }

  return weightedRandom(pool);
}

/**
 * Create a single room object.
 */
function createRoom({ room_number, type, dcRange, floorNumber, enemyRules, isEntrance, dungeon, isBossRoom = false, isExit = false }) {
  const room = {
    room_number,
    type,
    is_cleared: false,
    is_accessible: room_number === 1, // Only first room accessible initially
    connections: [],
    actions_in_room_count: 0,
    geometry_tags: [],
  };

  // Enemy placement
  room.enemies = [];
  if (type === 'standard' && !isEntrance) {
    // 60% chance of enemies in standard rooms
    if (Math.random() < 0.6) {
      room.enemies = spawnEnemies(enemyRules, floorNumber, dungeon.difficulty_tier, false);
    }
  } else if (type === 'trap') {
    // Traps sometimes have enemies too (30%)
    if (Math.random() < 0.3) {
      room.enemies = spawnEnemies(enemyRules, floorNumber, dungeon.difficulty_tier, false);
    }
    room.trap = generateTrap(dcRange);
  } else if (type === BOSS_ROOM_TYPE) {
    room.enemies = spawnEnemies(enemyRules, floorNumber, dungeon.difficulty_tier, true);
  }

  // Chest placement
  room.chest = null;
  if (type === 'treasure') {
    room.chest = { is_opened: false, is_locked: Math.random() < 0.4, lock_dc: null, is_looted: false };
    if (room.chest.is_locked) {
      room.chest.lock_dc = randomDC(dcRange);
    }
  } else if (type === 'standard' && !isEntrance && Math.random() < 0.15) {
    // Small chance of a chest in standard rooms
    room.chest = { is_opened: false, is_locked: false, lock_dc: null, is_looted: false };
  }

  // Locked room lock
  if (type === 'locked') {
    room.lock = {
      lock_dc: randomDC({ min: dcRange.min + 2, max: dcRange.max + 2 }),
      requires_key: false,
    };
    room.is_accessible = false;
  }

  // Rest rooms
  if (type === 'rest') {
    room.rest = { heal_percent: 0.2 + Math.random() * 0.15 }; // 20-35% HP restore
  }

  // Mark exit rooms
  if (isExit) {
    room.is_exit = true;
  }
  if (isBossRoom) {
    room.is_boss_room = true;
  }

  return room;
}

/**
 * Spawn enemies for a room based on enemy_rules.
 */
function spawnEnemies(enemyRules, floorNumber, difficultyTier, isBossRoom) {
  const enemies = [];

  if (isBossRoom) {
    // Find boss enemy
    const bossRules = enemyRules.filter(r => r.is_boss === 1);
    if (bossRules.length > 0) {
      const bossRule = bossRules[0];
      const boss = createEnemyInstance(bossRule, difficultyTier, true);
      enemies.push(boss);
    }
    // Boss might have adds (50% chance, 1-2 regular enemies)
    if (Math.random() < 0.5) {
      const regularRules = enemyRules.filter(r => r.is_boss === 0 && r.spawn_weight > 0);
      const addCount = roll(2);
      for (let i = 0; i < addCount; i++) {
        const rule = weightedRandom(regularRules.map(r => ({ weight: r.spawn_weight, item: r })));
        if (rule) enemies.push(createEnemyInstance(rule, difficultyTier, false));
      }
    }
    return enemies;
  }

  // Regular room: 1-2 enemies (capped at 2 to keep encounters manageable)
  const regularRules = enemyRules.filter(r => r.is_boss === 0 && r.spawn_weight > 0);
  if (regularRules.length === 0) return enemies;

  const enemyCount = 1 + Math.floor(Math.random() * Math.min(2, floorNumber));

  for (let i = 0; i < enemyCount; i++) {
    const rule = weightedRandom(regularRules.map(r => ({ weight: r.spawn_weight, item: r })));
    if (rule) enemies.push(createEnemyInstance(rule, difficultyTier, false));
  }

  return enemies;
}

/**
 * Create an enemy instance from an enemy rule.
 * Applies difficulty tier scaling to base stats.
 */
function createEnemyInstance(rule, difficultyTier, isBoss) {
  let scaling;
  try {
    scaling = typeof rule.stat_scaling === 'string' ? JSON.parse(rule.stat_scaling) : rule.stat_scaling;
  } catch { scaling = { hp_per_tier: 1.3, damage_per_tier: 1.15, armor_per_tier: 1.1 }; }

  const tierMultiplier = Math.max(0, difficultyTier - 1); // Tier 1 = base stats (no scaling)

  let abilities;
  try {
    abilities = typeof rule.abilities === 'string' ? JSON.parse(rule.abilities) : rule.abilities;
  } catch { abilities = []; }

  let resistances, weaknesses, effectImmunities;
  try {
    resistances = typeof rule.resistances === 'string' ? JSON.parse(rule.resistances) : rule.resistances;
    weaknesses = typeof rule.weaknesses === 'string' ? JSON.parse(rule.weaknesses) : rule.weaknesses;
    effectImmunities = typeof rule.effect_immunities === 'string' ? JSON.parse(rule.effect_immunities) : rule.effect_immunities;
  } catch {
    resistances = {};
    weaknesses = {};
    effectImmunities = [];
  }

  const scaledHp = Math.round(rule.base_hp * Math.pow(scaling.hp_per_tier || 1.3, tierMultiplier));
  const scaledDamage = Math.round(rule.base_damage * Math.pow(scaling.damage_per_tier || 1.15, tierMultiplier));
  const scaledArmor = Math.round(rule.base_armor * Math.pow(scaling.armor_per_tier || 1.1, tierMultiplier));

  return {
    enemy_id: rule.enemy_id,
    instance_id: `enemy_${rule.enemy_id}_${Date.now()}_${roll(10000)}`,
    name: rule.enemy_name,
    hp_current: scaledHp,
    hp_max: scaledHp,
    damage: scaledDamage,
    armor: scaledArmor,
    abilities,
    resistances,
    weaknesses,
    effect_immunities: effectImmunities,
    is_boss: isBoss ? 1 : 0,
    is_dead: false,
    xp_reward: rule.xp_reward,
    gold_reward_min: rule.gold_reward_min,
    gold_reward_max: rule.gold_reward_max,
    ai_descriptor: rule.ai_descriptor || '',
    awareness: 'idle',       // idle | alert | hostile
    position: 'guarding',    // patrolling | guarding | idle | fleeing
    position_zone: 'open',   // open | behind_cover | elevated | flanking
    dc_modifier: 0,
    skip_next_action: false,
    status_effects: [],
    ability_cooldowns: {},
    ability_charges: {},
  };
}

/**
 * Generate a trap for a trap room.
 */
function generateTrap(dcRange) {
  const traps = [
    { name: 'Poison Dart Trap', damage_type: 'piercing', damage: 8, effect: 'poison', check: 'perception', description: 'Thin wires stretch across the corridor at ankle height.' },
    { name: 'Flame Jet', damage_type: 'fire', damage: 12, effect: null, check: 'dexterity', description: 'Scorch marks blacken the walls. The air smells of oil.' },
    { name: 'Collapsing Floor', damage_type: 'blunt', damage: 10, effect: 'stun', check: 'perception', description: 'The flagstones here seem uneven, slightly loose.' },
    { name: 'Necrotic Rune', damage_type: 'necrotic', damage: 15, effect: null, check: 'magic', description: 'A faintly glowing sigil is carved into the floor.' },
    { name: 'Spider Web Ambush', damage_type: 'piercing', damage: 6, effect: 'stun', check: 'perception', description: 'Thick webbing covers the doorway ahead.' },
  ];

  const trap = traps[Math.floor(Math.random() * traps.length)];
  return {
    ...trap,
    dc: randomDC(dcRange),
    is_triggered: false,
    is_disarmed: false,
  };
}

/**
 * Generate connections between rooms.
 * Creates a linear path with some optional branches.
 */
function generateConnections(rooms) {
  // Primary linear path: 1 → 2 → 3 → ... → N
  for (let i = 0; i < rooms.length - 1; i++) {
    const from = rooms[i];
    const to = rooms[i + 1];
    if (!from.connections.includes(to.room_number)) {
      from.connections.push(to.room_number);
    }
    if (!to.connections.includes(from.room_number)) {
      to.connections.push(from.room_number);
    }
    // Rooms on the main path are accessible once the previous room is cleared
    // (except locked rooms which need lockpicking)
    if (to.type !== 'locked') {
      to.is_accessible = false; // Will be unlocked when previous room is cleared
    }
  }

  // First room always accessible
  rooms[0].is_accessible = true;

  // Optional branches: 20% chance per room to have a side connection
  for (let i = 1; i < rooms.length - 2; i++) {
    if (Math.random() < 0.2) {
      // Connect to a non-adjacent room
      const target = i + 2 + Math.floor(Math.random() * Math.min(2, rooms.length - i - 2));
      if (target < rooms.length) {
        rooms[i].connections.push(rooms[target].room_number);
        rooms[target].connections.push(rooms[i].room_number);
      }
    }
  }
}

/**
 * Get the current room data from a floor map.
 * This is what gets sent to the AI — just the single room, not the full floor.
 */
export function getCurrentRoom(floorMap, roomNumber) {
  return floorMap.rooms.find(r => r.room_number === roomNumber) || null;
}

/**
 * Mark a room as cleared and unlock connected rooms.
 * Returns list of newly accessible room numbers.
 */
export function clearRoom(floorMap, roomNumber) {
  const room = floorMap.rooms.find(r => r.room_number === roomNumber);
  if (!room) return [];

  room.is_cleared = true;

  // Unlock connected rooms (except locked ones)
  const newlyAccessible = [];
  for (const connectedNum of room.connections) {
    const connected = floorMap.rooms.find(r => r.room_number === connectedNum);
    if (connected && !connected.is_accessible && connected.type !== 'locked') {
      connected.is_accessible = true;
      newlyAccessible.push(connectedNum);
    }
  }

  return newlyAccessible;
}

/**
 * Unlock a locked room (after lockpicking check).
 */
export function unlockRoom(floorMap, roomNumber) {
  const room = floorMap.rooms.find(r => r.room_number === roomNumber);
  if (room) {
    room.is_accessible = true;
    if (room.lock) room.lock.is_picked = true;
  }
}
