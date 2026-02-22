// ═══════════════════════════════════════════════════════════════
// COMMAND LOADER — Loads and registers slash commands
// ═══════════════════════════════════════════════════════════════

import { REST, Routes } from 'discord.js';
import { config } from '../config.js';

// Import all commands
import characters from './characters.js';
import dungeons from './dungeons.js';
import delve from './enter.js';
import stats from './stats.js';
import inventory from './inventory.js';
import equip from './equip.js';
import abandon from './abandon.js';
import status from './status.js';
import hub from './hub.js';
import map from './map.js';
import shop from './shop.js';
import sell from './sell.js';

const commands = [characters, dungeons, delve, stats, inventory, equip, abandon, status, hub, map, shop, sell];

/**
 * Load commands into the client's command collection.
 */
export async function loadCommands(client) {
  for (const command of commands) {
    client.commands.set(command.data.name, command);
    console.log(`  [CMD] Loaded /${command.data.name}`);
  }
}

/**
 * Register slash commands with Discord API.
 */
export async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const commandData = commands.map(c => c.data.toJSON());

  try {
    if (config.discord.guildId) {
      // Guild-specific (instant, good for dev)
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commandData },
      );
      console.log(`[CMD] Registered ${commandData.length} guild commands`);
    } else {
      // Global (takes up to 1hr to propagate)
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commandData },
      );
      console.log(`[CMD] Registered ${commandData.length} global commands`);
    }
  } catch (err) {
    console.error('[CMD] Failed to register commands:', err);
  }
}