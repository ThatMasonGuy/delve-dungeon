// ═══════════════════════════════════════════════════════════════
// /map — View current floor layout
// ═══════════════════════════════════════════════════════════════

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { queries } from '../db/index.js';
import { getCurrentRoom } from '../engine/floor-generator.js';

export default {
  data: new SlashCommandBuilder()
    .setName('map')
    .setDescription('View your current floor layout'),

  async execute(interaction) {
    const player = queries.getPlayerByDiscordId(interaction.user.id);
    if (!player) {
      await interaction.reply({ content: '⚠️ No character found. Use /characters to create one.', ephemeral: true });
      return;
    }

    const run = queries.getActiveRun(player.id);
    if (!run) {
      await interaction.reply({ content: '⚠️ You\'re not in a dungeon. Use /delve to start a delve.', ephemeral: true });
      return;
    }

    const dungeon = queries.getDungeon(run.dungeon_id);
    const floorMapRow = queries.getFloorMap(run.id, run.current_floor);
    if (!floorMapRow) {
      await interaction.reply({ content: '⚠️ Floor data not found.', ephemeral: true });
      return;
    }

    const floorMap = floorMapRow.floor_map;
    const mapText = renderFloorMap(floorMap, run.current_room);

    const embed = new EmbedBuilder()
      .setColor(0x7c6fcd)
      .setTitle(`🗺️ ${dungeon.name} — Floor ${run.current_floor}`)
      .setDescription(mapText)
      .setFooter({ text: `You are in Room ${run.current_room}  ·  ${floorMap.rooms.length} rooms on this floor` });

    await interaction.reply({ embeds: [embed] });
  },
};

/**
 * Render a text-based floor map for Discord.
 * Shows rooms as nodes with connections, colored by status.
 */
function renderFloorMap(floorMap, currentRoom) {
  const rooms = floorMap.rooms;
  const lines = [];

  // Legend
  lines.push('```');

  // Build adjacency visualization
  // Sort rooms by room_number
  const sorted = [...rooms].sort((a, b) => a.room_number - b.room_number);

  // Render each room as a node with its connections
  for (const room of sorted) {
    const marker = getRoomMarker(room, currentRoom);
    const status = getRoomStatus(room, currentRoom);
    const conns = room.connections
      .filter(c => c > room.room_number) // Only show forward connections to avoid dupes
      .map(c => `→ ${c}`)
      .join('  ');

    const typeTag = getRoomTypeTag(room);
    lines.push(`  ${marker} Room ${String(room.room_number).padEnd(2)} ${typeTag.padEnd(8)} ${status}  ${conns}`);
  }

  lines.push('```');

  // Visual graph below
  lines.push('');
  lines.push(renderGraph(sorted, currentRoom));

  return lines.join('\n');
}

/**
 * Build a visual graph representation of the floor.
 */
function renderGraph(rooms, currentRoom) {
  const nodes = rooms.map(r => {
    if (r.room_number === currentRoom) return `**【${r.room_number}】**`;
    if (r.is_cleared) return `~~[${r.room_number}]~~`;
    if (!r.is_accessible) return `ˣ${r.room_number}ˣ`;
    return `[${r.room_number}]`;
  });

  // Build connection lines between rooms
  const lines = [];
  const roomNums = rooms.map(r => r.room_number);

  // Main path (linear connections)
  const mainPath = [];
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const nodeLabel = getNodeEmoji(room, currentRoom);
    mainPath.push(nodeLabel);

    // Check if next room in sequence is connected
    if (i < rooms.length - 1) {
      const nextRoom = rooms[i + 1];
      if (room.connections.includes(nextRoom.room_number)) {
        mainPath.push(' ── ');
      } else {
        mainPath.push('    ');
      }
    }
  }

  lines.push(mainPath.join(''));

  // Room numbers below
  const numLine = rooms.map(r => {
    const num = String(r.room_number);
    const pad = getNodeEmoji(r, currentRoom).length;
    return num.padStart(Math.ceil(pad / 2)).padEnd(pad);
  });
  // Join with same spacing as connections
  const numParts = [];
  for (let i = 0; i < rooms.length; i++) {
    numParts.push(` ${rooms[i].room_number} `);
    if (i < rooms.length - 1) numParts.push('    ');
  }
  lines.push('-# ' + numParts.join(''));

  // Show branch connections
  const branches = [];
  for (const room of rooms) {
    for (const conn of room.connections) {
      // Skip main path connections (adjacent rooms)
      const roomIdx = roomNums.indexOf(room.room_number);
      const connIdx = roomNums.indexOf(conn);
      if (Math.abs(roomIdx - connIdx) === 1) continue;
      if (conn < room.room_number) continue; // Avoid dupes

      branches.push(`-# ↳ Room ${room.room_number} ↔ Room ${conn}`);
    }
  }

  if (branches.length > 0) {
    lines.push(...branches);
  }

  return lines.join('\n');
}

function getNodeEmoji(room, currentRoom) {
  if (room.room_number === currentRoom) return '🟢';
  if (room.is_boss_room) return '💀';
  if (room.is_exit) return '🚪';
  if (room.type === 'locked' && !room.is_accessible) return '🔒';
  if (room.type === 'locked' && room.is_accessible) return '🔓';
  if (room.type === 'rest') return '🛏️';
  if (room.type === 'treasure') return '📦';
  if (room.type === 'trap') return '⚠️';
  if (room.is_cleared) return '✅';
  if (room.is_accessible) return '⬜';
  return '⬛';
}

function getRoomMarker(room, currentRoom) {
  if (room.room_number === currentRoom) return '▸';
  if (room.is_cleared) return '✓';
  if (!room.is_accessible) return '✗';
  return '○';
}

function getRoomStatus(room, currentRoom) {
  if (room.room_number === currentRoom) return '◄ YOU';
  if (room.is_cleared) return 'cleared';
  if (!room.is_accessible) return 'locked ';
  return 'open   ';
}

function getRoomTypeTag(room) {
  if (room.is_boss_room) return '[BOSS]';
  if (room.is_exit) return '[EXIT]';
  if (room.type === 'locked') return '[LOCK]';
  if (room.type === 'rest') return '[REST]';
  if (room.type === 'treasure') return '[LOOT]';
  if (room.type === 'trap') return '[TRAP]';
  return '[ROOM]';
}
