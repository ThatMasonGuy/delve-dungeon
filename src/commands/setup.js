import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';

const DEFAULT_CHANNEL_NAME = 'delve-adventures';

export const SERVER_INTRO_MESSAGE = [
  '👋 **Welcome to Delve Dungeon (Beta v1)!**',
  '',
  'This bot is currently in **playtest** mode. To play:',
  '1) DM this bot directly.',
  '2) Use `/characters` to create your character.',
  '3) Use `/dungeons` and `/delve` to begin.',
  '',
  '⚠️ **Beta notice:** This is an early version and may contain bugs. Character progress may be reset if needed during testing.',
  '🏰 Only one dungeon is currently available, with more content coming soon.',
].join('\n');

export const DM_WELCOME_MESSAGE = [
  '👋 Welcome to **Delve**!',
  'To get started:',
  '1) Use `/characters` and pick an empty slot to create your character.',
  '2) Use `/dungeons` to browse available dungeons.',
  '3) Use `/delve` to begin a run, then type natural actions like `search room` or `attack skeleton`.',
  'Need guidance? Type `/help` or `/help overview`.',
  '',
  '⚠️ **Beta notice:** This is a v1 playtest and will contain issues. Characters may be reset if needed.',
  '🏰 Right now only one dungeon is available, with more coming soon.',
].join('\n');

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Admin setup: create a read-only server channel and post Delve instructions.')
    .addStringOption(option =>
      option
        .setName('channel_name')
        .setDescription('Optional channel name (default: delve-adventures)')
        .setRequired(false)
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const hasPerm = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) {
      return interaction.reply({ content: 'You need **Manage Server** permission to run `/setup`.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const channelName = (interaction.options.getString('channel_name') || DEFAULT_CHANNEL_NAME)
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100) || DEFAULT_CHANNEL_NAME;

    const existing = interaction.guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && c.name === channelName
    );

    const channel = existing || await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: 'Delve Dungeon playtest info. DM the bot to play.',
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages],
          allow: [PermissionFlagsBits.ViewChannel],
        },
      ],
    });

    await channel.send(SERVER_INTRO_MESSAGE);

    await interaction.editReply(
      existing
        ? `Posted setup message in existing channel <#${channel.id}>.`
        : `Created <#${channel.id}>, restricted member posting, and posted setup instructions.`
    );
  },
};
