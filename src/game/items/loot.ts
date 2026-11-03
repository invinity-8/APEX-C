/**
 * The playable loot loop (APEX 0.6): GM Arsenal (generate → preview → give), currency grants, revoking, and the
 * player actions identify / reroll / salvage / combine fragments.
 *
 * Authority & safety
 *  - Every change goes through executeCommand on the server, against the latest stored state, and is saved with
 *    optimistic locking (version check). Randomness comes from `seed`, which ONLY the server sets (the validator
 *    drops any client value; see api.ts) – so a retried or replayed request cannot "fish" for better rolls.
 *  - Item actions name the item revision (`rev`), currency actions the purse revision (`currencyRev`): a repeated
 *    request after success fails instead of spending or rewarding twice. Requests also carry a request id
 *    (apex_command_log) – an exact retry returns the first result.
 *  - Modifiers of unidentified items are rolled at creation and stay server-side (player views are redacted);
 *    identification reveals them, it never rolls.
 */
import type { Actor, GameState, Item, ItemAuditEntry, Token } from '../types.js';
import { reconcileEquipment, slotOfItem, equipmentOf } from '../equipment.js';
import { containersOf, INVENTORY_LIMITS } from '../inventory.js';
import { stringHash } from '../rng.js';
import { baseItem, type BaseItem } from './bases.js';
import { balanceOf, CURRENCIES, currencyLabel, MAX_CURRENCY, type CurrencyId } from './currency.js';
import { canRollMods, clampItemLevel, generatedName, rollMods, seededRng } from './generate.js';
import { createItem } from './instance.js';
import { itemRulesOf, MODIFIER_VERSION, RARITY_LABEL } from './rules.js';

export type GenRarity = 'normal' | 'magic' | 'rare';

export type LootCommand =
  | { type: 'arsenalGenerate'; stagedId: string; baseId: string; rarity: GenRarity; itemLevel: number; identified: boolean; quantity?: number; count?: number; giveTo?: string; seed?: number }
  | { type: 'arsenalGive'; stagedId: string; tokenId: string }
  | { type: 'arsenalDiscard'; stagedId: string }
  | { type: 'gmGrantCurrency'; tokenId: string; currency: CurrencyId; amount: number }
  | { type: 'gmRevokeItem'; tokenId: string; itemId: string; reason?: string }
  | { type: 'gmSetItemLock'; tokenId: string; itemId: string; locked: boolean }
  | { type: 'itemIdentify'; tokenId: string; itemId: string; rev: number }
  | { type: 'itemReroll'; tokenId: string; itemId: string; rev: number; seed?: number }
  | { type: 'itemSalvage'; tokenId: string; itemId: string; rev: number }
  | { type: 'combineFragments'; tokenId: string; sets: number; currencyRev: number };

export const LOOT_GM_COMMANDS = new Set<LootCommand['type']>(['arsenalGenerate', 'arsenalGive', 'arsenalDiscard', 'gmGrantCurrency', 'gmRevokeItem', 'gmSetItemLock']);
export const LOOT_PLAYER_COMMANDS = new Set<LootCommand['type']>(['itemIdentify', 'itemReroll', 'itemSalvage', 'combineFragments']);
export const LOOT_COMMANDS = new Set<string>([...LOOT_GM_COMMANDS, ...LOOT_PLAYER_COMMANDS]);
/** Commands that need a server-provided random seed. */
export const SEEDED_COMMANDS = new Set<string>(['arsenalGenerate', 'itemReroll']);

export const MAX_STAGED = 24;
export const MAX_AUDIT = 300;
export const MAX_COUNT = 10;
const MAX_HISTORY = 10;

type Result = { ok: true; state: GameState; message?: string } | { ok: false; state: GameState; error: string };
const fail = (state: GameState, error: string): Result => ({ ok: false, state, error });

// ---------------------------------------------------------------- pure rules (shared with the UI)

