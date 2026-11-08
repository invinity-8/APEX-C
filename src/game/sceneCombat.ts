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
import { BUILTIN_BESTIARY, displayName, initBonus, statBlock, type AbilityKey, type NpcArea, type NpcAttack, type StatBlock } from './bestiary.js';
import { activeEncounter } from './sceneTurns.js';
import { orderParticipants } from './sceneOperations.js';

/** Compact view of a library creature (kept for older callers). */
export interface EnemyTemplate { id: string; name: string; ac: number; hp: number; speedFt: number; init: number; attack: { name: string; bonus: number; damage: string; reachFt: number; rangeFt?: number }; color: string; icon: string; darkvisionFt: number }
const templateOf = (b: StatBlock): EnemyTemplate => ({ id: b.id, name: displayName(b), ac: b.ac, hp: b.hp, speedFt: b.speedFt, init: initBonus(b), attack: legacyAttack(b.attacks[0]), color: b.color, icon: b.icon, darkvisionFt: b.darkvisionFt });
const legacyAttack = (a: NpcAttack | undefined) => (a ? { name: a.name, bonus: a.bonus, damage: a.damage, reachFt: a.reachFt, ...(a.rangeFt ? { rangeFt: a.rangeFt } : {}) } : { name: 'Unarmed', bonus: 0, damage: '1', reachFt: 5 });
export const ENEMY_TEMPLATES: EnemyTemplate[] = BUILTIN_BESTIARY.map(templateOf);

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
  /** APEX 1.2 stat block copy (older saves only have `attack`). */
  attacks?: NpcAttack[];
  multiattack?: number;
  abilities?: Record<AbilityKey, number>;
  saves?: Partial<Record<AbilityKey, number>>;
  areas?: NpcArea[];
  buffs?: import('./bestiary.js').NpcBuff[];
  /** Area ability name → uses spent this encounter. */
  areaUsed?: Record<string, number>;
  elite?: boolean;
  color: string;
  icon: string;
  defeated?: boolean;
  /** APEX: 'ally' = a GM-controlled companion fighting with the party (default 'enemy'). */
  side?: 'enemy' | 'ally';
  darkvisionFt?: number;
  /** APEX 1.6 – temporary hit points (spent before hit points, never stack: the higher value stays). */
  tempHp?: number;
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
  const b = statBlock(prev, templateId);
  if (!b) return { ok: false, error: 'Unknown enemy.' };
  if (enemiesOf(prev, sceneId).length >= 60) return { ok: false, error: 'Too many enemies on this map.' };
  const count = enemiesOf(prev, sceneId).filter((e) => e.templateId === templateId).length;
  const t = templateOf(b);
  const label = b.elite ? displayName(b) : `${b.name} ${count + 1}`;
  const enemy: SceneEnemy = {
    id, templateId, name: (name?.trim() || label).slice(0, 60), x: at.x, y: at.y, hp: b.hp, maxHp: b.hp, ac: b.ac, speedFt: b.speedFt, init: t.init, attack: t.attack,
    attacks: structuredClone(b.attacks), multiattack: b.multiattack, abilities: { ...b.abilities }, ...(b.saves ? { saves: { ...b.saves } } : {}), ...(b.areas ? { areas: structuredClone(b.areas) } : {}), ...(b.buffs ? { buffs: structuredClone(b.buffs) } : {}), ...(b.elite ? { elite: true } : {}),
    color: side === 'ally' ? '#3f7fbf' : b.color, icon: b.icon, darkvisionFt: b.darkvisionFt, ...(side === 'ally' ? { side } : {}),
  };
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

