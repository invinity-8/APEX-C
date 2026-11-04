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
import { activeSlots, reconcileEquipment, slotOfItem, equipmentOf } from '../equipment.js';
import { containersOf, INVENTORY_LIMITS } from '../inventory.js';
import { stringHash } from '../rng.js';
import { baseItem, type BaseItem } from './bases.js';
import { balanceOf, CURRENCIES, currencyLabel, MAX_CURRENCY, type CurrencyId } from './currency.js';
import { addableMods, addMods, canRollMods, clampItemLevel, generatedName, rollMods, seededRng, weightedPick } from './generate.js';
import { uniqueDef } from './uniques.js';
import { addLog } from '../log.js';
import { packBag, syncHolding } from './holding.js';
import { clampLevel, DRAFT_LIMITS, normaliseEntry, QUEST_BASE, rollDraft, type DraftRarity, type Encounter, type LootCategory, type LootDraftEntry } from './lootDraft.js';
import { isBagOfHolding } from './weight.js';
import { createItem } from './instance.js';
import { AFFIX_RULES, itemRulesOf, MODIFIER_VERSION, RARITY_LABEL } from './rules.js';

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
  | { type: 'combineFragments'; tokenId: string; sets: number; currencyRev: number }
  // APEX 0.7
  | { type: 'itemAugment'; tokenId: string; itemId: string; rev: number; seed?: number }
  | { type: 'itemAscend'; tokenId: string; itemId: string; rev: number; seed?: number }
  | { type: 'transmuteFragments'; tokenId: string; sets: number; currencyRev: number; seed?: number }
  | { type: 'itemActivate'; tokenId: string; itemId: string; rev: number }
  | { type: 'arsenalGenerateUnique'; stagedId: string; uniqueId: string; giveTo?: string }
  | { type: 'gmTimeTwist'; tokenId: string; action: 'resolve' | 'cancel' }
  | { type: 'gmRechargeItem'; tokenId: string; itemId: string }
  | { type: 'gmSetCubeAccess'; tokenId: string; permanent: boolean }
  // APEX 0.7 – loot drafts (see lootDraft.ts)
  | { type: 'lootDraftCreate'; draftId: string; encounter: Encounter; referenceLevel: number; categories: LootCategory[]; seed?: number }
  | { type: 'lootDraftEdit'; rev: number; op: DraftOp }
  | { type: 'lootDraftApprove'; rev: number; seed?: number }
  | { type: 'lootDraftDiscard' };

export type DraftOp =
  | { kind: 'remove'; key: string }
  | { kind: 'set'; key: string; quantity?: number; itemLevel?: number; rarity?: DraftRarity; identified?: boolean }
  | { kind: 'add'; entry: LootDraftEntry };

export const LOOT_GM_COMMANDS = new Set<LootCommand['type']>(['arsenalGenerate', 'arsenalGive', 'arsenalDiscard', 'gmGrantCurrency', 'gmRevokeItem', 'gmSetItemLock', 'arsenalGenerateUnique', 'gmTimeTwist', 'gmRechargeItem', 'gmSetCubeAccess', 'lootDraftCreate', 'lootDraftEdit', 'lootDraftApprove', 'lootDraftDiscard']);
export const LOOT_PLAYER_COMMANDS = new Set<LootCommand['type']>(['itemIdentify', 'itemReroll', 'itemSalvage', 'combineFragments', 'itemAugment', 'itemAscend', 'transmuteFragments', 'itemActivate']);
export const LOOT_COMMANDS = new Set<string>([...LOOT_GM_COMMANDS, ...LOOT_PLAYER_COMMANDS]);
/** Commands that need a server-provided random seed. */
export const SEEDED_COMMANDS = new Set<string>(['arsenalGenerate', 'lootDraftCreate', 'lootDraftApprove', 'itemReroll', 'itemAugment', 'itemAscend', 'transmuteFragments']);

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

