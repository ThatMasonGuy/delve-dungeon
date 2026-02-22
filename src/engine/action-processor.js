// ═══════════════════════════════════════════════════════════════
// ACTION PROCESSOR — The Game Brain
// ═══════════════════════════════════════════════════════════════
// Takes player input → determines what checks to run → rolls
// dice → updates game state → prepares context for AI narrator.
//
// This is the central orchestrator. It calls into dice, combat,
// loot, and floor-generator modules, then packages everything
// for the AI to narrate.
// ═══════════════════════════════════════════════════════════════

import { queries, transaction, execute, queryOne, queryAll } from '../db/index.js';
import { skillCheck, rollDamage, formatDiceResult, roll, randomDC } from './dice.js';
import { generateFloor, getCurrentRoom, clearRoom, unlockRoom } from './floor-generator.js';
import {
  processEnemyTurn, damageEnemy, tickCooldowns, distributeXp, handlePlayerDeath,
  getWeaponDamageBonus, getWeaponCritRange, getWeaponDamageType, calculatePlayerArmor,
} from './combat.js';
import { resolveLoot, rollGoldDrop } from './loot.js';
import { config } from '../config.js';

// ──────── PERCEPTION BUFF HELPER ────────

/**
 * Build perception perk bonuses from active run buffs.
 */
function getPerceptionPerkBonuses(runStats) {
  const bonuses = [];
  if (runStats?.torch_lit) bonuses.push({ name: 'Torch', effect: 3 });
  if (runStats?.fungus_lit) bonuses.push({ name: 'Glowing Fungus', effect: 1 });
  return bonuses;
}

/**
 * Tick status effects (poison, etc.) at the start of each action.
 */
function tickStatusEffects(result, run, player) {
  if (!run.run_stats.status_effects) run.run_stats.status_effects = [];
  const effects = run.run_stats.status_effects;
  if (effects.length === 0) return;

  const expired = [];
  let poisonDmg = 0;

  for (const effect of effects) {
    if (effect.type === 'poison') {
      const dmg = effect.damage_per_tick || 2;
      poisonDmg += dmg;
    }
    effect.duration--;
    if (effect.duration <= 0) expired.push(effect);
  }

  // Remove expired effects
  run.run_stats.status_effects = effects.filter(e => !expired.includes(e));

  // Apply poison damage
  if (poisonDmg > 0) {
    result.hpChange -= poisonDmg;
    result.updatedPlayerHp -= poisonDmg;
    result.poisonTick = {
      damage: poisonDmg,
      remaining: run.run_stats.status_effects.some(e => e.type === 'poison'),
      turnsLeft: Math.max(0, ...run.run_stats.status_effects.filter(e => e.type === 'poison').map(e => e.duration)),
    };
    console.log(`[STATUS] Poison tick: ${poisonDmg} dmg`);
  }

  for (const e of expired) {
    result.statusEffectsRemoved.push(e);
    console.log(`[STATUS] ${e.type} from ${e.source} expired`);
  }
}

// ──────── RUN LIFECYCLE ────────

/**
 * Start a new dungeon run for a player.
 */
export function startRun(playerId, dungeonId) {
  const player = queries.getPlayerByDiscordId(null); // Need to get by internal ID
  // This will be called with internal player id from command handler

  const dungeon = queries.getDungeon(dungeonId);
  if (!dungeon) throw new Error(`Dungeon ${dungeonId} not found`);

  // Check for existing active run
  const existing = queries.getActiveRun(playerId);
  if (existing) throw new Error('You already have an active dungeon run! Finish or abandon it first.');

  // Check gold
  const playerRow = queryOne('SELECT * FROM players WHERE id = ?', [playerId]);
  if (playerRow.gold < dungeon.entry_cost) {
    throw new Error(`Not enough gold. Entry costs ${dungeon.entry_cost}g (you have ${playerRow.gold}g).`);
  }

  // Deduct entry cost
  execute(`UPDATE players SET gold = gold - ? WHERE id = ?`, [dungeon.entry_cost, playerId]);

  // Generate seed
  const seed = `${dungeonId}-${playerId}-${Date.now()}`;

  // Create run
  const runId = queries.createRun(playerId, dungeonId, seed);

  // Get enemy rules for floor generation
  const enemyRules = queries.getEnemyRulesForDungeon(dungeonId);

  // Generate floor 1
  const floorMap = generateFloor({
    dungeon,
    floorNumber: 1,
    isFinalFloor: dungeon.floor_count === 1,
    enemyRules,
    seed,
  });

  queries.saveFloorMap(runId, 1, floorMap);

  // Update dungeon history
  queries.upsertDungeonHistory(playerId, dungeonId, 'times_attempted');

  // Set initial room state from floor map
  const firstRoom = getCurrentRoom(floorMap, 1);
  const roomState = buildRoomState(firstRoom);

  queries.updateRunState(runId, { room_state: roomState });

  return {
    runId,
    dungeon,
    floorMap,
    roomState,
    firstRoom,
    entryCost: dungeon.entry_cost,
  };
}

/**
 * Process a player action during an active run.
 * This is the main game loop entry point.
 *
 * @param {number} playerId - Internal player ID
 * @param {string} actionText - The player's message text
 * @returns {ActionResult} - Everything needed for AI narration and Discord display
 */
