// ═══════════════════════════════════════════════════════════════
// /inventory — View inventory
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder } from 'discord.js';
import { queries } from '../db/index.js';
import { inventoryEmbed } from './embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View your inventory.'),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const player = queries.getPlayerByDiscordId(discordId);

    if (!player) {
      return interaction.reply({
        content: '⚠️ You don\'t have a character yet. Use `/characters` to create one.',
        ephemeral: true,
      });
    }

    const inventory = queries.getInventory(player.id);
    const embed = inventoryEmbed(player, inventory);
    await interaction.reply({ embeds: [embed] });
  },
};
