// ═══════════════════════════════════════════════════════════════
// NARRATOR — AI-powered dungeon master narration
// ═══════════════════════════════════════════════════════════════
// Builds prompts from game state, calls OpenAI, returns narrative.
// The AI sees: dungeon theme, current room, enemies, player stats,
// dice results, and a rolling context window of recent actions.
//
// The AI NEVER invents mechanical content — it narrates what the
// engine has already determined. Items, enemies, rooms all come
// from the database.
// ═══════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import { config } from '../config.js';

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

// ──────── SYSTEM PROMPT ────────

function buildSystemPrompt(dungeon, currentRoom, player, baseStats, equippedItems, inventory) {
  // Build inventory summary for AI awareness
  const invSummary = (inventory && inventory.length > 0)
    ? inventory.map(i => `${i.item_name}${i.quantity > 1 ? ` x${i.quantity}` : ''}${i.is_equipped ? ' [equipped]' : ''}`).join(', ')
    : 'Empty';

  const eqSummary = (equippedItems && equippedItems.length > 0)
    ? equippedItems.map(i => `${i.item_name} (${i.subtype})`).join(', ')
    : 'Nothing equipped (bare fists)';

  return `${dungeon.ai_context_seed}

═══ NARRATOR RULES ═══
You narrate a dungeon crawler in Discord. The ENGINE handles all mechanics — you describe the results.

HARD RULES (never break these):
1. NEVER invent items, enemies, or room features not listed in the game state below.
2. NEVER let the player use or reference items they don't have in their inventory below. If a player claims to have something not in their inventory, narrate that they reach for it but it isn't there.
3. NEVER tell exact numbers (HP, damage, dice values) — embeds handle that.
4. When mechanical results say "ITEMS FOUND", narrate discovering those EXACT items by name. If they found "Glowing Fungus", describe a glowing fungus — not an urn or relic you invented.
5. If the engine didn't move the player to a new room, they are STILL in the same room. Don't narrate them walking somewhere new.

STORYTELLING RULES:
6. Second person present tense. Be vivid, atmospheric, and immersive.
7. 2-3 paragraphs. Describe the environment, the sounds, the smells, the feeling of the place. Paint a picture.
8. When entering a NEW room, describe it fresh — atmosphere, threats, features, exits. Make each room feel distinct.
9. Describe combat viscerally — the clash of steel, the crunch of bone, the spray of ichor.
10. Critical success = legendary moment. Critical failure = memorable and darkly funny.
11. Partial success = "yes, but..." — success at a cost.
12. End with a subtle narrative hook woven into the description. Never literally ask "What do you do?"
13. IMPORTANT: The player is in Room ${currentRoom?.room_number || '?'} on FLOOR ${player._currentFloor || '?'}. Each floor is a completely different level of the dungeon with its own rooms. Floor 2 Room 1 is NOT the same place as Floor 1 Room 1 — describe it as a new, deeper area.

═══ CURRENT PLAYER ═══
Name: ${player.character_name || player.username}
HP: ${player.hp_current}/${player.hp_max}
Gold: ${player.gold}g
Stats: STR ${baseStats?.strength || '?'} DEX ${baseStats?.dexterity || '?'} CON ${baseStats?.constitution || '?'} INT ${baseStats?.intelligence || '?'} WIS ${baseStats?.wisdom || '?'} CHA ${baseStats?.charisma || '?'}
Equipped: ${eqSummary}
Inventory: ${invSummary}`;
}

