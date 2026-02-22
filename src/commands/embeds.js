// ═══════════════════════════════════════════════════════════════
// EMBEDS — Discord embed builders
// ═══════════════════════════════════════════════════════════════

import { EmbedBuilder } from 'discord.js';

const C = {
  gold:       0xc8a96e,
  purple:     0x7c6fcd,
  green:      0x4a9e6c,
  red:        0xc45555,
  blue:       0x5a7a9e,
  dark:       0x2b2d31,
  crit:       0xffd700,
  fumble:     0x8b0000,
  death:      0x1a0005,
  levelUp:    0x43b581,
  loot:       0xe6a817,
  xp:         0x5865f2,
  floor:      0x7c6fcd,
  floorFinal: 0xc45555,
  heal:       0x43b581,
  trap:       0xff6b35,
};

const RARITY = { common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟠' };

// ════════════════════════════════════════════
// IN-DUNGEON EMBEDS
// ════════════════════════════════════════════

export function diceEmbed(check, context = '') {
  const isCrit = check.is_critical;
  const isFumble = check.is_fumble;
  let color = check.passed ? C.green : C.red;
  if (isCrit) color = C.crit;
  if (isFumble) color = C.fumble;

  // Roll breakdown
  const parts = [`d20(**${check.base_roll}**)`];
  if (check.stat_modifier !== 0) {
    parts.push(`${check.stat_modifier > 0 ? '+' : ''}${check.stat_modifier} ${check.governing_stat}`);
  }
  if (check.skill_bonus > 0) parts.push(`+${check.skill_bonus} skill`);
  if (check.perk_total > 0) parts.push(`+${check.perk_total} perk`);

  let advNote = '';
  if (check.roll_details?.type === 'advantage') {
    advNote = `\n-# Advantage: [${check.roll_details.rolls.join(', ')}] → ${check.base_roll}`;
  } else if (check.roll_details?.type === 'disadvantage') {
    advNote = `\n-# Disadvantage: [${check.roll_details.rolls.join(', ')}] → ${check.base_roll}`;
  }

  const outcomes = {
    critical_success: '🌟 **CRITICAL SUCCESS**',
    success:          '✅ **Success**',
    partial:          '⚠️ **Partial**',
    failure:          '✖️ **Failure**',
    critical_failure: '💀 **CRITICAL FAILURE**',
  };

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: context || 'Skill Check' })
    .setDescription(
      `${parts.join(' ')} = **${check.final_total}** vs DC **${check.dc}**\n` +
      `${outcomes[check.outcome]}${advNote}`
    );
}

export function combatEmbed(combatResults, enemyTurns, roomState) {
  const lines = [];

  for (const cr of combatResults) {
    if (cr.missed) {
      lines.push(`⚔️ → **${cr.target}** · Miss`);
    } else {
      const kill = cr.enemyDied ? ' · ☠️ **Killed!**' : '';
      const resist = cr.resistanceApplied ? ` *(${cr.resistanceMultiplier}x)*` : '';
      lines.push(`⚔️ → **${cr.target}** · **${cr.damageDealt}** dmg${resist}${kill}`);
    }
  }

  for (const et of enemyTurns) {
    if (et.action === 'skip' || et.action === 'idle') continue;
    if (et.dodge_check?.passed && et.damage === 0) {
      lines.push(`🛡️ **${et.enemy}** ${et.action} · Blocked`);
    } else if (et.damage > 0) {
      lines.push(`🩸 **${et.enemy}** ${et.action} · **${et.damage}** dmg`);
    }
  }

  const living = (roomState?.enemies || []).filter(e => !e.is_dead);
  if (living.length > 0) {
    lines.push('');
    for (const e of living) {
      const boss = e.is_boss ? '👑 ' : '';
      lines.push(`${boss}${e.name} ${hpBar(e.hp_current / e.hp_max, 8)} \`${e.hp_current}/${e.hp_max}\``);
    }
  }

  return new EmbedBuilder()
    .setColor(C.red)
    .setDescription(lines.join('\n'));
}

export function lootEmbed(drops, goldGained) {
  if (drops.length === 0 && goldGained <= 0) return null;
  const parts = [];
  if (goldGained > 0) parts.push(`💰 **+${goldGained}g**`);
  for (const d of drops) {
    const emoji = RARITY[d.rarity] || '⚪';
    const qty = d.quantity > 1 ? ` x${d.quantity}` : '';
    const hidden = d.was_hidden ? ' *(hidden!)*' : '';
    parts.push(`${emoji} **${d.item_name}**${qty}${hidden}`);
  }
  return new EmbedBuilder()
    .setColor(C.loot)
    .setDescription(parts.join('\n'));
}

