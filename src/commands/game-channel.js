// ═══════════════════════════════════════════════════════════════
// GAME CHANNEL — Natural language message handler
// ═══════════════════════════════════════════════════════════════
// This is the magic. Player types in the game channel, Delve
// processes the action through the engine, gets AI narration,
// and responds with narrative + mechanical embeds.
// ═══════════════════════════════════════════════════════════════

import { queries, queryOne, execute } from '../db/index.js';
import { processAction } from '../engine/action-processor.js';
import { getCurrentRoom } from '../engine/floor-generator.js';
import { narrateAction } from '../ai/narrator.js';
import { buildHelpEmbed } from './help.js';
import {
  diceEmbed,
  combatEmbed,
  lootEmbed,
  levelUpEmbed,
  xpEmbed,
  deathEmbed,
  dungeonCompleteEmbed,
  floorTransitionEmbed,
  restEmbed,
  trapEmbed,
  itemUsedEmbed,
  torchLitEmbed,
  fungusLitEmbed,
  poisonTickEmbed,
  poisonCuredEmbed,
  unequipEmbed,
  fleeEmbed,
} from './embeds.js';

// Track players currently being processed to prevent double-actions
const processing = new Set();

/**
 * Handle a message in the game channel.
 */
export async function handleGameMessage(message, client) {
  const discordId = message.author.id;

  // ./help [topic] — works anywhere in the game channel, dungeon or hub
  const helpMatch = message.content.trim().match(/^\.\/help\s*(.*)$/i);
  if (helpMatch) {
    const topic = (helpMatch[1] || '').trim();
    const embed = buildHelpEmbed(topic);
    return message.reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false },
    });
  }

  // Check if player exists
  const player = queries.getPlayerByDiscordId(discordId);
  if (!player) {
    // Silently ignore non-players in the game channel
    return;
  }

  // Check if player has an active run
  const run = queries.getActiveRun(player.id);
  if (!run) {
    // Not in a dungeon — ignore or give a hint
    if (message.content.trim().length > 2) {
      await message.reply({
        content: '🏠 You\'re in the hub. Use `/delve` to start a dungeon run.',
        allowedMentions: { repliedUser: false },
      });
    }
    return;
  }

  // Prevent double-processing
  if (processing.has(discordId)) {
    await message.react('⏳').catch(() => {});
    return;
  }

  processing.add(discordId);

  try {
    // Show typing indicator
    await message.channel.sendTyping();

    // Process the action through the engine
    const result = await processAction(player.id, message.content);

    console.log(`[GAME] Result: intent=${result.intent?.type}, movedTo=${result.movedToRoom || 'none'}, floor=${result.movedToFloor || 'none'}, floorTransition=${!!result.floorTransition}`);

    // Build response
    let narrativeText = '';

    // Quick responses that don't need AI
    if (result.roomAlreadySearched) {
      narrativeText = '*You\'ve already searched this room thoroughly. Nothing new to find here.*';
    }

    // Room is genuinely empty after a search
    if (result.roomEmptyOnSearch) {
      const emptyMessages = [
        '*You search the room carefully — dust, stone, nothing more. This place has nothing to offer.*',
        '*You turn the room over looking for something useful. There\'s nothing here worth taking.*',
        '*A thorough search turns up nothing. The room is empty.*',
        '*Despite your best efforts, the room yields nothing of value. Some rooms just aren\'t worth the time.*',
      ];
      narrativeText = emptyMessages[Math.floor(Math.random() * emptyMessages.length)];
    }

    // Locked door feedback
    if (result.moveBlocked?.reason === 'locked') {
      narrativeText = `*The way to Room ${result.moveBlocked.room} is barred by a heavy locked door. You'll need to **pick the lock** to get through.*`;
    }

    // Chest feedback
    if (result.noChest) {
      narrativeText = '*There\'s no chest in this room.*';
    }
    if (result.chestLocked) {
      narrativeText = '*The chest is locked tight. You\'ll need to **pick the lock** first.*';
    }
    if (result.chestAlreadyLooted) {
      narrativeText = '*The chest is empty — you\'ve already taken everything.*';
    }

    // Rest failed — not a rest room
    if (result.restFailed) {
      narrativeText = '*This area isn\'t safe enough to rest. Look for a rest room — they\'ll feel calmer and more sheltered.*';
    }

    // Item use feedback
    if (result.noItemToUse) {
      narrativeText = '*You don\'t have any usable items matching that description.*';
    }
    if (result.noItemEffect) {
      narrativeText = `*${result.itemUsed?.name || 'That item'} doesn't have a usable effect.*`;
    }
    if (result.torchAlreadyLit) {
      narrativeText = '*Your torch is already burning brightly.*';
    }
    if (result.fungusAlreadyLit) {
      narrativeText = '*You\'re already using a Glowing Fungus for light.*';
    }

    // Lockpick feedback
    if (result.noLockpick) {
      narrativeText = '*You don\'t have any lockpicks. Buy **Thieves\' Picks** from the shop before your next run.*';
    }

    // Rest room hint — append to narrative when entering a rest room
    if (result.movedToRoom && !narrativeText) {
      const updatedRunForHint = queries.getActiveRun(player.id) || run;
      const floorMapHint = queries.getFloorMap(updatedRunForHint.id, updatedRunForHint.current_floor);
      const movedRoom = floorMapHint ? getCurrentRoom(floorMapHint.floor_map, result.movedToRoom) : null;
      if (movedRoom?.rest) {
        result._isRestRoom = true;
      }
    }

    // ── Generate AI narration ──
    if (!narrativeText) try {
      // Re-fetch run state since processAction may have changed floor/room
      const updatedRunForAI = queries.getActiveRun(player.id);
      const activeRun = updatedRunForAI || run;

      const dungeon = queries.getDungeon(run.dungeon_id);
      const floorMapRow = queries.getFloorMap(run.id, activeRun.current_floor);
      const currentRoom = floorMapRow ? getCurrentRoom(floorMapRow.floor_map, activeRun.current_room) : null;

      if (result.floorTransition) {
        // Floor transition — use dedicated room entry narration for fresh description
        const { narrateRoomEntry } = await import('../ai/narrator.js');
        narrativeText = await narrateRoomEntry(
          dungeon,
          result.currentRoom || currentRoom,
          player,
          result.movedToFloor,
          1,
        );
      } else {
        narrativeText = await narrateAction({
          actionText: message.content,
          result,
          dungeon,
          currentRoom: result.currentRoom || currentRoom,
          player,
          baseStats: queries.getBaseStats(player.id),
          roomState: result.updatedRoomState || activeRun.room_state,
          aiContext: activeRun.ai_context || [],
        });
      }

      // Store AI response in context
      const updatedRun = queries.getActiveRun(player.id);
      if (updatedRun) {
        const ctx = updatedRun.ai_context || [];
        ctx.push({
          role: 'assistant',
          narration: narrativeText,
          room: updatedRun.current_room,
          floor: updatedRun.current_floor,
        });
        // Trim context window
        while (ctx.length > 12) ctx.shift();
        queries.updateRunState(updatedRun.id, { ai_context: ctx });
      }

    } catch (aiErr) {
      console.error('[GAME] AI narration failed:', aiErr);
      narrativeText = buildFallbackNarration(result);
    }

    // ── Build mechanical embeds (sent FIRST) ──
    const mechEmbeds = [];

    // Floor transition
    if (result.floorTransition) {
      mechEmbeds.push(floorTransitionEmbed(result.movedToFloor, result.previousFloor, result.totalFloors));
    }

    // Dice results
    if (result.diceResults.length > 0) {
      const primaryCheck = result.diceResults[0];
      let context;

      if (result.intent?.type === 'attack') {
        context = `Attacking ${result.combatResults[0]?.target || 'enemy'}`;
      } else if (result.intent?.type === 'skill_check' || result.intent?.skill) {
        const skillName = result.intent.skill || primaryCheck.governing_stat || 'Skill';
        context = `${capitalize(skillName.replace(/_/g, ' '))}`;
      } else {
        const contextLabels = {
          room_search: 'Searching the room',
          room_feature: 'Examining the room',
          flee: 'Attempting to flee',
        };
        context = contextLabels[primaryCheck.dc_source] || capitalize(result.intent?.type || 'Check');
      }
      mechEmbeds.push(diceEmbed(primaryCheck, context));
    }

    // Combat results
    if (result.combatResults.length > 0 || result.enemyTurns.length > 0) {
      const roomState = result.updatedRoomState || run.room_state;
      mechEmbeds.push(combatEmbed(result.combatResults, result.enemyTurns, roomState));
    }

    // Loot
    const lootEm = lootEmbed(result.lootDrops, result.goldGained);
    if (lootEm) mechEmbeds.push(lootEm);

    // Level ups
    const lvlEm = levelUpEmbed(result.levelUps);
    if (lvlEm) mechEmbeds.push(lvlEm);

    // XP (only if no level-up, to reduce noise)
    if (result.levelUps.length === 0) {
      const xpEm = xpEmbed(result.xpGained);
      if (xpEm) mechEmbeds.push(xpEm);
    }

    // Rest
    if (result.rested) {
      mechEmbeds.push(restEmbed(result.restHealAmount, result.updatedPlayerHp, player.hp_max));
    }

    // Trap triggered on room entry
    if (result.trapTriggered) {
      mechEmbeds.push(trapEmbed(result.trapTriggered.trap, result.trapTriggered.damage, false));
    }
    if (result.trapDetected) {
      mechEmbeds.push(trapEmbed(result.trapDetected.trap, 0, true));
    }

    // Torch lit
    if (result.torchLit) {
      mechEmbeds.push(torchLitEmbed());
    }

    // Fungus lit
    if (result.fungusLit) {
      mechEmbeds.push(fungusLitEmbed());
    }

    // Poison tick
    if (result.poisonTick) {
      mechEmbeds.push(poisonTickEmbed(result.poisonTick.damage, result.poisonTick.turnsLeft));
    }

    // Poison cured
    if (result.poisonCured) {
      mechEmbeds.push(poisonCuredEmbed());
    }

    // Item used (non-torch, non-fungus consumables)
    if (result.itemUsed && !result.torchLit && !result.fungusLit && result.itemUsed.effects.length > 0) {
      mechEmbeds.push(itemUsedEmbed(result.itemUsed.name, result.itemUsed.effects));
    }

    // Unequip result
    if (result.unequippedItem) {
      mechEmbeds.push(unequipEmbed(result.unequippedItem));
    }

    // Flee result (only on successful flee — failed flee shows combat embed)
    if (result.fleeSuccess) {
      mechEmbeds.push(fleeEmbed(result.fleeOutcome));
    }

    // ── Build story embeds (sent WITH narrative) ──
    const storyEmbeds = [];

    if (result.runDied) {
      const dungeon = queries.getDungeon(run.dungeon_id);
      const goldLost = Math.floor(player.gold * 0.25);
      storyEmbeds.push(deathEmbed(player, result.itemsLostOnDeath || [], goldLost, dungeon));
    }

    if (result.runComplete) {
      const dungeon = queries.getDungeon(run.dungeon_id);
      storyEmbeds.push(dungeonCompleteEmbed(dungeon, run.run_stats, result.lootDrops, result.goldGained, result.completionGold || 0));
    }

    // ── Send response: mechanics first, then narrative ──

    // Append rest room hint
    if (result._isRestRoom && narrativeText) {
      narrativeText += '\n\n-# 🛏️ This is a rest area. Say "rest" or "sleep" to recover some health.';
    }

    const updatedRunFinal = queries.getActiveRun(player.id) || run;
    let locationLine = '';
    if (updatedRunFinal && updatedRunFinal.status === 'active') {
      const rs = updatedRunFinal.run_stats || {};
      const poisonEffects = (rs.status_effects || []).filter(e => e.type === 'poison');
      const tags = [];
      if (poisonEffects.length > 0) tags.push(`☠️ Poisoned (${Math.max(...poisonEffects.map(e => e.duration))})`);
      if (rs.torch_lit) tags.push('🔥 Torch');
      if (rs.fungus_lit) tags.push('🍄 Fungus');
      const tagStr = tags.length > 0 ? ` · ${tags.join(' · ')}` : '';
      locationLine = `\n-# 📍 Floor ${updatedRunFinal.current_floor} · Room ${updatedRunFinal.current_room} · ❤️ ${result.updatedPlayerHp}/${player.hp_max}${tagStr}`;
    }

    // 1) Send mechanical results as reply (dice, combat, loot, xp)
    if (mechEmbeds.length > 0) {
      await message.reply({
        embeds: mechEmbeds.slice(0, 10),
        allowedMentions: { repliedUser: false },
      });
    }

    // 2) Send AI narrative as follow-up message
    let fullContent = narrativeText ? `${narrativeText}${locationLine}` : (locationLine || undefined);
    if (fullContent && fullContent.length > 1900) {
      fullContent = fullContent.substring(0, 1900) + '...';
    }

    if (fullContent || storyEmbeds.length > 0) {
      // If we already sent mechanics as a reply, send narrative as a channel message
      // If no mechanics, send narrative as the reply
      if (mechEmbeds.length > 0) {
        await message.channel.send({
          content: fullContent || undefined,
          embeds: storyEmbeds.length > 0 ? storyEmbeds : undefined,
        });
      } else {
        await message.reply({
          content: fullContent || undefined,
          embeds: storyEmbeds.length > 0 ? storyEmbeds : undefined,
          allowedMentions: { repliedUser: false },
        });
      }
    }

    // Update the action log with AI response
    const lastLog = queryOne(
      'SELECT id FROM run_action_log WHERE run_id = ? ORDER BY sequence DESC LIMIT 1',
      [run.id]
    );
    if (lastLog) {
      execute('UPDATE run_action_log SET ai_response = ? WHERE id = ?', [narrativeText, lastLog.id]);
    }

  } catch (err) {
    console.error('[GAME] Error processing action:', err);
    await message.reply({
      content: `⚠️ Something went wrong: ${err.message}`,
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
  } finally {
    processing.delete(discordId);
  }
}

/**
 * Build a fallback narration when AI is unavailable.
 */
function buildFallbackNarration(result) {
  const parts = [];

  if (result.movedToFloor) {
    parts.push(`*You descend to floor ${result.movedToFloor}.*`);
  } else if (result.movedToRoom) {
    parts.push(`*You move to room ${result.movedToRoom}.*`);
  }

  if (result.combatResults.length > 0) {
    for (const cr of result.combatResults) {
      if (cr.missed) {
        parts.push(`*Your attack on ${cr.target} misses.*`);
      } else {
        parts.push(`*You strike ${cr.target} for ${cr.damageDealt} damage.${cr.enemyDied ? ' It falls!' : ''}*`);
      }
    }
  }

  for (const et of result.enemyTurns) {
    if (et.damage > 0) {
      parts.push(`*${et.enemy} uses ${et.action} for ${et.damage} damage.*`);
    }
  }

  if (result.runDied) {
    parts.push('*Everything goes dark...*');
  } else if (result.runComplete) {
    parts.push('*The dungeon falls silent. You have triumphed!*');
  }

  return parts.join('\n') || '*You act, and the dungeon responds...*';
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}