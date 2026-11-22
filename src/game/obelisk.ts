/**
 * APEX 2.11 – the Obelisk: solo trials between sessions. A player sends their own character into a random fight
 * (the random encounter creator, the enemy AI and the loot drafts do the work) – no GM needed. Tiers run from 1 to
 * 150: tier 1 is a level-1 fight, tier 150 is as hard as a level-25 fight would be (characters stop at 20, so beyond
 * that the fights grow). Only tier 1 is open at first; every clear opens the next two. Death costs the inventory
 * (never the level): the GM is alerted and can give single items back; the player accepts the wipe to go on.
 * Keystones are a resource the GM hands out; the GM decides whether a trial costs one.
 *
 * This module is pure (no I/O): tiers, proposals, records, loot, the wipe and the restore.
 */
import type { Difficulty } from './encounters.js';
import { THEMES } from './encounters.js';
import type { StatBlock } from './bestiary.js';
import type { CharacterSheet } from './sheet.js';
import type { Item, Token } from './types.js';
import { proposeEncounter, type EncounterProposal } from './randomEncounter.js';
import { reconcileEquipment } from './equipment.js';
import { rollDraft, ROLLED_CATEGORIES, QUEST_BASE, type Encounter } from './items/lootDraft.js';
import { addToInventory, draftItem, setBalance } from './items/loot.js';
import { balanceOf, MAX_CURRENCY } from './items/currency.js';
import { seededRng } from './items/generate.js';
import { CUBE_BASE } from './items/cubeProgression.js';

export const OBELISK_MAX = 150;
/** The level tier 150 is worth. */
export const OBELISK_TOP_LEVEL = 25;
/** Tiers opened by a clear. */
export const OBELISK_UNLOCK_STEP = 2;
export const MAX_KEYSTONES = 999;
const MAX_ALERTS = 30;
const MAX_LOSSES = 5;
const MAX_LOG = 40;

export const clampTier = (n: number) => Math.max(1, Math.min(OBELISK_MAX, Math.floor(Number.isFinite(n) ? n : 1)));
/** The level a tier is worth: tier 1 = 1, tier 150 = 25, linear in between. */
export const tierLevel = (tier: number) => 1 + ((clampTier(tier) - 1) * (OBELISK_TOP_LEVEL - 1)) / (OBELISK_MAX - 1);

export interface TierPlan {
  tier: number;
  /** The level the tier is worth (fractional, up to 25). */
  level: number;
  /** The level the encounter is planned for (1–20). */
  partyLevel: number;
  /** The party size the encounter is planned for (grows beyond level 20 – the fight is "level 25"). */
  partySize: number;
  difficulty: Difficulty;
  /** Loot class of the fight: every 10th tier a boss, every 5th an elite. */
  loot: Encounter;
}

/**
 * The plan of a tier for `members` characters. Within one level the tiers climb from easy to deadly; above level
 * 20 the XP budget keeps growing (20 % more per level, ×2 at tier 150).
 */
export function tierPlan(tier: number, members = 1): TierPlan {
  const t = clampTier(tier), L = tierLevel(t);
  const whole = Math.floor(L + 1e-9), frac = L - whole;
  const partyLevel = Math.max(1, Math.min(20, whole));
  const over = Math.max(0, L - 20);
  const partySize = Math.max(1, members) * (1 + over * 0.2);
  const difficulty: Difficulty = L >= 20 ? 'deadly' : frac < 0.25 ? 'easy' : frac < 0.5 ? 'medium' : frac < 0.8 ? 'hard' : 'deadly';
  const loot: Encounter = t % 10 === 0 ? 'boss' : t % 5 === 0 ? 'elite' : 'standard';
  return { tier: t, level: L, partyLevel, partySize, difficulty, loot };
}