export function levelUpEmbed(levelUps) {
  if (levelUps.length === 0) return null;
  const lines = levelUps.map(lu => `**${capitalize(lu.skill)}** ${lu.old_level} → **${lu.new_level}**`);
  return new EmbedBuilder()
    .setColor(C.levelUp)
    .setDescription(`⬆️ ${lines.join('  ·  ')}`);
}

export function xpEmbed(xpGained) {
  const entries = Object.entries(xpGained).filter(([_, xp]) => xp > 0);
  if (entries.length === 0) return null;
  const parts = entries.map(([skill, xp]) => `${capitalize(skill)} +${xp}`);
  return new EmbedBuilder()
    .setColor(C.xp)
    .setDescription(`-# ${parts.join('  ·  ')} XP`);
}

export function floorTransitionEmbed(newFloor, previousFloor, totalFloors) {
  const isFinal = newFloor === totalFloors;
  return new EmbedBuilder()
    .setColor(isFinal ? C.floorFinal : C.floor)
    .setDescription(
      isFinal
        ? `## ⬇️ Floor ${newFloor}\nThe air grows heavy. Something ancient stirs below.\n**This is the final floor.**`
        : `## ⬇️ Floor ${newFloor}\nYou descend deeper into the crypt.`
    );
}

// ════════════════════════════════════════════
// COMMAND EMBEDS
// ════════════════════════════════════════════

export function characterCreatedEmbed(username, baseStats, gold) {
  const stats = [
    `\`STR\` ${statBar(baseStats.strength)} **${baseStats.strength}**`,
    `\`DEX\` ${statBar(baseStats.dexterity)} **${baseStats.dexterity}**`,
    `\`CON\` ${statBar(baseStats.constitution)} **${baseStats.constitution}**`,
    `\`INT\` ${statBar(baseStats.intelligence)} **${baseStats.intelligence}**`,
    `\`WIS\` ${statBar(baseStats.wisdom)} **${baseStats.wisdom}**`,
    `\`CHA\` ${statBar(baseStats.charisma)} **${baseStats.charisma}**`,
  ];

  return new EmbedBuilder()
    .setColor(C.gold)
    .setTitle(`⚔️ ${username}`)
    .setDescription('Your fate has been cast. The dungeons await.')
    .addFields(
      { name: 'Base Stats', value: stats.join('\n'), inline: true },
      { name: 'Starting Gold', value: `💰 **${gold}g**`, inline: true },
      { name: 'Starting Gear', value: '❤️ Health Potion x1\n🔧 Thieves\' Pick x3', inline: true },
    )
    .setFooter({ text: 'Stats are permanent. Skills improve through use.' });
}

export function dungeonEntryEmbed(dungeon, entryCost, floorCount) {
  return new EmbedBuilder()
    .setColor(C.purple)
    .setTitle(`🏰 ${dungeon.name}`)
    .setDescription(`*${dungeon.theme}*`)
    .addFields(
      { name: 'Tier', value: `${dungeon.difficulty_tier}`, inline: true },
      { name: 'Floors', value: `${floorCount}`, inline: true },
      { name: 'Cost', value: `💰 ${entryCost}g`, inline: true },
    )
    .setFooter({ text: 'Type naturally to interact. The dungeon master is watching.' });
}

export function playerStatsEmbed(player, baseStats, skills, equippedItems) {
  const statLine1 = `\`STR\` **${baseStats.strength}**(${modStr(baseStats.strength)})  \`DEX\` **${baseStats.dexterity}**(${modStr(baseStats.dexterity)})  \`CON\` **${baseStats.constitution}**(${modStr(baseStats.constitution)})`;
  const statLine2 = `\`INT\` **${baseStats.intelligence}**(${modStr(baseStats.intelligence)})  \`WIS\` **${baseStats.wisdom}**(${modStr(baseStats.wisdom)})  \`CHA\` **${baseStats.charisma}**(${modStr(baseStats.charisma)})`;

  const skillLines = skills.map(s =>
    `${skillBar(s.level)} **${capitalize(s.skill_name)}** Lv.**${s.level}**`
  );
  const mid = Math.ceil(skillLines.length / 2);

  const embed = new EmbedBuilder()
    .setColor(C.gold)
    .setTitle(`⚔️ ${player.character_name || player.username}`)
    .setDescription(
      `❤️ ${hpBar(player.hp_current / player.hp_max, 12)} **${player.hp_current}**/${player.hp_max}  ·  💰 **${player.gold}g**  ·  🎒 ${player.inventory_count || '?'}/${player.max_inventory_slots}\n\n` +
      `${statLine1}\n${statLine2}`
    )
    .addFields(
      { name: 'Skills', value: skillLines.slice(0, mid).join('\n'), inline: true },
      { name: '\u200b', value: skillLines.slice(mid).join('\n'), inline: true },
    );

  const equipped = (equippedItems || []).filter(i => i.is_equipped);
  if (equipped.length > 0) {
    const eqLines = equipped.map(i => `${RARITY[i.rarity] || '⚪'} ${i.item_name} *(${i.subtype})*`);
    embed.addFields({ name: 'Equipped', value: eqLines.join('\n'), inline: false });
  }

  return embed;
}

