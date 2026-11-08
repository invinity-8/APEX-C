/**
 * Turn economy, reactions and spells on battle maps (D&D 5e 2014 / SRD 5.1) – pure rules shared by the server and
 * the UI.
 *
 *  - Every creature in initiative has, per own turn: one ACTION, one BONUS ACTION, its movement, and one REACTION
 *    that refreshes at the start of its own turn. Budgets are stored per turn serial, so a new turn is always
 *    fresh and an old budget can never be reused.
 *  - Standard actions: Attack (Extra Attack → several attacks per Attack action), Cast a Spell, Dash (movement
 *    doubled this turn), Disengage (no opportunity attacks against you this turn), Dodge, Help, Hide, Ready,
 *    Search, Use an Object. Outside initiative nothing is limited (free play).
 *  - Opportunity attacks: when a creature leaves the reach of a hostile creature without Disengage, the hostile may
 *    use its reaction to make one melee attack. APEX offers it as a prompt to whoever controls the reactor (the GM
 *    for enemies and allies, the player for their character) – nothing happens automatically.
 *  - Spells: a known spell (cantrip, or prepared), cast with a slot of its level or higher (upcasting); the slot is
 *    spent on the server. Attack-roll spells roll against AC; saving-throw spells roll the damage and show the DC
 *    – the GM applies the result.
 */
import type { GameState, SceneEncounter } from './types.js';
import type { CharacterSheet, SheetSpell } from './sheet.js';
import { SLOT_RE } from './resources.js';

export type StandardAction = 'dash' | 'disengage' | 'dodge' | 'help' | 'hide' | 'ready' | 'search' | 'useObject';
export const STANDARD_ACTIONS: Array<{ id: StandardAction; label: string; text: string }> = [
  { id: 'dash', label: 'Dash', text: 'Extra movement equal to your speed this turn.' },
  { id: 'disengage', label: 'Disengage', text: 'Your movement does not provoke opportunity attacks this turn.' },
  { id: 'dodge', label: 'Dodge', text: 'Until your next turn, attacks against you have disadvantage (if you can see the attacker) and you have advantage on Dex saves.' },
  { id: 'help', label: 'Help', text: 'An ally gains advantage on its next ability check or attack against a creature within 5 ft of you.' },
  { id: 'hide', label: 'Hide', text: 'Make a Dexterity (Stealth) check – the GM decides.' },
  { id: 'ready', label: 'Ready', text: 'Prepare an action with a trigger; it uses your reaction when it happens.' },
  { id: 'search', label: 'Search', text: 'Make a Wisdom (Perception) or Intelligence (Investigation) check.' },
  { id: 'useObject', label: 'Use an object', text: 'Interact with a second object, drink a potion …' },
];

/** What one creature has used in the current turn (valid only while `serial` equals the encounter turn serial). */
export interface TurnBudget {
  serial: number;
  action?: boolean;
  bonus?: boolean;
  /** The action was the Attack action; `attacks` counts its attacks (Extra Attack). */
  attackAction?: boolean;
  attacks?: number;
  dash?: boolean;
  disengage?: boolean;
  dodge?: boolean;
  /** Last standard action, for the log and the UI. */
  last?: string;
}

/** Participant id of a character / NPC in the encounter. */
export const pcActor = (tokenId: string) => `pc-${tokenId}`;
export const npcActor = (npcId: string) => `npc-${npcId}`;

export function budgetOf(e: Pick<SceneEncounter, 'economy' | 'turnSerial'> | null, actor: string): TurnBudget {
  const serial = e?.turnSerial ?? 0;
  const b = e?.economy?.[actor];
  return b && b.serial === serial ? b : { serial };
}
export const reactionUsed = (e: Pick<SceneEncounter, 'reactions'> | null, actor: string) => !!e?.reactions?.[actor];
export const isActiveActor = (e: Pick<SceneEncounter, 'participants' | 'turnIndex'> | null, actor: string) => !!e && e.participants[e.turnIndex]?.id === actor;