/** How dangerous a tier looks to a character of `level` (the tiers are not labelled with levels, as in the game). */
export type Danger = 'trivial' | 'comfortable' | 'challenging' | 'dangerous' | 'deadly';
export function dangerFor(tier: number, level: number | null): Danger {
  const d = tierLevel(tier) - Math.max(1, level ?? 1);
  return d <= -3 ? 'trivial' : d <= -1 ? 'comfortable' : d < 0.75 ? 'challenging' : d < 2 ? 'dangerous' : 'deadly';
}
export const DANGER_LABEL: Record<Danger, string> = { trivial: 'Trivial', comfortable: 'Comfortable', challenging: 'Challenging', dangerous: 'Dangerous', deadly: 'Deadly' };

const SITUATIONS = ['camp', 'patrol', 'lair', 'ambush'] as const;
/**
 * A fight for a tier: among a few bands and settings it takes the one whose (DMG-adjusted) XP comes closest to the
 * tier's budget without overshooting it much – so a level-1 hero never meets a hill giant. Same seed → same fight.
 */
/** Farm and riding animals and harmless critters do not guard the Obelisk. */
const TAME = /^(cat|jackal|deer|goat|lion-cub|eagle|raven|sheep|cow|bull|riding-horse|warhorse|pony|mule|camel|mastiff|elk|commoner)$/;
export const obeliskFoes = (blocks: StatBlock[]) => blocks.filter((b) => b.cr.trim() !== '0' && !TAME.test(b.id));

export function obeliskProposal(tier: number, members: number, seed: number, all: StatBlock[]): EncounterProposal & { budget: number } {
  const p = tierPlan(tier, members);
  const blocks = obeliskFoes(all);
  const mix = (x: number) => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; };
  const found: Array<EncounterProposal & { budget: number; score: number }> = [];
  for (let i = 0; i < 24; i++) {
    const s = mix((seed >>> 0) + i * 0x9e3779b1);
    const theme = THEMES[s % THEMES.length].id;
    const situation = SITUATIONS[(s >>> 8) % SITUATIONS.length];
    const prop = proposeEncounter({ site: 'any', theme, situation, difficulty: p.difficulty, partySize: p.partySize, partyLevel: p.partyLevel, seed: s & 0x7fffffff, blocks });
    if (!prop.plan.entries.length) continue;
    const budget = prop.plan.budget, got = prop.plan.rating.adjusted;
    // closeness to the budget; overshooting costs three times as much as falling short
    found.push({ ...prop, budget, score: got > budget ? (got / budget - 1) * 3 : 1 - got / budget });
  }
  if (!found.length) { const prop = proposeEncounter({ site: 'any', theme: 'any', situation: 'camp', difficulty: p.difficulty, partySize: p.partySize, partyLevel: p.partyLevel, seed, blocks }); return { ...prop, budget: prop.plan.budget }; }
  // every band that fits well enough has a chance (variety); otherwise the closest one
  const best = Math.min(...found.map((f) => f.score));
  const good = found.filter((f) => f.score <= Math.max(0.3, best + 0.05));
  const { score: _score, ...out } = good[mix(seed ^ 0x2545f491) % good.length];
  return out;
}

// ---------------------------------------------------------------- records

