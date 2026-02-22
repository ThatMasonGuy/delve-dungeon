import 'dotenv/config';

export const config = {
  // Discord
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.GAME_GUILD_ID,
    gameChannelId: process.env.GAME_CHANNEL_ID,
  },

  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },

  // Database
  db: {
    path: process.env.DB_PATH || './data/adventure.db',
  },

  // Game defaults
  game: {
    startGold: parseInt(process.env.DEFAULT_START_GOLD) || 100,
    startHp: parseInt(process.env.DEFAULT_START_HP) || 50,
    inventorySlots: parseInt(process.env.DEFAULT_INVENTORY_SLOTS) || 20,
    startInventorySlots: parseInt(process.env.DEFAULT_INVENTORY_SLOTS) || 20,
    aiContextWindow: 12,        // rolling message count for AI
    generateDungeonImages: process.env.GENERATE_DUNGEON_IMAGES === 'true',
    xpPerAction: { min: 5, max: 15 },
    deathGoldPenalty: 0.25,     // 25% gold lost on death
  },
};
