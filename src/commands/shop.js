// ═══════════════════════════════════════════════════════════════
// /shop — Browse and buy items from hub shops
// ═══════════════════════════════════════════════════════════════

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} from 'discord.js';
import { queries, execute } from '../db/index.js';

// ── Shop Definitions ──

const POTION_SHOP = {
  name: 'The Cauldron',
  emoji: '🧪',
  description: 'Potions, tools, and provisions for the road ahead.',
  items: [
    { itemName: 'Health Potion', price: 15, emoji: '❤️', desc: 'Heals 20 HP' },
    { itemName: 'Antidote', price: 18, emoji: '🟢', desc: 'Cures poison' },
    { itemName: 'Torch', price: 5, emoji: '🔥', desc: '+3 Perception while lit' },
    { itemName: "Thieves' Pick", price: 12, emoji: '🔧', desc: 'Lockpicking tool' },
  ],
};

const TROPHY_SHOPS = {
  // dungeon_id → unlocked items after first completion
  1: {
    name: 'The Sunken Crypt',
    items: [
      { itemName: 'Rusty Shortsword', price: 25, emoji: '⚔️', desc: '+3 melee damage' },
      { itemName: 'Tattered Leather Vest', price: 35, emoji: '🛡️', desc: 'Light armor' },
      { itemName: 'Bone Shield', price: 30, emoji: '🛡️', desc: 'Off-hand shield' },
      { itemName: 'Bone Longbow', price: 45, emoji: '🏹', desc: 'Ranged weapon' },
    ],
  },
};

// ── Colors ──
const C = { gold: 0xf1c40f, green: 0x2ecc71, red: 0xe74c3c };

export default {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse the hub shops and buy items.'),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const player = queries.getPlayerByDiscordId(discordId);

    if (!player) {
      return interaction.reply({
        content: '⚠️ You don\'t have a character yet. Use `/characters` to create one.',
        ephemeral: true,
      });
    }

    const run = queries.getActiveRun(player.id);
    if (run) {
      return interaction.reply({
        content: '⚠️ You can\'t shop while in a dungeon. Use `/abandon` to return first.',
        ephemeral: true,
      });
    }

    // ── Build Potion Shop ──
    const potionEmbed = new EmbedBuilder()
      .setColor(C.gold)
      .setTitle(`${POTION_SHOP.emoji} ${POTION_SHOP.name}`)
      .setDescription(
        `${POTION_SHOP.description}\n💰 **${player.gold}g** available\n\n` +
        POTION_SHOP.items.map(i => `${i.emoji} **${i.itemName}** — ${i.price}g\n-# ${i.desc}`).join('\n')
      );

    const potionMenu = new StringSelectMenuBuilder()
      .setCustomId('shop_potion')
      .setPlaceholder('Buy from The Cauldron...')
      .addOptions(
        POTION_SHOP.items.map(i => ({
          label: `${i.itemName} — ${i.price}g`,
          description: i.desc,
          value: i.itemName,
          emoji: i.emoji,
        }))
      );

    const potionRow = new ActionRowBuilder().addComponents(potionMenu);

    // ── Build Trophy Shop ──
    const completedIds = queries.getCompletedDungeonIds(player.id);
    const trophyItems = [];
    const unlockedDungeons = [];

    for (const [dungeonId, shop] of Object.entries(TROPHY_SHOPS)) {
      if (completedIds.includes(parseInt(dungeonId))) {
        unlockedDungeons.push(shop.name);
        trophyItems.push(...shop.items);
      }
    }

    let trophyDesc;
    if (trophyItems.length === 0) {
      trophyDesc = '*Complete a dungeon to unlock its rewards for purchase.*\n\nThe shelves are empty... for now.';
    } else {
      trophyDesc = `Spoils from conquered dungeons.\n💰 **${player.gold}g** available\n\n` +
        trophyItems.map(i => `${i.emoji} **${i.itemName}** — ${i.price}g\n-# ${i.desc}`).join('\n');
    }

    const trophyEmbed = new EmbedBuilder()
      .setColor(trophyItems.length > 0 ? C.gold : 0x95a5a6)
      .setTitle('🏆 Hall of Conquests')
      .setDescription(trophyDesc);

    const embeds = [potionEmbed, trophyEmbed];
    const components = [potionRow];

    // Add trophy select menu if items available
    if (trophyItems.length > 0) {
      const trophyMenu = new StringSelectMenuBuilder()
        .setCustomId('shop_trophy')
        .setPlaceholder('Buy from Hall of Conquests...')
        .addOptions(
          trophyItems.map(i => ({
            label: `${i.itemName} — ${i.price}g`,
            description: i.desc,
            value: i.itemName,
            emoji: i.emoji,
          }))
        );
      components.push(new ActionRowBuilder().addComponents(trophyMenu));
    }

    const reply = await interaction.reply({ embeds, components, fetchReply: true });

    // ── Handle purchases ──
    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 120_000, // 2 minutes
    });

    collector.on('collect', async (i) => {
      // Only the command user can buy
      if (i.user.id !== discordId) {
        return i.reply({ content: 'This shop isn\'t for you.', ephemeral: true });
      }

      const selectedName = i.values[0];
      const shopType = i.customId === 'shop_potion' ? 'potion' : 'trophy';

      // Find the item in shop stock
      const shopStock = shopType === 'potion'
        ? POTION_SHOP.items
        : trophyItems;
      const shopItem = shopStock.find(s => s.itemName === selectedName);

      if (!shopItem) {
        return i.reply({ content: '⚠️ Item not found.', ephemeral: true });
      }

      // Re-fetch player for current gold
      const currentPlayer = queries.getPlayerByDiscordId(discordId);
      if (currentPlayer.gold < shopItem.price) {
        return i.reply({
          content: `⚠️ Not enough gold. **${shopItem.itemName}** costs **${shopItem.price}g** but you only have **${currentPlayer.gold}g**.`,
          ephemeral: true,
        });
      }

      // Check inventory space
      const slotCount = queries.countInventorySlots(currentPlayer.id);
      if (slotCount >= 20) {
        return i.reply({
          content: '⚠️ Inventory full (20/20). Drop or use items first.',
          ephemeral: true,
        });
      }

      // Process purchase
      const dbItem = queries.getItemByName(shopItem.itemName);
      if (!dbItem) {
        return i.reply({ content: '⚠️ Item not found in database.', ephemeral: true });
      }

      execute(`UPDATE players SET gold = gold - ? WHERE id = ?`, [shopItem.price, currentPlayer.id]);
      queries.addItem(currentPlayer.id, dbItem.id, 1);

      const newGold = currentPlayer.gold - shopItem.price;

      await i.reply({
        content: `${shopItem.emoji} Purchased **${shopItem.itemName}** for **${shopItem.price}g**. 💰 ${newGold}g remaining.`,
      });
    });

    collector.on('end', () => {
      // Remove menus after timeout
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};