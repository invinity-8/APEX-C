/**
 * Party loot distribution (APEX 0.7) – Need / Distribute / Pass.
 *
 * Flow
 *  1. The GM puts items from the Arsenal tray up for a roll (`lootRollStart`): eligible characters and a deadline.
 *     The item leaves the tray and lives inside the roll – it exists exactly once at every moment.
 *  2. Each eligible player chooses **Need** (I need it for my character), **Distribute** (I'd take it, e.g. to pass it
 *     on or sell it) or **Pass** (`lootRollChoose`). The choice can be changed until the roll is resolved.
 *  3. Resolution – automatically when every eligible character has chosen, by the GM at any time ("Resolve now"),
 *     or by any eligible player once the deadline has passed (so a disconnected GM or player never blocks a roll):
 *       - characters that did not answer count as Pass;
 *       - Need beats Distribute: if anyone chose Need, only Need characters roll; otherwise Distribute characters;
 *       - each roller gets a public server d100 (crypto seed from the API, never from the client);
 *       - a tie for the highest roll is re-rolled among the tied characters until there is a single winner;
 *       - the item goes to the winner atomically (same state write as the resolution); if the winner's inventory
 *         or purse is full, the next-highest roller gets it; if nobody wants it or nobody can take it, it returns
 *         to the Arsenal tray.
 *     The result (all choices and rolls) is announced in the Chronicle and stays visible in the roll history.
 *
 * Retries are safe: every change is one optimistic-locked state write; a resolved roll cannot be resolved again,
 * and repeated choices are idempotent.
 */
import type { Actor, GameState, Item, Token } from '../types.js';
import { addLog } from '../log.js';
import { balanceOf, currencyLabel, MAX_CURRENCY } from './currency.js';
import { seededRng } from './generate.js';
import { redactItem } from './instance.js';
import { addHistory, addToInventory, audit, setBalance } from './loot.js';

export type LootChoice = 'need' | 'distribute' | 'pass';
export const LOOT_CHOICES: LootChoice[] = ['need', 'distribute', 'pass'];
export const CHOICE_LABEL: Record<LootChoice, string> = { need: 'Need', distribute: 'Distribute', pass: 'Pass' };

export const MAX_OPEN_ROLLS = 12;
export const MAX_ROLL_HISTORY = 20;
export const ROLL_MINUTES = { min: 1, max: 60, default: 5 } as const;

export interface LootRollResult {
  tokenId: string;
  choice: LootChoice;
  /** d100 results – more than one when a tie was re-rolled. */
  rolls: number[];
}

export interface LootRoll {
  id: string;
  /** Scene whose assigned party started this roll; omitted for existing campaign-wide rolls. */
  sceneId?: string;
  /** The item while the roll is open; removed once it has been handed out (see itemName). */
  item?: Item;
  itemName: string;
  rarity?: Item['rarity'];
  eligible: string[];
  choices: Record<string, LootChoice>;
  createdAt: string;
  deadline: string;
  status: 'open' | 'won' | 'returned';
  results?: LootRollResult[];
  winner?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  /** Why the item went back to the tray (nobody wanted it, nobody could take it, cancelled). */
  note?: string;
  /** Player views of open rolls: characters that have already chosen (their choice stays hidden). */
  decided?: string[];
  /** Views only: names of the eligible characters (players may not see every character on the map). */
  names?: Record<string, string>;
}

export type PartyLootCommand =
  | { type: 'lootRollStart'; rollId: string; stagedIds: string[]; tokenIds: string[]; minutes: number; sceneId?: string; now?: number }
  | { type: 'lootRollChoose'; rollId: string; tokenId: string; choice: LootChoice; now?: number; seed?: number }
  | { type: 'lootRollResolve'; rollId: string; now?: number; seed?: number }
  | { type: 'lootRollClaimExpired'; rollId: string; tokenId: string; now?: number; seed?: number }
  | { type: 'lootRollCancel'; rollId: string; now?: number };

