/**
 * Scene combat (first version): generic enemies, the 4×4 arrival area, carried light and simple
 * attacks. Pure rules shared by the server and the tests.
 *
 *  - Enemies live per scene in the game state. The GM places, moves and removes them; players see an
 *    enemy only while its hex is visible to them (filtered on the server).
 *  - Attacks: d20 + attack bonus against AC; a natural 20 doubles the damage dice, a natural 1 misses.
 *    Players attack on their own turn (one attack per turn) within reach/range and line of sight.
 *    Advantage/disadvantage, saving throws and spells are still resolved by hand by the GM.
 *  - Enemy stats are SRD 5.1 basics (no flavour text), enough to try out a fight.
 */
import type { GameState } from './types.js';
import { activeEncounter } from './sceneTurns.js';
import { orderParticipants } from './sceneOperations.js';

export interface EnemyTemplate { id: string; name: string; ac: number; hp: number; speedFt: number; init: number; attack: { name: string; bonus: number; damage: string; reachFt: number; rangeFt?: number }; color: string; icon: string; darkvisionFt: number }
export const ENEMY_TEMPLATES: EnemyTemplate[] = [
  { id: 'goblin', name: 'Goblin', ac: 15, hp: 7, speedFt: 30, init: 2, attack: { name: 'Scimitar', bonus: 4, damage: '1d6+2', reachFt: 5 }, color: '#6f8a3a', icon: 'Gb', darkvisionFt: 60 },
  { id: 'bandit', name: 'Bandit', ac: 12, hp: 11, speedFt: 30, init: 1, attack: { name: 'Scimitar', bonus: 3, damage: '1d6+1', reachFt: 5 }, color: '#8a5a3a', icon: 'Bd', darkvisionFt: 0 },
  { id: 'archer', name: 'Bandit archer', ac: 12, hp: 11, speedFt: 30, init: 1, attack: { name: 'Light crossbow', bonus: 3, damage: '1d8+1', reachFt: 5, rangeFt: 80 }, color: '#7a6a3a', icon: 'Ar', darkvisionFt: 0 },
  { id: 'wolf', name: 'Wolf', ac: 13, hp: 11, speedFt: 40, init: 2, attack: { name: 'Bite', bonus: 4, damage: '2d4+2', reachFt: 5 }, color: '#7a7a80', icon: 'Wf', darkvisionFt: 0 },
  { id: 'skeleton', name: 'Skeleton', ac: 13, hp: 13, speedFt: 30, init: 2, attack: { name: 'Shortsword', bonus: 4, damage: '1d6+2', reachFt: 5 }, color: '#d8d0b8', icon: 'Sk', darkvisionFt: 60 },
  { id: 'zombie', name: 'Zombie', ac: 8, hp: 22, speedFt: 20, init: -2, attack: { name: 'Slam', bonus: 3, damage: '1d6+1', reachFt: 5 }, color: '#5a7a5a', icon: 'Zb', darkvisionFt: 60 },
  { id: 'orc', name: 'Orc', ac: 13, hp: 15, speedFt: 30, init: 1, attack: { name: 'Greataxe', bonus: 5, damage: '1d12+3', reachFt: 5 }, color: '#4a6a3a', icon: 'Or', darkvisionFt: 60 },
  { id: 'cultist', name: 'Cultist', ac: 12, hp: 9, speedFt: 30, init: 1, attack: { name: 'Scimitar', bonus: 3, damage: '1d6+1', reachFt: 5 }, color: '#6a2a3a', icon: 'Cu', darkvisionFt: 0 },
  { id: 'spider', name: 'Giant spider', ac: 14, hp: 26, speedFt: 30, init: 3, attack: { name: 'Bite', bonus: 5, damage: '1d8+3', reachFt: 5 }, color: '#3a3040', icon: 'Sp', darkvisionFt: 0 },
  { id: 'bear', name: 'Brown bear', ac: 11, hp: 34, speedFt: 40, init: 0, attack: { name: 'Claws', bonus: 6, damage: '2d6+4', reachFt: 5 }, color: '#6a4a2a', icon: 'Br', darkvisionFt: 0 },
  { id: 'thug', name: 'Thug', ac: 11, hp: 32, speedFt: 30, init: 0, attack: { name: 'Mace', bonus: 4, damage: '1d6+2', reachFt: 5 }, color: '#5a5a6a', icon: 'Th', darkvisionFt: 0 },
  { id: 'ogre', name: 'Ogre', ac: 11, hp: 59, speedFt: 40, init: -1, attack: { name: 'Greatclub', bonus: 6, damage: '2d8+4', reachFt: 5 }, color: '#8a6a4a', icon: 'Og', darkvisionFt: 60 },
];