/** Temporary hit points for an NPC (the higher of the old and new value). */
export function grantEnemyTempHp(state: GameState, sceneId: string, id: string, amount: number) {
  const e = enemiesOf(state, sceneId).find((x) => x.id === id);
  if (e && amount > (e.tempHp ?? 0)) e.tempHp = amount;
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
    let delta = change.hpDelta;
    if (delta < 0 && e.tempHp) { const soak = Math.min(e.tempHp, -delta); e.tempHp -= soak; delta += soak; if (!e.tempHp) delete e.tempHp; }
    e.hp = Math.max(0, Math.min(e.maxHp, e.hp + delta));
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
export function parseRangeFt(text: string): { reachFt: number; rangeFt?: number; longRangeFt?: number } {
  const ranged = /(\d{2,3})\s*\/\s*(\d{2,4})/.exec(text);
  if (ranged) return { reachFt: 5, rangeFt: Number(ranged[1]), longRangeFt: Number(ranged[2]) };
  const reach = /reach\s*(\d{1,2})/i.exec(text);
  if (reach) return { reachFt: Math.max(5, Number(reach[1])) };
  // "120 ft.", "Range 150 feet", "60 ft" – up to three digits (spells and thrown weapons)
  const plain = /(?:range\s*)?(\d{1,3})\s*(?:ft|feet|')/i.exec(text);
  const ft = plain ? Number(plain[1]) : 5;
  return ft > 15 ? { reachFt: 5, rangeFt: ft } : { reachFt: Math.max(5, ft) };
}

export interface AttackRoll { d20: number; d20s: number[]; total: number; hit: boolean; crit: boolean; damage: number; rolls: number[]; text: string; mode: 'normal' | 'adv' | 'dis' }
export interface AttackOptions {
  mode?: 'normal' | 'adv' | 'dis';
  reasons?: string[];
  /** Bonus dice on the attack roll (Bless "1d4", Bane "-1d4"). */
  toHitDice?: string[];
  toHitFlat?: number;
  /** Melee hit within 5 ft of a paralyzed / unconscious target. */
  autoCrit?: boolean;
  /** Extra damage dice on a hit (Sneak Attack, Hunter's Mark, Smite …), doubled on a critical hit. */
  extraDice?: Array<{ dice: string; label: string }>;
  /** Flat extra damage on a hit (Rage). */
  extraFlat?: Array<{ value: number; label: string }>;
  /** Halve the damage (resistance, e.g. a raging target hit by a physical attack). */
  halve?: string;
}
/** Resolves one attack with the given random source (1..sides). Advantage/disadvantage roll two d20. */
export function resolveAttack(attacker: string, target: string, weapon: string, bonus: number, damage: { count: number; sides: number; mod: number }, ac: number, die: (sides: number) => number, o: AttackOptions = {}): AttackRoll {
  const mode = o.mode ?? 'normal';
  const d20s = mode === 'normal' ? [die(20)] : [die(20), die(20)];
  const d20 = mode === 'adv' ? Math.max(...d20s) : mode === 'dis' ? Math.min(...d20s) : d20s[0];
  const bonusDice = (o.toHitDice ?? []).map((spec) => { const m = /^(-)?(\d{1,2})d(\d{1,3})$/.exec(spec.trim()); if (!m) return 0; let t = 0; for (let i = 0; i < Number(m[2]); i++) t += die(Number(m[3])); return m[1] ? -t : t; });
  const extra = bonusDice.reduce((a, b) => a + b, 0) + (o.toHitFlat ?? 0);
  const total = d20 + bonus + extra;
  const hit = d20 === 20 || (d20 !== 1 && total >= ac);
  const crit = d20 === 20 || (hit && !!o.autoCrit);
  const mult = crit ? 2 : 1;
  const rolls = hit ? Array.from({ length: damage.count * mult }, () => die(damage.sides)) : [];
  let dmg = hit ? Math.max(1, rolls.reduce((a, b) => a + b, 0) + damage.mod) : 0;
  const extras: string[] = [];
  if (hit) {
    for (const x of o.extraDice ?? []) {
      const m = /^(\d{1,2})d(\d{1,3})/.exec(x.dice);
      if (!m) continue;
      const r = Array.from({ length: Number(m[1]) * mult }, () => die(Number(m[2])));
      const v = r.reduce((a, b) => a + b, 0);
      dmg += v;
      extras.push(`+${v} ${x.label}`);
    }
    for (const x of o.extraFlat ?? []) { dmg += x.value; extras.push(`+${x.value} ${x.label}`); }
    if (o.halve) { dmg = Math.floor(dmg / 2); extras.push(`halved (${o.halve})`); }
  }
  const sign = bonus >= 0 ? '+' : '−';
  const rollText = mode === 'normal' ? `d20 ${d20}` : `d20 ${d20} (${mode === 'adv' ? 'advantage' : 'disadvantage'}: ${d20s.join(', ')})`;
  const bonusText = extra ? ` ${extra >= 0 ? '+' : '−'} ${Math.abs(extra)} (${[...(o.toHitDice ?? []), ...(o.toHitFlat ? [String(o.toHitFlat)] : [])].join(', ')})` : '';
  const why = o.reasons?.length ? ` [${o.reasons.join('; ')}]` : '';
  const text = `${attacker} attacks ${target} with ${weapon}: ${rollText} ${sign} ${Math.abs(bonus)}${bonusText} = ${total} vs AC ${ac} → ${crit ? 'CRITICAL HIT' : hit ? 'hit' : d20 === 1 ? 'natural 1, miss' : 'miss'}${hit ? `, ${dmg} damage (${rolls.join('+') || '0'}${damage.mod ? `${damage.mod > 0 ? '+' : '−'}${Math.abs(damage.mod)}` : ''}${extras.length ? ` ${extras.join(' ')}` : ''})` : ''}.${why}`;
  return { d20, d20s, total, hit, crit, damage: dmg, rolls, text, mode };
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

/** Attacks of an NPC (stat block copy, or the single attack of older saves). */
export function npcAttacks(e: Pick<SceneEnemy, 'attacks' | 'attack'>): NpcAttack[] {
  if (e.attacks?.length) return e.attacks;
  return [{ name: e.attack.name, kind: e.attack.rangeFt ? 'ranged' : 'melee', bonus: e.attack.bonus, damage: e.attack.damage, damageType: '', reachFt: e.attack.reachFt || 5, ...(e.attack.rangeFt ? { rangeFt: e.attack.rangeFt } : {}) }];
}
/** Melee reach of an NPC (for opportunity attacks): its longest melee reach, 5 ft by default. */
export const npcReach = (e: Pick<SceneEnemy, 'attacks' | 'attack'>) => Math.max(5, ...npcAttacks(e).filter((a) => a.kind === 'melee').map((a) => a.reachFt));
