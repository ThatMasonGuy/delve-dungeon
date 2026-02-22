// ═══════════════════════════════════════════════════════════════
// /help — How to play guide
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const C = { gold: 0xc8a96e, purple: 0x7c6fcd, blue: 0x5a7a9e };

export const PAGES = {
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
      '› Skills level up through use and grant permanent bonuses every 10 levels\n' +
      '› Rest rooms are safe. Use them.\n' +
      '› When in doubt, try wording it differently'
    )
    .addFields(
      {
        name: '📖 Topics — type `./help <topic>` in the game channel',
        value:
          '`overview` — This page\n' +
          '`commands` — All slash commands\n' +
          '`combat` — How combat and dice work\n' +
          '`flee` — Fleeing combat and what happens after\n' +
          '`search` — Searching rooms for loot\n' +
          '`skills` — Skill levels, bonuses, and progression\n' +
          '`items` — Inventory, equip, consumables\n' +
          '`dungeon` — Floors, rooms, movement',
      }
    )
    .setFooter({ text: '/help topic:commands  |  /help topic:combat  |  ./help flee  |  etc.' }),

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
          '✅ **Success** (beat DC) — Normal hit',
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
        name: 'Damage Formula',
        value: [
          'Base damage = 5 + (Strength or Dexterity / 3)',
          '+ weapon bonus from equipped item',
          '− enemy armor (flat reduction)',
          '× resistance or weakness multiplier',
          'Critical hit = damage doubled',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Use ./help flee for fleeing mechanics. Use ./help skills for skill bonuses.' }),

  flee: () => new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('🏃 Fleeing Combat')
    .setDescription(
      'Type *"flee"*, *"run"*, *"escape"*, or *"retreat"* to attempt to disengage.\n\n' +
      'Fleeing uses a **Stealth check vs DC 12**. Your Stealth skill and Dexterity modifier apply.'
    )
    .addFields(
      {
        name: 'Flee Outcomes',
        value: [
          '🌟 **Critical Success** (nat 20) — Clean escape, no opportunity damage',
          '✅ **Success** — You disengage (25% opportunity damage from each living enemy)',
          '⚠️ **Partial** — You escape but take a solid hit (50% opportunity damage)',
          '✖️ **Failure** — You couldn\'t break away; enemies immediately take their turns',
        ].join('\n'),
      },
      {
        name: '⚠️ What Happens After You Flee',
        value: [
          '**You stay in the same room.** Fleeing breaks combat, not your position.',
          'The enemies **do not leave** — they\'re still there with the same HP.',
          'Combat is deactivated so you can catch your breath, use items, or think.',
          'You can **re-engage any time** by saying "attack" again.',
          'You can also **move to a different room** instead of re-engaging.',
          'The room will **not be cleared** until all enemies are dead.',
        ].join('\n'),
      },
      {
        name: 'Strategy Notes',
        value: [
          '› Flee to use a health potion, then re-engage on better terms',
          '› A failed flee means enemies act — it\'s not free to attempt',
          '› Higher Stealth skill reduces the risk of a failed attempt',
          '› On a clean escape (nat 20), you take zero damage from opportunity attacks',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Stealth is governed by Dexterity. Level it by fleeing and sneaking.' }),

  search: () => new EmbedBuilder()
    .setColor(C.blue)
    .setTitle('🔍 Searching Rooms')
    .setDescription(
      'Type *"search"*, *"look around"*, *"examine the room"*, or *"investigate"* to search.\n\n' +
      'Searching uses a **Perception check** vs a DC set by the dungeon\'s difficulty. ' +
      'You get **one search attempt per room** — you can\'t re-roll.'
    )
    .addFields(
      {
        name: 'Not Every Room Has Loot',
        value: [
          'Some rooms are genuinely empty. A successful Perception roll tells you',
          'what\'s there — if nothing is hidden, you\'ll know you searched thoroughly.',
          'Don\'t expect a reward every time. Dungeons aren\'t that generous.',
          'Treasure rooms and boss rooms reliably have something worth taking.',
        ].join('\n'),
      },
      {
        name: 'Perception Bonuses',
        value: [
          '🔥 **Torch** — +3 Perception for the entire run (light it with *"light the torch"*)',
          '🍄 **Glowing Fungus** — +1 Perception for the run (consumable)',
          '📈 **Perception skill** — Grants a bonus every 10 levels (`./help skills`)',
          '📊 **Wisdom modifier** — Your base Perception stat',
        ].join('\n'),
      },
      {
        name: 'Hidden Loot',
        value: [
          'Some items require a minimum Perception level to even be visible.',
          'A high Perception skill unlocks hidden drops that other adventurers walk past.',
          'The narrator will hint when something feels concealed.',
        ].join('\n'),
      },
      {
        name: 'XP from Searching',
        value: 'You gain Perception XP from every search attempt — even on failure. ' +
          'Repeated searching across many runs is how you build up that skill.',
      },
    )
    .setFooter({ text: 'Tip: search once per room, then move on. Re-searching does nothing.' }),

  skills: () => new EmbedBuilder()
    .setColor(C.purple)
    .setTitle('📈 Skills & Leveling')
    .setDescription(
      'You have **10 skills** that improve through use. Each skill has its own XP pool and levels independently.\n\n' +
      '**Melee · Ranged · Magic · Stealth · Perception**\n' +
      '**Persuasion · Lockpicking · Survival · Crafting · Alchemy**'
    )
    .addFields(
      {
        name: 'How Skill Bonuses Work',
        value: [
          'Every skill adds a flat bonus to related dice checks:',
          '```',
          'Skill bonus = floor(skill level ÷ 10)',
          '',
          'Level  1–9  → +0    Level 10–19 → +1',
          'Level 20–29 → +2    Level 30–39 → +3',
          'Level 40–49 → +4    Level 50–59 → +5',
          '...up to Level 100  → +10 (maximum)',
          '```',
          'The bonus applies on every d20 roll for that skill.',
          'Hitting a new tier (every 10 levels) is the key milestone.',
        ].join('\n'),
      },
      {
        name: 'Full Roll Formula',
        value: [
          '`Final roll = d20 + stat modifier + skill bonus + item perks vs DC`',
          '',
          'Stat modifiers are permanent from character creation.',
          'Skill bonuses grow over time through play.',
          'Item perks (torch, gear) stack on top of both.',
        ].join('\n'),
      },
      {
        name: 'Skill → Governing Stat',
        value: [
          '`Melee` → Strength        `Ranged` → Dexterity',
          '`Magic` → Intelligence    `Stealth` → Dexterity',
          '`Perception` → Wisdom     `Persuasion` → Charisma',
          '`Lockpicking` → Dexterity `Survival` → Wisdom',
          '`Crafting` → Intelligence `Alchemy` → Intelligence',
        ].join('\n'),
      },
      {
        name: 'How Skills Gain XP',
        value: [
          '› Use the skill — attack with a weapon, search a room, pick a lock',
          '› Better outcomes give more XP (critical success = 2× XP)',
          '› Failures still give a small amount of XP',
          '› Use `/stats` to see all skill levels and their current bonuses',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Level 10 is your first meaningful spike. Work toward it.' }),

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
        name: 'Room Types',
        value: [
          '⚔️ **Standard** — Enemies to fight. Clear them to move on.',
          '💎 **Treasure** — A chest to open. Search for extra loot.',
          '⚠️ **Trap** — Perception check on entry; torch helps avoid damage.',
          '🛏️ **Rest** — Type *"rest"* or *"sleep"* to recover 20–35% HP.',
          '🔒 **Locked** — Requires a Thieves\' Pick to enter.',
          '👑 **Boss** — The final challenge. Come prepared.',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Use /status anytime to check your run. Use /map to see the layout.' }),
};

/**
 * Build a help embed for a given topic string.
 * Returns the overview embed for unknown topics.
 */
export function buildHelpEmbed(topic = '') {
  const key = topic.trim().toLowerCase();

  // Alias mapping for natural inputs
  const aliases = {
    flee: 'flee', run: 'flee', escape: 'flee', retreat: 'flee',
    search: 'search', explore: 'search', investigate: 'search', loot: 'search', find: 'search',
    skills: 'skills', skill: 'skills', level: 'skills', leveling: 'skills', xp: 'skills', progression: 'skills',
    combat: 'combat', fight: 'combat', attack: 'combat', dice: 'combat', roll: 'combat',
    items: 'items', item: 'items', inventory: 'items', equip: 'items', potion: 'items',
    dungeon: 'dungeon', rooms: 'dungeon', floors: 'dungeon', map: 'dungeon', movement: 'dungeon',
    commands: 'commands', command: 'commands', slash: 'commands',
  };

  const page = aliases[key] || (PAGES[key] ? key : 'overview');
  const build = PAGES[page] || PAGES.overview;
  return build();
}

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
          { name: 'Fleeing Combat', value: 'flee' },
          { name: 'Searching Rooms', value: 'search' },
          { name: 'Skills & Leveling', value: 'skills' },
          { name: 'Items & Inventory', value: 'items' },
          { name: 'Dungeon Structure', value: 'dungeon' },
        )
    ),

  async execute(interaction) {
    const topic = interaction.options.getString('topic') || 'overview';
    const embed = buildHelpEmbed(topic);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
