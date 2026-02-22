// ═══════════════════════════════════════════════════════════════
// /stats — View character stats
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder } from 'discord.js';
import { queries } from '../db/index.js';
import { playerStatsEmbed } from './embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View your character stats and skills.'),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const player = queries.getPlayerByDiscordId(discordId);

    if (!player) {
      return interaction.reply({
        content: '⚠️ You don\'t have a character yet. Use `/characters` to create one.',
        ephemeral: true,
      });
    }

    const baseStats = queries.getBaseStats(player.id);
    const skills = queries.getPlayerSkills(player.id);
    const equippedItems = queries.getEquippedItems(player.id);
    const slotCount = queries.countInventorySlots(player.id);
    player.inventory_count = slotCount;

    const embed = playerStatsEmbed(player, baseStats, skills, equippedItems);
    await interaction.reply({ embeds: [embed] });
  },
};