/** Number of attacks one Attack action allows, from the sheet's features (Extra Attack, Fighter 11/20). */
export function attacksPerAction(sheet: Pick<CharacterSheet, 'abilities' | 'details'> | null): number {
  if (!sheet) return 1;
  const names = sheet.abilities.map((a) => `${a.name} ${a.text.slice(0, 120)}`.toLowerCase());
  const fighter = sheet.details.map((d) => `${d.label} ${d.value}`.toLowerCase()).join(' ');
  const lvl = /fighter\s*(\d{1,2})/.exec(fighter)?.[1];
  if (lvl && Number(lvl) >= 20) return 4;
  if (lvl && Number(lvl) >= 11) return 3;
  if (names.some((n) => /extra attack/.test(n))) return /three times|\(3\)|attack three/.test(names.join(' ')) ? 3 : 2;
  return 1;
}

type Result = { ok: true; state: GameState; message?: string } | { ok: false; error: string };
const clone = (s: GameState) => structuredClone(s);

/** Mutates `e` – call on a cloned state. */
export function spend(e: SceneEncounter, actor: string, change: Partial<Omit<TurnBudget, 'serial'>>) {
  const b = { ...budgetOf(e, actor), ...change };
  e.economy = { ...(e.economy ?? {}), [actor]: b };
}

/**
 * Checks (and with `apply` spends) one use of the action economy. `gm` may act out of turn (table authority), but
 * the budget is still recorded so everyone sees what was used.
 */
export function useEconomy(e: SceneEncounter | null, actor: string, kind: 'action' | 'bonus' | 'attack' | 'reaction', opts: { gm: boolean; attacksAllowed?: number }): string | null {
  if (!e) return null; // no initiative: free play
  const active = isActiveActor(e, actor);
  if (kind === 'reaction') {
    if (reactionUsed(e, actor)) return 'The reaction was already used this round.';
    e.reactions = { ...(e.reactions ?? {}), [actor]: e.turnSerial ?? 0 };
    return null;
  }
  if (!active && !opts.gm) return 'Wait for your turn.';
  const b = budgetOf(e, actor);
  if (kind === 'bonus') {
    if (b.bonus && !opts.gm) return 'The bonus action was already used this turn.';
    spend(e, actor, { bonus: true });
    return null;
  }
  if (kind === 'attack') {
    const allowed = Math.max(1, opts.attacksAllowed ?? 1);
    if (b.action && !opts.gm) {
      if (!b.attackAction) return 'The action was already used this turn.';
      if ((b.attacks ?? 0) >= allowed) return allowed > 1 ? `All ${allowed} attacks of the Attack action are used.` : 'The attack was already made this turn.';
    }
    spend(e, actor, { action: true, attackAction: b.action ? b.attackAction : true, attacks: (b.attackAction ? b.attacks ?? 0 : 0) + 1, last: 'attack' });
    return null;
  }
  if (b.action && !opts.gm) return 'The action was already used this turn.';
  spend(e, actor, { action: true });
  return null;
}

/** A standard action (Dash, Disengage, Dodge …): uses the action (or the bonus action, e.g. Cunning Action). */
export function takeStandardAction(prev: GameState, sceneId: string, actor: string, name: string, act: StandardAction, viaBonus: boolean, gm: boolean): Result {
  const state = clone(prev);
  const e = state.sceneEncounters?.[sceneId];
  if (!e || e.status !== 'active') return { ok: false, error: 'Actions are tracked while initiative runs.' };
  const err = useEconomy(e, actor, viaBonus ? 'bonus' : 'action', { gm });
  if (err) return { ok: false, error: err };
  spend(e, actor, { last: act, ...(act === 'dash' ? { dash: true } : act === 'disengage' ? { disengage: true } : act === 'dodge' ? { dodge: true } : {}) });
  e.version++;
  const label = STANDARD_ACTIONS.find((a) => a.id === act)?.label ?? act;
  return { ok: true, state, message: `${name} takes the ${label} ${viaBonus ? 'bonus action' : 'action'}.` };
}

// ---------------------------------------------------------------- opportunity attacks

export interface ReactionOffer {
  id: string;
  kind: 'opportunity';
  /** Who may react: an NPC (GM decides) or a character (its player decides; the GM may too). */
  reactor: { kind: 'pc' | 'npc'; id: string; name: string };
  target: { kind: 'pc' | 'npc'; id: string; name: string };
  turnSerial: number;
  at: string;
  /** Where the target was when it left the reach (the attack happens there). */
  from: { x: number; y: number };
}

