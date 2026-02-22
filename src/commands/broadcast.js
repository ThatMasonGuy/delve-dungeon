import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { queryAll } from '../db/index.js';
import { config } from '../config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('Owner only: send a DM announcement to all known Delve players.')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Message to DM all players')
        .setRequired(true)
    )
    .setDMPermission(false),

  async execute(interaction) {
    const ownerId = config.discord.broadcastOwnerId;
    if (!ownerId) {
      return interaction.reply({
        content: 'Broadcast owner ID is not configured. Set `BROADCAST_OWNER_ID` in env.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.user.id !== ownerId) {
      return interaction.reply({
        content: 'You are not allowed to use `/broadcast`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const text = interaction.options.getString('message', true).trim();
    if (text.length < 5) {
      return interaction.reply({ content: 'Message is too short.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const recipients = queryAll("SELECT DISTINCT discord_id FROM players WHERE discord_id IS NOT NULL AND discord_id != ''");

    let sent = 0;
    let failed = 0;

    for (const row of recipients) {
      try {
        const user = await interaction.client.users.fetch(row.discord_id);
        await user.send(text);
        sent += 1;
      } catch (err) {
        failed += 1;
        console.warn(`[BROADCAST] Failed DM to ${row.discord_id}:`, err?.message || err);
      }
    }

    await interaction.editReply(`Broadcast complete. Sent: **${sent}**, Failed: **${failed}**.`);
  },
};