export async function processAction(playerId, actionText) {
  const run = queries.getActiveRun(playerId);
  if (!run) throw new Error('No active run.');
  if (run.status !== 'active') throw new Error('Run is not active.');

  // Mark as processing to prevent double-actions
  queries.updateRunState(run.id, { status: 'processing', pending_action_text: actionText });

  try {
    const dungeon = queries.getDungeon(run.dungeon_id);
    const player = queryOne('SELECT * FROM players WHERE id = ?', [playerId]);
    const baseStats = queries.getBaseStats(playerId);
    const skills = buildSkillsMap(playerId);
    const equippedItems = queries.getEquippedItems(playerId);
    const floorMapRow = queries.getFloorMap(run.id, run.current_floor);
    const floorMap = floorMapRow.floor_map;
    const currentRoom = getCurrentRoom(floorMap, run.current_room);

    if (!currentRoom) throw new Error('Current room not found in floor map.');

    console.log(`[ENGINE] Room ${run.current_room} on Floor ${run.current_floor}, connections: [${currentRoom.connections}], type: ${currentRoom.type}, cleared: ${currentRoom.is_cleared}`);

    // Determine what kind of action the player is taking
    const intent = classifyIntent(actionText, currentRoom, run.room_state);
    console.log(`[ENGINE] Intent: ${intent.type}, targetRoom: ${intent.targetRoom || 'none'}, raw: "${actionText.substring(0, 60)}"`);

    const result = {
      actionText,
      intent,
      checks: [],
      diceResults: [],
      combatResults: [],
      enemyTurns: [],
      lootDrops: [],
      goldGained: 0,
      xpGained: {},
      levelUps: [],
      hpChange: 0,
      playerDied: false,
      roomCleared: false,
      floorComplete: false,
      runComplete: false,
      runDied: false,
      movedToRoom: null,
      movedToFloor: null,
      newlyAccessibleRooms: [],
      statusEffectsApplied: [],
      statusEffectsRemoved: [],
      updatedRoomState: run.room_state,
      updatedPlayerHp: player.hp_current,
      currentRoom,
      dungeon,
    };

    // ── Tick status effects (poison, etc.) ──
    tickStatusEffects(result, run, player);

    // ── Process by intent ──

    switch (intent.type) {
      case 'attack':
        await processAttack(result, intent, run, player, baseStats, skills, equippedItems, currentRoom, dungeon);
        break;

      case 'skill_check':
        await processSkillCheck(result, intent, run, player, baseStats, skills, equippedItems, currentRoom, dungeon, floorMap);
        break;

      case 'use_item':
        processUseItem(result, intent, run, player, equippedItems, baseStats, skills);
        break;

      case 'move':
        await processMove(result, intent, run, player, floorMap, dungeon, playerId, equippedItems, baseStats, skills);
        break;

      case 'search':
        await processSearch(result, run, player, baseStats, skills, currentRoom, dungeon);
        break;

      case 'open_chest':
        processChestLoot(result, currentRoom, dungeon, player);
        break;

      case 'rest':
        processRest(result, player, currentRoom);
        break;

      case 'rest_failed':
        result.restFailed = true;
        break;

      case 'flee':
        await processFlee(result, run, player, baseStats, skills, currentRoom);
        break;

      case 'unequip':
        processUnequip(result, intent, player, equippedItems);
        break;

      case 'interact':
      case 'general':
      default:
        // General interaction — no mechanical resolution, just AI narration
        result.intent.type = 'general';
        break;
    }

    // ── Enemy turns (if in combat and player didn't die) ──
    // Skip enemy turns on the round the player enters a boss room — they get to act first
    if (run.room_state.is_combat_active && !result.playerDied && intent.type !== 'flee' && !result.bossRoomEntered) {
      for (const enemy of run.room_state.enemies) {
        if (enemy.is_dead) continue;
        const enemyResult = processEnemyTurn(enemy, player, baseStats, equippedItems);
        result.enemyTurns.push({ enemy: enemy.name, ...enemyResult });

        if (enemyResult.damage > 0) {
          result.hpChange -= enemyResult.damage;
          result.updatedPlayerHp -= enemyResult.damage;

          // Apply status effects from enemy
          for (const effect of enemyResult.effects) {
            result.statusEffectsApplied.push(effect);
            // Track poison mechanically in run_stats
            if (effect.type === 'poison') {
              if (!run.run_stats.status_effects) run.run_stats.status_effects = [];
              // Don't stack poison from same source — refresh duration
              const existing = run.run_stats.status_effects.find(e => e.type === 'poison' && e.source === effect.source);
              if (existing) {
                existing.duration = Math.max(existing.duration, effect.duration || 5);
              } else {
                run.run_stats.status_effects.push({
                  type: 'poison',
                  duration: effect.duration || 5,
                  damage_per_tick: 2,
                  source: effect.source,
                });
              }
              console.log(`[STATUS] Poison applied from ${effect.source}, duration: ${effect.duration || 5}`);
            }
          }
        }
      }

      // Tick cooldowns
      tickCooldowns(run.room_state);

      // Check player death
      if (result.updatedPlayerHp <= 0) {
        result.updatedPlayerHp = 0;
        result.playerDied = true;
        result.runDied = true;
      }
    }

    // ── Final death check (poison tick, trap + combat combined) ──
    if (result.updatedPlayerHp <= 0 && !result.runDied) {
      result.updatedPlayerHp = 0;
      result.playerDied = true;
      result.runDied = true;
    }

    // ── Apply state changes to DB ──
    await applyResults(result, run, player, playerId, dungeon, floorMap);

    // Save floor map — room state changes (search_count, traps, chests) need to persist
    // BUT NOT after a floor transition — processMove already saved both maps, and
    // floorMap here is the OLD floor's data which would overwrite the fresh new floor
    if (!result.floorTransition) {
      queries.updateFloorMap(run.id, run.current_floor, floorMap);
    }

    // ── Update AI context window ──
    const aiContext = run.ai_context || [];
    aiContext.push({
      role: 'user',
      action: actionText,
      intent: intent.type,
      mechanical_results: summarizeMechanics(result),
    });

    // Keep rolling window
    while (aiContext.length > config.game.aiContextWindow) {
      aiContext.shift();
    }

    queries.updateRunState(run.id, {
      status: result.runDied ? 'dead' : (result.runComplete ? 'completed' : 'active'),
      room_state: run.room_state,
      ai_context: aiContext,
      run_stats: run.run_stats,
      pending_action_text: null,
      pending_since: null,
    });

    // Log the action
    const sequence = queries.getNextSequence(run.id);
    queries.logAction({
      run_id: run.id,
      player_id: playerId,
      sequence,
      floor_number: run.current_floor,
      room_number: run.current_room,
      action_type: result.runDied ? 'death' : (result.runComplete ? 'run_complete' : 'player_action'),
      player_action: actionText,
      checks_rolled: result.checks,
      dice_results: result.diceResults,
      outcome: result.diceResults[0]?.outcome || 'success',
      ai_response: '', // Filled after AI generates response
      xp_gained: result.xpGained,
      level_ups: result.levelUps,
      items_found: result.lootDrops,
      items_lost: result.runDied ? [] : [],
    });

    return result;

  } catch (err) {
    // Restore active status on error
    queries.updateRunState(run.id, { status: 'active', pending_action_text: null });
    throw err;
  }
}

// ──────── INTENT CLASSIFICATION ────────

/**
 * Classify what the player is trying to do.
 * This is a simple keyword/context classifier — the AI will also help
 * interpret ambiguous actions, but mechanics need a category.
 */
