/**
 * APEX 2.7 – enemy AI: NPCs steer themselves on their turn. Pure planning (no dice, no state changes): given the
 * map, everybody on it and what the creature has left this turn, `planAiStep` returns ONE step – move, attack, use an
 * area ability or a war cry, Dash / Dodge / Disengage, or end the turn. The server carries the step out through the
 * same rules the GM's clicks go through and asks again until the turn ends.
 *
 * A creature's behaviour has two parts, preset per creature and changeable by the GM:
 *  - TACTIC – how it fights: `pack` (gang up, flank), `brute` (the nearest, head-on), `skirmisher` (shoot and keep
 *    away), `caster` (stay back, areas on clusters), `ambusher` (the wounded and the lone), `guardian` (holds its
 *    post), `support` (war cries first), `soldier` (disciplined: focus the weakest in reach), `mindless` (the nearest,
 *    never flees).
 *  - MOOD – its temper: `aggressive` (Dash to close in, never runs), `cautious` (retreats badly hurt, Dodge rather
 *    than a reckless Dash), `curious` (comes close and watches; fights once it or a friend is hurt), `cowardly`
 *    (runs when bloodied or alone), `defensive` (stands its ground: fights what comes to it).
 */
import type { SceneMap } from '../campaign/maps.js';
import { areaHexes } from '../campaign/hexArea.js';
import { hexAt, hexCentre, hexMovementCost, hexReach, tileLookup, type MoveMode } from '../campaign/hexScene.js';
import { lineOfSight, sightRules } from '../campaign/hexVision.js';
import type { NpcArea, NpcAttack, NpcBuff } from './bestiary.js';
import { distance, hexKey, parseKey, type Axial, type HexKey } from './hex.js';

export const TACTICS = ['pack', 'brute', 'skirmisher', 'caster', 'ambusher', 'guardian', 'support', 'soldier', 'mindless'] as const;
export type Tactic = (typeof TACTICS)[number];
export const MOODS = ['aggressive', 'cautious', 'curious', 'cowardly', 'defensive'] as const;
export type Mood = (typeof MOODS)[number];
export interface AiProfile { tactic: Tactic; mood: Mood }
export const TACTIC_LABEL: Record<Tactic, string> = { pack: '🐺 Pack – gang up and flank', brute: '🪓 Brute – the nearest, head-on', skirmisher: '🏹 Skirmisher – shoot and keep away', caster: '✨ Caster – stay back, areas on groups', ambusher: '🕷 Ambusher – the wounded and the lone', guardian: '🛡 Guardian – holds its post', support: '📯 Support – war cries, then fight', soldier: '⚔ Soldier – disciplined, focus fire', mindless: '💀 Mindless – the nearest, never flees' };
export const MOOD_LABEL: Record<Mood, string> = { aggressive: 'Aggressive', cautious: 'Cautious', curious: 'Curious', cowardly: 'Cowardly', defensive: 'Defensive' };