function buildRoomContext(currentRoom, roomState, floorNumber) {
  if (!currentRoom) return 'Room data unavailable.';

  const parts = [`═══ CURRENT LOCATION: FLOOR ${floorNumber || '?'}, ROOM ${currentRoom.room_number} (${currentRoom.type}) ═══`];
  parts.push(`This is a ${currentRoom.type} room on floor ${floorNumber || '?'} of the dungeon.`);

  if (currentRoom.is_cleared) parts.push('Status: CLEARED');

  // Enemies
  const enemies = roomState?.enemies || currentRoom.enemies || [];
  const living = enemies.filter(e => !e.is_dead);
  if (living.length > 0) {
    parts.push('\nEnemies present:');
    for (const e of living) {
      parts.push(`- ${e.is_boss ? '[BOSS] ' : ''}${e.name}: ${e.hp_current}/${e.hp_max} HP, ${e.damage} dmg, ${e.armor} armor`);
      if (e.ai_descriptor) parts.push(`  Behavior: ${e.ai_descriptor}`);
    }
  }
  const dead = enemies.filter(e => e.is_dead);
  if (dead.length > 0) {
    parts.push(`\nDead: ${dead.map(e => e.name).join(', ')}`);
  }

  // Room features
  if (currentRoom.type === 'treasure') {
    parts.push('\nThis is a TREASURE ROOM — it should feel rewarding and exciting. Describe glinting objects, ornate details, or signs this room holds something valuable.');
  }
  if (currentRoom.chest) {
    const c = currentRoom.chest;
    if (c.is_looted) {
      parts.push('Chest: opened and emptied');
    } else if (!c.is_opened && c.is_locked) {
      parts.push(`Chest: LOCKED (DC ${c.lock_dc}) — hint that the player could try to pick the lock`);
    } else if (!c.is_opened) {
      parts.push('Chest: unlocked, unopened — describe it invitingly, the player can search or open it to find loot');
    } else {
      parts.push('Chest: opened but not yet looted — the contents await');
    }
  }

  if (currentRoom.trap && !currentRoom.trap.is_disarmed && !currentRoom.trap.is_triggered) {
    // Don't tell AI about undetected traps — it should be a surprise
    // Only mention if trap was detected via perception
  } else if (currentRoom.trap?.is_triggered) {
    parts.push(`\nTriggered trap: ${currentRoom.trap.name} — describe the aftermath of the trap going off.`);
  } else if (currentRoom.trap?.is_disarmed) {
    parts.push(`\nDisarmed trap: ${currentRoom.trap.name} — the player spotted and avoided it.`);
  }

  if (currentRoom.rest) {
    parts.push('\nThis is a REST AREA — a safe haven. The atmosphere is notably calmer and more peaceful than the surrounding rooms. Describe this as a place where the player could stop and recover their strength. Subtly hint they could rest here.');
  }

  if (currentRoom.is_exit) {
    parts.push('\nThis room contains a passage descending to the next floor.');
  }
  if (currentRoom.is_boss_room) {
    parts.push('\nThis is the final chamber. Something powerful awaits.');
  }

  // Connections
  if (currentRoom.connections?.length > 0) {
    parts.push(`\nExits: rooms ${currentRoom.connections.join(', ')}`);
  }

  // Combat state
  if (roomState?.is_combat_active) {
    parts.push(`\n[COMBAT ACTIVE — Round ${roomState.round_number || 1}]`);
  }

  return parts.join('\n');
}

