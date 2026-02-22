// ═══════════════════════════════════════════════════════════════
// /create — Character Creation
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder } from 'discord.js';
import { queries, transaction } from '../db/index.js';
import { rollBaseStats } from '../engine/dice.js';
import { characterCreatedEmbed } from './embeds.js';
import { config } from '../config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('create')
    .setDescription('Create your character and enter the realm.'),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    // Check if player already exists
    const existing = queries.getPlayerByDiscordId(discordId);
    if (existing) {
      return interaction.reply({
        content: `⚠️ You already have a character, **${existing.username}**. There's no rerolling fate.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      const baseStats = rollBaseStats();
      const startGold = config.game.startGold;
      const startHp = config.game.startHp + Math.floor((baseStats.constitution - 10) / 2) * 5;
      const inventorySlots = config.game.startInventorySlots;

      let playerId;

      transaction(() => {
        playerId = queries.createPlayer(discordId, username, startGold, startHp, inventorySlots);
        queries.createBaseStats(playerId, baseStats);
        queries.initPlayerSkills(playerId);
      });

      const embed = characterCreatedEmbed(username, baseStats, startGold);
      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('[/create] Error:', err);
      await interaction.editReply({ content: '⚠️ Something went wrong creating your character.' });
    }
  },
};
