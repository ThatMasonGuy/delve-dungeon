// ═══════════════════════════════════════════════════════════════
// /characters — Multi-character management
// ═══════════════════════════════════════════════════════════════

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { queries } from '../db/index.js';
import { rollBaseStats, statModifier } from '../engine/dice.js';
import { config } from '../config.js';
import { characterCreatedEmbed } from './embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('characters')
    .setDescription('Manage your characters — create, select, or delete'),

  async execute(interaction) {
    await sendCharacterPanel(interaction);
  },

  // ── Button handler ──
  async handleComponent(interaction) {
    const [, action, slotStr] = interaction.customId.split(':');
    const slot = parseInt(slotStr);
    const discordId = interaction.user.id;

    if (action === 'create') {
      // Open character creation modal
      const modal = new ModalBuilder()
        .setCustomId(`characters:modal_create:${slot}`)
        .setTitle('Create Character');

      const nameInput = new TextInputBuilder()
        .setCustomId('character_name')
        .setLabel('Character Name')
        .setPlaceholder('Enter a name for your adventurer...')
        .setStyle(TextInputStyle.Short)
        .setMinLength(2)
        .setMaxLength(24)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      await interaction.showModal(modal);
      return;
    }

    if (action === 'select') {
      const char = queries.getCharacterBySlot(discordId, slot);
      if (!char) {
        await interaction.reply({ content: '⚠️ No character in that slot.', ephemeral: true });
        return;
      }

      // Check if character has active run
      const activeRun = queries.getActiveRun(char.id);
      const currentActive = queries.getPlayerByDiscordId(discordId);
      const currentRun = currentActive ? queries.getActiveRun(currentActive.id) : null;

      if (currentRun) {
        await interaction.reply({
          content: `⚠️ Your active character **${currentActive.character_name}** is currently in a dungeon. Use \`/abandon\` first.`,
          ephemeral: true,
        });
        return;
      }

      queries.setActiveCharacter(discordId, slot);
      await interaction.update({ content: null, embeds: [], components: [] });
      await sendCharacterPanel(interaction, false, `✅ Switched to **${char.character_name}**`);
      return;
    }

    if (action === 'delete') {
      const char = queries.getCharacterBySlot(discordId, slot);
      if (!char) {
        await interaction.reply({ content: '⚠️ No character in that slot.', ephemeral: true });
        return;
      }

      // Check for active run
      const activeRun = queries.getActiveRun(char.id);
      if (activeRun) {
        await interaction.reply({
          content: `⚠️ **${char.character_name}** is currently in a dungeon. Use \`/abandon\` first.`,
          ephemeral: true,
        });
        return;
      }

      // Show confirmation buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`characters:confirm_delete:${slot}`)
          .setLabel(`Delete ${char.character_name}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`characters:cancel_delete:${slot}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.update({
        content: `⚠️ Are you sure you want to **permanently delete ${char.character_name}**? All progress, items, and gold will be lost.`,
        embeds: [],
        components: [row],
      });
      return;
    }

    if (action === 'confirm_delete') {
      const char = queries.getCharacterBySlot(discordId, slot);
      const name = char?.character_name || 'Unknown';
      queries.deleteCharacter(discordId, slot);
      await interaction.update({ content: null, embeds: [], components: [] });
      await sendCharacterPanel(interaction, false, `🗑️ **${name}** has been deleted.`);
      return;
    }

    if (action === 'cancel_delete') {
      await interaction.update({ content: null, embeds: [], components: [] });
      await sendCharacterPanel(interaction, false);
      return;
    }
  },

  // ── Modal handler ──
  async handleModal(interaction) {
    const [, , slotStr] = interaction.customId.split(':');
    const slot = parseInt(slotStr);
    const discordId = interaction.user.id;
    const characterName = interaction.fields.getTextInputValue('character_name').trim();

    // Validate
    if (queries.getCharacterBySlot(discordId, slot)) {
      await interaction.reply({ content: '⚠️ That slot is already taken.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    // Roll stats
    const baseStats = rollBaseStats();
    const conMod = statModifier(baseStats.constitution);
    const startHp = Math.max(1, config.game.startHp + (conMod * 5));
    const startGold = config.game.startGold;
    const inventorySlots = config.game.inventorySlots;

    // Create character
    const playerId = queries.createPlayer(
      discordId,
      interaction.user.username,
      characterName,
      slot,
      startGold,
      startHp,
      inventorySlots,
    );
    queries.createBaseStats(playerId, baseStats);
    queries.initPlayerSkills(playerId);

    // Starting inventory: 3 Thieves' Picks + 1 Health Potion
    const pickItem = queries.getItemByName("Thieves' Pick");
    const potionItem = queries.getItemByName('Health Potion');
    if (pickItem) queries.addItem(playerId, pickItem.id, 3);
    if (potionItem) queries.addItem(playerId, potionItem.id, 1);

    // Show result
    const embed = characterCreatedEmbed(characterName, baseStats, startGold);
    await interaction.editReply({ embeds: [embed] });

    // Send intro guide as follow-up
    const intro = [
      `**Welcome, ${characterName}!** You are an adventurer seeking fortune in the depths below.`,
      '',
      '⚔️ **How it works:**',
      '> Type naturally in the game channel to explore, fight, and interact.',
      '> Your skills level up as you use them — fight to improve **Melee**, search to improve **Perception**, pick locks to improve **Lockpicking**.',
      '> Loot weapons and armor to grow stronger. Death is punishing but not permanent.',
      '',
      '📜 **Commands:**',
      '> `/delve` — Enter a dungeon',
      '> `/stats` — View your character sheet',
      '> `/inventory` — Check your gear',
      '> `/map` — See the floor layout',
      '> `/dungeons` — Browse available dungeons',
      '',
      `💰 You have **${startGold}g** to your name, along with **1 Health Potion** and **3 Thieves' Picks**. Ready to prove yourself?`,
      `-# Use /delve to enter The Sunken Crypt and begin your journey.`,
    ].join('\n');

    await interaction.followUp({ content: intro });
  },
};

// ── Build & send the character panel ──

async function sendCharacterPanel(interaction, isInitialReply = true, statusMessage = null) {
  const discordId = interaction.user.id;
  const characters = queries.getAllCharacters(discordId);
  const charMap = {};
  for (const c of characters) charMap[c.character_slot] = c;

  const embed = new EmbedBuilder()
    .setColor(0xc8a96e)
    .setTitle('⚔️ Your Characters');

  if (statusMessage) {
    embed.setDescription(statusMessage);
  }

  const rows = [];

  for (let slot = 1; slot <= 3; slot++) {
    const char = charMap[slot];
    if (char) {
      const skills = queries.getPlayerSkills(char.id);
      const activeRun = queries.getActiveRun(char.id);
      const topSkills = skills
        .filter(s => s.level > 1)
        .sort((a, b) => b.level - a.level)
        .slice(0, 3)
        .map(s => `${s.skill_name} ${s.level}`)
        .join(', ');

      const active = char.is_active ? ' 🟢' : '';
      const inDungeon = activeRun ? ' *(in dungeon)*' : '';
      const skillInfo = topSkills || 'Fresh adventurer';

      embed.addFields({
        name: `Slot ${slot}: ${char.character_name}${active}`,
        value: `❤️ ${char.hp_current}/${char.hp_max}  ·  💰 ${char.gold}g  ·  ${skillInfo}${inDungeon}`,
        inline: false,
      });

      // Buttons for existing character
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`characters:select:${slot}`)
          .setLabel(char.is_active ? '✓ Active' : 'Select')
          .setStyle(char.is_active ? ButtonStyle.Success : ButtonStyle.Primary)
          .setDisabled(!!char.is_active),
        new ButtonBuilder()
          .setCustomId(`characters:delete:${slot}`)
          .setLabel('Delete')
          .setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    } else {
      embed.addFields({
        name: `Slot ${slot}: Empty`,
        value: '*Available for a new adventurer*',
        inline: false,
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`characters:create:${slot}`)
          .setLabel('Create Character')
          .setStyle(ButtonStyle.Success),
      );
      rows.push(row);
    }
  }

  const payload = { embeds: [embed], components: rows };

  if (isInitialReply) {
    await interaction.reply(payload);
  } else {
    await interaction.message.edit(payload);
  }
}