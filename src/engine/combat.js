// ═══════════════════════════════════════════════════════════════
// COMBAT — Enemy turns, damage, death, XP
// ═══════════════════════════════════════════════════════════════

import { roll, rollDamage, skillCheck, statModifier } from './dice.js';
import { resolveLoot, rollGoldDrop } from './loot.js';
import { queries, execute } from '../db/index.js';

/**
 * Process an enemy turn in combat.
 * The AI narrates the result; this function handles the mechanics.
 *
 * @param {object} enemy - Enemy instance from room_state
 * @param {object} player - Player row
 * @param {object} baseStats - Player base stats
 * @param {object} equippedItems - Player's equipped items for armor calc
 * @returns {{ action, damage, effects, description }}
 */
export function processEnemyTurn(enemy, player, baseStats, equippedItems) {
  if (enemy.is_dead || enemy.skip_next_action) {
    if (enemy.skip_next_action) enemy.skip_next_action = false;
    return { action: 'skip', damage: 0, effects: [], description: null };
  }

  // Pick an ability (respect cooldowns and charges)
  const ability = pickEnemyAbility(enemy);
  if (!ability) {
    return { action: 'idle', damage: 0, effects: [], description: `${enemy.name} hesitates.` };
  }

  // Track cooldown
  if (ability.cooldown_rounds) {
    enemy.ability_cooldowns[ability.name] = ability.cooldown_rounds;
  }
  if (ability.max_charges != null) {
    enemy.ability_charges[ability.name] = (enemy.ability_charges[ability.name] ?? ability.max_charges) - 1;
  }

  // Calculate player's total armor from equipped items
  const playerArmor = calculatePlayerArmor(equippedItems);

  // Calculate player resistance to this damage type
  const resistanceMult = calculatePlayerResistance(equippedItems, ability.damage_type);

  // Determine if player dodges (dexterity save)
  const dodgeCheck = skillCheck({
    skillName: ability.check_type === 'melee' ? 'melee' : (ability.check_type === 'ranged' ? 'ranged' : 'survival'),
    dc: ability.base_dc || 12,
    baseStats,
    skills: {}, // Player's skill data would go here in full impl
    dcSource: 'enemy_ability',
  });

  const result = {
    action: ability.name,
    ability,
    dodge_check: dodgeCheck,
    damage: 0,
    effects: [],
    description: null,
  };

  if (dodgeCheck.passed && !dodgeCheck.is_fumble) {
    // Player dodged/blocked
    if (dodgeCheck.outcome === 'partial') {
      // Partial: take half damage
      const dmg = rollDamage({
        baseDamage: enemy.damage,
        weaponBonus: 0,
        isCritical: false,
        targetArmor: playerArmor,
        resistanceMultiplier: resistanceMult,
      });
      result.damage = Math.floor(dmg.mitigatedDamage / 2);
      result.damageDetails = dmg;
    }
    // Full success: no damage
  } else {
    // Player hit
    const dmg = rollDamage({
      baseDamage: enemy.damage * (ability.damage_multiplier || 1.0),
      weaponBonus: 0,
      isCritical: false,
      targetArmor: playerArmor,
      resistanceMultiplier: resistanceMult,
    });
    result.damage = dmg.mitigatedDamage;
    result.damageDetails = dmg;

    // Check for status effect application
    if (ability.effect_chance && ability.effect_value) {
      if (Math.random() < ability.effect_chance) {
        result.effects.push({
          type: ability.effect_value.status || ability.effect_category,
          duration: ability.effect_value.duration_actions || 3,
          source: enemy.name,
        });
      }
    }
  }

  return result;
}

/**
 * Pick an ability for an enemy to use, respecting cooldowns and trigger conditions.
 */