export const PARTY_LOOT_COMMANDS = new Set<string>(['lootRollStart', 'lootRollChoose', 'lootRollResolve', 'lootRollClaimExpired', 'lootRollCancel']);
/** Player commands (they name the acting character). */
export const PARTY_LOOT_PLAYER_COMMANDS = new Set<string>(['lootRollChoose', 'lootRollClaimExpired']);
/** Commands that may resolve a roll and therefore need a server seed. */
export const PARTY_LOOT_SEEDED = new Set<string>(['lootRollChoose', 'lootRollResolve', 'lootRollClaimExpired']);
/** Commands that need the server clock. */
export const PARTY_LOOT_TIMED = PARTY_LOOT_COMMANDS;

type Result = { ok: true; state: GameState; message?: string } | { ok: false; state: GameState; error: string };
const fail = (state: GameState, error: string): Result => ({ ok: false, state, error });

/** Pure: the d100 rolls for a group, re-rolling ties for the top until one character is ahead. */
export function rollOff(tokenIds: string[], seed: number): Array<{ tokenId: string; rolls: number[] }> {
  const rng = seededRng(seed);
  const d100 = () => 1 + Math.floor(rng() * 100);
  const out = tokenIds.map((tokenId) => ({ tokenId, rolls: [d100()] }));
  let tied = out;
  for (let guard = 0; guard < 50 && tied.length > 1; guard++) {
    const top = Math.max(...tied.map((r) => r.rolls.at(-1)!));
    tied = tied.filter((r) => r.rolls.at(-1) === top);
    if (tied.length > 1) for (const r of tied) r.rolls.push(d100());
  }
  return out;
}

/** Order of precedence: compares roll sequences (first roll, then tie-break rolls). */
export function ranking(results: Array<{ tokenId: string; rolls: number[] }>): string[] {
  return [...results]
    .sort((a, b) => {
      for (let i = 0; i < Math.max(a.rolls.length, b.rolls.length); i++) {
        const d = (b.rolls[i] ?? -1) - (a.rolls[i] ?? -1);
        if (d) return d;
      }
      return 0;
    })
    .map((r) => r.tokenId);
}

const isPlayer = (s: GameState, id: string) => s.tokens[id]?.kind === 'player';
const names = (s: GameState, ids: string[]) => ids.map((id) => s.tokens[id]?.name ?? id).join(', ');

function clone(prev: GameState): GameState {
  return { ...prev, lootRolls: (prev.lootRolls ?? []).map((r) => ({ ...r, choices: { ...r.choices } })), arsenal: prev.arsenal ? { ...prev.arsenal, staged: [...prev.arsenal.staged] } : prev.arsenal };
}

/** Gives the item to the best-ranked character that can take it. Mutates `state` (tokens copied on write). */
function award(state: GameState, roll: LootRoll, order: string[]): string | null {
  const item = roll.item!;
  for (const id of order) {
    if (!isPlayer(state, id)) continue;
    const t: Token = structuredClone(state.tokens[id]);
    if (item.grant) {
      const next = balanceOf(t, item.grant.currency) + item.grant.amount;
      if (next > MAX_CURRENCY) continue;
      setBalance(t, item.grant.currency, next);
      state.tokens = { ...state.tokens, [id]: t };
      audit(state, { by: 'Loot roll', action: 'currency', tokenId: id, detail: `Won ${currencyLabel(item.grant.currency, item.grant.amount)} (now ${next})` });
      return id;
    }
    const copy = structuredClone(item);
    addHistory(state, copy, `Won by ${t.name} in a loot roll`);
    if (addToInventory(t, copy)) continue; // inventory full → next in line
    state.tokens = { ...state.tokens, [id]: t };
    audit(state, { by: 'Loot roll', action: 'give', tokenId: id, itemId: item.id, itemName: item.name, detail: 'Won in a loot roll' });
    return id;
  }
  return null;
}

function returnToTray(state: GameState, roll: LootRoll) {
  state.arsenal = { ...(state.arsenal ?? { staged: [] }), staged: [...(state.arsenal?.staged ?? []), roll.item!] };
}