function classifyIntent(actionText, currentRoom, roomState) {
  const text = actionText.toLowerCase().trim();

  // Combat actions
  if (roomState.is_combat_active) {
    // Detect "unequip [weapon] and attack" — must be handled before generic attack check
    const hasUnequip = /\b(unequip|remove|put away|set aside|sheathe|holster|drop)\b/.test(text);
    const hasAttack = /\b(attack|strike|hit|slash|stab|swing|shoot|fire|cast|smash|bash|punch|kick|charge|rush|lunge|leap|thrust|drive)\b/.test(text);

    if (hasUnequip && hasAttack) {
      // Combined: unequip first, then melee attack
      const targetEnemy = findTargetEnemy(text, roomState.enemies);
      return { type: 'attack', target: targetEnemy, unequipFirst: true, raw: text };
    }
    if (hasUnequip && !hasAttack) {
      return { type: 'unequip', raw: text };
    }
    if (hasAttack) {
      // Try to identify target
      const targetEnemy = findTargetEnemy(text, roomState.enemies);
      return { type: 'attack', target: targetEnemy, raw: text };
    }
    if (/\b(flee|run|escape|retreat)\b/.test(text)) {
      return { type: 'flee', raw: text };
    }
    // Only trigger use_item if there's a clear item keyword — prevent roleplay phrases like
    // "I use the blood as war paint" from being parsed as inventory commands
    if (/\b(use|drink|consume|eat|apply|chug|down|swallow|quaff)\b/.test(text) &&
        /\b(potion|health|antidote|torch|pick|lockpick|fungus|mushroom|scroll|item|cure|heal)\b/.test(text)) {
      return { type: 'use_item', raw: text };
    }
  }

  // Movement — check BEFORE search/skill to avoid "look around" being movement
  // Direct room reference: "go to room 3", "head back into room 2", "move to the door"
  if (/\b(go|move|walk|proceed|enter|head|travel)\b.*\b(room|door|corridor|exit|passage)\s*(\d+)?/i.test(text)) {
    const roomMatch = text.match(/room\s*(\d+)/i) || text.match(/(\d+)/);
    return { type: 'move', targetRoom: roomMatch ? parseInt(roomMatch[1]) : null, raw: text };
  }
  // Explicit room number with any movement context (handles Yoda-speak "Room 4 we go" and typos like "more on to room 4")
  if (/\broom\s*(\d+)\b/i.test(text)) {
    const roomMatch = text.match(/room\s*(\d+)/i);
    // Accept if there's any vague movement word or intent nearby (including "let's", "we", "time")
    if (/\b(go|move|head|press|push|let'?s|we|proceed|on|to|into|forward|time|next|will|gonna|going)\b/i.test(text)) {
      return { type: 'move', targetRoom: roomMatch ? parseInt(roomMatch[1]) : null, raw: text };
    }
  }
  if (/\b(next room|go forward|go forwards|go ahead|go on|continue|proceed|advance|press on|keep going|move on|move forward|move forwards|move ahead|head forward|head forwards|head ahead|head on|head out|head deeper|onwards|onward|deeper|go deeper|push on|push forward|push forwards|carry on|lets go|let's go|lets move|let's move|head to the next|move to the next|go to the next|I press on|move along|push ahead|keep moving|march on|forge ahead|venture forward|venture on|venture ahead|venture deeper)\b/i.test(text)) {
    return { type: 'move', targetRoom: null, raw: text }; // Next in sequence
  }
  // "pass through", "step through", "move beyond", "head back into" — allow words between verb and preposition
  // Exclude chest-related phrases to avoid conflicts with open_chest
  if (/\b(pass|step|walk|go|move|head)\b.{0,15}\b(through|into|past|beyond|across)\b/i.test(text) && !/\b(chest|box|crate|coffer)\b/i.test(text)) {
    return { type: 'move', targetRoom: null, raw: text };
  }

  // Chest interaction — "open chest", "loot chest", "take from chest", "reach into chest"
  // Must be close together to avoid false positives like "check for traps before the chest"
  if (/\b(open|loot|take|grab|reach|pull|empty)\s+.{0,15}\b(chest|box|crate|coffer)\b/i.test(text) ||
      /\b(chest|box|crate|coffer)\b.{0,15}\b(open|loot|take|grab|contents)\b/i.test(text) ||
      /\bwhat('?s| is) in the chest\b/i.test(text) ||
      /\b(check out|look in|peek in|dig into)\s+.{0,10}\b(chest|box|crate|coffer)\b/i.test(text)) {
    return { type: 'open_chest', raw: text };
  }

  // Searching / looking around
  if (/\b(search|examine|inspect|investigate|scan|scour)\b/.test(text)) {
    return { type: 'search', raw: text };
  }
  // "look" only counts as search if it's "look around/for/at" not "look ahead"
  if (/\blook\s+(around|for|at|closer|carefully)\b/i.test(text)) {
    return { type: 'search', raw: text };
  }

  // Using items — "light torch", "drink potion", "chug health potion", "use antidote", "hold fungus aloft"
  if (/\b(use|drink|consume|eat|apply|equip|wear|wield|light|ignite|kindle|chug|down|swallow|quaff)\b/.test(text) ||
      (/\b(hold|raise|lift)\b/.test(text) && /\b(fungus|mushroom|shroom|torch|aloft)\b/.test(text))) {
    // Don't match "light" as in "the light" or "a light source"
    if (/\b(light|ignite|kindle)\b/.test(text) && /\b(torch|lantern|fire|flame|fungus|mushroom)\b/.test(text)) {
      return { type: 'use_item', raw: text };
    }
    if (/\b(hold|raise|lift)\b/.test(text) && /\b(fungus|mushroom|shroom|torch|aloft)\b/.test(text)) {
      return { type: 'use_item', raw: text };
    }
    if (/\b(use|drink|consume|eat|apply|chug|down|swallow|quaff)\b/.test(text)) {
      return { type: 'use_item', raw: text };
    }
  }

  // Skill-based actions — "pick" must be "pick lock" or "lockpick", NOT "pick up"
  if (/\b(lockpick|pick\s+(?:the\s+)?lock|unlock|disarm)\b/i.test(text)) {
    return { type: 'skill_check', skill: 'lockpicking', raw: text };
  }
  // "try again" near a locked chest = retry lockpick
  if (/\b(try again|another attempt|one more try|give it another|have another go)\b/i.test(text)) {
    if (currentRoom.chest?.is_locked) {
      return { type: 'skill_check', skill: 'lockpicking', raw: text };
    }
  }
  if (/\b(sneak|stealth|hide|creep)\b/.test(text)) {
    return { type: 'skill_check', skill: 'stealth', raw: text };
  }
  if (/\b(persuade|convince|talk|negotiate|bribe)\b/.test(text)) {
    return { type: 'skill_check', skill: 'persuasion', raw: text };
  }

  // Rest
  if (/\b(rest|sleep|camp|heal|meditate)\b/.test(text)) {
    if (currentRoom.type === 'rest') {
      return { type: 'rest', raw: text };
    }
    return { type: 'rest_failed', raw: text };
  }

  // If in combat, default to attack
  if (roomState.is_combat_active) {
    const targetEnemy = findTargetEnemy(text, roomState.enemies) || roomState.enemies.find(e => !e.is_dead);
    return { type: 'attack', target: targetEnemy, raw: text };
  }

  // Default: general interaction for AI to interpret
  return { type: 'general', raw: text };
}

/**
 * Try to find which enemy the player is targeting by name.
 */
function findTargetEnemy(text, enemies) {
  const living = enemies.filter(e => !e.is_dead);
  if (living.length === 0) return null;
  if (living.length === 1) return living[0];

  const lower = text.toLowerCase();

  // Exact full name match first
  for (const enemy of living) {
    if (lower.includes(enemy.name.toLowerCase())) return enemy;
  }

  // Partial match — any word from the enemy's name (e.g. "rat" matches "Crypt Rat")
  for (const enemy of living) {
    const words = enemy.name.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length >= 3 && lower.includes(word)) return enemy;
    }
  }

  // Default to first living enemy
  return living[0];
}