/** Fragments for salvaging an item – predictable, shown before confirming. */
export function salvageReward(item: Pick<Item, 'rarity' | 'itemLevel'>): number {
  const ilvl = clampItemLevel(item.itemLevel ?? 1);
  if (item.rarity === 'rare') return 4 + Math.min(2, Math.floor(ilvl / 10)); // 4–6
  if (item.rarity === 'magic') return 2 + (ilvl >= 15 ? 1 : 0); // 2–3
  return 1;
}

export type Check = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Check => ({ ok: false, reason });
const yes: Check = { ok: true };

export function canIdentify(t: Pick<Token, 'currency'>, item: Item): Check {
  if (item.identified !== false) return no('This item is already identified.');
  if (balanceOf(t, 'seal') < 1) return no('Requires 1 Seal of Revelation.');
  return yes;
}

export function canReroll(t: Pick<Token, 'currency'>, item: Item): Check {
  if (!item.rarity || !item.baseId) return no('Only generated Magic or Rare items can be rerolled.');
  if (item.identified === false) return no('Cannot reroll an unidentified item – identify it first.');
  if (item.rarity !== 'magic' && item.rarity !== 'rare') return no(`${RARITY_LABEL[item.rarity]} items have no modifiers to reroll.`);
  const base = baseItem(item.baseId);
  if (!base || !canRollMods(base)) return no('This base item cannot carry modifiers.');
  if (balanceOf(t, 'orb') < 1) return no('Requires 1 Orb of Renewal.');
  return yes;
}

export function canSalvage(t: Pick<Token, 'equipment'>, item: Item, actor: Actor): Check {
  if (!item.rarity || !item.baseId) return no('Only generated equipment can be salvaged.');
  if (item.locked && actor.role !== 'gm') return no('The Game Master has restricted this item.');
  if (item.bound) return no('Bound items cannot be salvaged.');
  if (slotOfItem(equipmentOf(t), item.id)) return no('Unequip before salvaging.');
  return yes;
}

// ---------------------------------------------------------------- helpers

function audit(state: GameState, e: Omit<ItemAuditEntry, 'id' | 'day' | 'phase'>) {
  const id = state.nextAuditId ?? 1;
  state.nextAuditId = id + 1;
  state.itemAudit = [...(state.itemAudit ?? []), { id, day: state.day, phase: state.phase, ...e }].slice(-MAX_AUDIT);
}
const addHistory = (state: GameState, item: Item, text: string) => {
  item.history = [...(item.history ?? []), { day: state.day, text }].slice(-MAX_HISTORY);
};
const byName = (state: GameState, actor: Actor) => (actor.role === 'gm' ? 'GM' : (state.tokens[actor.tokenId]?.name ?? actor.tokenId));
const describe = (i: Item) => [i.rarity ? RARITY_LABEL[i.rarity] : null, i.itemLevel ? `ilvl ${i.itemLevel}` : null, i.identified === false ? 'unidentified' : null].filter(Boolean).join(', ');

/** Name an item gets when identified: magic = affix name, rare = stable random name derived from the item id. */
function revealedName(base: BaseItem, item: Item): string {
  if (item.rarity === 'magic') return generatedName(base, 'magic', item.mods ?? [], () => 0);
  if (item.rarity === 'rare') return generatedName(base, 'rare', [], seededRng(stringHash(item.id)));
  return item.name;
}

function addToInventory(t: Token, item: Item): string | null {
  if (t.inventory.length >= INVENTORY_LIMITS.items) return `${t.name}'s inventory is full.`;
  if (t.inventory.some((i) => i.id === item.id)) return 'An item with this id already exists.';
  t.inventory.push({ ...item, container: containersOf(t)[0].id });
  return null;
}

function setBalance(t: Token, id: CurrencyId, value: number) {
  t.currency = { ...(t.currency ?? {}), [id]: value };
  t.currencyRev = (t.currencyRev ?? 0) + 1;
}