export interface Figure { kind: 'pc' | 'npc'; id: string; name: string; side: 'party' | 'enemy'; x: number; y: number; reachFt: number; down?: boolean }

/**
 * Hostiles whose reach the mover leaves: within reach at the start, out of reach at the destination. `dist` returns
 * feet between two points. (Reach is checked at start and end of the move; a path that only brushes past a
 * creature is not tracked – the GM can still call for it.)
 */
export function opportunityOffers(mover: Figure, to: { x: number; y: number }, others: Figure[], dist: (a: { x: number; y: number }, b: { x: number; y: number }) => number, e: SceneEncounter | null, makeId: () => string, now: string): ReactionOffer[] {
  if (!e || e.status !== 'active') return [];
  const moverActor = mover.kind === 'pc' ? pcActor(mover.id) : npcActor(mover.id);
  if (budgetOf(e, moverActor).disengage) return [];
  const out: ReactionOffer[] = [];
  for (const o of others) {
    if (o.down || o.side === mover.side || (o.kind === mover.kind && o.id === mover.id)) continue;
    const actor = o.kind === 'pc' ? pcActor(o.id) : npcActor(o.id);
    if (!e.participants.some((p) => p.id === actor) || reactionUsed(e, actor)) continue;
    if (dist(o, mover) <= o.reachFt && dist(o, to) > o.reachFt) {
      out.push({ id: makeId(), kind: 'opportunity', reactor: { kind: o.kind, id: o.id, name: o.name }, target: { kind: mover.kind, id: mover.id, name: mover.name }, turnSerial: e.turnSerial ?? 0, at: now, from: { x: mover.x, y: mover.y } });
    }
  }
  return out;
}

export const reactionsOf = (state: Pick<GameState, 'sceneReactions' | 'sceneEncounters'>, sceneId: string): ReactionOffer[] => {
  const serial = state.sceneEncounters?.[sceneId]?.turnSerial ?? 0;
  return (state.sceneReactions?.[sceneId] ?? []).filter((r) => r.turnSerial === serial);
};

export function addOffers(state: GameState, sceneId: string, offers: ReactionOffer[]) {
  if (!offers.length) return;
  state.sceneReactions = { ...(state.sceneReactions ?? {}), [sceneId]: [...reactionsOf(state, sceneId), ...offers].slice(-20) };
}
export function dropOffer(state: GameState, sceneId: string, id: string) {
  state.sceneReactions = { ...(state.sceneReactions ?? {}), [sceneId]: reactionsOf(state, sceneId).filter((r) => r.id !== id) };
}

// ---------------------------------------------------------------- spells

export interface SpellPlan {
  spell: SheetSpell;
  /** 0 = cantrip */
  slotLevel: number;
  mode: 'attack' | 'save' | 'utility';
  save?: string;
  rangeFt: number | null;
  damage: string | null;
  bonusAction: boolean;
  reaction: boolean;
}

/** Spell slot resources by level: current / max. */
export function spellSlots(sheet: Pick<CharacterSheet, 'resources'>): Array<{ level: number; current: number; max: number | null; id: string }> {
  return sheet.resources.flatMap((r) => {
    const m = SLOT_RE.exec(r.name.trim());
    return m ? [{ level: Number(m[1]), current: r.current, max: r.max, id: r.id }] : [];
  }).sort((a, b) => a.level - b.level);
}

/** Range in feet ("120 feet", "Touch" → 5, "Self (15-foot cone)" → 15, "Self" → null). */
export function spellRangeFt(range: string): number | null {
  const r = range.toLowerCase();
  if (/touch/.test(r)) return 5;
  const ft = /(\d{1,4})\s*(?:-\s*)?(?:feet|foot|ft)/.exec(r);
  if (ft) return Number(ft[1]);
  const mi = /(\d{1,2})\s*mile/.exec(r);
  if (mi) return Number(mi[1]) * 5280;
  return null;
}

/**
 * Damage dice of a spell at a slot level: the first "XdY [type] damage" in the description, plus "increases by
 * 1dY for each slot level above Nth" (upcasting) or the cantrip steps at levels 5/11/17.
 */
