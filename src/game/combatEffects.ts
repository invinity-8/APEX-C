/**
 * Conditions, buffs and concentration on battle maps (APEX 1.3) – D&D 5e 2014 / SRD 5.1, pure rules.
 *
 * Every creature in a scene (participant id `pc-<token>` / `npc-<id>`) can carry effects: the SRD conditions
 * (blinded, prone, restrained …) and buffs/debuffs from spells, features and elite abilities (Bless, Shield, Rage,
 * Hunter's Mark …). What the rules use:
 *  - advantage / disadvantage on attack rolls (attacker and target side; both cancel, 5e),
 *  - AC bonus, a bonus die on attack rolls (Bless +1d4, Bane −1d4, Bardic Inspiration, used once),
 *  - incapacitated (no actions or reactions), speed 0, automatic critical hits for melee hits within 5 ft against
 *    paralyzed or unconscious creatures, resistance to physical damage (Rage), bonus melee damage (Rage),
 *    extra damage of a marker (Hunter's Mark, Hex) against its target.
 * Effects end at the start of a creature's turn (`untilStartOf`), after a number of that creature's turns
 * (`turns`), when concentration ends, or when the GM removes them.
 *
 * Concentration: one concentration spell per creature; a new one ends the old one. Damage forces a Constitution
 * save (DC 10 or half the damage, whichever is higher) – on a failure every effect of that spell ends.
 */
import type { GameState } from './types.js';

export type ConditionId =
  | 'blinded' | 'charmed' | 'deafened' | 'frightened' | 'grappled' | 'incapacitated' | 'invisible' | 'paralyzed' | 'petrified' | 'poisoned' | 'prone' | 'restrained' | 'stunned' | 'unconscious';
export const CONDITIONS: ConditionId[] = ['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'];

export interface EffectMods {
  /** Advantage / disadvantage on this creature's own attack rolls. */
  attack?: 'adv' | 'dis';
  /** Advantage / disadvantage on attack rolls AGAINST this creature ('proneAware': adv within 5 ft, dis beyond). */
  attacked?: 'adv' | 'dis' | 'proneAware';
  ac?: number;
  /** Flat bonus to this creature's attack rolls. */
  toHit?: number;
  /** Bonus die to attack rolls (Bless '1d4', Bane '-1d4', Inspiration '1d8'). */
  toHitDie?: string;
  /** The bonus die is used up by the next attack (Bardic Inspiration). */
  once?: boolean;
  incapacitated?: boolean;
  speedZero?: boolean;
  /** Melee hits from within 5 ft are critical hits (paralyzed, unconscious). */
  autoCritMelee?: boolean;
  /** Bludgeoning/piercing/slashing damage is halved (Rage). */
  resistPhysical?: boolean;
  /** Extra damage on this creature's melee weapon hits (Rage). */
  meleeDamage?: number;
  /** On the TARGET: the marker (source actor) deals this extra damage dice on hits against it (Hunter's Mark, Hex). */
  markDamage?: string;
}

export interface SceneEffect {
  id: string;
  name: string;
  /** SRD condition id, or a buff key ('bless', 'shield', 'rage' …). */
  key: string;
  mods: EffectMods;
  source?: { actor: string; name: string; spell?: string; concentration?: boolean };
  /** Ends at the start of this actor's next turn (Shield, Dodge, a war cry). */
  untilStartOf?: string;
  /** Ends after this many turns of the affected creature (Rage: 10). */
  turns?: number;
  note?: string;
}

const C = (mods: EffectMods): EffectMods => mods;
/** SRD 5.1 conditions with their mechanical effects (what APEX applies automatically). */
export const CONDITION_MODS: Record<ConditionId, EffectMods> = {
  blinded: C({ attack: 'dis', attacked: 'adv' }),
  charmed: C({}),
  deafened: C({}),
  frightened: C({ attack: 'dis' }),
  grappled: C({ speedZero: true }),
  incapacitated: C({ incapacitated: true }),
  invisible: C({ attack: 'adv', attacked: 'dis' }),
  paralyzed: C({ incapacitated: true, speedZero: true, attacked: 'adv', autoCritMelee: true }),
  petrified: C({ incapacitated: true, speedZero: true, attacked: 'adv', resistPhysical: true }),
  poisoned: C({ attack: 'dis' }),
  prone: C({ attack: 'dis', attacked: 'proneAware' }),
  restrained: C({ speedZero: true, attack: 'dis', attacked: 'adv' }),
  stunned: C({ incapacitated: true, speedZero: true, attacked: 'adv' }),
  unconscious: C({ incapacitated: true, speedZero: true, attacked: 'adv', autoCritMelee: true }),
};
export const CONDITION_TEXT: Record<ConditionId, string> = {
  blinded: 'Can’t see; its attacks have disadvantage, attacks against it advantage.',
  charmed: 'Can’t attack the charmer (GM).',
  deafened: 'Can’t hear (GM).',
  frightened: 'Disadvantage on attacks while the source is in sight; can’t move closer (GM).',
  grappled: 'Speed 0.',
  incapacitated: 'No actions or reactions.',
  invisible: 'Its attacks have advantage, attacks against it disadvantage.',
  paralyzed: 'Incapacitated, speed 0, fails Str/Dex saves (GM); attacks against it have advantage, melee hits within 5 ft are critical.',
  petrified: 'Incapacitated, speed 0, resistance to all damage (APEX: physical halved); attacks against it have advantage.',
  poisoned: 'Disadvantage on attack rolls and ability checks.',
  prone: 'Its attacks have disadvantage; attacks within 5 ft have advantage, from farther away disadvantage. Standing up costs half its speed (GM).',
  restrained: 'Speed 0; its attacks have disadvantage, attacks against it advantage; disadvantage on Dex saves (GM).',
  stunned: 'Incapacitated, speed 0; attacks against it have advantage; fails Str/Dex saves (GM).',
  unconscious: 'Incapacitated, speed 0, prone; attacks against it have advantage, melee hits within 5 ft are critical.',
};

