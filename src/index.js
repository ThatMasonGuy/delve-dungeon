// ═══════════════════════════════════════════════════════════════
// DELVE — Discord Bot Entry Point
// ═══════════════════════════════════════════════════════════════

import { Client, GatewayIntentBits, Partials, Collection, Events } from 'discord.js';
import { config } from './config.js';
import { initDb, applySchema, closeDb } from './db/index.js';
import { seedAll } from './db/seed.js';
import { loadCommands, registerCommands } from './commands/index.js';
import { handleGameMessage } from './commands/game-channel.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

// ──────── STARTUP ────────

async function boot() {
  console.log('[DELVE] Starting up...');

  // Init database
  initDb();
  applySchema();

  // Check if we need to seed (empty dungeons table = fresh db)
  const { getDb } = await import('./db/index.js');
  const dungeonCount = getDb().prepare('SELECT COUNT(*) as c FROM dungeons').get();
  if (dungeonCount.c === 0) {
    console.log('[DELVE] Empty database detected, seeding...');
    await seedAll();
  }

  // Load slash commands
  await loadCommands(client);

  // Register slash commands with Discord
  await registerCommands();

  // Login
  await client.login(config.discord.token);
}

// ──────── EVENTS ────────

client.once(Events.ClientReady, (c) => {
  console.log(`[DELVE] Logged in as ${c.user.tag}`);
  const channelScope = config.discord.gameChannelIds.length > 0
    ? config.discord.gameChannelIds.join(', ')
    : (config.discord.gameChannelId || 'all channels');
  console.log(`[DELVE] Watching game channels: ${channelScope}`);
  console.log(`[DELVE] DM gameplay: ${config.discord.allowDmGameplay ? 'enabled' : 'disabled'}`);
  console.log(`[DELVE] Ready.`);
});

// Slash command handler
client.on(Events.InteractionCreate, async (interaction) => {
  // Button interactions — route to the command that created them
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const [commandName] = interaction.customId.split(':');
    const command = client.commands.get(commandName);
    if (command?.handleComponent) {
      try {
        await command.handleComponent(interaction);
      } catch (error) {
        console.error(`[CMD] Error handling component ${interaction.customId}:`, error);
        const reply = { content: '⚠️ Something went wrong.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
    }
    return;
  }

  // Modal submissions
  if (interaction.isModalSubmit()) {
    const [commandName] = interaction.customId.split(':');
    const command = client.commands.get(commandName);
    if (command?.handleModal) {
      try {
        await command.handleModal(interaction);
      } catch (error) {
        console.error(`[CMD] Error handling modal ${interaction.customId}:`, error);
        const reply = { content: '⚠️ Something went wrong.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`[CMD] Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[CMD] Error executing ${interaction.commandName}:`, error);
    const reply = { content: '⚠️ Something went wrong processing that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// Game channel/DM message handler — this is where natural language gameplay happens
client.on(Events.MessageCreate, async (message) => {
  // Ignore bots
  if (message.author.bot) return;

  const isDm = message.guildId == null;
  const inAllowedChannel = config.discord.gameChannelIds.length === 0
    ? !isDm
    : config.discord.gameChannelIds.includes(message.channelId);

  if (isDm && config.discord.allowDmGameplay) {
    await handleGameMessage(message, client);
    return;
  }

  if (inAllowedChannel) {
    await handleGameMessage(message, client);
  }
});

// ──────── SHUTDOWN ────────

function shutdown(signal) {
  console.log(`\n[DELVE] ${signal} received, shutting down...`);
  client.destroy();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('[DELVE] Unhandled rejection:', err);
});

// ──────── GO ────────

boot().catch((err) => {
  console.error('[DELVE] Fatal startup error:', err);
  closeDb();
  process.exit(1);
});