export function spellDamage(spell: Pick<SheetSpell, 'description' | 'level'>, slotLevel: number, characterLevel = 1): string | null {
  const text = spell.description.replace(/\s+/g, ' ');
  const m = /(\d{1,2})d(\d{1,2})(?:\s*\+\s*(\d{1,2}))?\s+(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)?\s*damage/i.exec(text);
  if (!m) return null;
  let count = Number(m[1]);
  const sides = Number(m[2]);
  const flat = m[3] ? Number(m[3]) : 0;
  if (spell.level === 0) {
    count *= characterLevel >= 17 ? 4 : characterLevel >= 11 ? 3 : characterLevel >= 5 ? 2 : 1;
  } else if (slotLevel > spell.level) {
    const up = /increases by (\d{1,2})d(\d{1,2}) for each (?:slot )?level above (\d)/i.exec(text) ?? /(\d{1,2})d(\d{1,2}) for each slot level above (\d)/i.exec(text);
    if (up && Number(up[2]) === sides) count += Number(up[1]) * (slotLevel - Math.max(spell.level, Number(up[3])));
  }
  return `${count}d${sides}${flat ? `+${flat}` : ''}${m[4] ? ` ${m[4].toLowerCase()}` : ''}`;
}

/** Validated plan for casting `spell` with a slot level (0 for cantrips). */
export function planSpell(sheet: CharacterSheet, spellId: string, slotLevel: number, characterLevel = 1): SpellPlan | { error: string } {
  const spell = sheet.spells.find((s) => s.id === spellId);
  if (!spell) return { error: 'Choose a spell from your character sheet.' };
  if (spell.level > 0 && !spell.prepared) return { error: `${spell.name} is not prepared.` };
  if (spell.level === 0) slotLevel = 0;
  else {
    if (!Number.isInteger(slotLevel) || slotLevel < spell.level || slotLevel > 9) return { error: `${spell.name} needs a slot of level ${spell.level} or higher.` };
    const slot = spellSlots(sheet).find((s) => s.level === slotLevel);
    if (!slot) return { error: `There is no “Spell slots (level ${slotLevel})” resource on the sheet.` };
    if (slot.current < 1) return { error: `No level-${slotLevel} spell slot left.` };
  }
  const text = `${spell.description} ${spell.notes}`.toLowerCase();
  const save = /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/.exec(text)?.[1];
  const mode: SpellPlan['mode'] = /(ranged|melee) spell attack/.test(text) ? 'attack' : save ? 'save' : 'utility';
  const ct = spell.castingTime.toLowerCase();
  return { spell, slotLevel, mode, save, rangeFt: spellRangeFt(spell.range), damage: spellDamage(spell, slotLevel, characterLevel), bonusAction: /bonus/.test(ct), reaction: /reaction/.test(ct) };
}

/** Sheet with one slot of the level spent (null for cantrips: no slot). */
export function spendSlot(sheet: CharacterSheet, slotLevel: number): CharacterSheet {
  if (!slotLevel) return sheet;
  const next = structuredClone(sheet);
  const slot = next.resources.find((r) => SLOT_RE.exec(r.name.trim())?.[1] === String(slotLevel));
  if (slot) slot.current = Math.max(0, slot.current - 1);
  return next;
}

/** "Spell attack bonus" / "Spell save DC" from the sheet's spellcasting block (first source). */
export function spellNumbers(sheet: Pick<CharacterSheet, 'spellcasting'>): { attack: number | null; dc: number | null } {
  const val = (re: RegExp) => {
    const e = sheet.spellcasting.find((x) => re.test(x.label));
    const m = e ? /([+-]?\d{1,2})/.exec(e.value) : null;
    return m ? Number(m[1]) : null;
  };
  return { attack: val(/spell attack/i), dc: val(/save dc/i) };
}

/** Total character level from "Wizard 5 / Cleric 2" style details (for cantrip scaling), default 1. */
export function characterLevel(sheet: Pick<CharacterSheet, 'details'>): number {
  const text = sheet.details.filter((d) => /class|level/i.test(d.label)).map((d) => d.value).join(' ');
  const nums = [...text.matchAll(/(?:^|\D)(\d{1,2})(?!\d)/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 20);
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.max(1, Math.min(20, sum || 1));
}

export const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