export function inventoryEmbed(player, inventory) {
  const embed = new EmbedBuilder()
    .setColor(C.gold)
    .setTitle(`🎒 ${player.character_name || player.username}'s Inventory`)
    .setDescription(`${inventory.length}/${player.max_inventory_slots} slots  ·  💰 **${player.gold}g**`);

  if (inventory.length === 0) {
    embed.setDescription(embed.data.description + '\n\n*Empty. Go delve for some loot.*');
    return embed;
  }

  const groups = {};
  for (const item of inventory) {
    const t = item.item_type || 'other';
    if (!groups[t]) groups[t] = [];
    groups[t].push(item);
  }

  const typeEmoji = { weapon: '⚔️', armor: '🛡️', consumable: '🧪', valuable: '💎', quest: '🗝️', scroll: '📜', spellbook: '📖' };

  for (const [type, items] of Object.entries(groups)) {
    const lines = items.map(i => {
      const emoji = RARITY[i.rarity] || '⚪';
      const qty = i.quantity > 1 ? ` x${i.quantity}` : '';
      const eq = i.is_equipped ? ' `E`' : '';
      const cursed = i.is_cursed ? ' 💀' : '';
      return `${emoji} ${i.item_name}${qty}${eq}${cursed}`;
    });
    embed.addFields({
      name: `${typeEmoji[type] || '📦'} ${capitalize(type)}`,
      value: lines.join('\n'),
      inline: true,
    });
  }

  return embed;
}

export function runStatusEmbed(run, dungeon, currentRoom, player) {
  const rs = run.run_stats || {};
  const living = (run.room_state?.enemies || []).filter(e => !e.is_dead);
  const inCombat = run.room_state?.is_combat_active;

  let desc = `❤️ ${hpBar(player.hp_current / player.hp_max, 10)} **${player.hp_current}**/${player.hp_max}  ·  💰 **${player.gold}g**\n\n`;
  desc += `**Floor** ${run.current_floor}/${dungeon.floor_count}  ·  **Room** ${run.current_room} (${currentRoom?.type || '?'})  ·  ${inCombat ? '⚔️ Combat' : '🚶 Exploring'}\n`;
  desc += `-# 🗡️ ${rs.damage_dealt || 0} dealt  ·  💔 ${rs.damage_taken || 0} taken  ·  ☠️ ${rs.enemies_killed || 0} kills  ·  🚪 ${rs.rooms_cleared || 0} rooms`;

  const embed = new EmbedBuilder()
    .setColor(inCombat ? C.red : C.purple)
    .setTitle(`🏰 ${dungeon.name}`)
    .setDescription(desc);

  if (living.length > 0) {
    const lines = living.map(e =>
      `${e.is_boss ? '👑 ' : ''}**${e.name}** ${hpBar(e.hp_current / e.hp_max, 8)} \`${e.hp_current}/${e.hp_max}\``
    );
    embed.addFields({ name: 'Enemies', value: lines.join('\n'), inline: false });
  }

  if (currentRoom?.connections?.length > 0) {
    embed.setFooter({ text: `Exits: ${currentRoom.connections.map(c => `Room ${c}`).join('  ·  ')}` });
  }

  return embed;
}

export function deathEmbed(player, itemsLost, goldLost, dungeon) {
  let desc = `The darkness of **${dungeon.name}** claims another soul.\n`;
  if (goldLost > 0) desc += `\n💰 **-${goldLost}g** lost`;
  if (itemsLost?.length > 0) {
    const items = itemsLost.map(i => i.name + (i.quantity > 1 ? ` x${i.quantity}` : '')).join(', ');
    desc += `\n📦 Lost: ${items}`;
  }
  desc += '\n\n*You awaken in the hub. Bruised, but alive.*';

  return new EmbedBuilder()
    .setColor(C.death)
    .setTitle('💀 YOU DIED')
    .setDescription(desc)
    .setFooter({ text: `Use /delve ${dungeon.name} to try again.` });
}