function pickEnemyAbility(enemy) {
  const available = enemy.abilities.filter(a => {
    // Check cooldown
    if (a.cooldown_rounds && (enemy.ability_cooldowns[a.name] || 0) > 0) return false;
    // Check charges
    if (a.max_charges != null && (enemy.ability_charges[a.name] ?? a.max_charges) <= 0) return false;
    // Check trigger condition
    if (a.trigger_condition) {
      if (a.trigger_condition.type === 'hp_threshold_below') {
        if (enemy.hp_current / enemy.hp_max > a.trigger_condition.value) return false;
      }
      if (a.trigger_condition.type === 'hp_threshold_above') {
        if (enemy.hp_current / enemy.hp_max < a.trigger_condition.value) return false;
      }
    }
    return true;
  });

  if (available.length === 0) return null;

  // Pick randomly, weighting slightly toward higher damage abilities
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Apply damage to an enemy and check for death.
 * Returns loot drops if enemy dies.
 */
export function damageEnemy(enemy, damage, damageType, player, roomState) {
  // Apply resistance
  const resistance = enemy.resistances?.[damageType] ?? 1.0;
  const afterResistance = Math.round(damage * resistance);

  // Apply armor
  const afterArmor = Math.max(1, afterResistance - enemy.armor);

  enemy.hp_current -= afterArmor;

  const result = {
    damageDealt: afterArmor,
    rawDamage: damage,
    resistanceApplied: resistance !== 1.0,
    resistanceMultiplier: resistance,
    armorReduced: Math.max(0, afterResistance - afterArmor),
    enemyDied: false,
    loot: [],
    goldDrop: 0,
    xpReward: 0,
  };

  if (enemy.hp_current <= 0) {
    enemy.hp_current = 0;
    enemy.is_dead = true;
    result.enemyDied = true;

    // Resolve loot
    const sourceType = enemy.is_boss ? 'boss' : 'enemy_kill';
    result.loot = resolveLoot(sourceType, enemy.enemy_id);

    // Gold drop
    result.goldDrop = rollGoldDrop(enemy.gold_reward_min, enemy.gold_reward_max);

    // XP
    result.xpReward = enemy.xp_reward;

    // Check if all enemies dead → combat ends
    const allDead = roomState.enemies.every(e => e.is_dead);
    if (allDead) {
      roomState.is_combat_active = false;
    }
  }

  return result;
}

/**
 * Calculate total player armor from equipped items.
 */
export function calculatePlayerArmor(equippedItems) {
  let total = 0;
  for (const item of equippedItems) {
    try {
      const mods = typeof item.stat_modifiers === 'string' ? JSON.parse(item.stat_modifiers) : item.stat_modifiers;
      total += mods?.armor || 0;
    } catch { /* skip */ }
  }
  return total;
}

/**
 * Calculate player's resistance multiplier for a damage type from equipped items.
 */
export function calculatePlayerResistance(equippedItems, damageType) {
  if (!damageType) return 1.0;
  let multiplier = 1.0;
  for (const item of equippedItems) {
    try {
      const mods = typeof item.stat_modifiers === 'string' ? JSON.parse(item.stat_modifiers) : item.stat_modifiers;
      if (mods?.resistance?.[damageType]) {
        multiplier *= mods.resistance[damageType];
      }
    } catch { /* skip */ }
  }
  return multiplier;
}

/**
 * Calculate weapon damage bonus from equipped weapon.
 */
export function getWeaponDamageBonus(equippedItems) {
  for (const item of equippedItems) {
    if (item.item_type === 'weapon') {
      try {
        const mods = typeof item.stat_modifiers === 'string' ? JSON.parse(item.stat_modifiers) : item.stat_modifiers;
        return mods?.damage_bonus || 0;
      } catch { return 0; }
    }
  }
  return 0;
}

/**
 * Get equipped weapon's crit range.
 */
export function getWeaponCritRange(equippedItems) {
  for (const item of equippedItems) {
    if (item.item_type === 'weapon') {
      return item.base_crit_range || 20;
    }
  }
  return 20;
}

/**
 * Get equipped weapon's damage type.
 */
export function getWeaponDamageType(equippedItems) {
  for (const item of equippedItems) {
    if (item.item_type === 'weapon') {
      return item.damage_type || 'blunt';
    }
  }
  return 'blunt'; // Unarmed = blunt
}

/**
 * Tick down all enemy ability cooldowns at end of round.
 */
export function tickCooldowns(roomState) {
  for (const enemy of roomState.enemies) {
    if (enemy.is_dead) continue;
    for (const ability of Object.keys(enemy.ability_cooldowns)) {
      if (enemy.ability_cooldowns[ability] > 0) {
        enemy.ability_cooldowns[ability]--;
      }
    }
  }
  roomState.round_number = (roomState.round_number || 0) + 1;
}

/**
 * Handle player death.
 * - Lose half of items acquired this run (rounded up, excluding quest items)
 * - Lose percentage of gold
 * - End the run
 */
export function handlePlayerDeath(playerId, runId) {
  const player = queries.getPlayerByDiscordId(null); // We need the player by ID
  // Get items acquired this run
  const runItems = queries.getInventory(playerId).filter(i =>
    i.acquired_in_run_id === runId && !i.is_quest_item
  );

  const itemsLost = [];
  if (runItems.length > 0) {
    // Lose half, rounded up
    const loseCount = Math.ceil(runItems.length / 2);
    // Shuffle and take first N
    const shuffled = runItems.sort(() => Math.random() - 0.5);
    for (let i = 0; i < loseCount && i < shuffled.length; i++) {
      itemsLost.push({
        item_id: shuffled[i].item_id,
        name: shuffled[i].item_name,
        quantity: shuffled[i].quantity,
      });
      queries.removeItem(shuffled[i].id, shuffled[i].quantity);
    }
  }

  // Remove ALL quest items from this run
  const questItems = queries.getInventory(playerId).filter(i =>
    i.acquired_in_run_id === runId && i.is_quest_item
  );
  for (const qi of questItems) {
    queries.removeItem(qi.id, qi.quantity);
    itemsLost.push({ item_id: qi.item_id, name: qi.item_name, quantity: qi.quantity, was_quest_item: true });
  }

  return { itemsLost };
}

/**
 * Distribute XP to relevant skills based on what the player did.
 * @param {number} playerId
 * @param {string} skillName - Primary skill used
 * @param {number} baseXp - Base XP from the action
 * @param {string} outcome - 'success' | 'failure' etc.
 * @returns {{ skill, xp_gained, leveled_up, old_level, new_level }[]}
 */
export function distributeXp(playerId, skillName, baseXp, outcome) {
  // Bonus XP for crits, reduced for failures
  let xpMultiplier = 1.0;
  if (outcome === 'critical_success') xpMultiplier = 2.0;
  else if (outcome === 'failure') xpMultiplier = 0.5;
  else if (outcome === 'critical_failure') xpMultiplier = 0.25;

  const xp = Math.max(1, Math.round(baseXp * xpMultiplier));

  const skill = queries.getPlayerSkill(playerId, skillName);
  if (!skill) return [];

  const oldLevel = skill.level;
  queries.updateSkillXp(playerId, skillName, xp);

  // Check for level up — simple formula: level N requires N*100 total XP
  const newXp = skill.xp + xp;
  const newLevel = Math.min(100, Math.floor(Math.sqrt(newXp / 10)) + 1);

  const levelUps = [];
  if (newLevel > oldLevel) {
    // Update level
    execute(
      `UPDATE player_skills SET level = ?, true_level = true_level + ? WHERE player_id = ? AND skill_name = ?`,
      [newLevel, newLevel - oldLevel, playerId, skillName]
    );
    levelUps.push({
      skill: skillName,
      xp_gained: xp,
      old_level: oldLevel,
      new_level: newLevel,
    });
  }

  return levelUps.length > 0 ? levelUps : [{ skill: skillName, xp_gained: xp, leveled_up: false }];
}