export interface SceneEnemy {
  id: string;
  templateId: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ac: number;
  speedFt: number;
  init: number;
  attack: EnemyTemplate['attack'];
  color: string;
  icon: string;
  defeated?: boolean;
  /** APEX: 'ally' = a GM-controlled companion fighting with the party (default 'enemy'). */
  side?: 'enemy' | 'ally';
  darkvisionFt?: number;
}

export interface CombatLogEntry { id: number; at: string; text: string }

/** Carried light (torch, lantern): bright 20 ft + dim 20 ft – treated as 40 ft of light. */
export const CARRIED_LIGHT_FT = 40;

type Result = { ok: true; state: GameState; message?: string } | { ok: false; error: string };

export const enemiesOf = (state: Pick<GameState, 'sceneEnemies'>, sceneId: string): SceneEnemy[] => state.sceneEnemies?.[sceneId] ?? [];
export const torchesOf = (state: Pick<GameState, 'sceneLights'>, sceneId: string): string[] => state.sceneLights?.[sceneId] ?? [];

export function setCarriedLight(prev: GameState, sceneId: string, tokenId: string, on: boolean): Result {
  if (!prev.tokens[tokenId]) return { ok: false, error: 'Character unavailable.' };
  const current = torchesOf(prev, sceneId);
  if (current.includes(tokenId) === on) return { ok: true, state: prev };
  const state = structuredClone(prev);
  state.sceneLights = { ...(state.sceneLights ?? {}), [sceneId]: on ? [...current, tokenId] : current.filter((t) => t !== tokenId) };
  return { ok: true, state, message: on ? `${prev.tokens[tokenId].name} lights a torch.` : `${prev.tokens[tokenId].name} puts out the light.` };
}

export function addEnemy(prev: GameState, sceneId: string, id: string, templateId: string, at: { x: number; y: number }, name: string | undefined, roll: number | null, side: 'enemy' | 'ally' = 'enemy'): Result {
  const t = ENEMY_TEMPLATES.find((e) => e.id === templateId);
  if (!t) return { ok: false, error: 'Unknown enemy.' };
  if (enemiesOf(prev, sceneId).length >= 60) return { ok: false, error: 'Too many enemies on this map.' };
  const count = enemiesOf(prev, sceneId).filter((e) => e.templateId === templateId).length;
  const enemy: SceneEnemy = { id, templateId, name: (name?.trim() || `${t.name} ${count + 1}`).slice(0, 60), x: at.x, y: at.y, hp: t.hp, maxHp: t.hp, ac: t.ac, speedFt: t.speedFt, init: t.init, attack: { ...t.attack }, color: side === 'ally' ? '#3f7fbf' : t.color, icon: t.icon, darkvisionFt: t.darkvisionFt, ...(side === 'ally' ? { side } : {}) };
  const state = structuredClone(prev);
  state.sceneEnemies = { ...(state.sceneEnemies ?? {}), [sceneId]: [...enemiesOf(state, sceneId), enemy] };
  const enc = activeEncounter(state, sceneId);
  if (enc && roll !== null) {
    const e = state.sceneEncounters![sceneId];
    const activeId = e.participants[e.turnIndex]?.id;
    e.participants = orderParticipants([...e.participants, { id: `npc-${id}`, name: enemy.name, initiative: roll + t.init, bonus: t.init, visible: true }]);
    e.turnIndex = Math.max(0, e.participants.findIndex((p) => p.id === activeId));
    e.version++;
  }
  return { ok: true, state, message: `${enemy.name} placed.` };
}

export function updateEnemy(prev: GameState, sceneId: string, id: string, change: { x?: number; y?: number; hpDelta?: number; remove?: boolean }): Result {
  const list = enemiesOf(prev, sceneId);
  const enemy = list.find((e) => e.id === id);
  if (!enemy) return { ok: false, error: 'Enemy not found.' };
  const state = structuredClone(prev);
  const enemies = enemiesOf(state, sceneId);
  if (change.remove) {
    state.sceneEnemies![sceneId] = enemies.filter((e) => e.id !== id);
    dropFromInitiative(state, sceneId, `npc-${id}`);
    return { ok: true, state, message: `${enemy.name} removed.` };
  }
  const e = enemies.find((x) => x.id === id)!;
  if (change.x !== undefined && change.y !== undefined) { e.x = change.x; e.y = change.y; }
  if (change.hpDelta) {
    e.hp = Math.max(0, Math.min(e.maxHp, e.hp + change.hpDelta));
    e.defeated = e.hp === 0;
    if (e.defeated) dropFromInitiative(state, sceneId, `npc-${id}`);
  }
  return { ok: true, state };
}