export function restEmbed(healAmount, newHp, maxHp) {
  const pct = Math.round((newHp / maxHp) * 100);
  return new EmbedBuilder()
    .setColor(C.heal)
    .setDescription(`🛏️ **Rested** · +${healAmount} HP · ❤️ ${newHp}/${maxHp} (${pct}%)`);
}

export function trapEmbed(trap, damage, detected) {
  if (detected) {
    return new EmbedBuilder()
      .setColor(C.green)
      .setDescription(`⚠️ **Trap Detected!** — ${trap.name}\n*${trap.description}*\nYou spotted it before it triggered.`);
  }
  return new EmbedBuilder()
    .setColor(C.trap)
    .setDescription(`💥 **${trap.name}** triggered!\n*${trap.description}*\n🩸 **${damage} ${trap.damage_type} damage**`);
}

export function itemUsedEmbed(itemName, effects) {
  const parts = [];
  for (const eff of effects) {
    if (eff.type === 'heal') parts.push(`+${eff.value} HP`);
    if (eff.type === 'cleanse') parts.push(`Cleansed ${eff.targets.join(', ')}`);
    if (eff.type === 'buff') parts.push(`+${eff.value} ${eff.stat}${eff.duration ? ` (${eff.duration} actions)` : ''}`);
  }
  return new EmbedBuilder()
    .setColor(C.green)
    .setDescription(`🧪 **${itemName}** · ${parts.join(' · ')}`);
}

export function torchLitEmbed() {
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setDescription(`🔥 **Torch lit!** · +3 Perception for this dungeon run`);
}

export function fungusLitEmbed() {
  return new EmbedBuilder()
    .setColor(0x3ddc84)
    .setDescription(`🍄 **Glowing Fungus raised!** · +1 Perception for this dungeon run`);
}

export function poisonTickEmbed(damage, turnsLeft) {
  const remaining = turnsLeft > 0 ? ` · ${turnsLeft} turns remaining` : ' · Poison fading...';
  return new EmbedBuilder()
    .setColor(0x7b2d8b)
    .setDescription(`☠️ **Poison** · -${damage} HP${remaining}`);
}

export function poisonCuredEmbed() {
  return new EmbedBuilder()
    .setColor(0x43b581)
    .setDescription(`🟢 **Poison cured!** The toxins leave your body.`);
}

export function dungeonCompleteEmbed(dungeon, runStats, loot, goldTotal, completionGold) {
  const rs = runStats || {};
  let desc = `*The dungeon falls silent. You emerge victorious.*\n\n` +
    `🗡️ **${rs.damage_dealt || 0}** dealt  ·  ☠️ **${rs.enemies_killed || 0}** slain  ·  🚪 **${rs.rooms_cleared || 0}** rooms`;
  if (goldTotal > 0) desc += `  ·  💰 **${goldTotal}g** looted`;
  if (completionGold > 0) desc += `\n🏆 **+${completionGold}g** completion bonus`;
  desc += `\n❤️ HP fully restored`;
  desc += `\n\n*New items may be available at the shop.*`;
  return new EmbedBuilder()
    .setColor(C.crit)
    .setTitle(`🏆 ${dungeon.name} — CLEARED`)
    .setDescription(desc)
    .setFooter({ text: 'Use /shop to browse the Hall of Conquests.' });
}

export function hubEmbed(player, availableDungeons) {
  let desc = `❤️ **${player.hp_current}**/${player.hp_max}  ·  💰 **${player.gold}g**\n`;
  if (availableDungeons.length > 0) {
    desc += '\n**Available Dungeons**\n';
    for (const d of availableDungeons) {
      desc += `🏰 **${d.name}** — Tier ${d.difficulty_tier} · ${d.floor_count} floors · 💰 ${d.entry_cost}g\n`;
    }
  }
  return new EmbedBuilder()
    .setColor(C.gold)
    .setTitle('🏠 The Hub')
    .setDescription(desc)
    .setFooter({ text: '/characters · /dungeons · /delve · /stats · /inventory · /equip · /shop · /sell' });
}

// ════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════

function statBar(value, max = 18) {
  const filled = Math.round((value / max) * 8);
  return '`' + '█'.repeat(filled) + '░'.repeat(8 - filled) + '`';
}

function skillBar(level, max = 100) {
  const filled = Math.round((level / max) * 6);
  return '`' + '▰'.repeat(filled) + '▱'.repeat(6 - filled) + '`';
}

function hpBar(percent, width = 10) {
  const p = Math.max(0, Math.min(1, percent));
  const filled = Math.round(p * width);
  const empty = width - filled;
  return '`' + '▓'.repeat(filled) + '░'.repeat(empty) + '`';
}

function modStr(value) {
  const mod = Math.floor((value - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}