export const effectsOf = (state: Pick<GameState, 'sceneEffects'>, sceneId: string, actor: string): SceneEffect[] => state.sceneEffects?.[sceneId]?.[actor] ?? [];
export const has = (state: Pick<GameState, 'sceneEffects'>, sceneId: string, actor: string, pred: (m: EffectMods) => boolean) => effectsOf(state, sceneId, actor).some((e) => pred(e.mods));

/** Adds an effect (mutates a cloned state). A buff with the same key and source replaces the old one. */
export function addEffect(state: GameState, sceneId: string, actor: string, effect: SceneEffect) {
  const scene = { ...(state.sceneEffects?.[sceneId] ?? {}) };
  scene[actor] = [...(scene[actor] ?? []).filter((e) => !(e.key === effect.key && e.source?.actor === effect.source?.actor)), effect];
  state.sceneEffects = { ...(state.sceneEffects ?? {}), [sceneId]: scene };
}
export function removeEffect(state: GameState, sceneId: string, actor: string, id: string) {
  const scene = { ...(state.sceneEffects?.[sceneId] ?? {}) };
  scene[actor] = (scene[actor] ?? []).filter((e) => e.id !== id);
  state.sceneEffects = { ...(state.sceneEffects ?? {}), [sceneId]: scene };
}
export const conditionEffect = (id: ConditionId, source?: SceneEffect['source'], makeId = () => `fx-${Math.random().toString(36).slice(2, 10)}`): SceneEffect => ({ id: makeId(), name: id[0].toUpperCase() + id.slice(1), key: id, mods: { ...CONDITION_MODS[id] }, ...(source ? { source } : {}) });

/** Turn start of `actor`: its untilStartOf effects end (also those it put on others), its turn counters tick. */
export function onTurnStart(state: GameState, sceneId: string, actor: string): string[] {
  const ended: string[] = [];
  const scene = state.sceneEffects?.[sceneId];
  if (!scene) return ended;
  const next: Record<string, SceneEffect[]> = {};
  for (const [who, list] of Object.entries(scene)) {
    next[who] = list.flatMap((e) => {
      if (e.untilStartOf === actor) { ended.push(`${e.name} ends`); return []; }
      if (who === actor && e.turns !== undefined) {
        if (e.turns <= 1) { ended.push(`${e.name} ends`); return []; }
        return [{ ...e, turns: e.turns - 1 }];
      }
      return [e];
    });
  }
  state.sceneEffects = { ...(state.sceneEffects ?? {}), [sceneId]: next };
  return ended;
}

// ---------------------------------------------------------------- concentration

export interface Concentration { spell: string; since: string }
export const concentrationOf = (state: Pick<GameState, 'sceneConcentration'>, sceneId: string, actor: string): Concentration | null => state.sceneConcentration?.[sceneId]?.[actor] ?? null;

/** Ends a creature's concentration: every effect of it disappears. */
export function endConcentration(state: GameState, sceneId: string, actor: string): string | null {
  const c = concentrationOf(state, sceneId, actor);
  if (!c) return null;
  const scene = state.sceneEffects?.[sceneId] ?? {};
  const next: Record<string, SceneEffect[]> = {};
  for (const [who, list] of Object.entries(scene)) next[who] = list.filter((e) => !(e.source?.actor === actor && e.source.concentration));
  state.sceneEffects = { ...(state.sceneEffects ?? {}), [sceneId]: next };
  const conc = { ...(state.sceneConcentration?.[sceneId] ?? {}) };
  delete conc[actor];
  state.sceneConcentration = { ...(state.sceneConcentration ?? {}), [sceneId]: conc };
  return c.spell;
}
export function startConcentration(state: GameState, sceneId: string, actor: string, spell: string): string | null {
  const old = endConcentration(state, sceneId, actor);
  state.sceneConcentration = { ...(state.sceneConcentration ?? {}), [sceneId]: { ...(state.sceneConcentration?.[sceneId] ?? {}), [actor]: { spell, since: new Date().toISOString() } } };
  return old;
}
/** Concentration save DC after taking damage. */
export const concentrationDc = (damage: number) => Math.max(10, Math.floor(damage / 2));