/** The behaviour a creature has out of the box, from its type, name, traits and attacks. */
export function defaultProfile(b: { id?: string; name: string; type: string; attacks: NpcAttack[]; areas?: NpcArea[]; buffs?: NpcBuff[]; traits?: Array<{ name: string }>; abilities?: { int: number } }): AiProfile {
  const t = `${b.id ?? ''} ${b.name} ${b.type}`.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  const packTrait = !!b.traits?.some((x) => /pack tactics/i.test(x.name));
  const rangedOnly = b.attacks.length > 0 && b.attacks[0].kind !== 'melee';
  const shoots = b.attacks.some((a) => a.kind !== 'melee');
  if (b.buffs?.length) return { tactic: 'support', mood: 'aggressive' };
  if (has(/zombie|skeleton|ooze|pudding|jelly|gelatinous|golem|animated|shambling|awakened|carnivorous|myconid|elemental|purple worm/)) return { tactic: 'mindless', mood: 'aggressive' };
  if (has(/commoner|noble|sheep|cow\b|deer|elk|goat|pony|riding horse|mule|camel|raven|\bcat\b|eagle|weasel|badger|frog/)) return { tactic: 'brute', mood: 'cowardly' };
  if (has(/mage|fanatic|beholder|aboleth|lich|sorcer|wizard|warlock|will-o|nothic/)) return { tactic: 'caster', mood: 'cautious' };
  if (has(/priest|acolyte|shaman|druid/)) return { tactic: 'caster', mood: 'defensive' };
  if (has(/archer|scout|sling|manticore/)) return { tactic: 'skirmisher', mood: 'cautious' };
  if (has(/kobold|goblin\b|pirate|jackal|giant rat/)) return { tactic: 'pack', mood: 'cowardly' };
  if (has(/assassin|spider|panther|tiger|crocodile|snake|mimic|darkmantle|roper|cloaker|ghost|specter|wraith|shadow|banshee|ghoul|ghast|displacer|grell|carrion|imp|quasit|intellect/)) return { tactic: 'ambusher', mood: has(/imp|quasit|ghost|specter/) ? 'cautious' : 'aggressive' };
  if (has(/guard\b|knight|golem|gargoyle|treant|mastiff|warhorse/)) return { tactic: 'guardian', mood: 'defensive' };
  if (has(/veteran|hobgoblin|gladiator|captain|soldier|legion|lizardfolk/)) return { tactic: 'soldier', mood: 'aggressive' };
  if (packTrait || has(/wolf|worg|hyena|gnoll|bandit|thug|cultist|orc\b|lion|hawk|vulture|hell hound|bugbear/)) return { tactic: 'pack', mood: 'aggressive' };
  if (has(/pseudodragon|blink dog|unicorn|pegasus|flumph/)) return { tactic: 'skirmisher', mood: 'curious' };
  if (b.areas?.length && rangedOnly) return { tactic: 'caster', mood: 'cautious' };
  if (rangedOnly) return { tactic: 'skirmisher', mood: 'cautious' };
  if (has(/beast/) && (b.abilities?.int ?? 10) <= 3) return { tactic: 'brute', mood: 'aggressive' };
  return { tactic: shoots && !has(/giant|dragon|ogre|troll|minotaur|berserker|owlbear|bear/) ? 'soldier' : 'brute', mood: 'aggressive' };
}
export function parseProfile(v: unknown): Partial<AiProfile> | null {
  const o = v as { tactic?: unknown; mood?: unknown } | null;
  if (!o || typeof o !== 'object') return null;
  const out: Partial<AiProfile> = {};
  if (o.tactic !== undefined) { if (!TACTICS.includes(o.tactic as Tactic)) return null; out.tactic = o.tactic as Tactic; }
  if (o.mood !== undefined) { if (!MOODS.includes(o.mood as Mood)) return null; out.mood = o.mood as Mood; }
  return out;
}

export interface AiFigure {
  /** Actor key: `pc-<token>` or `npc-<id>`. */
  id: string;
  name: string;
  side: 'party' | 'enemy';
  x: number;
  y: number;
  /** Altitude above the ground in feet. */
  alt: number;
  /** 0 … 1. */
  hp: number;
  down?: boolean;
  /** Hidden from the acting creature (its passive Perception does not reach the Stealth). */
  unseen?: boolean;
}
export interface AiSelf extends AiFigure {
  profile: AiProfile;
  attacks: NpcAttack[];
  /** Attacks of the Attack action still open this turn (multiattack). */
  attacksLeft: number;
  actionFree: boolean;
  bonusFree: boolean;
  dashed: boolean;
  /** Feet of movement left this turn (walking, or flying when it can fly). */
  moveLeft: number;
  flyFt?: number;
  climbFt?: number;
  areas: Array<NpcArea & { index: number; left: number | null }>;
  buffs: Array<NpcBuff & { index: number; left: number | null }>;
  /** Disengage or Hide as a bonus action (Nimble Escape, Cunning Action). */
  nimble?: boolean;
  /** Somebody of its side was hurt or went down (wakes the curious). */
  provoked?: boolean;
}
export type AiStep =
  | { kind: 'move'; x: number; y: number; alt?: number; why: string }
  | { kind: 'attack'; target: string; attackIndex: number; why: string }
  | { kind: 'area'; area: number; x: number; y: number; why: string }
  | { kind: 'buff'; buff: number; why: string }
  | { kind: 'standard'; act: 'dash' | 'dodge' | 'disengage'; viaBonus?: boolean; why: string }
  | { kind: 'end'; why: string };

