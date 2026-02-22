// ═══════════════════════════════════════════════════════════════
// DICE — d20 rolls, skill checks, crit detection
// ═══════════════════════════════════════════════════════════════
// All randomness in the game flows through here. Every roll is
// fully auditable — base roll, modifiers, bonuses, final total.
// ═══════════════════════════════════════════════════════════════

/**
 * Roll a single die.
 * @param {number} sides - Number of sides (default 20)
 * @returns {number}
 */
export function roll(sides = 20) {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Roll multiple dice and sum them.
 * @param {number} count - Number of dice
 * @param {number} sides - Sides per die
 * @returns {{ rolls: number[], total: number }}
 */
export function rollMultiple(count, sides = 6) {
  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(roll(sides));
  }
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

/**
 * Roll 3d6 for a stat (character creation).
 * @returns {number} 3-18
 */
export function rollStat() {
  return rollMultiple(3, 6).total;
}

/**
 * Roll all six base stats for character creation.
 * @returns {{ strength, dexterity, constitution, intelligence, wisdom, charisma }}
 */
export function rollBaseStats() {
  return {
    strength: rollStat(),
    dexterity: rollStat(),
    constitution: rollStat(),
    intelligence: rollStat(),
    wisdom: rollStat(),
    charisma: rollStat(),
  };
}

/**
 * Calculate the modifier for a base stat (DnD style).
 * 10-11 = +0, 12-13 = +1, 8-9 = -1, etc.
 * @param {number} statValue
 * @returns {number}
 */
export function statModifier(statValue) {
  return Math.floor((statValue - 10) / 2);
}

/**
 * Map a skill name to its governing base stat.
 */
const SKILL_STAT_MAP = {
  melee: 'strength',
  ranged: 'dexterity',
  magic: 'intelligence',
  stealth: 'dexterity',
  perception: 'wisdom',
  persuasion: 'charisma',
  lockpicking: 'dexterity',
  survival: 'wisdom',
  crafting: 'intelligence',
  alchemy: 'intelligence',
};

export function getGoverningStatForSkill(skillName) {
  return SKILL_STAT_MAP[skillName] || null;
}

/**
 * Perform a full skill check.
 *
 * Formula: d20 + stat_modifier + floor(skill_level / 10) + perk_bonuses
 *
 * @param {object} params
 * @param {string} params.skillName - Skill being checked
 * @param {number} params.dc - Difficulty class to beat
 * @param {object} params.baseStats - { strength, dexterity, ... }
 * @param {object} params.skills - { [skillName]: { level } }
 * @param {number} params.critRange - Minimum d20 roll for crit (from weapon, default 20)
 * @param {object[]} [params.perkBonuses] - [{ perk, skill_level, effect: number }]
 * @param {boolean} [params.advantage] - Roll twice, take higher
 * @param {boolean} [params.disadvantage] - Roll twice, take lower
 * @param {string} [params.dcSource] - Where the DC came from (for audit)
 * @param {number} [params.dcOriginId] - FK to source entity
 * @returns {DiceResult}
 */
export function skillCheck({
  skillName,
  dc,
  baseStats,
  skills,
  critRange = 20,
  perkBonuses = [],
  advantage = false,
  disadvantage = false,
  dcSource = 'skill_check',
  dcOriginId = null,
}) {
  // Roll d20 (with advantage/disadvantage)
  let baseRoll;
  let rollDetails;

  if (advantage && !disadvantage) {
    const r1 = roll(20);
    const r2 = roll(20);
    baseRoll = Math.max(r1, r2);
    rollDetails = { type: 'advantage', rolls: [r1, r2], used: baseRoll };
  } else if (disadvantage && !advantage) {
    const r1 = roll(20);
    const r2 = roll(20);
    baseRoll = Math.min(r1, r2);
    rollDetails = { type: 'disadvantage', rolls: [r1, r2], used: baseRoll };
  } else {
    baseRoll = roll(20);
    rollDetails = { type: 'normal', rolls: [baseRoll], used: baseRoll };
  }

  // Stat modifier
  const governingStat = SKILL_STAT_MAP[skillName];
  const statValue = governingStat && baseStats ? (baseStats[governingStat] || 10) : 10;
  const statMod = statModifier(statValue);

  // Skill level bonus: floor(level / 10) — so level 1 = +0, level 10 = +1, level 45 = +4
  const skillLevel = skills?.[skillName]?.level || 1;
  const skillBonus = Math.floor(skillLevel / 10);

  // Sum perk bonuses
  const perkTotal = perkBonuses.reduce((sum, p) => sum + (p.effect || 0), 0);

  // Final total
  const finalTotal = baseRoll + statMod + skillBonus + perkTotal;

  // Crit detection
  const isCriticalSuccess = baseRoll >= critRange;
  const isCriticalFailure = baseRoll === 1;

  // Outcome
  let outcome;
  if (isCriticalSuccess) {
    outcome = 'critical_success';
  } else if (isCriticalFailure) {
    outcome = 'critical_failure';
  } else if (finalTotal >= dc) {
    outcome = 'success';
  } else if (finalTotal >= dc - 2) {
    outcome = 'partial'; // Within 2 of DC = partial success
  } else {
    outcome = 'failure';
  }

  const passed = outcome === 'success' || outcome === 'critical_success' || outcome === 'partial';

  return {
    base_roll: baseRoll,
    roll_details: rollDetails,
    stat_modifier: statMod,
    governing_stat: governingStat,
    stat_value: statValue,
    skill_level: skillLevel,
    skill_bonus: skillBonus,
    perk_bonuses: perkBonuses,
    perk_total: perkTotal,
    final_total: finalTotal,
    dc,
    dc_source: dcSource,
    dc_origin_id: dcOriginId,
    passed,
    outcome,
    is_critical: isCriticalSuccess,
    is_fumble: isCriticalFailure,
  };
}

/**
 * Roll damage.
 * Base damage + weapon bonus + crit multiplier, minus armor.
 *
 * @param {object} params
 * @param {number} params.baseDamage - Attacker base damage
 * @param {number} params.weaponBonus - From equipped weapon stat_modifiers.damage_bonus
 * @param {boolean} params.isCritical - Double damage on crit
 * @param {number} params.targetArmor - Flat damage reduction
 * @param {number} [params.resistanceMultiplier=1.0] - Damage type resistance
 * @returns {{ rawDamage, mitigatedDamage, armorReduced, resistanceApplied, isCritical }}
 */
export function rollDamage({
  baseDamage,
  weaponBonus = 0,
  isCritical = false,
  targetArmor = 0,
  resistanceMultiplier = 1.0,
}) {
  // Variance: ±20%
  const variance = 0.8 + (Math.random() * 0.4);
  let rawDamage = Math.round((baseDamage + weaponBonus) * variance);

  if (isCritical) {
    rawDamage = rawDamage * 2;
  }

  // Apply resistance
  const afterResistance = Math.round(rawDamage * resistanceMultiplier);

  // Apply armor (flat reduction, minimum 1 damage if raw > 0)
  const armorReduced = Math.min(targetArmor, afterResistance - 1);
  const mitigatedDamage = Math.max(1, afterResistance - targetArmor);

  return {
    rawDamage,
    mitigatedDamage,
    armorReduced: Math.max(0, armorReduced),
    resistanceMultiplier,
    resistanceApplied: rawDamage !== afterResistance,
    isCritical,
  };
}

/**
 * Pick a random DC within a dungeon's dc_range.
 * @param {{ min: number, max: number }} dcRange
 * @returns {number}
 */
export function randomDC(dcRange) {
  return dcRange.min + Math.floor(Math.random() * (dcRange.max - dcRange.min + 1));
}

/**
 * Weighted random selection from an array of items with weights.
 * @param {{ weight: number, item: any }[]} pool
 * @returns {any|null}
 */
export function weightedRandom(pool) {
  const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return null;

  let roll = Math.random() * totalWeight;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return pool[pool.length - 1]?.item || null;
}

/**
 * Format a dice result for display in Discord.
 * @param {DiceResult} result
 * @returns {string}
 */
export function formatDiceResult(result) {
  const parts = [];

  // The roll itself
  if (result.roll_details?.type === 'advantage') {
    parts.push(`🎲 d20 (advantage): [${result.roll_details.rolls.join(', ')}] → **${result.base_roll}**`);
  } else if (result.roll_details?.type === 'disadvantage') {
    parts.push(`🎲 d20 (disadvantage): [${result.roll_details.rolls.join(', ')}] → **${result.base_roll}**`);
  } else {
    parts.push(`🎲 d20: **${result.base_roll}**`);
  }

  // Modifiers
  const mods = [];
  if (result.stat_modifier !== 0) {
    mods.push(`${result.governing_stat} ${result.stat_modifier >= 0 ? '+' : ''}${result.stat_modifier}`);
  }
  if (result.skill_bonus > 0) {
    mods.push(`skill +${result.skill_bonus}`);
  }
  if (result.perk_total > 0) {
    mods.push(`perks +${result.perk_total}`);
  }
  if (mods.length > 0) {
    parts.push(`  (${mods.join(', ')})`);
  }

  // Total vs DC
  parts.push(`  **Total: ${result.final_total}** vs DC ${result.dc}`);

  // Outcome
  const outcomes = {
    critical_success: '💥 **CRITICAL SUCCESS!**',
    success: '✅ **Success**',
    partial: '⚠️ **Partial Success**',
    failure: '❌ **Failure**',
    critical_failure: '💀 **CRITICAL FAILURE!**',
  };
  parts.push(`  ${outcomes[result.outcome]}`);

  return parts.join('\n');
}
