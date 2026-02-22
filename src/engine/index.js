// ═══════════════════════════════════════════════════════════════
// ENGINE — Public API
// ═══════════════════════════════════════════════════════════════

export { roll, rollMultiple, rollStat, rollBaseStats, statModifier, skillCheck, rollDamage, formatDiceResult, weightedRandom, randomDC } from './dice.js';
export { generateFloor, getCurrentRoom, clearRoom, unlockRoom } from './floor-generator.js';
export { resolveLoot, rollGoldDrop } from './loot.js';
export { processEnemyTurn, damageEnemy, distributeXp, handlePlayerDeath, calculatePlayerArmor, getWeaponDamageBonus, getWeaponCritRange, getWeaponDamageType, tickCooldowns } from './combat.js';
export { startRun, processAction, abandonRun } from './action-processor.js';