// ──────── ACTION HANDLERS ────────

/**
 * Unequip a weapon or armor piece by name or type.
 * Looks for ranged/weapon items in text and unequips them.
 */
function processUnequip(result, intent, player, equippedItems) {
  const text = intent.raw.toLowerCase();

  // Determine which item to unequip based on text hints
  let toUnequip = null;

  // Prefer explicit name match first
  for (const item of equippedItems) {
    const name = item.item_name.toLowerCase();
    if (text.includes(name) || name.split(/\s+/).some(w => w.length >= 3 && text.includes(w))) {
      toUnequip = item;
      break;
    }
  }

  // Fallback: keyword-based type matching
  if (!toUnequip) {
    if (/\b(bow|ranged|arrows?|crossbow)\b/.test(text)) {
      toUnequip = equippedItems.find(i => i.subtype === 'ranged');
    } else if (/\b(sword|blade|dagger|knife|axe|mace|club|staff|wand|weapon|melee)\b/.test(text)) {
      toUnequip = equippedItems.find(i => i.item_type === 'weapon');
    } else if (/\b(shield|buckler)\b/.test(text)) {
      toUnequip = equippedItems.find(i => i.subtype === 'shield');
    } else if (/\b(armor|vest|chainmail|chest)\b/.test(text)) {
      toUnequip = equippedItems.find(i => i.item_type === 'armor' && i.subtype !== 'shield');
    }
  }

  if (!toUnequip) {
    // Nothing explicit — unequip the main hand weapon if any
    toUnequip = equippedItems.find(i => i.item_type === 'weapon');
  }

  if (toUnequip) {
    execute(`UPDATE player_inventory SET is_equipped = 0 WHERE id = ?`, [toUnequip.id]);
    result.unequippedItem = toUnequip.item_name;
    // Remove from in-memory equippedItems array so subsequent attack uses correct weapon
    const idx = equippedItems.findIndex(i => i.id === toUnequip.id);
    if (idx !== -1) equippedItems.splice(idx, 1);
    console.log(`[UNEQUIP] Unequipped ${toUnequip.item_name}`);
  } else {
    result.nothingToUnequip = true;
  }
}

async function processAttack(result, intent, run, player, baseStats, skills, equippedItems, currentRoom, dungeon) {
  const target = intent.target || run.room_state.enemies.find(e => !e.is_dead);
  if (!target) {
    result.intent.type = 'general'; // No valid target
    return;
  }

  // Initiate combat if not already active
  if (!run.room_state.is_combat_active) {
    run.room_state.is_combat_active = true;
    run.room_state.round_number = 1;
  }

  // Handle combined "unequip + attack" — unequip first so weapon type is correct
  if (intent.unequipFirst) {
    processUnequip(result, intent, player, equippedItems);
  }

  // Determine weapon type and skill
  const weaponDmgType = getWeaponDamageType(equippedItems);
  const weaponBonus = getWeaponDamageBonus(equippedItems);
  const critRange = getWeaponCritRange(equippedItems);

  // Determine attack skill based on weapon
  const hasRangedWeapon = equippedItems.some(i => i.subtype === 'ranged');
  const attackSkill = hasRangedWeapon ? 'ranged' : 'melee';

  // Roll attack
  const attackDC = 10 + Math.floor(target.armor / 2) + (target.dc_modifier || 0);
  const attackCheck = skillCheck({
    skillName: attackSkill,
    dc: attackDC,
    baseStats,
    skills,
    critRange,
    dcSource: 'enemy_armor',
    dcOriginId: target.enemy_id,
  });

  result.checks.push({ type: attackSkill, target: target.name, ...attackCheck });
  result.diceResults.push(attackCheck);

  if (attackCheck.passed) {
    // Calculate damage
    const baseDmg = 5 + (baseStats[attackSkill === 'melee' ? 'strength' : 'dexterity'] || 10) / 3;
    const dmgResult = damageEnemy(target, Math.round(baseDmg) + weaponBonus, weaponDmgType, player, run.room_state);

    result.combatResults.push({
      target: target.name,
      ...dmgResult,
      attackCheck,
    });

    // Track run stats
    run.run_stats.damage_dealt = (run.run_stats.damage_dealt || 0) + dmgResult.damageDealt;

    if (dmgResult.enemyDied) {
      run.run_stats.enemies_killed = (run.run_stats.enemies_killed || 0) + 1;

      // Add loot to results
      result.lootDrops.push(...dmgResult.loot);
      result.goldGained += dmgResult.goldDrop;

      // XP distribution
      const xpResults = distributeXp(player.id, attackSkill, dmgResult.xpReward, attackCheck.outcome);
      for (const xr of xpResults) {
        result.xpGained[xr.skill] = (result.xpGained[xr.skill] || 0) + (xr.xp_gained || 0);
        if (xr.leveled_up !== false && xr.new_level) result.levelUps.push(xr);
      }
    }
  } else {
    result.combatResults.push({
      target: target.name,
      missed: true,
      attackCheck,
    });

    // Still get some XP for trying
    const xpResults = distributeXp(player.id, attackSkill, 3, attackCheck.outcome);
    for (const xr of xpResults) {
      result.xpGained[xr.skill] = (result.xpGained[xr.skill] || 0) + (xr.xp_gained || 0);
    }
  }
}

