// ═══════════════════════════════════════════════════════════════
// LOOT — Drop resolution from loot_rules
// ═══════════════════════════════════════════════════════════════

import { weightedRandom } from './dice.js';
import { queries } from '../db/index.js';

/**
 * Resolve loot drops for a given source (enemy kill, chest, room, boss, etc).
 *
 * @param {string} sourceType - 'enemy_kill' | 'chest' | 'room_drop' | 'boss' | 'dungeon_completion'
 * @param {number} sourceId - ID of the source entity
 * @param {object} [context] - Optional context for condition checks
 * @param {object} [context.playerSkills] - { [skillName]: { level } }
 * @param {number} [context.dungeonCompletions] - Times player has completed this dungeon
 * @param {number[]} [context.playerItemIds] - Item IDs player currently owns
 * @param {number} [context.perceptionLevel] - Player's perception skill level (for hidden loot)
 * @returns {{ item_id, item_name, item_type, rarity, quantity, was_hidden }[]}
 */
export function resolveLoot(sourceType, sourceId, context = {}) {
  const rules = queries.getLootRulesForSource(sourceType, sourceId);
  if (!rules || rules.length === 0) return [];

  const drops = [];

  // Separate guaranteed from weighted
  const guaranteed = rules.filter(r => r.drop_type === 'guaranteed');
  const weighted = rules.filter(r => r.drop_type === 'weighted');

  // Process guaranteed drops
  for (const rule of guaranteed) {
    if (checkCondition(rule, context)) {
      if (rule.requires_perception && !checkPerception(rule, context)) {
        continue; // Hidden loot player can't see
      }
      drops.push(makeDrop(rule, rule.requires_perception));
    }
  }

  // Process weighted drops — roll once from the eligible weighted pool
  const eligibleWeighted = weighted.filter(r => {
    if (!checkCondition(r, context)) return false;
    if (r.requires_perception && !checkPerception(r, context)) return false;
    return true;
  });

  if (eligibleWeighted.length > 0) {
    // Roll 1-2 items from the pool (1 normally, 2 from chests/bosses)
    const rollCount = (sourceType === 'chest' || sourceType === 'boss') ? 2 : 1;

    for (let i = 0; i < rollCount; i++) {
      const pool = eligibleWeighted.map(r => ({ weight: r.base_weight, item: r }));
      const selected = weightedRandom(pool);
      if (selected) {
        // Don't duplicate (unless stackable, but we track by rule)
        if (!drops.some(d => d.item_id === selected.item_id)) {
          drops.push(makeDrop(selected, selected.requires_perception));
        }
      }
    }
  }

  return drops;
}

/**
 * Check if a loot rule's condition is met.
 */
function checkCondition(rule, context) {
  switch (rule.condition_type) {
    case 'none':
      return true;

    case 'min_skill': {
      if (!context.playerSkills || !rule.condition_skill_name) return false;
      const skill = context.playerSkills[rule.condition_skill_name];
      return skill && skill.level >= (rule.condition_skill_min || 0);
    }

    case 'min_completions':
      return (context.dungeonCompletions || 0) >= (rule.condition_min_completions || 0);

    case 'has_item':
      return context.playerItemIds?.includes(rule.condition_requires_item_id) || false;

    case 'has_not_item':
      return !context.playerItemIds?.includes(rule.condition_requires_item_id);

    default:
      return true;
  }
}

/**
 * Check if player's perception is high enough to find hidden loot.
 */
function checkPerception(rule, context) {
  if (!rule.requires_perception) return true;
  const perceptionLevel = context.perceptionLevel || 1;
  // Simple check: perception skill level / 5 + d20 roll vs perception_dc
  // For loot, we do a simplified passive check: level >= dc - 5
  return perceptionLevel >= (rule.perception_dc || 10) - 5;
}

/**
 * Create a drop result object.
 */
function makeDrop(rule, wasHidden = false) {
  return {
    item_id: rule.item_id,
    item_name: rule.item_name,
    item_type: rule.item_type,
    rarity: rule.rarity || 'common',
    base_value: rule.base_value || 0,
    quantity: 1,
    was_hidden: wasHidden ? true : false,
  };
}

/**
 * Calculate gold drop from an enemy kill.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function rollGoldDrop(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}