export function canAugment(t: Pick<Token, 'currency'>, item: Item): Check {
  if (!item.rarity || !item.baseId) return no('Only generated equipment can be augmented.');
  if (item.identified === false) return no('Identify this item first.');
  if (item.rarity === 'normal') return no('Normal items have no affix slots – use an Orb of Ascension first.');
  if (item.rarity !== 'magic' && item.rarity !== 'rare') return no('Unique items cannot be augmented.');
  const base = baseItem(item.baseId);
  if (!base) return no('Unknown base item.');
  if ((item.mods?.length ?? 0) >= AFFIX_RULES[item.rarity].max) return no(`No free affix slot (${RARITY_LABEL[item.rarity]} items have at most ${AFFIX_RULES[item.rarity].max}).`);
  if (!addableMods(base, item.rarity, item.itemLevel ?? 1, item.mods ?? []).length) return no('No eligible modifier can be added to this item.');
  if (balanceOf(t, 'augment') < 1) return no('Requires 1 Orb of Augmentation.');
  return yes;
}

export function canAscend(t: Pick<Token, 'currency'>, item: Item): Check {
  if (!item.rarity || !item.baseId) return no('Only generated equipment can be ascended.');
  if (item.identified === false) return no('Identify this item first.');
  if (item.rarity === 'rare') return no('Rare is the highest rarity an Orb of Ascension can reach.');
  if (item.rarity !== 'normal' && item.rarity !== 'magic') return no('Unique items cannot be ascended.');
  const base = baseItem(item.baseId);
  if (!base || !canRollMods(base)) return no('This base item cannot carry modifiers.');
  const next = item.rarity === 'normal' ? 'magic' : 'rare';
  if (!addableMods(base, next, item.itemLevel ?? 1, item.mods ?? []).length) return no('No eligible modifier can be added to this item.');
  if (balanceOf(t, 'ascend') < 1) return no('Requires 1 Orb of Ascension.');
  return yes;
}

export function canActivate(t: Pick<Token, 'equipment' | 'timeTwist'>, item: Item): Check {
  const def = uniqueDef(item.uniqueId);
  if (!def?.ability) return no('This item has no ability to activate.');
  if (item.charge?.spent) return no('Spent – recharges once per long rest (the GM recharges it).');
  const eq = equipmentOf(t);
  const slot = slotOfItem(eq, item.id);
  if (!slot || !activeSlots(eq).includes(slot)) return no('Wear it (amulet slot, not resting) to activate it.');
  if (t.timeTwist) return no('You already have a postponed turn waiting.');
  return yes;
}

export function canSalvage(t: Pick<Token, 'equipment'>, item: Item, actor: Actor): Check {
  if (!item.rarity || !item.baseId) return no('Only generated equipment can be salvaged.');
  if (item.rarity === 'unique') return no('Unique items cannot be salvaged.');
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
  if (t.inventory.length + 1 + (item.held?.length ?? 0) > INVENTORY_LIMITS.items) return `${t.name}'s inventory is full.`;
  if (t.inventory.some((i) => i.id === item.id)) return 'An item with this id already exists.';
  t.inventory.push({ ...item, container: containersOf(t)[0].id });
  syncHolding(t); // a Bag of Holding unpacks its contents into its own container
  return null;
}

function setBalance(t: Token, id: CurrencyId, value: number) {
  t.currency = { ...(t.currency ?? {}), [id]: value };
  t.currencyRev = (t.currencyRev ?? 0) + 1;
}

