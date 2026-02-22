// ═══════════════════════════════════════════════════════════════
// /help — How to play guide
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const C = { gold: 0xc8a96e, purple: 0x7c6fcd, blue: 0x5a7a9e };

const PAGES = {
  overview: () => new EmbedBuilder()
    .setColor(C.gold)
    .setTitle('⚔️ Delve Dungeon — How to Play')
    .setDescription(
      'Delve Dungeon is a Discord-native dungeon crawler. **Type naturally** inside the game channel to act — ' +
      'the AI Dungeon Master interprets your words and resolves them mechanically.\n\n' +
      '**The core loop:**\n' +
      '1. Create a character with `/characters`\n' +
      '2. Buy supplies at `/shop` (potions, torches, lockpicks)\n' +
      '3. Enter a dungeon with `/delve`\n' +
      '4. Type what you do in the game channel — fight, flee, search, use items\n' +
      '5. Clear every floor and defeat the boss to complete the dungeon\n\n' +
      '**Tips:**\n' +
      '› Light your torch before entering — it gives +3 Perception\n' +
      '› Search rooms before moving on — hidden loot waits for sharp eyes\n' +
      '› Rest rooms are safe. Use them.\n' +
      '› When in doubt, try wording it differently'
    )
    .addFields(
      {
        name: '📖 Select a topic below',
        value:
          '`overview` — This page\n' +
          '`commands` — All slash commands\n' +
          '`combat` — How combat and dice work\n' +
          '`items` — Inventory, equip, consumables\n' +
          '`dungeon` — Floors, rooms, movement',
      }
    )
    .setFooter({ text: '/help topic:commands  |  /help topic:combat  |  etc.' }),

  commands: () => new EmbedBuilder()
    .setColor(C.purple)
    .setTitle('🔧 Slash Commands')
    .addFields(
      {
        name: '🏠 Hub',
        value: [
          '`/characters` — Create, select, or delete characters (3 slots)',
          '`/hub` — Hub overview and available dungeons',
          '`/dungeons` — Browse dungeons and your history',
          '`/stats` — View character stats and skill levels',
          '`/inventory` — View your backpack',
          '`/shop` — Buy potions, tools, and dungeon trophy items',
          '`/sell` — Sell items for gold',
          '`/equip <item>` — Equip or unequip weapons/armor',
        ].join('\n'),
      },
      {
        name: '🏰 Dungeon',
        value: [
          '`/delve` — Enter a dungeon (costs gold)',
          '`/status` — Check your current run (floor, room, HP, enemies)',
          '`/map` — Display the current floor layout',
          '`/abandon` — Exit the dungeon early (keep loot, lose quest items)',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'You cannot use /equip while inside a dungeon — use natural language instead.' }),

  combat: () => new EmbedBuilder()
    .setColor(0xc45555)
    .setTitle('⚔️ Combat & Dice')
    .setDescription(
      'Combat is resolved by **skill checks**: roll a d20, add modifiers, beat the DC.\n\n' +
      '**Attack roll** = d20 + stat modifier + skill bonus + perks vs enemy AC\n' +
      '**DC outcomes:**'
    )
    .addFields(
      {
        name: 'Roll Results',
        value: [
          '🌟 **Critical Success** (nat 20) — Max damage, memorable moment',
          '✅ **Success** (beat DC by 5+) — Normal hit',
          '⚠️ **Partial** (within 2 of DC) — Reduced effect',
          '✖️ **Failure** — Miss',
          '💀 **Critical Failure** (nat 1) — Something goes very wrong',
        ].join('\n'),
      },
      {
        name: 'Natural Language Actions',
        value: [
          '**Attack**: *attack, strike, slash, swing, shoot, charge, rush, lunge*',
          '**Use item**: *drink, chug, use, swallow, eat, quaff* + item name',
          '**Flee**: *flee, run, escape, retreat*',
          '**Search**: *search, examine, investigate, look around*',
          '**Move**: *go to room 3, move on, press on, let\'s go deeper*',
          '**Unequip + attack**: *unequip my bow and swing at the skeleton*',
        ].join('\n'),
      },
      {
        name: 'Fleeing',
        value: [
          'A **Stealth check** vs DC 12 determines escape.',
          '🌟 Critical success → clean escape, no damage',
          '✅ Success → escape with glancing blow (25% opportunity damage)',
          '⚠️ Partial → escape with a hit (50% opportunity damage)',
          '✖️ Failure → combat continues, enemies act',
        ].join('\n'),
      },
    ),

  items: () => new EmbedBuilder()
    .setColor(C.gold)
    .setTitle('🎒 Items & Inventory')
    .addFields(
      {
        name: 'Consumables',
        value: [
          '❤️ **Health Potion** (15g) — Heals 10–20 HP. Say: *"drink the health potion"* or *"chug potion"*',
          '🟢 **Antidote** (18g) — Cures poison. Say: *"use the antidote"*',
          '🔥 **Torch** (5g) — +3 Perception for the entire run. Say: *"light the torch"*. Non-consumable.',
          '🔧 **Thieves\' Pick** (12g) — Required to pick locks. Breaks on use.',
        ].join('\n'),
      },
      {
        name: 'Equipping',
        value: [
          'Use `/equip <item name>` from the hub to equip or unequip weapons and armor.',
          'While inside a dungeon, say it naturally: *"I unequip my bow and swing at the rat"*',
          'Two-handed weapons occupy both weapon slots. Shields are off-hand.',
          '💀 **Cursed items cannot be unequipped.** Ever.',
        ].join('\n'),
      },
      {
        name: 'Inventory Limits',
        value: 'Max **20 slots**. Stackable items (potions, arrows) share a slot. Check with `/inventory`.',
      },
    ),

  dungeon: () => new EmbedBuilder()
    .setColor(C.blue)
    .setTitle('🏰 Dungeon Structure')
    .addFields(
      {
        name: 'Floors & Rooms',
        value: [
          'Dungeons have **3 floors**. Each floor is 4–8 rooms connected in a graph.',
          'Room 1 is the entrance. Clearing a room unlocks connected rooms.',
          '**Room types:** standard (enemies), treasure (chest), trap, rest, locked, boss',
          'The **boss room** is always the final room of the final floor.',
        ].join('\n'),
      },
      {
        name: 'Movement',
        value: [
          'Say where you want to go naturally:',
          '› *"Go to room 3"* — explicit room number',
          '› *"Press on / move forward / let\'s go deeper"* — advance to next room',
          '› *"Room 4 we will go"* — explicit room number, any phrasing',
          'Use `/map` to see the layout and which rooms are cleared.',
        ].join('\n'),
      },
      {
        name: 'Room Tips',
        value: [
          '🔍 **Search rooms** — type *"search"* or *"look around"* once per room for hidden loot',
          '🛏️ **Rest rooms** — type *"rest"* to recover 20–35% HP',
          '🔒 **Locked rooms** — require a Thieves\' Pick to enter',
          '⚠️ **Traps** — Perception check on room entry; torch helps',
          '👑 **Boss room** — you\'ll sense something wrong before you enter',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Use /status anytime to check your run. Good luck.' }),
};

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('How to play Delve Dungeon.')
    .addStringOption(opt =>
      opt.setName('topic')
        .setDescription('Which topic to read about')
        .setRequired(false)
        .addChoices(
          { name: 'Overview', value: 'overview' },
          { name: 'Commands', value: 'commands' },
          { name: 'Combat & Dice', value: 'combat' },
          { name: 'Items & Inventory', value: 'items' },
          { name: 'Dungeon Structure', value: 'dungeon' },
        )
    ),

  async execute(interaction) {
    const topic = interaction.options.getString('topic') || 'overview';
    const build = PAGES[topic];
    if (!build) {
      return interaction.reply({ content: '⚠️ Unknown topic.', ephemeral: true });
    }
    return interaction.reply({ embeds: [build()], ephemeral: true });
  },
};