async function processSkillCheck(result, intent, run, player, baseStats, skills, equippedItems, currentRoom, dungeon, floorMap) {
  const skillName = intent.skill || 'perception';
  let dc;
  let lockpickTarget = null; // Track what we're picking

  // Determine DC from context
  if (skillName === 'lockpicking' && currentRoom.type === 'locked' && currentRoom.lock) {
    dc = currentRoom.lock.lock_dc;
    lockpickTarget = 'current_room';
  } else if (skillName === 'lockpicking' && currentRoom.chest?.is_locked) {
    dc = currentRoom.chest.lock_dc;
    lockpickTarget = 'chest';
  } else if (skillName === 'lockpicking') {
    // Check for adjacent locked rooms
    for (const connNum of currentRoom.connections) {
      const connRoom = getCurrentRoom(floorMap, connNum);
      if (connRoom && connRoom.type === 'locked' && !connRoom.is_accessible && connRoom.lock) {
        dc = connRoom.lock.lock_dc;
        lockpickTarget = { type: 'adjacent_room', roomNumber: connNum };
        break;
      }
    }
    if (!dc) dc = randomDC(dungeon.dc_range); // No lock found, generic check
  } else if (currentRoom.trap && !currentRoom.trap.is_disarmed && skillName === 'perception') {
    dc = currentRoom.trap.dc;
  } else {
    dc = randomDC(dungeon.dc_range);
  }

  // ── Lockpick requires a Thieves' Pick ──
  if (skillName === 'lockpicking' && lockpickTarget) {
    const inventory = queries.getInventory(player.id);
    const pick = inventory.find(i => i.item_name === "Thieves' Pick" && i.quantity > 0);
    if (!pick) {
      result.noLockpick = true;
      return;
    }
    // Consume the pick (fragile tool, breaks on use)
    queries.removeItem(pick.id, 1);
    result.lockpickConsumed = true;
    console.log(`[SKILL] Consumed 1x Thieves' Pick (${pick.quantity - 1} remaining)`);
  }

  const check = skillCheck({
    skillName,
    dc,
    baseStats,
    skills,
    perkBonuses: (skillName === 'perception') ? getPerceptionPerkBonuses(run.run_stats) : [],
    dcSource: 'room_feature',
  });

  result.checks.push({ type: skillName, ...check });
  result.diceResults.push(check);

  // Apply effects based on skill
  if (check.passed) {
    if (skillName === 'lockpicking') {
      if (lockpickTarget === 'current_room' && currentRoom.lock) {
        unlockRoom(floorMap, currentRoom.room_number);
      } else if (lockpickTarget === 'chest' && currentRoom.chest?.is_locked) {
        currentRoom.chest.is_locked = false;
        // Auto-loot the chest on successful lockpick
        processChestLoot(result, currentRoom, dungeon, player);
      } else if (lockpickTarget?.type === 'adjacent_room') {
        unlockRoom(floorMap, lockpickTarget.roomNumber);
        console.log(`[SKILL] Unlocked adjacent Room ${lockpickTarget.roomNumber}`);
      }
    }
    if (skillName === 'stealth') {
      // Enemies become unaware — player can get a surprise round
      for (const enemy of run.room_state.enemies) {
        if (!enemy.is_dead) enemy.awareness = 'idle';
      }
    }
  }

  // Trap handling
  if (currentRoom.trap && !currentRoom.trap.is_disarmed) {
    if (skillName === 'perception' && check.passed) {
      currentRoom.trap.is_disarmed = true;
    } else if (!check.passed) {
      // Trap triggers
      currentRoom.trap.is_triggered = true;
      result.hpChange -= currentRoom.trap.damage;
      result.updatedPlayerHp -= currentRoom.trap.damage;
    }
  }

  // XP
  const xpResults = distributeXp(player.id, skillName, 10, check.outcome);
  for (const xr of xpResults) {
    result.xpGained[xr.skill] = (result.xpGained[xr.skill] || 0) + (xr.xp_gained || 0);
    if (xr.leveled_up !== false && xr.new_level) result.levelUps.push(xr);
  }
}

async function processSearch(result, run, player, baseStats, skills, currentRoom, dungeon) {
  // Check for opened but unlooted chest FIRST — this takes priority over "already searched"
  if (currentRoom.chest && !currentRoom.chest.is_locked && !currentRoom.chest.is_looted) {
    processChestLoot(result, currentRoom, dungeon, player);
    // Still allow the room search below if not yet searched
  }

  const searchCount = currentRoom.search_count || 0;

  // Already searched this room — no roll, no XP, just tell them
  if (searchCount > 0) {
    // Only set roomAlreadySearched if we also didn't just loot a chest
    if (!result.chestLooted) {
      result.roomAlreadySearched = true;
    }
    return;
  }

  currentRoom.search_count = 1;

  const check = skillCheck({
    skillName: 'perception',
    dc: randomDC(dungeon.dc_range),
    baseStats,
    skills,
    perkBonuses: getPerceptionPerkBonuses(run.run_stats),
    dcSource: 'room_search',
  });

  result.checks.push({ type: 'perception', ...check });
  result.diceResults.push(check);

  if (check.passed) {
    const loot = resolveLoot('room_drop', dungeon.id, {
      perceptionLevel: skills.perception?.level || 1,
    });
    result.lootDrops.push(...loot);
    currentRoom.is_searched = true;
  }

  const xpResults = distributeXp(player.id, 'perception', 5, check.outcome);
  for (const xr of xpResults) {
    result.xpGained[xr.skill] = (result.xpGained[xr.skill] || 0) + (xr.xp_gained || 0);
    if (xr.leveled_up !== false && xr.new_level) result.levelUps.push(xr);
  }
}

/**
 * Loot an opened chest.
 */
function processChestLoot(result, currentRoom, dungeon, player) {
  const chest = currentRoom.chest;
  if (!chest) {
    result.noChest = true;
    return;
  }
  if (chest.is_locked) {
    result.chestLocked = true;
    return;
  }
  if (chest.is_looted) {
    result.chestAlreadyLooted = true;
    return;
  }

  // Open and loot the chest
  chest.is_opened = true;
  chest.is_looted = true;
  result.chestLooted = true;

  // Resolve chest loot (gets 2 rolls from the loot system)
  const loot = resolveLoot('chest', dungeon.id, {
    perceptionLevel: 1,
  });
  result.lootDrops.push(...loot);

  // Chest gold (15-40g)
  const chestGold = rollGoldDrop(15, 40);
  result.goldGained += chestGold;

  console.log(`[CHEST] Looted chest in Room ${currentRoom.room_number}: ${loot.length} items, ${chestGold}g`);
}