/** A death: what the inventory held (the GM can give it back item by item). */
export interface ObeliskLoss { id: string; at: string; tier: number; items: Item[] }
/** One character's standing at the Obelisk. */
export interface ObeliskRecord {
  /** Highest tier the character may enter. */
  unlocked: number;
  /** Highest tier cleared. */
  best: number;
  keystones: number;
  clears: number;
  deaths: number;
  /** A wipe the player has not accepted yet (no new trial until then). */
  wipe?: { lossId: string; at: string; tier: number; count: number };
  losses?: ObeliskLoss[];
}
/** What a sheet looked like before a trial (put back afterwards: the trial does not cost campaign HP or slots). */
export type SheetSnap = Pick<CharacterSheet, 'hitPoints' | 'resources' | 'spellEffects'> & { wildShape?: CharacterSheet['wildShape'] };
export interface ObeliskRun {
  id: string;
  userId: string;
  /** The character whose record the trial counts for. */
  tokenId: string;
  /** Every character of the profile that went in (normally one). */
  tokenIds: string[];
  tier: number;
  sceneId: string;
  /** Where the player was before (back there afterwards; null = Sanctuary). */
  prevSceneId: string | null;
  startedAt: string;
  name: string;
  snapshot: Record<string, SheetSnap>;
}
export interface ObeliskAlert { id: string; at: string; tokenId: string; name: string; tier: number; count: number; lossId: string }
export interface ObeliskState {
  /** The GM's choice: a trial costs one keystone. */
  keystonesRequired?: boolean;
  records: Record<string, ObeliskRecord>;
  /** Trials in progress, by profile (user id). */
  runs?: Record<string, ObeliskRun>;
  /** Deaths the GM has not looked at yet. */
  alerts?: ObeliskAlert[];
  log?: Array<{ at: string; text: string }>;
}

export const emptyRecord = (): ObeliskRecord => ({ unlocked: 1, best: 0, keystones: 0, clears: 0, deaths: 0 });
export const obeliskOf = (s: { obelisk?: ObeliskState }): ObeliskState => s.obelisk ?? { records: {} };
export const recordOf = (s: { obelisk?: ObeliskState }, tokenId: string): ObeliskRecord => ({ ...emptyRecord(), ...(s.obelisk?.records[tokenId] ?? {}) });

/** After a clear: the next two tiers open, the best tier and the clears count go up. */
export function afterClear(r: ObeliskRecord, tier: number): ObeliskRecord {
  const t = clampTier(tier);
  return { ...r, unlocked: Math.max(r.unlocked, Math.min(OBELISK_MAX, t + OBELISK_UNLOCK_STEP)), best: Math.max(r.best, t), clears: r.clears + 1 };
}

/** Quest items and the Transmutation Cube are campaign progress, not gear: a wipe leaves them. */
export const survivesWipe = (i: Item) => !!i.quest || i.baseId === QUEST_BASE || i.baseId === CUBE_BASE;

/** Empties a character's inventory (equipment included); returns what was taken. The purse and the level stay. */
export function wipeInventory(t: Token): Item[] {
  const taken = t.inventory.filter((i) => !survivesWipe(i));
  t.inventory = t.inventory.filter(survivesWipe);
  reconcileEquipment(t);
  return taken;
}

/** Records a death: wipe pending, the loss kept for the GM, an alert. Mutates `ob`. */
export function recordDeath(ob: ObeliskState, t: Token, tier: number, items: Item[], at: string, id: string): void {
  const r = { ...emptyRecord(), ...(ob.records[t.id] ?? {}) };
  const loss: ObeliskLoss = { id, at, tier, items };
  ob.records[t.id] = { ...r, deaths: r.deaths + 1, wipe: { lossId: id, at, tier, count: items.length }, losses: [loss, ...(r.losses ?? [])].slice(0, MAX_LOSSES) };
  ob.alerts = [{ id, at, tokenId: t.id, name: t.name, tier, count: items.length, lossId: id }, ...(ob.alerts ?? [])].slice(0, MAX_ALERTS);
}

/** The GM gives one lost item back (or all of a loss). Mutates the token and `ob`; returns an error text or null. */
export function restoreLost(ob: ObeliskState, t: Token, lossId: string, itemId: string | null): string | null {
  const r = ob.records[t.id];
  const loss = r?.losses?.find((l) => l.id === lossId);
  if (!r || !loss) return 'This loss is no longer kept.';
  const items = itemId ? loss.items.filter((i) => i.id === itemId) : [...loss.items];
  if (!items.length) return 'This item was already given back.';
  for (const item of items) {
    // an item of the same id may exist again (given back before): a fresh id keeps both
    const copy = t.inventory.some((i) => i.id === item.id) ? { ...item, id: `${item.id}-r${Date.now().toString(36)}` } : item;
    const err = addToInventory(t, { ...copy, history: [...(copy.history ?? []), { day: copy.history?.at(-1)?.day ?? 1, text: 'Given back by the GM after an Obelisk death' }].slice(-10) });
    if (err) return err;
    loss.items = loss.items.filter((i) => i.id !== item.id);
  }
  return null;
}

