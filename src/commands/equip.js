// ═══════════════════════════════════════════════════════════════
// /equip — Equip or unequip items
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder } from 'discord.js';
import { queries, execute } from '../db/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('equip')
    .setDescription('Equip or unequip an item.')
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('Item name to equip/unequip')
        .setRequired(true)
    ),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const player = queries.getPlayerByDiscordId(discordId);

    if (!player) {
      return interaction.reply({
        content: '⚠️ You don\'t have a character yet. Use `/characters` to create one.',
        ephemeral: true,
      });
    }

    const itemName = interaction.options.getString('item').toLowerCase();
    const inventory = queries.getInventory(player.id);

    // Find the item (fuzzy match)
    const match = inventory.find(i =>
      i.item_name.toLowerCase() === itemName ||
      i.item_name.toLowerCase().includes(itemName)
    );

    if (!match) {
      return interaction.reply({
        content: `⚠️ You don't have an item matching "${itemName}".`,
        ephemeral: true,
      });
    }

    // Only weapons and armor can be equipped
    if (!['weapon', 'armor'].includes(match.item_type)) {
      return interaction.reply({
        content: `⚠️ **${match.item_name}** can't be equipped (it's a ${match.item_type}).`,
        ephemeral: true,
      });
    }

    // Check cursed — can't unequip
    if (match.is_equipped && match.is_cursed) {
      return interaction.reply({
        content: `💀 **${match.item_name}** is cursed and cannot be removed!`,
        ephemeral: true,
      });
    }

    if (match.is_equipped) {
      // Unequip
      execute('UPDATE player_inventory SET is_equipped = 0 WHERE id = ?', [match.id]);
      return interaction.reply({
        content: `🔽 Unequipped **${match.item_name}**.`,
      });
    }

    // Equip — check for slot conflicts
    const equipped = queries.getEquippedItems(player.id);

    // Weapon slot logic
    if (match.item_type === 'weapon') {
      const equippedWeapons = equipped.filter(i => i.item_type === 'weapon');
      const twoHanded = equippedWeapons.find(i => i.hand_requirement === 'two_handed');
      const offHand = equipped.find(i => i.hand_requirement === 'off_hand');

      if (match.hand_requirement === 'two_handed') {
        // Unequip all weapons and off-hand
        for (const w of equippedWeapons) {
          execute('UPDATE player_inventory SET is_equipped = 0 WHERE id = ?', [w.id]);
        }
        if (offHand) {
          execute('UPDATE player_inventory SET is_equipped = 0 WHERE id = ?', [offHand.id]);
        }
      } else if (match.hand_requirement === 'off_hand') {
        // Can't equip off-hand with two-handed
        if (twoHanded) {
          return interaction.reply({
            content: `⚠️ Can't equip **${match.item_name}** — you're wielding a two-handed weapon.`,
            ephemeral: true,
          });
        }
      } else {
        // One-handed weapon — unequip existing main hand
        const mainHand = equippedWeapons.find(i => i.hand_requirement !== 'off_hand');
        if (mainHand) {
          execute('UPDATE player_inventory SET is_equipped = 0 WHERE id = ?', [mainHand.id]);
        }
        // If new weapon is one-handed and there's a two-handed equipped, unequip it
        if (twoHanded) {
          execute('UPDATE player_inventory SET is_equipped = 0 WHERE id = ?', [twoHanded.id]);
        }
      }
    }

    // Armor slot logic — one per subtype
    if (match.item_type === 'armor') {
      const sameSlot = equipped.find(i => i.item_type === 'armor' && i.subtype === match.subtype);
      if (sameSlot) {
        execute('UPDATE player_inventory SET is_equipped = 0 WHERE id = ?', [sameSlot.id]);
      }
    }

    // Equip the item
    execute('UPDATE player_inventory SET is_equipped = 1 WHERE id = ?', [match.id]);

    const rarityEmoji = { common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟠' };
    return interaction.reply({
      content: `🔼 Equipped ${rarityEmoji[match.rarity] || '⚪'} **${match.item_name}**`,
    });
  },
};