function processUseItem(result, intent, run, player, equippedItems, baseStats, skills) {
  const inventory = queries.getInventory(player.id);
  const text = intent.raw.toLowerCase();

  // ── Find item by name matching ──
  let targetItem = null;

  // Special case: "light torch" / "ignite torch"
  const isTorchLight = /\b(light|ignite|kindle)\b/.test(text) && /\b(torch|lantern)\b/.test(text);

  // Special case: "hold fungus aloft" / "use fungus" / "light fungus"
  const isFungusLight = /\b(hold|use|light|raise|lift)\b/.test(text) && /\b(fungus|mushroom|shroom|glow)\b/.test(text);

  if (isTorchLight) {
    targetItem = inventory.find(i => i.item_name === 'Torch' && i.quantity > 0);
  }
  if (!targetItem && isFungusLight) {
    targetItem = inventory.find(i => i.item_name === 'Glowing Fungus' && i.quantity > 0);
  }

  if (!targetItem) {
    // Match by item name fragments in the player's text
    for (const item of inventory) {
      if (item.quantity <= 0) continue;
      if (item.item_type !== 'consumable') continue;
      const name = item.item_name.toLowerCase();
      const words = name.split(/\s+/);
      // Full name match or partial word match (3+ char words)
      if (text.includes(name) || words.some(w => w.length >= 3 && text.includes(w))) {
        targetItem = item;
        break;
      }
    }
  }

  // Fallback: match by category keywords
  if (!targetItem) {
    if (/\b(potion|heal|health)\b/.test(text)) {
      targetItem = inventory.find(i => i.item_name === 'Health Potion' && i.quantity > 0);
    } else if (/\b(antidote|cure|cleanse|poison)\b/.test(text)) {
      targetItem = inventory.find(i => i.item_name === 'Antidote' && i.quantity > 0);
    } else if (/\b(torch|light|fire|flame)\b/.test(text)) {
      targetItem = inventory.find(i => i.item_name === 'Torch' && i.quantity > 0);
    } else if (/\b(pick|lockpick|tool)\b/.test(text)) {
      targetItem = inventory.find(i => i.item_name === "Thieves' Pick" && i.quantity > 0);
    }
  }

  if (!targetItem) {
    result.noItemToUse = true;
    return;
  }

  // ── Special: Torch lighting ──
  if (targetItem.item_name === 'Torch' && (isTorchLight || /\b(use|light)\b/.test(text))) {
    if (run.run_stats.torch_lit) {
      result.torchAlreadyLit = true;
      return;
    }
    run.run_stats.torch_lit = true;
    result.torchLit = true;
    result.itemUsed = { name: 'Torch', effects: [{ type: 'buff', stat: 'perception', value: 3 }] };
    // Torch is NOT consumed — it persists in inventory, resets on run end
    console.log(`[ITEM] Torch lit — +3 perception for this run`);
    return;
  }

  // ── Special: Glowing Fungus as light source ──
  if (targetItem?.item_name === 'Glowing Fungus' && (isFungusLight || /\b(use|light|hold)\b/.test(text))) {
    if (run.run_stats.fungus_lit) {
      result.fungusAlreadyLit = true;
      return;
    }
    run.run_stats.fungus_lit = true;
    result.fungusLit = true;
    result.itemUsed = { name: 'Glowing Fungus', effects: [{ type: 'buff', stat: 'perception', value: 1 }] };
    // Fungus IS consumed — unlike torch
    queries.removeItem(targetItem.id, 1);
    console.log(`[ITEM] Glowing Fungus lit — +1 perception for this run (consumed)`);
    return;
  }

  // ── Parse use_effect ──
  let effects;
  try {
    effects = typeof targetItem.use_effect === 'string'
      ? JSON.parse(targetItem.use_effect)
      : targetItem.use_effect;
  } catch { effects = null; }

  if (!effects || effects.length === 0) {
    result.noItemEffect = true;
    result.itemUsed = { name: targetItem.item_name, effects: [] };
    return;
  }

  result.itemUsed = { name: targetItem.item_name, effects: [] };

  for (const effect of effects) {
    switch (effect.effect_type) {
      case 'heal': {
        // Roll for heal amount if range specified (e.g. potions heal 10-20)
        const minHeal = effect.min_value || effect.value;
        const maxHeal = effect.value;
        const heal = minHeal < maxHeal
          ? Math.floor(Math.random() * (maxHeal - minHeal + 1)) + minHeal
          : maxHeal;
        result.hpChange += heal;
        result.updatedPlayerHp = Math.min(player.hp_max, player.hp_current + heal);
        result.itemUsed.effects.push({ type: 'heal', value: heal });
        console.log(`[ITEM] ${targetItem.item_name}: healed ${heal} HP (rolled ${minHeal}-${maxHeal})`);
        break;
      }
      case 'cleanse': {
        // Actually remove matching status effects from run_stats
        if (run.run_stats.status_effects && effect.value) {
          const before = run.run_stats.status_effects.length;
          run.run_stats.status_effects = run.run_stats.status_effects.filter(
            se => !effect.value.includes(se.type)
          );
          const removed = before - run.run_stats.status_effects.length;
          if (removed > 0) {
            result.poisonCured = true;
            console.log(`[ITEM] Cleansed ${removed} status effect(s)`);
          }
        }
        result.itemUsed.effects.push({ type: 'cleanse', targets: effect.value });
        console.log(`[ITEM] ${targetItem.item_name}: cleansed ${effect.value}`);
        break;
      }
      case 'perception_bonus': {
        // For torch this is handled above, but support other items
        result.itemUsed.effects.push({
          type: 'buff',
          stat: 'perception',
          value: effect.value,
          duration: effect.duration_actions,
        });
        break;
      }
      default:
        console.log(`[ITEM] Unknown effect type: ${effect.effect_type}`);
    }
  }

  // Consume the item (remove 1 from stack)
  queries.removeItem(targetItem.id, 1);
  console.log(`[ITEM] Consumed 1x ${targetItem.item_name}`);
}