// ---------------------------------------------------------------- attack roll modifiers

export interface AttackContext {
  attacker: string;
  target: string;
  melee: boolean;
  /** Distance attacker → target in feet. */
  distanceFt: number;
  /** Beyond the normal range (long range of a ranged weapon). */
  longRange?: boolean;
  /** A hostile, not incapacitated creature is within 5 ft of the attacker (ranged attacks have disadvantage). */
  hostileAdjacent?: boolean;
  /** Manual choice (GM ruling or a feature the rules don't track). */
  manual?: 'adv' | 'dis';
}
export interface AttackMods { mode: 'normal' | 'adv' | 'dis'; reasons: string[]; toHit: number; toHitDice: string[]; autoCrit: boolean; onceUsed: string[] }

export function attackMods(state: Pick<GameState, 'sceneEffects' | 'sceneEncounters'>, sceneId: string, ctx: AttackContext): AttackMods {
  const adv: string[] = [], dis: string[] = [];
  const mine = effectsOf(state, sceneId, ctx.attacker), theirs = effectsOf(state, sceneId, ctx.target);
  for (const e of mine) { if (e.mods.attack === 'adv') adv.push(e.name); if (e.mods.attack === 'dis') dis.push(e.name); }
  for (const e of theirs) {
    const a = e.mods.attacked;
    if (a === 'adv') adv.push(`target ${e.name.toLowerCase()}`);
    else if (a === 'dis') dis.push(`target ${e.name.toLowerCase()}`);
    else if (a === 'proneAware') (ctx.distanceFt <= 5 ? adv : dis).push(`target prone${ctx.distanceFt <= 5 ? ' (within 5 ft)' : ' (from afar)'}`);
  }
  if (ctx.longRange) dis.push('long range');
  if (!ctx.melee && ctx.hostileAdjacent) dis.push('ranged attack with a hostile within 5 ft');
  if (ctx.manual === 'adv') adv.push('GM / situational');
  if (ctx.manual === 'dis') dis.push('GM / situational');
  const mode = adv.length && !dis.length ? 'adv' : dis.length && !adv.length ? 'dis' : 'normal';
  const reasons = [...adv.map((r) => `+ ${r}`), ...dis.map((r) => `− ${r}`)];
  if (adv.length && dis.length) reasons.push('advantage and disadvantage cancel');
  const toHit = mine.reduce((s, e) => s + (e.mods.toHit ?? 0), 0);
  const toHitDice = mine.filter((e) => e.mods.toHitDie).map((e) => e.mods.toHitDie!);
  const onceUsed = mine.filter((e) => e.mods.toHitDie && e.mods.once).map((e) => e.id);
  const autoCrit = ctx.melee && ctx.distanceFt <= 5 && theirs.some((e) => e.mods.autoCritMelee);
  return { mode, reasons, toHit, toHitDice, autoCrit, onceUsed };
}

/** AC bonus from effects (Shield +5, Shield of Faith +2 …). */
export const acBonus = (state: Pick<GameState, 'sceneEffects'>, sceneId: string, actor: string) => effectsOf(state, sceneId, actor).reduce((s, e) => s + (e.mods.ac ?? 0), 0);
export const incapacitated = (state: Pick<GameState, 'sceneEffects'>, sceneId: string, actor: string) => has(state, sceneId, actor, (m) => !!m.incapacitated);
export const speedZero = (state: Pick<GameState, 'sceneEffects'>, sceneId: string, actor: string) => has(state, sceneId, actor, (m) => !!m.speedZero);
export const resistsPhysical = (state: Pick<GameState, 'sceneEffects'>, sceneId: string, actor: string) => has(state, sceneId, actor, (m) => !!m.resistPhysical);
export const PHYSICAL = /bludgeoning|piercing|slashing/i;

/** Signed dice "1d4" / "-1d4" → rolled value. */
export function rollBonusDie(spec: string, die: (sides: number) => number): number {
  const m = /^(-)?(\d{1,2})d(\d{1,3})$/.exec(spec.trim());
  if (!m) return 0;
  let t = 0;
  for (let i = 0; i < Number(m[2]); i++) t += die(Number(m[3]));
  return m[1] ? -t : t;
}