/** Shallow copy that deep-copies only what a loot command may touch. */
function prepare(prev: GameState, tokenId?: string): GameState {
  const state: GameState = { ...prev, tokens: tokenId ? { ...prev.tokens, [tokenId]: structuredClone(prev.tokens[tokenId]) } : prev.tokens };
  if (prev.arsenal) state.arsenal = { ...prev.arsenal, staged: [...prev.arsenal.staged] };
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

const pickDefined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Creates the real item for an approved draft entry (modifiers rolled with the server seed). */
function draftItem(e: LootDraftEntry, id: string, seed: number, day: number): Item | null {
  const source = { kind: 'loot' as const, label: 'Loot drop', day };
  if (e.currency) {
    return { id, name: `${currencyLabel(e.currency, e.quantity)}`, kind: 'misc', description: `Loot: ${currencyLabel(e.currency, e.quantity)} – goes straight into the purse when given.`, quantity: 1, rev: 0, grant: { currency: e.currency, amount: e.quantity }, source };
  }
  if (e.category === 'quest' || e.category === 'custom') {
    const quest = e.category === 'quest';
    return {
      id,
      name: e.name ?? 'Item',
      kind: 'misc',
      description: e.description ?? '',
      quantity: e.quantity,
      rev: 0,
      ...(quest ? { baseId: QUEST_BASE, quest: { ...(e.image ? { image: e.image } : {}), ...(e.gmNotes ? { gmNotes: e.gmNotes } : {}) } } : {}),
      ...((quest && !e.salvageable) || e.salvageable === false ? { locked: true } : {}),
      ...(e.noTransfer ? { bound: true } : {}),
      source,
      history: [{ day, text: quest ? 'Quest item from a loot drop' : 'Custom item from a loot drop' }],
    };
  }
  const base = baseItem(e.baseId);
  if (!base) return null;
  const rarity = base.equip && canRollMods(base) ? (e.rarity ?? 'normal') : 'normal';
  const item = generate(base, { type: 'arsenalGenerate', stagedId: id, baseId: base.id, rarity, itemLevel: e.itemLevel ?? 1, identified: e.identified !== false, quantity: e.quantity }, id, seed, day);
  item.source = source;
  item.history = [{ day, text: 'Rolled in a GM loot drop' }];
  return item;
}

/** Transmutation outcome table from the balance rules (weights ≥ 0; all zero → Renewal only). */
export function transmuteTable(rules: ReturnType<typeof itemRulesOf>): Array<{ value: CurrencyId; weight: number }> {
  const t: Array<{ value: CurrencyId; weight: number }> = [
    { value: 'orb', weight: rules.transmuteWeightRenewal },
    { value: 'augment', weight: rules.transmuteWeightAugment },
    { value: 'ascend', weight: rules.transmuteWeightAscension },
  ];
  return t.some((x) => x.weight > 0) ? t : [{ value: 'orb', weight: 1 }];
}

function uniqueItem(id: string, uniqueId: string, day: number): Item | null {
  const def = uniqueDef(uniqueId);
  const base = baseItem(def?.baseId);
  if (!def || !base) return null;
  return {
    id,
    name: def.name,
    kind: 'misc',
    description: def.flavor,
    quantity: 1,
    rev: 0,
    baseId: base.id,
    uniqueId: def.id,
    rarity: 'unique',
    itemLevel: def.itemLevel,
    mods: structuredClone(def.mods),
    modVersion: MODIFIER_VERSION,
    ...(base.equip ? { equip: { ...structuredClone(base.equip), gmLocked: true } } : {}),
    ...(def.ability ? { charge: { spent: false } } : {}),
    source: { kind: 'gm', label: 'GM Arsenal (unique)', day },
    history: [{ day, text: 'Created in the GM Arsenal' }],
  };
}

/**
 * APEX 0.7 – Imperial Transmutation Cube: advanced currency crafting (Arcane Transmutation) is unlocked while the
 * character CARRIES a cube (current possession), or permanently if the GM granted the entitlement. Basic currency
 * functions (balances, identify, reroll, combining fragments into Orbs of Renewal) never need the cube.
 */
export const CUBE_BASE = 'apex-imperial-transmutation-cube';
export const hasCube = (t: Pick<Token, 'inventory' | 'cubeAccess'>) => !!t.cubeAccess || t.inventory.some((i) => i.baseId === CUBE_BASE);

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
        state.arsenal = { ...state.arsenal, staged: [...staged, ...made] };
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
      if (item.grant) {
        // a currency bundle from an approved loot draft goes straight into the purse
        const next = balanceOf(t, item.grant.currency) + item.grant.amount;
        if (next > MAX_CURRENCY) return fail(prev, `At most ${MAX_CURRENCY} per currency.`);
        setBalance(t, item.grant.currency, next);
        state.arsenal = { ...state.arsenal, staged: state.arsenal!.staged.filter((i) => i.id !== cmd.stagedId) };
        audit(state, { by: 'GM', action: 'currency', tokenId: t.id, detail: `Loot: granted ${currencyLabel(item.grant.currency, item.grant.amount)} (now ${next})` });
        return { ok: true, state };
      }
      const copy = structuredClone(item);
      addHistory(state, copy, `Given to ${t.name}`);
      const err = addToInventory(t, copy);
      if (err) return fail(prev, err);
      state.arsenal = { ...state.arsenal, staged: state.arsenal!.staged.filter((i) => i.id !== cmd.stagedId) };
      audit(state, { by: 'GM', action: 'give', tokenId: t.id, itemId: item.id, itemName: item.name, detail: describe(item) });
      return { ok: true, state };
    }
    case 'arsenalDiscard': {
      const item = prev.arsenal?.staged.find((i) => i.id === cmd.stagedId);
      if (!item) return fail(prev, 'This item is no longer in the Arsenal tray.');
      if (item.held?.length) return fail(prev, `${item.name} still holds ${item.held.length} item(s) – give it to a character to unpack them first.`);
      const state = prepare(prev);
      state.arsenal = { ...state.arsenal, staged: state.arsenal!.staged.filter((i) => i.id !== cmd.stagedId) };
      audit(state, { by: 'GM', action: 'discard', itemId: item.id, itemName: item.name, detail: describe(item) });
      return { ok: true, state };
    }
    case 'lootDraftCreate': {
      if (typeof cmd.seed !== 'number') return fail(prev, 'A loot draft needs a server seed.');
      if (prev.arsenal?.draft) return fail(prev, 'Approve or discard the current loot draft first.');
      const state = prepare(prev);
      const level = clampLevel(cmd.referenceLevel);
      const entries = rollDraft(cmd.encounter, level, cmd.categories, seededRng(cmd.seed), cmd.draftId);
      state.arsenal = { staged: state.arsenal?.staged ?? [], draft: { id: cmd.draftId, encounter: cmd.encounter, referenceLevel: level, categories: [...cmd.categories], entries, rev: 0, createdDay: prev.day } };
      audit(state, { by: 'GM', action: 'draft', detail: `Loot draft rolled: ${cmd.encounter}, level ${level}, ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` });
      return { ok: true, state };
    }
    case 'lootDraftEdit': {
      const d0 = prev.arsenal?.draft;
      if (!d0) return fail(prev, 'There is no loot draft.');
      if (d0.rev !== cmd.rev) return fail(prev, 'The loot draft was changed in the meantime – please look at it again.');
      const entries = [...d0.entries];
      const op = cmd.op;
      const at = op.kind === 'add' ? -1 : entries.findIndex((e) => e.key === op.key);
      if (op.kind !== 'add' && at < 0) return fail(prev, 'This entry is no longer in the draft.');
      if (op.kind === 'remove') entries.splice(at, 1);
      else {
        if (op.kind === 'add' && entries.length >= DRAFT_LIMITS.entries) return fail(prev, `A draft holds at most ${DRAFT_LIMITS.entries} entries.`);
        if (op.kind === 'add' && entries.some((e) => e.key === op.entry.key)) return fail(prev, 'This entry already exists.');
        const merged: LootDraftEntry = op.kind === 'add' ? op.entry : { ...entries[at], ...pickDefined({ quantity: op.quantity, itemLevel: op.itemLevel, rarity: op.rarity, identified: op.identified }) };
        const norm = normaliseEntry(merged, baseItem);
        if (typeof norm === 'string') return fail(prev, norm);
        if (op.kind === 'add') entries.push(norm);
        else entries[at] = norm;
      }
      const state = prepare(prev);
      state.arsenal = { ...state.arsenal!, draft: { ...d0, entries, rev: d0.rev + 1 } };
      return { ok: true, state };
    }
    case 'lootDraftApprove': {
      const d = prev.arsenal?.draft;
      if (!d) return fail(prev, 'There is no loot draft.');
      if (d.rev !== cmd.rev) return fail(prev, 'The loot draft was changed in the meantime – please look at it again.');
      if (typeof cmd.seed !== 'number') return fail(prev, 'Approving a draft needs a server seed.');
      if (!d.entries.length) return fail(prev, 'The draft is empty – add an entry or discard it.');
      const staged = prev.arsenal?.staged ?? [];
      if (staged.length + d.entries.length > MAX_STAGED) return fail(prev, `The Arsenal tray holds at most ${MAX_STAGED} items – give or discard some first.`);
      const made: Item[] = [];
      for (const [n, e] of d.entries.entries()) {
        const item = draftItem(e, `${d.id}-i${n + 1}`, (cmd.seed + n * 0x9e3779b1) >>> 0, prev.day);
        if (!item) return fail(prev, `Entry ${n + 1} can no longer be created.`);
        if (staged.some((i) => i.id === item.id)) return fail(prev, 'This draft was already approved.');
        made.push(item);
      }
      const state = prepare(prev);
      state.arsenal = { staged: [...staged, ...made] };
      audit(state, { by: 'GM', action: 'draft', detail: `Loot draft approved: ${made.length} item(s) moved to the Arsenal tray` });
      for (const item of made) audit(state, { by: 'GM', action: 'generate', itemId: item.id, itemName: item.name, detail: describe(item) || (item.grant ? 'currency bundle' : 'loot') });
      return { ok: true, state };
    }
    case 'lootDraftDiscard': {
      if (!prev.arsenal?.draft) return fail(prev, 'There is no loot draft.');
      const state = prepare(prev);
      state.arsenal = { staged: state.arsenal?.staged ?? [] };
      audit(state, { by: 'GM', action: 'draft', detail: 'Loot draft discarded' });
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
      const packed = isBagOfHolding(item) ? packBag(t, t.inventory.find((i) => i.id === cmd.itemId)!) : null; // contents travel with the bag
      t.inventory = t.inventory.filter((i) => i.id !== cmd.itemId);
      reconcileEquipment(t);
      let back = '';
      // generated items go back to the Arsenal tray so an accidental grant can simply be re-given
      if (item.baseId && (state.arsenal?.staged.length ?? 0) < MAX_STAGED && !state.arsenal?.staged.some((i) => i.id === item.id)) {
        const copy = structuredClone(packed ?? item);
        delete copy.container;
        addHistory(state, copy, `Revoked from ${t.name}`);
        state.arsenal = { ...state.arsenal, staged: [...(state.arsenal?.staged ?? []), copy] };
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
    case 'itemAugment':
    case 'itemAscend': {
      const item0 = prev.tokens[cmd.tokenId]?.inventory.find((i) => i.id === cmd.itemId);
      if (!item0) return fail(prev, 'This item is no longer in the inventory.');
      if ((item0.rev ?? 0) !== cmd.rev) return fail(prev, `“${item0.name}” was changed in the meantime – please look at it again.`);
      const check = cmd.type === 'itemAugment' ? canAugment(prev.tokens[cmd.tokenId], item0) : canAscend(prev.tokens[cmd.tokenId], item0);
      if (!check.ok) return fail(prev, check.reason);
      if (typeof cmd.seed !== 'number') return fail(prev, 'This needs a server seed.');
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      const item = t.inventory.find((i) => i.id === cmd.itemId)!;
      const base = baseItem(item.baseId)!;
      const rng = seededRng(cmd.seed);
      const before = item.mods?.length ?? 0;
      if (cmd.type === 'itemAugment') {
        const rarity = item.rarity as 'magic' | 'rare';
        const wasAuto = rarity === 'magic' && item.name === generatedName(base, 'magic', item.mods ?? [], () => 0);
        item.mods = addMods(base, rarity, item.itemLevel ?? 1, item.mods ?? [], 1, rng);
        if (item.mods.length === before) return fail(prev, 'No eligible modifier can be added to this item.'); // nothing consumed
        if (wasAuto) item.name = generatedName(base, 'magic', item.mods, () => 0);
        setBalance(t, 'augment', balanceOf(t, 'augment') - 1);
        addHistory(state, item, 'Augmented with an Orb of Augmentation');
      } else {
        const next = item.rarity === 'normal' ? 'magic' : 'rare';
        // keep every existing (valid) modifier, add only what the new rarity needs to reach its minimum
        const need = Math.max(1, AFFIX_RULES[next].min - before);
        item.mods = addMods(base, next, item.itemLevel ?? 1, item.mods ?? [], need, rng);
        if (item.mods.length === before) return fail(prev, 'No eligible modifier can be added to this item.');
        item.rarity = next;
        item.modVersion = MODIFIER_VERSION;
        item.name = revealedName(base, item);
        setBalance(t, 'ascend', balanceOf(t, 'ascend') - 1);
        addHistory(state, item, `Ascended to ${RARITY_LABEL[next]} with an Orb of Ascension`);
      }
      item.rev = (item.rev ?? 0) + 1;
      audit(state, { by: byName(prev, actor), action: cmd.type === 'itemAugment' ? 'augment' : 'ascend', tokenId: t.id, itemId: item.id, itemName: item.name, detail: `${describe(item)} · ${item.mods.length - before} modifier(s) added` });
      return { ok: true, state };
    }
    case 'transmuteFragments': {
      const t0 = prev.tokens[cmd.tokenId];
      if (!t0) return fail(prev, 'Unknown character.');
      if (!hasCube(t0)) return fail(prev, 'Arcane Transmutation requires the Imperial Transmutation Cube.');
      if ((t0.currencyRev ?? 0) !== cmd.currencyRev) return fail(prev, 'Your currency changed in the meantime – please try again.');
      if (typeof cmd.seed !== 'number') return fail(prev, 'This needs a server seed.');
      const sets = Math.floor(cmd.sets);
      const cost = sets * rules.fragmentsPerRandomOrb;
      if (sets < 1) return fail(prev, 'Choose at least one Orb.');
      if (balanceOf(t0, 'fragment') < cost) return fail(prev, `Requires ${currencyLabel('fragment', cost)}.`);
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      const rng = seededRng(cmd.seed);
      const table = transmuteTable(rules);
      const got: Partial<Record<CurrencyId, number>> = {};
      for (let i = 0; i < sets; i++) {
        const c = weightedPick(rng, table)!;
        got[c] = (got[c] ?? 0) + 1;
      }
      const cur = { ...(t.currency ?? {}) };
      cur.fragment = balanceOf(t, 'fragment') - cost;
      for (const [c, n] of Object.entries(got) as Array<[CurrencyId, number]>) cur[c] = Math.min(MAX_CURRENCY, balanceOf(t, c) + n);
      t.currency = cur;
      t.currencyRev = (t.currencyRev ?? 0) + 1;
      const summary = (Object.entries(got) as Array<[CurrencyId, number]>).map(([c, n]) => currencyLabel(c, n)).join(', ');
      t.lastTransmute = { rev: t.currencyRev, result: got };
      audit(state, { by: byName(prev, actor), action: 'transmute', tokenId: t.id, detail: `${currencyLabel('fragment', cost)} → ${summary}` });
      return { ok: true, state, message: `Arcane Transmutation: ${summary}.` };
    }
    case 'arsenalGenerateUnique': {
      const target = cmd.giveTo ? prev.tokens[cmd.giveTo] : undefined;
      if (cmd.giveTo && target?.kind !== 'player') return fail(prev, 'Unknown character.');
      const item = uniqueItem(cmd.stagedId, cmd.uniqueId, prev.day);
      if (!item) return fail(prev, 'Unknown unique item.');
      const state = prepare(prev, cmd.giveTo);
      if (cmd.giveTo) {
        const t = state.tokens[cmd.giveTo];
        addHistory(state, item, `Given to ${t.name}`);
        const err = addToInventory(t, item);
        if (err) return fail(prev, err);
        audit(state, { by: 'GM', action: 'give', tokenId: t.id, itemId: item.id, itemName: item.name, detail: 'Unique – created and given' });
      } else {
        const staged = state.arsenal?.staged ?? [];
        if (staged.length >= MAX_STAGED) return fail(prev, `The Arsenal tray holds at most ${MAX_STAGED} items.`);
        if (staged.some((i) => i.id === item.id)) return fail(prev, 'This item was already generated.');
        state.arsenal = { ...state.arsenal, staged: [...staged, item] };
        audit(state, { by: 'GM', action: 'generate', itemId: item.id, itemName: item.name, detail: 'Unique' });
      }
      return { ok: true, state };
    }
    case 'itemActivate': {
      const t0 = prev.tokens[cmd.tokenId];
      const item0 = t0?.inventory.find((i) => i.id === cmd.itemId);
      if (!item0) return fail(prev, 'This item is no longer in the inventory.');
      if ((item0.rev ?? 0) !== cmd.rev) return fail(prev, `“${item0.name}” was changed in the meantime – please look at it again.`);
      const c = canActivate(t0, item0);
      if (!c.ok) return fail(prev, c.reason);
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      const item = t.inventory.find((i) => i.id === cmd.itemId)!;
      item.charge = { spent: true, spentDay: state.day };
      item.rev = (item.rev ?? 0) + 1;
      t.timeTwist = { itemId: item.id, itemName: item.name, day: state.day, phase: state.phase };
      addHistory(state, item, 'Twist of Time activated');
      state.log = [...prev.log];
      addLog(state, 'event', `⏳ ${t.name} twists time with ${item.name}: the current turn is skipped – two consecutive turns follow at ${t.name}’s next turn (the GM resolves it).`);
      audit(state, { by: byName(prev, actor), action: 'activate', tokenId: t.id, itemId: item.id, itemName: item.name, detail: 'Twist of Time – postponed turn pending' });
      return { ok: true, state };
    }
    case 'gmTimeTwist': {
      const t0 = prev.tokens[cmd.tokenId];
      if (!t0?.timeTwist) return fail(prev, 'No postponed turn is waiting for this character.');
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      const tw = t.timeTwist!;
      delete t.timeTwist;
      state.log = [...prev.log];
      addLog(state, 'event', cmd.action === 'resolve' ? `⏳ ${t.name} takes two consecutive turns (${tw.itemName}).` : `⏳ ${t.name}’s postponed turn is lost (${tw.itemName}).`);
      audit(state, { by: 'GM', action: 'activate', tokenId: t.id, itemId: tw.itemId, itemName: tw.itemName, detail: cmd.action === 'resolve' ? 'Double turn resolved' : 'Postponed turn cancelled (encounter ended / incapacitated)' });
      return { ok: true, state };
    }
    case 'gmRechargeItem': {
      const item0 = prev.tokens[cmd.tokenId]?.inventory.find((i) => i.id === cmd.itemId);
      if (!item0?.charge) return fail(prev, 'This item has no charge.');
      const state = prepare(prev, cmd.tokenId);
      const item = state.tokens[cmd.tokenId].inventory.find((i) => i.id === cmd.itemId)!;
      item.charge = { spent: false };
      item.rev = (item.rev ?? 0) + 1;
      addHistory(state, item, 'Recharged (long rest)');
      audit(state, { by: 'GM', action: 'activate', tokenId: cmd.tokenId, itemId: item.id, itemName: item.name, detail: 'Recharged' });
      return { ok: true, state };
    }
    case 'gmSetCubeAccess': {
      if (prev.tokens[cmd.tokenId]?.kind !== 'player') return fail(prev, 'Unknown character.');
      const state = prepare(prev, cmd.tokenId);
      const t = state.tokens[cmd.tokenId];
      if (cmd.permanent) t.cubeAccess = true;
      else delete t.cubeAccess;
      audit(state, { by: 'GM', action: 'lock', tokenId: t.id, detail: cmd.permanent ? 'Permanent Transmutation access granted' : 'Permanent Transmutation access revoked (the cube itself still unlocks it)' });
      return { ok: true, state };
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
