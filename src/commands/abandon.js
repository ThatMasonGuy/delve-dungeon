// ═══════════════════════════════════════════════════════════════
// /abandon — Abandon current dungeon run
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder } from 'discord.js';
import { queries } from '../db/index.js';
import { abandonRun } from '../engine/action-processor.js';

export default {
  data: new SlashCommandBuilder()
    .setName('abandon')
    .setDescription('Abandon your current dungeon run. You keep non-quest items but lose quest items.'),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const player = queries.getPlayerByDiscordId(discordId);

    if (!player) {
      return interaction.reply({
        content: '⚠️ You don\'t have a character yet. Use `/characters` to create one.',
        ephemeral: true,
      });
    }

    try {
      const result = abandonRun(player.id);
      const dungeon = queries.getDungeon(result.dungeonId);

      await interaction.reply({
        content: `🚪 You retreat from **${dungeon?.name || 'the dungeon'}**, leaving its mysteries behind.\n\nYou kept your loot, but any quest items from this run were lost.\nUse \`/delve\` when you're ready to try again.`,
      });
    } catch (err) {
      await interaction.reply({
        content: `⚠️ ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
