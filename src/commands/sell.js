// ═══════════════════════════════════════════════════════════════
// /sell — Sell items for gold at the hub
// ═══════════════════════════════════════════════════════════════

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} from 'discord.js';
import { queries, execute } from '../db/index.js';

const C = { gold: 0xf1c40f, green: 0x2ecc71, grey: 0x95a5a6 };

export default {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Sell items from your inventory for gold.'),

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
        content: '⚠️ You can\'t sell items while in a dungeon. Use `/abandon` to return first.',
        ephemeral: true,
      });
    }

    const inventory = queries.getInventory(player.id);

    // Build sellable items list
    // Valuables sell at full base_value, other non-equipped items at half
    const sellable = inventory
      .filter(i => !i.is_equipped && !i.is_quest_item && i.base_value > 0)
      .map(i => {
        const isValuable = i.item_type === 'valuable';
        const priceEach = isValuable ? i.base_value : Math.max(1, Math.floor(i.base_value / 2));
        return {
          ...i,
          sell_price: priceEach,
          total_price: priceEach * i.quantity,
          is_valuable: isValuable,
        };
      });

    if (sellable.length === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(C.grey)
            .setTitle('🏪 Sell Items')
            .setDescription(`💰 **${player.gold}g**\n\n*You don\'t have anything to sell. Go delve for some loot.*`),
        ],
      });
    }

    const RARITY = { common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟠' };

    const desc = sellable.map(i => {
      const emoji = RARITY[i.rarity] || '⚪';
      const qty = i.quantity > 1 ? ` x${i.quantity}` : '';
      const rate = i.is_valuable ? 'full value' : 'half value';
      return `${emoji} **${i.item_name}**${qty} — **${i.total_price}g** *(${i.sell_price}g ea, ${rate})*`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(C.gold)
      .setTitle('🏪 Sell Items')
      .setDescription(`💰 **${player.gold}g**\n\n${desc}`);

    // Build select menu (max 25 options)
    const options = sellable.slice(0, 25).map(i => ({
      label: `${i.item_name}${i.quantity > 1 ? ` x${i.quantity}` : ''} — ${i.total_price}g`,
      description: `${i.sell_price}g each · ${i.is_valuable ? 'Valuable' : i.item_type}`,
      value: String(i.id), // inventory row ID
      emoji: RARITY[i.rarity] || '⚪',
    }));

    const menu = new StringSelectMenuBuilder()
      .setCustomId('sell_item')
      .setPlaceholder('Select an item to sell...')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);
    const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

    // ── Handle sales ──
    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 120_000,
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== discordId) {
        return i.reply({ content: 'This shop isn\'t for you.', ephemeral: true });
      }

      const inventoryRowId = parseInt(i.values[0]);
      const soldItem = sellable.find(s => s.id === inventoryRowId);

      if (!soldItem) {
        return i.reply({ content: '⚠️ Item not found.', ephemeral: true });
      }

      // Re-check the item still exists
      const currentInv = queries.getInventory(player.id);
      const current = currentInv.find(inv => inv.id === inventoryRowId);
      if (!current || current.quantity <= 0) {
        return i.reply({ content: '⚠️ You no longer have that item.', ephemeral: true });
      }

      // Sell the entire stack
      const sellQty = current.quantity;
      const isValuable = current.item_type === 'valuable';
      const priceEach = isValuable ? current.base_value : Math.max(1, Math.floor(current.base_value / 2));
      const totalGold = priceEach * sellQty;

      queries.removeItem(inventoryRowId, sellQty);
      execute(`UPDATE players SET gold = gold + ? WHERE id = ?`, [totalGold, player.id]);

      const newGold = player.gold + totalGold;
      player.gold = newGold; // Update local reference

      await i.reply({
        content: `💰 Sold **${current.item_name}${sellQty > 1 ? ` x${sellQty}` : ''}** for **${totalGold}g**. 💰 ${newGold}g total.`,
      });

      // Remove sold item from sellable list for subsequent selections
      const idx = sellable.findIndex(s => s.id === inventoryRowId);
      if (idx !== -1) sellable.splice(idx, 1);
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};