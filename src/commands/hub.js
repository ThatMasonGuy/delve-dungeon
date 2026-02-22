// ═══════════════════════════════════════════════════════════════
// /hub — View hub and available dungeons
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder } from 'discord.js';
import { queries } from '../db/index.js';
import { hubEmbed } from './embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hub')
    .setDescription('View the hub, available dungeons, and your status.'),

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
    if (run) {
      return interaction.reply({
        content: '⚠️ You\'re currently in a dungeon! Use `/status` to check your run, or `/abandon` to return to the hub.',
        ephemeral: true,
      });
    }

    const dungeons = queries.getAvailableDungeons();
    const embed = hubEmbed(player, dungeons);
    await interaction.reply({ embeds: [embed] });
  },
};