const avg = (dice: string): number => { const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(dice.replace(/\s/g, '')); return m ? Number(m[1]) * (Number(m[2]) + 1) / 2 + Number(m[3] ?? 0) : Number(dice) || 0; };

/** One step of a creature's turn. */
export function planAiStep(map: SceneMap, me: AiSelf, others: AiFigure[]): AiStep {
  if (!map.hex) return { kind: 'end', why: 'no battle map' };
  const unit = map.unitsPerCell || 5;
  const here = hexAt(map, me);
  const pos = (f: { x: number; y: number }) => hexAt(map, f);
  const feet = (a: Axial, aAlt: number, b: Axial, bAlt: number) => Math.max(distance(a, b) * unit, Math.abs(aAlt - bAlt));
  const foes = others.filter((f) => f.side !== me.side && !f.down && !f.unseen);
  const friends = others.filter((f) => f.side === me.side && !f.down);
  const { tactic, mood } = me.profile;
  if (!foes.length) return { kind: 'end', why: 'sees no opponent' };
  const rules = sightRules(map);
  const sees = (from: Axial, fromAlt: number, f: AiFigure) => lineOfSight(from, pos(f), rules.blocks, rules.height, { a: fromAlt / 5, b: f.alt / 5 });
  const dToMe = (f: AiFigure) => feet(here, me.alt, pos(f), f.alt);
  const nearest = foes.reduce((a, b) => (dToMe(a) <= dToMe(b) ? a : b));
  const occupied = new Set(others.filter((f) => !f.down).map((f) => hexKey(pos(f))));
  const flying = !!me.flyFt;
  const mode: MoveMode = { ...(flying ? { fly: true } : {}), ...(me.climbFt ? { climb: true } : {}) };
  const reach = me.moveLeft > 0 ? hexReach(map, me, me.moveLeft, mode) : new Map<HexKey, { cost: number; prev: HexKey | null }>();
  const look = tileLookup(map);
  const standable = (k: HexKey) => { const t = look(k); return !!t && (t.cost !== null || flying) && !occupied.has(k); };
  const adjacentFoes = foes.filter((f) => dToMe(f) <= 5);

  // ---- the curious watch from a few steps away until they (or a friend) are hurt
  if (mood === 'curious' && !me.provoked && me.hp >= 1) {
    const d = dToMe(nearest);
    if (d <= 20 || me.moveLeft <= 0) return { kind: 'end', why: `watches ${nearest.name}` };
    const spot = approach(nearest, 15, false);
    return spot ? { kind: 'move', ...spot, why: `comes closer to look at ${nearest.name}` } : { kind: 'end', why: `watches ${nearest.name}` };
  }

  // ---- morale: run when it is time to run
  const alone = !friends.some((f) => feet(here, me.alt, pos(f), f.alt) <= 30);
  const flee = tactic !== 'mindless' && ((mood === 'cowardly' && (me.hp <= 0.5 || (alone && foes.length > 1 && me.hp < 1))) || (mood === 'cautious' && me.hp <= 0.25) || (tactic === 'pack' && mood !== 'aggressive' && alone && me.hp <= 0.5));
  if (flee) {
    if (adjacentFoes.length && me.actionFree && !me.nimble) return { kind: 'standard', act: 'disengage', why: 'breaks away' };
    if (adjacentFoes.length && me.nimble && me.bonusFree) return { kind: 'standard', act: 'disengage', viaBonus: true, why: 'slips away' };
    const away = farthest();
    if (away) return { kind: 'move', ...away, why: 'flees' };
    if (me.actionFree && !me.dashed && me.moveLeft <= 0) return { kind: 'standard', act: 'dash', why: 'runs for it' };
    return { kind: 'end', why: 'cowers' };
  }

  const canAttack = me.attacksLeft > 0;
  if (canAttack || me.bonusFree) {
    // ---- war cries and other support abilities: when friends are close enough to profit
    for (const b of me.buffs) {
      if (b.left === 0 || (b.cost === 'bonus' ? !me.bonusFree : !me.actionFree)) continue;
      const near = friends.filter((f) => feet(here, me.alt, pos(f), f.alt) <= b.radiusFt).length + (b.self ? 1 : 0);
      if (near >= (tactic === 'support' ? 1 : 2)) return { kind: 'buff', buff: b.index, why: `${b.name} for ${near} of its side` };
    }
  }
  // what one attack is worth against a foe, from where the creature would stand
  const weight = (f: AiFigure) => {
    let w = 1 + (1 - f.hp) * 0.5;
    const fp = pos(f);
    if (tactic === 'pack' || tactic === 'soldier') w += 0.35 * friends.filter((a) => feet(pos(a), a.alt, fp, f.alt) <= 5).length;
    if (tactic === 'ambusher') w += (1 - f.hp) * 0.6 + (foes.some((o) => o !== f && feet(pos(o), o.alt, fp, f.alt) <= 10) ? 0 : 0.5);
    if (tactic === 'soldier') w += (1 - f.hp) * 0.4;
    if (tactic === 'brute' || tactic === 'mindless') w += Math.max(0, 1 - dToMe(f) / 60) * 0.6;
    return w;
  };
  const strike = (a: NpcAttack, from: Axial, fromAlt: number, f: AiFigure, crowded: boolean): number => {
    const d = feet(from, fromAlt, pos(f), f.alt);
    const dmg = Math.max(1, avg(a.damage));
    if (a.kind === 'melee') return d <= a.reachFt ? dmg * weight(f) : 0;
    const max = a.longRangeFt ?? a.rangeFt ?? a.reachFt;
    if (d > max || !sees(from, fromAlt, f)) return 0;
    return dmg * weight(f) * (crowded ? 0.55 : 1) * (a.rangeFt && d > a.rangeFt ? 0.6 : 1);
  };
  let bestNow: { v: number; target: AiFigure; index: number } | null = null;
  // fighters with a blade in hand do not waste turns on throws at long range (disadvantage) – they close in
  const meleeMinded = tactic !== 'skirmisher' && tactic !== 'caster' && me.attacks.some((a) => a.kind === 'melee');
  if (canAttack) for (const [i, a] of me.attacks.entries()) for (const f of foes) {
    if (meleeMinded && a.kind !== 'melee' && a.rangeFt && dToMe(f) > a.rangeFt) continue;
    const v = strike(a, here, me.alt, f, adjacentFoes.length > 0);
    if (v > 0 && (!bestNow || v > bestNow.v)) bestNow = { v, target: f, index: i };
  }

  // ---- area abilities: on a group, or when they beat a round of attacks
  if (me.actionFree && canAttack) {
    let bestArea: { v: number; index: number; x: number; y: number; n: number; name: string } | null = null;
    for (const ar of me.areas) {
      if (ar.left === 0) continue;
      const aims = ar.shape === 'sphere' && ar.rangeFt <= 5 ? [me as AiFigure] : foes.filter((f) => !ar.rangeFt || feet(here, me.alt, pos(f), f.alt) <= ar.rangeFt);
      for (const aim of aims) {
        const hexes = new Set(areaHexes(map, me, aim, { shape: ar.shape, sizeFt: ar.sizeFt }));
        const n = foes.filter((f) => hexes.has(hexKey(pos(f)))).length, own = friends.filter((f) => hexes.has(hexKey(pos(f)))).length;
        if (!n) continue;
        const v = (Math.max(2, avg(ar.damage)) * 0.75 + (ar.condition ? 5 : 0)) * (n - own * 1.5);
        if (!bestArea || v > bestArea.v) bestArea = { v, index: ar.index, x: aim.x, y: aim.y, n, name: ar.name };
      }
    }
    const round = (bestNow?.v ?? 0) * Math.max(1, me.attacksLeft);
    if (bestArea && bestArea.v > 0 && (bestArea.n >= 2 || bestArea.v > round)) return { kind: 'area', area: bestArea.index, x: bestArea.x, y: bestArea.y, why: `${bestArea.name} on ${bestArea.n}` };
  }

  // ---- move into a better spot first? (melee: next to the prey; shooters: out of arm's reach)
  // shooters with a clear shot and nobody close stay where they are
  const settled = !!bestNow && (tactic === 'skirmisher' || tactic === 'caster') && dToMe(nearest) > 10;
  if (canAttack && me.moveLeft > 0 && !settled) {
    let bestMove: { v: number; k: HexKey; alt: number; target: AiFigure } | null = null;
    const melee = me.attacks.filter((a) => a.kind === 'melee');
    const keepsAway = (tactic === 'skirmisher' || tactic === 'caster') && me.attacks.some((a) => a.kind !== 'melee');
    for (const [k, info] of reach) {
      if (!standable(k) || k === hexKey(here)) continue;
      const h = parseKey(k);
      for (const f of foes) {
        const alt = flying ? Math.min(f.alt + 5, 120) : 0;
        const crowded = foes.some((o) => feet(h, alt, pos(o), o.alt) <= 5);
        let v = 0;
        for (const a of keepsAway ? me.attacks.filter((x) => x.kind !== 'melee') : melee.length ? melee : me.attacks) v = Math.max(v, strike(a, h, alt, f, crowded));
        if (v <= 0) continue;
        if (keepsAway) v *= crowded ? 0.5 : 1 + Math.min(30, Math.min(...foes.map((o) => feet(h, alt, pos(o), o.alt)))) / 100;
        // pack: stand opposite a friend (flank); everyone: do not walk further than needed
        if (tactic === 'pack') { const fp = pos(f); if (friends.some((a) => { const ap = pos(a); return ap.q - fp.q === fp.q - h.q && ap.r - fp.r === fp.r - h.r; })) v *= 1.25; }
        v *= 1 - Math.min(0.2, (info.cost * unit) / 400);
        if (!bestMove || v > bestMove.v) bestMove = { v, k, alt, target: f };
      }
    }
    // leaving a foe's reach draws an opportunity attack: only for a clearly better spot (shooters: when not hemmed in)
    const leaving = adjacentFoes.length > 0;
    const worth = bestMove && bestMove.v > (bestNow?.v ?? 0) * (leaving ? 1.6 : 1.12);
    if (bestMove && worth && !(mood === 'defensive' && distance(here, parseKey(bestMove.k)) * unit > 15 && bestNow)) {
      if (leaving && me.nimble && me.bonusFree) return { kind: 'standard', act: 'disengage', viaBonus: true, why: 'slips out of reach' };
      const c = hexCentre(map, parseKey(bestMove.k));
      return { kind: 'move', x: c.x, y: c.y, ...(flying ? { alt: bestMove.alt } : {}), why: `closes in on ${bestMove.target.name}` };
    }
  }
  if (bestNow) return { kind: 'attack', target: bestNow.target.id, attackIndex: bestNow.index, why: `${me.attacks[bestNow.index].name} → ${bestNow.target.name}` };

  // ---- nothing to hit this turn
  if (canAttack) {
    if (mood === 'defensive' || tactic === 'guardian') return me.actionFree ? { kind: 'standard', act: 'dodge', why: 'holds its ground' } : { kind: 'end', why: 'holds its ground' };
    if (me.moveLeft > 0) {
      const ranged = me.attacks.find((a) => a.kind !== 'melee');
      const spot = approach(nearest, ranged && (tactic === 'skirmisher' || tactic === 'caster') ? Math.max(10, (ranged.rangeFt ?? 30) - 5) : 5, true);
      if (spot) return { kind: 'move', ...spot, why: `advances on ${nearest.name}` };
    }
    if (me.actionFree && !me.dashed && me.moveLeft <= 0 && (mood === 'aggressive' || tactic === 'brute' || tactic === 'pack' || tactic === 'mindless')) return { kind: 'standard', act: 'dash', why: `charges towards ${nearest.name}` };
    if (me.actionFree && mood === 'cautious') return { kind: 'standard', act: 'dodge', why: 'stays wary' };
    return { kind: 'end', why: 'cannot reach anyone' };
  }

  // ---- after the attacks: shooters and the wary step back when nobody holds them
  if ((tactic === 'skirmisher' || tactic === 'caster' || (tactic === 'ambusher' && mood === 'cautious')) && me.moveLeft > 0 && dToMe(nearest) <= 15) {
    if (adjacentFoes.length && me.nimble && me.bonusFree) return { kind: 'standard', act: 'disengage', viaBonus: true, why: 'slips away' };
    if (!adjacentFoes.length) { const away = farthest(30); if (away) return { kind: 'move', ...away, why: 'falls back' }; }
  }
  return { kind: 'end', why: 'done' };

  /** A free hex within `within` feet of the target on the cheapest path – as far along it as the movement goes. */
  function approach(target: AiFigure, within: number, partial: boolean): { x: number; y: number; alt?: number } | null {
    const tp = pos(target);
    let best: { cost: number; steps: Array<{ x: number; y: number; cost: number }> } | null = null;
    const ring = Math.max(1, Math.round(within / unit));
    for (let dq = -ring; dq <= ring; dq++) for (let dr = Math.max(-ring, -dq - ring); dr <= Math.min(ring, -dq + ring); dr++) {
      const h = { q: tp.q + dq, r: tp.r + dr }, k = hexKey(h);
      if ((dq === 0 && dr === 0) || !standable(k)) continue;
      const r = hexMovementCost(map, me, hexCentre(map, h), mode);
      if (r.ok && (!best || r.cost < best.cost)) best = { cost: r.cost, steps: r.steps };
    }
    if (!best) return null;
    if (best.cost > me.moveLeft + 1e-9 && !partial) return null;
    let stop: { x: number; y: number; cost: number } | null = null;
    for (const s of best.steps) if (s.cost <= me.moveLeft + 1e-9 && standable(hexKey(hexAt(map, s)))) stop = s;
    if (!stop || hexKey(hexAt(map, stop)) === hexKey(here)) return null;
    return { x: stop.x, y: stop.y, ...(flying ? { alt: Math.min(target.alt + 5, 120) } : {}) };
  }
  /** The reachable hex farthest from every foe (at least a little farther than now). */
  function farthest(cap = 999): { x: number; y: number; alt?: number } | null {
    const alt = flying ? Math.max(me.alt, 20) : 0;
    const safety = (h: Axial) => Math.min(cap, ...foes.map((f) => feet(h, alt, pos(f), f.alt)));
    let best: { k: HexKey; s: number } | null = null;
    const now = safety(here);
    for (const [k] of reach) { if (!standable(k)) continue; const s = safety(parseKey(k)); if (s > now + 4 && (!best || s > best.s)) best = { k, s }; }
    if (!best) return null;
    const c = hexCentre(map, parseKey(best.k));
    return { x: c.x, y: c.y, ...(flying ? { alt } : {}) };
  }
}
