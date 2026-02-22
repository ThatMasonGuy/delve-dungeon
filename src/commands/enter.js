// ═══════════════════════════════════════════════════════════════
// /delve — Delve into a dungeon
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder } from 'discord.js';
import { queries, queryAll } from '../db/index.js';
import { startRun } from '../engine/action-processor.js';
import { dungeonEntryEmbed } from './embeds.js';
import { narrateRoomEntry } from '../ai/narrator.js';

export default {
  data: new SlashCommandBuilder()
    .setName('delve')
    .setDescription('Delve into a dungeon.')
    .addStringOption(opt =>
      opt.setName('dungeon')
        .setDescription('Dungeon name (use /dungeons to browse)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const player = queries.getPlayerByDiscordId(discordId);

    if (!player) {
      return interaction.reply({
        content: '⚠️ You don\'t have a character yet. Use `/characters` to create one.',
        ephemeral: true,
      });
    }

    // Check for existing run
    const existingRun = queries.getActiveRun(player.id);
    if (existingRun) {
      return interaction.reply({
        content: '⚠️ You\'re already in a dungeon! Finish or `/abandon` your current run first.',
        ephemeral: true,
      });
    }

    // Find dungeon
    const dungeonName = interaction.options.getString('dungeon');
    const allDungeons = queryAll('SELECT * FROM dungeons ORDER BY difficulty_tier');
    let dungeon;

    if (dungeonName) {
      dungeon = allDungeons.find(d => d.name.toLowerCase().includes(dungeonName.toLowerCase()));
      if (!dungeon) {
        return interaction.reply({
          content: `⚠️ No dungeon found matching "${dungeonName}". Use \`/dungeons\` to see available options.`,
          ephemeral: true,
        });
      }
    } else if (allDungeons.length === 1) {
      dungeon = allDungeons[0];
    } else {
      return interaction.reply({
        content: '⚠️ Specify a dungeon name: `/delve dungeon:The Sunken Crypt`\nUse `/dungeons` to browse available dungeons.',
        ephemeral: true,
      });
    }

    // Check gold
    if (player.gold < dungeon.entry_cost) {
      return interaction.reply({
        content: `⚠️ **${player.character_name}** needs **${dungeon.entry_cost}g** to enter ${dungeon.name}, but only has **${player.gold}g**.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      const result = startRun(player.id, dungeon.id);

      const entryEmbed = dungeonEntryEmbed(result.dungeon, result.entryCost, result.dungeon.floor_count);

      // Generate AI narration for the first room
      let narrativeText = null;
      try {
        narrativeText = await narrateRoomEntry(result.dungeon, result.firstRoom, player, 1, 1);
      } catch (aiErr) {
        console.error('[/delve] AI narration failed:', aiErr);
        narrativeText = '*The entrance yawns before you. Damp air rises from the depths below. Your torch flickers.*';
      }

      // Update AI context with the entry narration
      const run = queries.getActiveRun(player.id);
      if (run) {
        const ctx = run.ai_context || [];
        ctx.push({
          role: 'assistant',
          narration: narrativeText,
          room: 1,
          floor: 1,
        });
        queries.updateRunState(run.id, { ai_context: ctx });
      }

      // Log room entry action
      queries.logAction({
        run_id: result.runId,
        player_id: player.id,
        sequence: 1,
        floor_number: 1,
        room_number: 1,
        action_type: 'room_entry',
        player_action: '',
        checks_rolled: {},
        dice_results: {},
        outcome: 'success',
        ai_response: narrativeText || '',
        xp_gained: {},
        level_ups: [],
        items_found: [],
        items_lost: [],
      });

      // Send dungeon embed first, then narrative
      await interaction.editReply({ embeds: [entryEmbed] });

      if (narrativeText) {
        await interaction.channel.send({
          content: `${narrativeText}\n-# 📍 Floor 1 · Room 1 · ❤️ ${player.hp_current}/${player.hp_max}`,
        });
      }

    } catch (err) {
      console.error('[/delve] Error:', err);
      await interaction.editReply({ content: `⚠️ ${err.message}` });
    }
  },
};
