// ═══════════════════════════════════════════════════════════════
// /status — Current run status
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder } from 'discord.js';
import { queries } from '../db/index.js';
import { getCurrentRoom } from '../engine/floor-generator.js';
import { runStatusEmbed } from './embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('View your current dungeon run status.'),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const player = queries.getPlayerByDiscordId(discordId);

    if (!player) {
      return interaction.reply({
        content: '⚠️ You don\'t have a character yet. Use `/characters` to create one.',
        ephemeral: true,
      });
    }

    const run = queries.getActiveRun(player.id);
    if (!run) {
      return interaction.reply({
        content: '🏠 You\'re in the hub. No active dungeon run.\nUse `/delve` to start a delve.',
        ephemeral: true,
      });
    }

    const dungeon = queries.getDungeon(run.dungeon_id);
    const floorMapRow = queries.getFloorMap(run.id, run.current_floor);
    const currentRoom = floorMapRow ? getCurrentRoom(floorMapRow.floor_map, run.current_room) : null;

    const embed = runStatusEmbed(run, dungeon, currentRoom, player);
    await interaction.reply({ embeds: [embed] });
  },
};