function dropFromInitiative(state: GameState, sceneId: string, participantId: string) {
  const enc = activeEncounter(state, sceneId);
  if (!enc || !enc.participants.some((p) => p.id === participantId)) return;
  const e = state.sceneEncounters![sceneId];
  const activeId = e.participants[e.turnIndex]?.id;
  e.participants = e.participants.filter((p) => p.id !== participantId);
  const idx = e.participants.findIndex((p) => p.id === activeId);
  if (idx >= 0) e.turnIndex = idx;
  else { e.turnIndex = Math.min(e.turnIndex, Math.max(0, e.participants.length - 1)); e.turnSerial = (e.turnSerial ?? 0) + 1; }
  e.version++;
}

export function logCombat(state: GameState, sceneId: string, text: string) {
  const log = state.sceneCombatLog?.[sceneId] ?? [];
  const id = (log[log.length - 1]?.id ?? 0) + 1;
  state.sceneCombatLog = { ...(state.sceneCombatLog ?? {}), [sceneId]: [...log, { id, at: new Date().toISOString(), text: text.slice(0, 300) }].slice(-40) };
}

// ---------------------------------------------------------------- dice

/** "1d8+3", "2d6 - 1", "+5 slashing" → dice and modifier (null if unreadable). */
export function parseDamage(text: string): { count: number; sides: number; mod: number } | null {
  const m = /(\d{1,2})\s*d\s*(\d{1,3})\s*(?:([+\-−])\s*(\d{1,3}))?/i.exec(text);
  if (m) return { count: Number(m[1]), sides: Number(m[2]), mod: m[3] ? (m[3] === '+' ? 1 : -1) * Number(m[4]) : 0 };
  const flat = /^\s*(\d{1,3})\b/.exec(text);
  return flat ? { count: 0, sides: 0, mod: Number(flat[1]) } : null;
}
export function parseBonus(text: string): number | null {
  const m = /([+\-−])\s*(\d{1,2})/.exec(text);
  return m ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : /^\s*(\d{1,2})\b/.test(text) ? Number(/^\s*(\d{1,2})/.exec(text)![1]) : null;
}
/** Normal range in feet from "80/320 ft.", "Reach 10 ft", "5 ft." (default: melee 5 ft). */
export function parseRangeFt(text: string): { reachFt: number; rangeFt?: number } {
  const ranged = /(\d{2,3})\s*\/\s*(\d{2,4})/.exec(text);
  if (ranged) return { reachFt: 5, rangeFt: Number(ranged[1]) };
  const reach = /reach\s*(\d{1,2})|^\s*(\d{1,2})\s*ft/i.exec(text);
  const ft = reach ? Number(reach[1] ?? reach[2]) : 5;
  return ft > 15 ? { reachFt: 5, rangeFt: ft } : { reachFt: Math.max(5, ft) };
}

export interface AttackRoll { d20: number; total: number; hit: boolean; crit: boolean; damage: number; rolls: number[]; text: string }
/** Resolves one attack with the given random source (1..sides). */
export function resolveAttack(attacker: string, target: string, weapon: string, bonus: number, damage: { count: number; sides: number; mod: number }, ac: number, die: (sides: number) => number): AttackRoll {
  const d20 = die(20);
  const crit = d20 === 20, total = d20 + bonus;
  const hit = crit || (d20 !== 1 && total >= ac);
  const rolls = hit ? Array.from({ length: damage.count * (crit ? 2 : 1) }, () => die(damage.sides)) : [];
  const dmg = hit ? Math.max(1, rolls.reduce((a, b) => a + b, 0) + damage.mod) : 0;
  const sign = bonus >= 0 ? '+' : '−';
  const text = `${attacker} attacks ${target} with ${weapon}: d20 ${d20} ${sign} ${Math.abs(bonus)} = ${total} vs AC ${ac} → ${crit ? 'CRITICAL HIT' : hit ? 'hit' : d20 === 1 ? 'natural 1, miss' : 'miss'}${hit ? `, ${dmg} damage (${rolls.join('+') || '0'}${damage.mod ? `${damage.mod > 0 ? '+' : '−'}${Math.abs(damage.mod)}` : ''})` : ''}.`;
  return { d20, total, hit, crit, damage: dmg, rolls, text };
}

/** Records that a character used its attack in the current turn (one attack per turn). */
export function attackUsed(state: Pick<GameState, 'sceneEncounters'>, sceneId: string, tokenId: string): boolean {
  const e = activeEncounter(state, sceneId);
  return !!e && e.attacked?.[tokenId] === (e.turnSerial ?? 0);
}
export function markAttack(state: GameState, sceneId: string, tokenId: string) {
  const e = state.sceneEncounters?.[sceneId];
  if (e && e.status === 'active') e.attacked = { ...(e.attacked ?? {}), [tokenId]: e.turnSerial ?? 0 };
}
