// ═══════════════════════════════════════════════════════════════
// /dungeons — Browse available dungeons
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { queries, queryAll } from '../db/index.js';
import { existsSync } from 'fs';

export default {
  data: new SlashCommandBuilder()
    .setName('dungeons')
    .setDescription('Browse available dungeons')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Preview a specific dungeon')
        .setRequired(false)
    ),

  async execute(interaction) {
    const nameFilter = interaction.options.getString('name');
    const player = queries.getPlayerByDiscordId(interaction.user.id);

    if (nameFilter) {
      // Preview a specific dungeon
      const dungeon = queryAll('SELECT * FROM dungeons')
        .find(d => d.name.toLowerCase().includes(nameFilter.toLowerCase()));

      if (!dungeon) {
        await interaction.reply({
          content: `⚠️ No dungeon found matching "${nameFilter}".`,
          ephemeral: true,
        });
        return;
      }

      // Get enemy rules for this dungeon
      const enemyRules = queries.getEnemyRulesForDungeon(dungeon.id);
      const enemies = enemyRules
        .filter(r => r.spawn_weight > 0)
        .map(r => {
          const enemy = queries.getEnemy(r.enemy_id);
          return enemy ? `**${enemy.name}** — ${enemy.ai_descriptor?.split('.')[0] || 'Unknown'}` : null;
        })
        .filter(Boolean);

      // Get boss
      const bossRule = enemyRules.find(r => r.spawn_weight === 0);
      const boss = bossRule ? queries.getEnemy(bossRule.enemy_id) : null;

      // Player's history with this dungeon
      const history = player ? queries.getDungeonHistory(player.id, dungeon.id) : null;

      const embed = new EmbedBuilder()
        .setColor(0x7c6fcd)
        .setTitle(`🏰 ${dungeon.name}`)
        .setDescription(`*${dungeon.theme}*`)
        .addFields(
          { name: 'Difficulty', value: `Tier ${dungeon.difficulty_tier}`, inline: true },
          { name: 'Floors', value: `${dungeon.floor_count}`, inline: true },
          { name: 'Entry Cost', value: `💰 ${dungeon.entry_cost}g`, inline: true },
        );

      if (enemies.length > 0) {
        embed.addFields({
          name: '👾 Denizens',
          value: enemies.join('\n'),
          inline: false,
        });
      }

      if (boss) {
        embed.addFields({
          name: '👑 Boss',
          value: `**${boss.name}** — ${boss.ai_descriptor?.split('.')[0] || 'Unknown'}`,
          inline: false,
        });
      }

      if (history) {
        const completions = history.times_completed || 0;
        const attempts = history.times_attempted || 0;
        const deaths = history.times_died || 0;
        embed.addFields({
          name: '📊 Your History',
          value: `${attempts} attempts  ·  ${completions} clears  ·  ${deaths} deaths`,
          inline: false,
        });
      }

      embed.setFooter({ text: player ? `Use /delve ${dungeon.name} to begin your delve.` : 'Use /characters to create a character first.' });

      // Attach dungeon image if available
      const files = [];
      if (dungeon.image_path && existsSync(dungeon.image_path)) {
        const attachment = new AttachmentBuilder(dungeon.image_path, { name: 'dungeon.png' });
        files.push(attachment);
        embed.setImage('attachment://dungeon.png');
      }

      await interaction.reply({ embeds: [embed], files });
      return;
    }

    // List all dungeons
    const dungeons = queryAll('SELECT * FROM dungeons ORDER BY difficulty_tier, name');

    if (dungeons.length === 0) {
      await interaction.reply({ content: 'No dungeons available yet.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x7c6fcd)
      .setTitle('🏰 Available Dungeons');

    let desc = '';
    for (const d of dungeons) {
      const history = player ? queries.getDungeonHistory(player.id, d.id) : null;
      const cleared = history?.times_completed > 0 ? ' ✅' : '';
      desc += `### ${d.name}${cleared}\n`;
      desc += `*${d.theme.split('.')[0]}.*\n`;
      desc += `Tier ${d.difficulty_tier}  ·  ${d.floor_count} floors  ·  💰 ${d.entry_cost}g entry\n\n`;
    }

    embed.setDescription(desc);
    embed.setFooter({ text: 'Use /dungeons name:<dungeon> for details, or /delve <dungeon> to delve.' });

    // Use first dungeon's image as thumbnail for the list
    const firstWithImage = dungeons.find(d => d.image_path && existsSync(d.image_path));
    const files = [];
    if (firstWithImage) {
      const attachment = new AttachmentBuilder(firstWithImage.image_path, { name: 'dungeon-thumb.png' });
      files.push(attachment);
      embed.setThumbnail('attachment://dungeon-thumb.png');
    }

    await interaction.reply({ embeds: [embed], files });
  },
};