/** The player accepts the wipe: the next trial may start. */
export function acceptWipe(ob: ObeliskState, tokenId: string): boolean {
  const r = ob.records[tokenId];
  if (!r?.wipe) return false;
  const { wipe: _done, ...rest } = r;
  ob.records[tokenId] = rest;
  return true;
}

export function obeliskLog(ob: ObeliskState, at: string, text: string): void {
  ob.log = [{ at, text }, ...(ob.log ?? [])].slice(0, MAX_LOG);
}

// ---------------------------------------------------------------- loot

/**
 * The reward of a cleared tier: one loot draft of the tier's class at the tier's level (more item level beyond
 * 20 through the elite/boss tables), straight into the character's inventory; currency bundles go into the purse.
 * Returns the names of what was given. Mutates the token.
 */
export function obeliskLoot(t: Token, tier: number, seed: number, day: number, runId: string): string[] {
  const p = tierPlan(tier);
  const cls: Encounter = p.level > 20 && p.loot === 'standard' ? 'elite' : p.loot;
  const entries = rollDraft(cls, Math.round(p.level), ROLLED_CATEGORIES, seededRng(seed), `ob-${runId.slice(0, 8)}`);
  const got: string[] = [];
  entries.forEach((e, n) => {
    const item = draftItem(e, `ob-${runId.slice(0, 8)}-${n + 1}`, (seed + n * 0x9e3779b1) >>> 0, day);
    if (!item) return;
    item.source = { kind: 'loot', label: `Obelisk tier ${clampTier(tier)}`, day };
    item.history = [{ day, text: `Won at the Obelisk (tier ${clampTier(tier)})` }];
    if (item.grant) {
      const next = Math.min(MAX_CURRENCY, balanceOf(t, item.grant.currency) + item.grant.amount);
      setBalance(t, item.grant.currency, next);
      got.push(item.name);
    } else if (!addToInventory(t, item)) got.push(item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name);
  });
  return got;
}

// ---------------------------------------------------------------- the outcome of a fight

export interface FightView {
  /** Enemies of the trial: still standing and hostile? */
  foes: Array<{ defeated?: boolean; hp: number; side?: 'enemy' | 'ally'; morale?: { surrendered?: boolean; broken?: boolean } }>;
  /** Hit points of the trial's characters. */
  heroes: Array<{ current: number; wildShape?: boolean }>;
}
/** Victory when no foe stands and fights any more (defeated – or, for foes that have morale, surrendered or fled in panic); defeat when every hero is down. */
export function fightOutcome(v: FightView): 'victory' | 'defeat' | null {
  if (v.heroes.length && v.heroes.every((h) => h.current <= 0 && !h.wildShape)) return 'defeat';
  const hostile = v.foes.filter((e) => (e.side ?? 'enemy') === 'enemy');
  if (hostile.length && hostile.every((e) => e.defeated || e.hp <= 0 || e.morale?.surrendered || e.morale?.broken)) return 'victory';
  return null;
}

/** Full strength for the trial: hit points, no temporary HP, every resource (spell slots, uses) refilled. */
export function freshSheet<T extends Pick<CharacterSheet, 'hitPoints' | 'resources'>>(s: T): T {
  return {
    ...s,
    hitPoints: s.hitPoints ? { ...s.hitPoints, current: s.hitPoints.max, temp: 0 } : s.hitPoints,
    resources: s.resources.map((r) => (r.max !== null && r.max > 0 ? { ...r, current: r.max } : r)),
  };
}