async function processMove(result, intent, run, player, floorMap, dungeon, playerId, equippedItems, baseStats, skills) {
  const currentRoom = getCurrentRoom(floorMap, run.current_room);

  console.log(`[MOVE] Player in Room ${run.current_room}, connections: [${currentRoom?.connections}], cleared: ${currentRoom?.is_cleared}`);

  // FIRST: clear current room if not already — this unlocks connected rooms
  if (!currentRoom.is_cleared) {
    const newAccessible = clearRoom(floorMap, run.current_room);
    console.log(`[MOVE] Cleared Room ${run.current_room}, newly accessible: [${newAccessible}]`);
    result.newlyAccessibleRooms.push(...newAccessible);
    result.roomCleared = true;
    run.run_stats.rooms_cleared = (run.run_stats.rooms_cleared || 0) + 1;
  }

  // Determine target room
  let targetRoomNum = intent.targetRoom;
  if (!targetRoomNum) {
    // Move to next uncleared accessible room in connections
    const accessible = currentRoom.connections.filter(c => {
      const r = getCurrentRoom(floorMap, c);
      console.log(`[MOVE]   Connection ${c}: exists=${!!r}, accessible=${r?.is_accessible}, cleared=${r?.is_cleared}`);
      return r && r.is_accessible && !r.is_cleared;
    });
    // Fallback: prefer highest-numbered room (forward direction), then any accessible
    const highestAccessible = [...currentRoom.connections]
      .filter(c => getCurrentRoom(floorMap, c)?.is_accessible)
      .sort((a, b) => b - a)[0]; // Highest first = forward
    targetRoomNum = accessible[0]
      || highestAccessible
      || currentRoom.connections[currentRoom.connections.length - 1];
    console.log(`[MOVE] Auto-target: accessible=[${accessible}], final target=${targetRoomNum}`);
  }

  if (!targetRoomNum) {
    console.log(`[MOVE] ❌ No target room found — downgrading to general`);
    result.intent.type = 'general'; // No connections at all
    return;
  }

  const targetRoom = getCurrentRoom(floorMap, targetRoomNum);
  if (!targetRoom) {
    console.log(`[MOVE] ❌ Target room ${targetRoomNum} not found in floorMap — downgrading to general`);
    result.intent.type = 'general';
    return;
  }

  if (!targetRoom.is_accessible) {
    console.log(`[MOVE] ❌ Target room ${targetRoomNum} is not accessible (type: ${targetRoom.type})`);
    // Room is locked — tell the player instead of silently failing
    if (targetRoom.type === 'locked' && targetRoom.lock) {
      result.moveBlocked = { reason: 'locked', room: targetRoomNum, dc: targetRoom.lock.lock_dc };
    }
    result.intent.moveBlocked = true;
    // Don't downgrade to general — let AI narrate the blocked path
    return;
  }

  // Check if moving to exit room → advance floor
  if (targetRoom.is_exit) {
    const nextFloor = run.current_floor + 1;
    if (nextFloor <= dungeon.floor_count) {
      // Generate next floor
      const enemyRules = queries.getEnemyRulesForDungeon(dungeon.id);
      const newFloorMap = generateFloor({
        dungeon,
        floorNumber: nextFloor,
        isFinalFloor: nextFloor === dungeon.floor_count,
        enemyRules,
        seed: run.generation_seed,
      });
      queries.saveFloorMap(run.id, nextFloor, newFloorMap);

      run.current_floor = nextFloor;
      run.current_room = 1;
      result.movedToFloor = nextFloor;
      result.movedToRoom = 1;
      result.floorTransition = true;
      result.previousFloor = nextFloor - 1;
      result.totalFloors = dungeon.floor_count;

      const newRoom = getCurrentRoom(newFloorMap, 1);
      run.room_state = buildRoomState(newRoom);
      result.currentRoom = newRoom;

      // HARD flush AI context — new floor = completely fresh narrative slate
      run.ai_context = [];

      queries.updateRunState(run.id, {
        current_floor: nextFloor,
        current_room: 1,
        ai_context: run.ai_context,
      });

      // Update old floor map
      queries.updateFloorMap(run.id, run.current_floor - 1, floorMap);
      return;
    }
  }

  // Move to room on same floor
  run.current_room = targetRoomNum;
  result.movedToRoom = targetRoomNum;

  // Build room state from the target room
  run.room_state = buildRoomState(targetRoom);

  queries.updateRunState(run.id, { current_room: targetRoomNum });
  queries.updateFloorMap(run.id, run.current_floor, floorMap);

  console.log(`[MOVE] ✅ Moved to Room ${targetRoomNum}, enemies: ${targetRoom.enemies?.length || 0}`);

  // Auto-enter combat if room has enemies
  if (targetRoom.enemies?.length > 0) {
    run.room_state.is_combat_active = true;
    run.room_state.round_number = 1;
  }

  // Flag boss room entry so enemies don't get a free first strike
  if (targetRoom.is_boss_room) {
    result.bossRoomEntered = true;
  }

  // Auto-trigger trap check on room entry
  if (targetRoom.trap && !targetRoom.trap.is_triggered && !targetRoom.trap.is_disarmed) {
    const trapCheck = skillCheck({
      skillName: 'perception',
      dc: targetRoom.trap.dc,
      baseStats,
      skills,
      perkBonuses: getPerceptionPerkBonuses(run.run_stats),
      dcSource: 'trap_detection',
    });

    result.checks.push({ type: 'perception', ...trapCheck });
    result.diceResults.push(trapCheck);

    if (trapCheck.passed) {
      // Player spotted the trap
      result.trapDetected = { trap: targetRoom.trap };
      console.log(`[MOVE] Trap detected in Room ${targetRoomNum}: ${targetRoom.trap.name}`);
    } else {
      // Trap triggers!
      targetRoom.trap.is_triggered = true;
      const trapDmg = targetRoom.trap.damage;
      result.hpChange -= trapDmg;
      result.updatedPlayerHp -= trapDmg;
      result.trapTriggered = { trap: targetRoom.trap, damage: trapDmg };
      console.log(`[MOVE] Trap triggered in Room ${targetRoomNum}: ${targetRoom.trap.name} for ${trapDmg} dmg`);

      // Check player death from trap
      if (result.updatedPlayerHp <= 0) {
        result.updatedPlayerHp = 0;
        result.playerDied = true;
        result.runDied = true;
      }
    }

    // XP for the perception check
    const xpResults = distributeXp(playerId, 'perception', 5, trapCheck.outcome);
    for (const xr of xpResults) {
      result.xpGained[xr.skill] = (result.xpGained[xr.skill] || 0) + (xr.xp_gained || 0);
      if (xr.leveled_up !== false && xr.new_level) result.levelUps.push(xr);
    }

    // Save the trap state
    queries.updateFloorMap(run.id, run.current_floor, floorMap);
  }

  result.updatedRoomState = run.room_state;
  result.currentRoom = targetRoom;
}

function processRest(result, player, currentRoom) {
  if (currentRoom.type !== 'rest' || !currentRoom.rest) return;

  const healAmount = Math.round(player.hp_max * currentRoom.rest.heal_percent);
  result.hpChange += healAmount;
  result.updatedPlayerHp = Math.min(player.hp_max, player.hp_current + healAmount);
  result.rested = true;
  result.restHealAmount = healAmount;
}