/** Resolves one open roll (mutates the cloned `state`). */
function resolve(state: GameState, roll: LootRoll, seed: number, now: number, by: string) {
  const eligible = roll.eligible.filter((id) => isPlayer(state, id));
  const choiceOf = (id: string): LootChoice => roll.choices[id] ?? 'pass';
  const need = eligible.filter((id) => choiceOf(id) === 'need');
  const group = need.length ? need : eligible.filter((id) => choiceOf(id) === 'distribute');
  const rolled = rollOff(group, seed);
  roll.results = eligible.map((id) => ({ tokenId: id, choice: choiceOf(id), rolls: rolled.find((r) => r.tokenId === id)?.rolls ?? [] }));
  roll.resolvedAt = new Date(now).toISOString();
  roll.resolvedBy = by;
  const winner = group.length ? award(state, roll, ranking(rolled)) : null;
  const rollText = rolled.length
    ? ranking(rolled)
        .map((id) => `${state.tokens[id]?.name ?? id} ${rolled.find((r) => r.tokenId === id)!.rolls.join('→')}`)
        .join(', ')
    : '';
  if (winner) {
    roll.status = 'won';
    roll.winner = winner;
    delete roll.item;
    addLog(state, 'event', `🎲 Loot roll – ${roll.itemName}: ${state.tokens[winner].name} wins (${need.length ? 'Need' : 'Distribute'}: ${rollText}).`);
  } else {
    roll.status = 'returned';
    roll.note = group.length ? 'Nobody who rolled could carry it.' : 'Everybody passed.';
    returnToTray(state, roll);
    delete roll.item;
    addLog(state, 'event', `🎲 Loot roll – ${roll.itemName}: ${group.length ? `nobody could take it (${rollText})` : 'everybody passed'}; it stays with the Game Master.`);
  }
}

/** Keeps every open roll and the most recent resolved ones. */
function trim(state: GameState) {
  const rolls = state.lootRolls ?? [];
  const open = rolls.filter((r) => r.status === 'open');
  const done = rolls.filter((r) => r.status !== 'open').slice(-MAX_ROLL_HISTORY);
  state.lootRolls = rolls.filter((r) => open.includes(r) || done.includes(r));
}