function buildMechanicalContext(result) {
  if (!result) return '';

  const parts = ['\n═══ WHAT JUST HAPPENED (MECHANICAL) ═══'];

  // Dice results
  for (const dr of result.diceResults || []) {
    parts.push(`Check: d20=${dr.base_roll} + mods = ${dr.final_total} vs DC ${dr.dc} → ${dr.outcome}`);
  }

  // Combat
  for (const cr of result.combatResults || []) {
    if (cr.missed) {
      parts.push(`Player attack → ${cr.target}: MISSED`);
    } else {
      parts.push(`Player attack → ${cr.target}: ${cr.damageDealt} damage${cr.enemyDied ? ' — KILLED' : ''}`);
    }
  }

  // Enemy turns
  for (const et of result.enemyTurns || []) {
    if (et.action === 'skip' || et.action === 'idle') continue;
    const dodged = et.dodge_check?.passed;
    parts.push(`${et.enemy} → ${et.action}: ${et.damage} damage to player${dodged && et.damage === 0 ? ' (dodged)' : ''}`);
  }

  // Status effects
  for (const se of result.statusEffectsApplied || []) {
    parts.push(`Status applied: ${se.type} (from ${se.source}, ${se.duration} actions)`);
  }

  // Loot — AI MUST narrate these exact items by name
  if ((result.lootDrops || []).length > 0) {
    const source = result.chestLooted ? 'from the CHEST' : '';
    parts.push(`\nITEMS FOUND ${source} (narrate finding these EXACT items by name — do NOT invent other items):`);
    for (const drop of result.lootDrops) {
      parts.push(`  → ${drop.item_name} (${drop.rarity}${drop.was_hidden ? ', hidden find' : ''})`);
    }
  }
  if (result.goldGained > 0) parts.push(`Gold found: ${result.goldGained}g${result.chestLooted ? ' (from chest)' : ''}`);

  // No loot found
  if ((result.lootDrops || []).length === 0 && result.intent?.type === 'search') {
    if (result.roomAlreadySearched) {
      parts.push('\nSEARCH: Room already thoroughly searched. Narrate that the player finds nothing new.');
    } else {
      parts.push('\nSEARCH: No loot found. Narrate the player searching but coming up empty.');
    }
  }

  // Chest states
  if (result.chestLocked) {
    parts.push('\nCHEST is LOCKED. Tell the player the chest is locked and they could try picking the lock.');
  }
  if (result.chestAlreadyLooted) {
    parts.push('\nCHEST is already empty — the player took everything earlier.');
  }

  // Trap results
  if (result.trapTriggered) {
    parts.push(`\nTRAP TRIGGERED: ${result.trapTriggered.trap.name} — ${result.trapTriggered.damage} ${result.trapTriggered.trap.damage_type} damage! Narrate the trap going off as the player enters.`);
  }
  if (result.trapDetected) {
    parts.push(`\nTRAP DETECTED: ${result.trapDetected.trap.name} — The player spotted it just in time. Narrate the close call.`);
  }

  // Poison tick
  if (result.poisonTick) {
    parts.push(`\nPOISON TICK: Player takes ${result.poisonTick.damage} poison damage. ${result.poisonTick.remaining ? `Poison continues (${result.poisonTick.turnsLeft} turns left). Briefly mention the venom burning.` : 'The poison has finally faded.'}`);
  }
  if (result.poisonCured) {
    parts.push(`\nPOISON CURED: The antidote worked — all poison has been neutralized. Narrate the relief.`);
  }

  // Item use context
  if (result.fungusLit) {
    parts.push(`\nGLOWING FUNGUS: Player is using a Glowing Fungus as a light source (+1 perception). Narrate the soft bioluminescent glow lighting their way.`);
  }
  if (result.lockpickConsumed) {
    parts.push(`\nLOCKPICK: A Thieves' Pick was used in this attempt. ${result.diceResults?.[0]?.passed ? 'The lock clicked open.' : 'The pick snapped in the lock.'}`);
  }
  if (result.noLockpick) {
    parts.push(`\nNO LOCKPICK: Player tried to pick a lock but has no Thieves' Picks. They need to buy some from the shop.`);
  }

  // HP changes
  if (result.hpChange !== 0) {
    parts.push(`Player HP change: ${result.hpChange > 0 ? '+' : ''}${result.hpChange} (now ${result.updatedPlayerHp})`);
  }

  // Movement
  if (result.movedToFloor) {
    parts.push(`\n*** FLOOR TRANSITION: Player descended to FLOOR ${result.movedToFloor}, ROOM 1 ***`);
    parts.push(`This is a COMPLETELY NEW area of the dungeon. Describe it as a fresh, unexplored space — different atmosphere, different features. Do NOT reuse any descriptions from the previous floor.`);
  } else if (result.movedToRoom) {
    parts.push(`\nMoved to Room ${result.movedToRoom} on the current floor. Describe this new room.`);
  }

  // Death / completion
  if (result.playerDied) parts.push('*** PLAYER DIED ***');
  if (result.runComplete) parts.push('*** DUNGEON COMPLETED ***');

  // Level ups
  for (const lu of result.levelUps || []) {
    parts.push(`LEVEL UP: ${lu.skill} ${lu.old_level} → ${lu.new_level}`);
  }

  return parts.length > 1 ? parts.join('\n') : '\n═══ NO MECHANICAL EFFECT ═══\nThe player\'s action had no mechanical outcome (no skill check, no combat, no movement). Respond to their roleplay briefly — acknowledge what they said/did within the room, but nothing changes mechanically. Do NOT describe them moving to a new location.';
}