async function processFlee(result, run, player, baseStats, skills, currentRoom) {
  // Stealth or dex check to flee
  const check = skillCheck({
    skillName: 'stealth',
    dc: 12,
    baseStats,
    skills,
    dcSource: 'flee',
  });

  result.checks.push({ type: 'stealth', ...check });
  result.diceResults.push(check);

  if (check.passed) {
    // End combat, player can move
    run.room_state.is_combat_active = false;

    // Opportunity attack damage scales with roll quality:
    //   crit_success   → 0x  (clean escape, no damage)
    //   success        → 0.25x  (glancing blow)
    //   partial_success→ 0.5x  (grazing hit while fleeing)
    const oppMultiplier =
      check.outcome === 'critical_success' ? 0.0
      : check.outcome === 'success' ? 0.25
      : 0.5;

    if (oppMultiplier > 0) {
      for (const enemy of run.room_state.enemies) {
        if (!enemy.is_dead) {
          const oppAttack = Math.round(enemy.damage * oppMultiplier);
          result.hpChange -= oppAttack;
          result.updatedPlayerHp -= oppAttack;
        }
      }
    }

    result.fleeSuccess = true;
    result.fleeOutcome = check.outcome;
  }
  // If failed, combat continues and enemies get their turns
}

// ──────── HELPERS ────────

/**
 * Build room_state JSON from a room in the floor map.
 */
function buildRoomState(room) {
  return {
    is_combat_active: false,
    round_number: 0,
    extra_actions_this_round: 0,
    active_combat_targets: [],
    telegraphed_actions: [],
    allies: [],
    enemies: room.enemies || [],
    npcs_present: [],
  };
}

/**
 * Build a skill map for quick lookup.
 */
function buildSkillsMap(playerId) {
  const skills = queries.getPlayerSkills(playerId);
  const map = {};
  for (const s of skills) {
    map[s.skill_name] = s;
  }
  return map;
}

/**
 * Apply result state changes to the database.
 */
async function applyResults(result, run, player, playerId, dungeon, floorMap) {
  transaction(() => {
    // HP changes
    if (result.hpChange !== 0) {
      const newHp = Math.max(0, Math.min(player.hp_max, player.hp_current + result.hpChange));
      execute(`UPDATE players SET hp_current = ? WHERE id = ?`, [newHp, playerId]);
      result.updatedPlayerHp = newHp;

      if (result.hpChange < 0) {
        run.run_stats.damage_taken = (run.run_stats.damage_taken || 0) + Math.abs(result.hpChange);
      }
    }

    // Gold gained
    if (result.goldGained > 0) {
      execute(`UPDATE players SET gold = gold + ? WHERE id = ?`, [result.goldGained, playerId]);
    }

    // Loot items
    for (const drop of result.lootDrops) {
      queries.addItem(playerId, drop.item_id, drop.quantity, run.id);
    }

    // Death handling
    if (result.runDied) {
      const deathResult = handlePlayerDeath(playerId, run.id);
      result.itemsLostOnDeath = deathResult.itemsLost;

      // Gold penalty
      const goldLoss = Math.floor(player.gold * config.game.deathGoldPenalty);
      execute(`UPDATE players SET gold = MAX(0, gold - ?), hp_current = 1 WHERE id = ?`, [goldLoss, playerId]);

      // Update dungeon history
      queries.upsertDungeonHistory(playerId, dungeon.id, 'times_died');

      // End run
      queries.endRun(run.id, 'dead');
    }

    // Run completion (already flagged)
    if (result.runComplete) {
      queries.upsertDungeonHistory(playerId, dungeon.id, 'times_completed');
      queries.endRun(run.id, 'completed');
    }

    // Check boss kill for completion
    if (!result.runComplete) {
      const bossKilled = run.room_state.enemies?.some(e => e.is_boss && e.is_dead);
      if (bossKilled) {
        let completionCondition;
        try {
          completionCondition = typeof dungeon.completion_condition === 'string'
            ? JSON.parse(dungeon.completion_condition)
            : dungeon.completion_condition;
        } catch { completionCondition = {}; }

        if (completionCondition?.type === 'boss_killed') {
          result.runComplete = true;

          // Completion rewards
          const completionGold = 50 + (dungeon.difficulty_tier || 1) * 25;
          result.completionGold = completionGold;
          result.goldGained += completionGold;
          execute(`UPDATE players SET gold = gold + ? WHERE id = ?`, [completionGold, playerId]);

          // Restore HP to full
          execute(`UPDATE players SET hp_current = hp_max WHERE id = ?`, [playerId]);
          result.updatedPlayerHp = player.hp_max;

          queries.upsertDungeonHistory(playerId, dungeon.id, 'times_completed');
          queries.endRun(run.id, 'completed');

          console.log(`[COMPLETE] Dungeon ${dungeon.name} cleared! +${completionGold}g completion bonus`);
        }
      }
    }
  });
}

/**
 * Summarize mechanical results for AI context injection.
 */
function summarizeMechanics(result) {
  const summary = {};

  if (result.diceResults.length > 0) {
    summary.checks = result.diceResults.map(r => ({
      skill: r.governing_stat,
      roll: r.base_roll,
      total: r.final_total,
      dc: r.dc,
      outcome: r.outcome,
    }));
  }

  if (result.combatResults.length > 0) {
    summary.combat = result.combatResults.map(c => ({
      target: c.target,
      damage: c.damageDealt || 0,
      killed: c.enemyDied || false,
      missed: c.missed || false,
    }));
  }

  if (result.enemyTurns.length > 0) {
    summary.enemy_actions = result.enemyTurns.filter(e => e.action !== 'skip').map(e => ({
      enemy: e.enemy,
      action: e.action,
      damage: e.damage,
    }));
  }

  if (result.lootDrops.length > 0) {
    summary.loot = result.lootDrops.map(l => l.item_name);
  }

  if (result.goldGained > 0) summary.gold_gained = result.goldGained;
  if (result.hpChange !== 0) summary.hp_change = result.hpChange;
  if (result.playerDied) summary.player_died = true;
  if (result.runComplete) summary.dungeon_completed = true;
  if (result.movedToRoom) summary.moved_to_room = result.movedToRoom;
  if (result.movedToFloor) summary.moved_to_floor = result.movedToFloor;
  if (result.poisonTick) summary.poison_tick = result.poisonTick;
  if (result.poisonCured) summary.poison_cured = true;
  if (result.fungusLit) summary.fungus_lit = true;
  if (result.lockpickConsumed) summary.lockpick_consumed = true;
  if (result.noLockpick) summary.no_lockpick = true;

  return summary;
}

/**
 * Abandon an active run.
 */
export function abandonRun(playerId) {
  const run = queries.getActiveRun(playerId);
  if (!run) throw new Error('No active run to abandon.');

  // Remove quest items from this run
  const inventory = queries.getInventory(playerId);
  const questItems = inventory.filter(i => i.acquired_in_run_id === run.id && i.is_quest_item);
  for (const qi of questItems) {
    queries.removeItem(qi.id, qi.quantity);
  }

  queries.endRun(run.id, 'abandoned');
  return { runId: run.id, dungeonId: run.dungeon_id };
}