export function executePartyLoot(prev: GameState, actor: Actor, cmd: PartyLootCommand): Result {
  const now = cmd.now ?? Date.now();
  if ((cmd.type === 'lootRollStart' || cmd.type === 'lootRollResolve' || cmd.type === 'lootRollCancel') && actor.role !== 'gm') return fail(prev, 'Only the Game Master can do that.');
  if (cmd.type === 'lootRollStart') {
    const staged = prev.arsenal?.staged ?? [];
    const items = cmd.stagedIds.map((id) => staged.find((i) => i.id === id));
    if (!items.length || items.some((i) => !i)) return fail(prev, 'An item is no longer in the Arsenal tray.');
    if (new Set(cmd.stagedIds).size !== cmd.stagedIds.length) return fail(prev, 'An item was selected twice.');
    const eligible = [...new Set(cmd.tokenIds)].filter((id) => isPlayer(prev, id));
    if (eligible.length !== new Set(cmd.tokenIds).size || !eligible.length) return fail(prev, 'Choose at least one character (player characters only).');
    const open = (prev.lootRolls ?? []).filter((r) => r.status === 'open').length;
    if (open + items.length > MAX_OPEN_ROLLS) return fail(prev, `At most ${MAX_OPEN_ROLLS} loot rolls can be open at once.`);
    if ((prev.lootRolls ?? []).some((r) => r.id.startsWith(`${cmd.rollId}-`))) return fail(prev, 'These loot rolls were already started.');
    const minutes = Math.max(ROLL_MINUTES.min, Math.min(ROLL_MINUTES.max, Math.floor(cmd.minutes)));
    const state = clone(prev);
    state.arsenal = { ...state.arsenal!, staged: staged.filter((i) => !cmd.stagedIds.includes(i.id)) };
    items.forEach((item, n) => {
      state.lootRolls!.push({
        id: `${cmd.rollId}-${n + 1}`,
        ...(cmd.sceneId ? { sceneId: cmd.sceneId } : {}),
        item: item!,
        itemName: item!.name,
        ...(item!.rarity ? { rarity: item!.rarity } : {}),
        eligible,
        choices: {},
        createdAt: new Date(now).toISOString(),
        deadline: new Date(now + minutes * 60_000).toISOString(),
        status: 'open',
      });
    });
    addLog(state, 'event', `🎲 Loot roll: ${items.map((i) => i!.name).join(', ')} – ${names(state, eligible)} may choose Need, Distribute or Pass (${minutes} min).`);
    audit(state, { by: 'GM', action: 'draft', detail: `Loot roll started for ${items.length} item(s): ${names(state, eligible)}` });
    return { ok: true, state };
  }

  const roll0 = (prev.lootRolls ?? []).find((r) => r.id === cmd.rollId);
  if (!roll0) return fail(prev, 'This loot roll does not exist.');
  if (roll0.status !== 'open') return fail(prev, 'This loot roll has already been resolved.');
  const expired = now >= Date.parse(roll0.deadline);

  if (cmd.type === 'lootRollCancel') {
    const state = clone(prev);
    const roll = state.lootRolls!.find((r) => r.id === cmd.rollId)!;
    roll.status = 'returned';
    roll.note = 'Cancelled by the Game Master.';
    roll.resolvedAt = new Date(now).toISOString();
    roll.resolvedBy = 'GM';
    returnToTray(state, roll);
    delete roll.item;
    addLog(state, 'event', `🎲 Loot roll – ${roll.itemName}: cancelled by the Game Master.`);
    trim(state);
    return { ok: true, state };
  }

  if (typeof cmd.seed !== 'number') return fail(prev, 'Loot rolls need a server seed.');
  if (cmd.type === 'lootRollChoose') {
    if (!roll0.eligible.includes(cmd.tokenId)) return fail(prev, `${prev.tokens[cmd.tokenId]?.name ?? 'This character'} is not part of this loot roll.`);
    if (expired) return fail(prev, 'The time for this loot roll is up – it is being resolved without your choice.');
    if (roll0.choices[cmd.tokenId] === cmd.choice) return { ok: true, state: prev }; // retry → nothing to do
    const state = clone(prev);
    const roll = state.lootRolls!.find((r) => r.id === cmd.rollId)!;
    roll.choices[cmd.tokenId] = cmd.choice;
    if (roll.eligible.filter((id) => isPlayer(state, id)).every((id) => roll.choices[id])) {
      resolve(state, roll, cmd.seed, now, 'everyone chose');
      trim(state);
    }
    return { ok: true, state };
  }
  if (cmd.type === 'lootRollClaimExpired') {
    if (!roll0.eligible.includes(cmd.tokenId)) return fail(prev, 'Only characters in this loot roll can close it.');
    if (!expired) return fail(prev, 'The loot roll is still open – wait for the deadline.');
  }
  const state = clone(prev);
  const roll = state.lootRolls!.find((r) => r.id === cmd.rollId)!;
  resolve(state, roll, cmd.seed, now, cmd.type === 'lootRollResolve' ? 'GM' : expired ? 'deadline' : 'GM');
  trim(state);
  return { ok: true, state };
}

/** Player view of the rolls: items redacted; other characters' choices hidden until the roll is resolved. */
export function lootRollsView(state: GameState, viewerIds: string[] | 'gm', sceneId?: string | null): LootRoll[] {
  return (state.lootRolls ?? []).filter(r => viewerIds === 'gm' || !r.sceneId || r.sceneId === sceneId).map((r) => {
    const v: LootRoll = { ...r, names: Object.fromEntries(r.eligible.map((id) => [id, state.tokens[id]?.name ?? id])), choices: { ...r.choices }, eligible: [...r.eligible], ...(r.results ? { results: r.results.map((x) => ({ ...x, rolls: [...x.rolls] })) } : {}) };
    if (r.item) v.item = viewerIds === 'gm' ? structuredClone(r.item) : redactItem({ ...structuredClone(r.item) });
    if (viewerIds !== 'gm' && r.status === 'open') {
      // before resolution a player only sees their own choice and who has already decided (as "?" placeholders)
      v.choices = Object.fromEntries(Object.entries(r.choices).filter(([id]) => viewerIds.includes(id)));
      v.decided = Object.keys(r.choices);
    }
    return v;
  });
}