/** Shallow copy that deep-copies only what a loot command may touch. */
function prepare(prev: GameState, tokenId?: string): GameState {
  const state: GameState = { ...prev, tokens: tokenId ? { ...prev.tokens, [tokenId]: structuredClone(prev.tokens[tokenId]) } : prev.tokens };
  if (prev.arsenal) state.arsenal = { staged: [...prev.arsenal.staged] };
  return state;
}

function generate(base: BaseItem, cmd: Extract<LootCommand, { type: 'arsenalGenerate' }>, id: string, seed: number, day: number): Item {
  const rng = seededRng(seed);
  const rarity = base.equip && canRollMods(base) ? cmd.rarity : 'normal';
  const item = createItem(base, { id, rarity, itemLevel: cmd.itemLevel, rng, identified: cmd.identified, quantity: cmd.quantity, source: { kind: 'gm', label: 'GM Arsenal', day } });
  if (item.identified === false) item.name = base.name; // the affix name would reveal the modifiers
  item.history = [{ day, text: 'Created in the GM Arsenal' }];
  return item;
}

// ---------------------------------------------------------------- command execution

export function executeLoot(prev: GameState, actor: Actor, cmd: LootCommand): Result {
  if (LOOT_GM_COMMANDS.has(cmd.type) && actor.role !== 'gm') return fail(prev, 'Only the Game Master can do that.');
  const rules = itemRulesOf(prev);
  switch (cmd.type) {
    case 'arsenalGenerate': {
      const base = baseItem(cmd.baseId);
      if (!base) return fail(prev, 'Unknown base item.');
      if (typeof cmd.seed !== 'number') return fail(prev, 'Item generation needs a server seed.');
      const count = Math.max(1, Math.min(MAX_COUNT, Math.floor(cmd.count ?? 1)));
      const target = cmd.giveTo ? prev.tokens[cmd.giveTo] : undefined;
      if (cmd.giveTo && target?.kind !== 'player') return fail(prev, 'Unknown character.');
      const state = prepare(prev, cmd.giveTo);
      const staged = state.arsenal?.staged ?? [];
      if (!cmd.giveTo && staged.length + count > MAX_STAGED) return fail(prev, `The Arsenal tray holds at most ${MAX_STAGED} items – give or discard some first.`);
      const made: Item[] = [];
      for (let n = 0; n < count; n++) {
        const id = n ? `${cmd.stagedId}-${n + 1}` : cmd.stagedId;
        if (staged.some((i) => i.id === id)) return fail(prev, 'This item was already generated.');
        made.push(generate(base, cmd, id, (cmd.seed + n * 0x9e3779b1) >>> 0, prev.day));
      }
      if (cmd.giveTo) {
        const t = state.tokens[cmd.giveTo];
        for (const item of made) {
          addHistory(state, item, `Given to ${t.name}`);
          const err = addToInventory(t, item);
          if (err) return fail(prev, err);
          audit(state, { by: 'GM', action: 'give', tokenId: t.id, itemId: item.id, itemName: item.name, detail: `Generated and given (${describe(item)})` });
        }
      } else {
        state.arsenal = { staged: [...staged, ...made] };
        for (const item of made) audit(state, { by: 'GM', action: 'generate', itemId: item.id, itemName: item.name, detail: describe(item) });
      }
      return { ok: true, state };
    }
    case 'arsenalGive': {
      const t0 = prev.tokens[cmd.tokenId];
      if (t0?.kind !== 'player') return fail(prev, 'Unknown character.');
      const item = prev.arsenal?.staged.find((i) => i.id === cmd.stagedId);
      if (!item) return fail(prev, 'This item is no longer in the Arsenal tray (already given?).');
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      const copy = structuredClone(item);
      addHistory(state, copy, `Given to ${t.name}`);
      const err = addToInventory(t, copy);
      if (err) return fail(prev, err);
      state.arsenal = { staged: state.arsenal!.staged.filter((i) => i.id !== cmd.stagedId) };
      audit(state, { by: 'GM', action: 'give', tokenId: t.id, itemId: item.id, itemName: item.name, detail: describe(item) });
      return { ok: true, state };
    }
    case 'arsenalDiscard': {
      const item = prev.arsenal?.staged.find((i) => i.id === cmd.stagedId);
      if (!item) return fail(prev, 'This item is no longer in the Arsenal tray.');
      const state = prepare(prev);
      state.arsenal = { staged: state.arsenal!.staged.filter((i) => i.id !== cmd.stagedId) };
      audit(state, { by: 'GM', action: 'discard', itemId: item.id, itemName: item.name, detail: describe(item) });
      return { ok: true, state };
    }
    case 'gmGrantCurrency': {
      if (prev.tokens[cmd.tokenId]?.kind !== 'player') return fail(prev, 'Unknown character.');
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      const next = balanceOf(t, cmd.currency) + cmd.amount;
      if (next < 0) return fail(prev, `${t.name} only has ${currencyLabel(cmd.currency, balanceOf(t, cmd.currency))}.`);
      if (next > MAX_CURRENCY) return fail(prev, `At most ${MAX_CURRENCY} per currency.`);
      setBalance(t, cmd.currency, next);
      audit(state, { by: 'GM', action: 'currency', tokenId: t.id, detail: `${cmd.amount > 0 ? 'Granted' : 'Removed'} ${currencyLabel(cmd.currency, Math.abs(cmd.amount))} (now ${next})` });
      return { ok: true, state };
    }
    case 'gmRevokeItem': {
      const t0 = prev.tokens[cmd.tokenId];
      const item = t0?.inventory.find((i) => i.id === cmd.itemId);
      if (!item) return fail(prev, 'This item is no longer in the inventory.');
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      t.inventory = t.inventory.filter((i) => i.id !== cmd.itemId);
      reconcileEquipment(t);
      let back = '';
      // generated items go back to the Arsenal tray so an accidental grant can simply be re-given
      if (item.baseId && (state.arsenal?.staged.length ?? 0) < MAX_STAGED && !state.arsenal?.staged.some((i) => i.id === item.id)) {
        const copy = structuredClone(item);
        delete copy.container;
        addHistory(state, copy, `Revoked from ${t.name}`);
        state.arsenal = { staged: [...(state.arsenal?.staged ?? []), copy] };
        back = ' – returned to the Arsenal tray';
      }
      audit(state, { by: 'GM', action: 'revoke', tokenId: t.id, itemId: item.id, itemName: item.name, detail: `${describe(item) || 'plain item'}${cmd.reason ? ` – ${cmd.reason}` : ''}${back}` });
      return { ok: true, state };
    }
    case 'gmSetItemLock': {
      const item0 = prev.tokens[cmd.tokenId]?.inventory.find((i) => i.id === cmd.itemId);
      if (!item0) return fail(prev, 'This item is no longer in the inventory.');
      const state = prepare(prev, cmd.tokenId);
      const item = state.tokens[cmd.tokenId].inventory.find((i) => i.id === cmd.itemId)!;
      if (cmd.locked) item.locked = true;
      else delete item.locked;
      item.rev = (item.rev ?? 0) + 1;
      audit(state, { by: 'GM', action: 'lock', tokenId: cmd.tokenId, itemId: item.id, itemName: item.name, detail: cmd.locked ? 'Restricted (no salvage/delete)' : 'Restriction lifted' });
      return { ok: true, state };
    }
    case 'itemIdentify':
    case 'itemReroll':
    case 'itemSalvage': {
      const t0 = prev.tokens[cmd.tokenId];
      const item0 = t0?.inventory.find((i) => i.id === cmd.itemId);
      if (!item0) return fail(prev, 'This item is no longer in the inventory.');
      if ((item0.rev ?? 0) !== cmd.rev) return fail(prev, `“${item0.name}” was changed in the meantime – please look at it again.`);
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      const item = t.inventory.find((i) => i.id === cmd.itemId)!;
      const by = byName(prev, actor);
      if (cmd.type === 'itemIdentify') {
        const c = canIdentify(t, item);
        if (!c.ok) return fail(prev, c.reason);
        const base = baseItem(item.baseId);
        setBalance(t, 'seal', balanceOf(t, 'seal') - 1);
        delete item.identified;
        if (base) item.name = revealedName(base, item);
        item.rev = (item.rev ?? 0) + 1;
        addHistory(state, item, 'Identified with a Seal of Revelation');
        audit(state, { by, action: 'identify', tokenId: t.id, itemId: item.id, itemName: item.name, detail: describe(item) });
        return { ok: true, state, message: `${item.name} has been identified.` };
      }
      if (cmd.type === 'itemReroll') {
        const c = canReroll(t, item);
        if (!c.ok) return fail(prev, c.reason);
        if (typeof cmd.seed !== 'number') return fail(prev, 'Rerolling needs a server seed.');
        const base = baseItem(item.baseId)!;
        const rarity = item.rarity as 'magic' | 'rare';
        const autoName = rarity === 'magic' && item.name === generatedName(base, 'magic', item.mods ?? [], () => 0);
        item.mods = rollMods(base, rarity, item.itemLevel ?? 1, seededRng(cmd.seed));
        item.modVersion = MODIFIER_VERSION;
        if (autoName) item.name = generatedName(base, 'magic', item.mods, () => 0);
        setBalance(t, 'orb', balanceOf(t, 'orb') - 1);
        item.rev = (item.rev ?? 0) + 1;
        addHistory(state, item, 'Modifiers renewed with an Orb of Renewal');
        audit(state, { by, action: 'reroll', tokenId: t.id, itemId: item.id, itemName: item.name, detail: describe(item) });
        return { ok: true, state, message: `${item.name} has new modifiers.` };
      }
      const c = canSalvage(t, item, actor);
      if (!c.ok) return fail(prev, c.reason);
      const reward = salvageReward(item);
      const next = Math.min(MAX_CURRENCY, balanceOf(t, 'fragment') + reward);
      t.inventory = t.inventory.filter((i) => i.id !== item.id);
      setBalance(t, 'fragment', next);
      audit(state, { by, action: 'salvage', tokenId: t.id, itemId: item.id, itemName: item.name, detail: `${describe(item)} → ${currencyLabel('fragment', reward)}` });
      return { ok: true, state, message: `Salvaged ${item.name}: +${currencyLabel('fragment', reward)}.` };
    }
    case 'combineFragments': {
      const t0 = prev.tokens[cmd.tokenId];
      if (!t0) return fail(prev, 'Unknown character.');
      if ((t0.currencyRev ?? 0) !== cmd.currencyRev) return fail(prev, 'Your currency changed in the meantime – please try again.');
      const sets = Math.floor(cmd.sets);
      const cost = sets * rules.fragmentsPerOrb;
      if (sets < 1) return fail(prev, 'Choose at least one Orb.');
      if (balanceOf(t0, 'fragment') < cost) return fail(prev, `Requires ${currencyLabel('fragment', cost)}.`);
      if (balanceOf(t0, 'orb') + sets > MAX_CURRENCY) return fail(prev, `At most ${MAX_CURRENCY} Orbs.`);
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      t.currency = { ...(t.currency ?? {}), fragment: balanceOf(t, 'fragment') - cost, orb: balanceOf(t, 'orb') + sets };
      t.currencyRev = (t.currencyRev ?? 0) + 1;
      audit(state, { by: byName(prev, actor), action: 'combine', tokenId: t.id, detail: `${currencyLabel('fragment', cost)} → ${currencyLabel('orb', sets)}` });
      return { ok: true, state, message: `Created ${currencyLabel('orb', sets)}.` };
    }
  }
}

export { CURRENCIES };