// ──────── CONVERSATION HISTORY ────────

function buildConversationHistory(aiContext) {
  const messages = [];
  for (const entry of aiContext || []) {
    if (entry.role === 'user') {
      messages.push({
        role: 'user',
        content: `[Player action: "${entry.action}"] ${entry.mechanical_results ? `[Engine result: ${JSON.stringify(entry.mechanical_results)}]` : ''}`,
      });
    } else if (entry.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: entry.narration || '',
      });
    }
  }
  return messages;
}

// ──────── PUBLIC API ────────

/**
 * Generate narration for entering a room.
 */
export async function narrateRoomEntry(dungeon, room, player, floorNumber, roomNumber) {
  const { queries } = await import('../db/index.js');
  const baseStats = queries.getBaseStats(player.id) || {};
  const equippedItems = queries.getEquippedItems(player.id) || [];
  const inventory = queries.getInventory(player.id) || [];

  player._currentFloor = floorNumber;

  const systemPrompt = buildSystemPrompt(dungeon, room, player, baseStats, equippedItems, inventory);
  const roomContext = buildRoomContext(room, { enemies: room.enemies || [] });

  const isNewFloor = floorNumber > 1;
  const isFinalFloor = floorNumber === dungeon.floor_count;

  let narrationInstruction;
  if (isNewFloor) {
    narrationInstruction = `The player has just DESCENDED to Floor ${floorNumber} (of ${dungeon.floor_count}) and enters its first room. This is a COMPLETELY NEW area they have never seen before — do NOT describe it as familiar or previously explored. Describe the descent itself (stairs, a drop, a flooded passage) and then this new floor's atmosphere. Make it feel distinctly different from the floor above — darker, wetter, more dangerous.${isFinalFloor ? ' This is the FINAL FLOOR. Something powerful and ancient waits here. Build dread.' : ''} 2-3 paragraphs, atmospheric and immersive.`;
  } else {
    narrationInstruction = `The player enters Room ${roomNumber} on Floor ${floorNumber} for the first time. Describe what they see, hear, and sense. Set the scene — atmosphere, notable features, threats. If enemies are present, describe them ominously but don't start combat. 2 paragraphs, atmospheric and immersive.`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${roomContext}\n\n═══ NARRATE ═══\n${narrationInstruction}`,
    },
  ];

  return callAI(messages, { maxTokens: 400 });
}

/**
 * Generate narration for a player action and its results.
 */
export async function narrateAction({ actionText, result, dungeon, currentRoom, player, baseStats, roomState, aiContext }) {
  const { queries: dbQueries } = await import('../db/index.js');
  const equippedItems = dbQueries.getEquippedItems(player.id) || [];
  const inventory = dbQueries.getInventory(player.id) || [];
  const run = dbQueries.getActiveRun(player.id);

  player._currentFloor = run?.current_floor || 1;

  const systemPrompt = buildSystemPrompt(dungeon, currentRoom, player, baseStats, equippedItems, inventory);
  const roomContext = buildRoomContext(currentRoom, roomState, run?.current_floor || 1);
  const mechanicalContext = buildMechanicalContext(result);
  const history = buildConversationHistory(aiContext);

  const userMessage = `${roomContext}\n${mechanicalContext}\n\n═══ PLAYER SAID ═══\n"${actionText}"\n\n═══ NARRATE ═══\nDescribe what happens based ONLY on the mechanical results above. The dice are already rolled — you narrate the outcome. If the player didn't mechanically move rooms, they're still in the same room. If the player claims to have an item not in their inventory, they don't have it. 1-2 paragraphs, be vivid but brief.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8), // Last 8 messages for context
    { role: 'user', content: userMessage },
  ];

  return callAI(messages);
}

// ──────── AI CALL ────────

async function callAI(messages, options = {}) {
  try {
    const client = getClient();

    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages,
      max_tokens: options.maxTokens || 300,
      temperature: 0.75,
      presence_penalty: 0.4,
      frequency_penalty: 0.3,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');

    return content.trim();

  } catch (err) {
    console.error('[AI] OpenAI call failed:', err.message);
    throw err;
  }
}