/**
 * GM Merchant (APEX 0.7) – a simple shop the Game Master runs during a session.
 *
 *  - The GM activates/deactivates it, names it, sets its gold and the rate it pays when buying from players.
 *  - Stock is MOVED from the Arsenal tray (and back) – the merchant never creates items out of nothing.
 *  - Prices are per unit, in Gold Pieces or any APEX currency; the GM can change them at any time.
 *  - Players buy and sell through server commands only. Each command names the purse revision (buy) or the item
 *    revision (sell) plus the merchant revision it was based on, so a double click, a retry or a stale screen can
 *    never spend twice or sell an item twice. Every change is a single optimistic-locked state write: currency,
 *    stock and inventory change together or not at all.
 *
 * Not for sale to the merchant: quest items, GM-restricted or bound items, uniques, equipped items, a Bag of Holding
 * that still holds items, and items without a price reference.
 */
import type { Actor, GameState, Item, Token } from '../types.js';
import { equipmentOf, slotOfItem } from '../equipment.js';
import { addLog } from '../log.js';
import { baseItem } from './bases.js';
import { balanceOf, currencyLabel, MAX_CURRENCY, type CurrencyId } from './currency.js';
import { bagItemCount } from './holding.js';
import { isBagOfHolding } from './weight.js';
import { addHistory, addToInventory, audit, MAX_STAGED, setBalance } from './loot.js';

export interface MerchantStock {
  id: string;
  item: Item;
  /** Price per unit. */
  price: number;
  currency: CurrencyId;
}

export interface Merchant {
  active: boolean;
  name: string;
  /** Gold the merchant can pay out when buying from players (grows when players pay in gold). */
  gold: number;
  /** Percent of an item's reference value the merchant pays (0–100). */
  buyRate: number;
  stock: MerchantStock[];
  /** Bumped by every change – clients name it so a stale screen cannot trade. */
  rev: number;
}

export const MERCHANT_LIMITS = { stock: 40, name: 40, price: MAX_CURRENCY, gold: MAX_CURRENCY } as const;
export const DEFAULT_MERCHANT: Merchant = { active: false, name: 'Imperial Quartermaster', gold: 500, buyRate: 50, stock: [], rev: 0 };
/** Reference value multiplier by rarity (base SRD price × multiplier). */
export const RARITY_VALUE: Record<string, number> = { normal: 1, magic: 3, rare: 8 };

export type MerchantCommand =
  | { type: 'merchantSetup'; active?: boolean; name?: string; gold?: number; buyRate?: number }
  | { type: 'merchantStockAdd'; stagedId: string; price: number; currency: CurrencyId }
  | { type: 'merchantStockUpdate'; stockId: string; price: number; currency: CurrencyId }
  | { type: 'merchantStockRemove'; stockId: string }
  | { type: 'merchantBuy'; tokenId: string; stockId: string; quantity: number; merchantRev: number; currencyRev: number }
  | { type: 'merchantSell'; tokenId: string; itemId: string; quantity: number; rev: number; merchantRev: number };

export const MERCHANT_GM_COMMANDS = new Set<string>(['merchantSetup', 'merchantStockAdd', 'merchantStockUpdate', 'merchantStockRemove']);
export const MERCHANT_PLAYER_COMMANDS = new Set<string>(['merchantBuy', 'merchantSell']);
export const MERCHANT_COMMANDS = new Set<string>([...MERCHANT_GM_COMMANDS, ...MERCHANT_PLAYER_COMMANDS]);

type Result = { ok: true; state: GameState; message?: string } | { ok: false; state: GameState; error: string };
const fail = (state: GameState, error: string): Result => ({ ok: false, state, error });

export const merchantOf = (s: Pick<GameState, 'merchant'>): Merchant => s.merchant ?? DEFAULT_MERCHANT;

/** Reference value of ONE unit in gold (base SRD price × rarity), or null when the merchant has no price for it. */
export function itemValue(item: Item): number | null {
  if (item.uniqueId || item.quest || item.grant) return null;
  const base = baseItem(item.baseId);
  if (!base?.price) return null;
  return Math.max(1, Math.round(base.price * (RARITY_VALUE[item.rarity ?? 'normal'] ?? 1)));
}

/** Gold the merchant offers for `quantity` units, or the reason it will not buy. */
export function sellOffer(m: Merchant, t: Pick<Token, 'inventory' | 'equipment'>, item: Item, quantity = item.quantity): { gold: number } | { refused: string } {
  if (!m.active) return { refused: 'The merchant is not open.' };
  if (item.quest) return { refused: 'Quest items cannot be sold.' };
  if (item.locked) return { refused: 'The Game Master has restricted this item.' };
  if (item.bound) return { refused: 'Bound items cannot be sold.' };
  if (item.uniqueId) return { refused: 'The merchant cannot afford a unique item.' };
  if (slotOfItem(equipmentOf(t), item.id)) return { refused: 'Unequip it first.' };
  if (isBagOfHolding(item) && bagItemCount(t as Token, item)) return { refused: 'Empty the Bag of Holding first.' };
  const value = itemValue(item);
  if (value === null) return { refused: 'The merchant has no price for this item.' };
  const gold = Math.floor((value * quantity * m.buyRate) / 100);
  if (gold < 1) return { refused: 'The merchant would pay nothing for it.' };
  return { gold };
}

function cloneMerchant(prev: GameState): GameState {
  const m = merchantOf(prev);
  return { ...prev, merchant: { ...m, stock: m.stock.map((s) => ({ ...s })) }, ...(prev.arsenal ? { arsenal: { ...prev.arsenal, staged: [...prev.arsenal.staged] } } : {}) };
}
const bump = (state: GameState) => (state.merchant!.rev += 1);
const unitLabel = (price: number, c: CurrencyId) => currencyLabel(c, price);

export function executeMerchant(prev: GameState, actor: Actor, cmd: MerchantCommand): Result {
  if (MERCHANT_GM_COMMANDS.has(cmd.type) && actor.role !== 'gm') return fail(prev, 'Only the Game Master can do that.');
  const m0 = merchantOf(prev);
  switch (cmd.type) {
    case 'merchantSetup': {
      const state = cloneMerchant(prev);
      const m = state.merchant!;
      if (cmd.name !== undefined) m.name = cmd.name.trim().slice(0, MERCHANT_LIMITS.name) || DEFAULT_MERCHANT.name;
      if (cmd.gold !== undefined) m.gold = Math.max(0, Math.min(MERCHANT_LIMITS.gold, Math.floor(cmd.gold)));
      if (cmd.buyRate !== undefined) m.buyRate = Math.max(0, Math.min(100, Math.floor(cmd.buyRate)));
      if (cmd.active !== undefined && cmd.active !== m.active) {
        m.active = cmd.active;
        addLog(state, 'event', cmd.active ? `🏛 ${m.name} has opened shop.` : `🏛 ${m.name} has closed shop.`);
      }
      bump(state);
      return { ok: true, state };
    }
    case 'merchantStockAdd': {
      const item = prev.arsenal?.staged.find((i) => i.id === cmd.stagedId);
      if (!item) return fail(prev, 'This item is no longer in the Arsenal tray.');
      if (item.grant) return fail(prev, 'Currency bundles cannot be sold – grant them directly.');
      if (m0.stock.length >= MERCHANT_LIMITS.stock) return fail(prev, `The merchant holds at most ${MERCHANT_LIMITS.stock} offers.`);
      const state = cloneMerchant(prev);
      state.arsenal = { ...state.arsenal!, staged: state.arsenal!.staged.filter((i) => i.id !== cmd.stagedId) };
      state.merchant!.stock.push({ id: item.id, item, price: cmd.price, currency: cmd.currency });
      bump(state);
      audit(state, { by: 'GM', action: 'trade', itemId: item.id, itemName: item.name, detail: `Offered at the merchant for ${unitLabel(cmd.price, cmd.currency)} each` });
      return { ok: true, state };
    }
    case 'merchantStockUpdate': {
      if (!m0.stock.some((s) => s.id === cmd.stockId)) return fail(prev, 'This offer no longer exists.');
      const state = cloneMerchant(prev);
      const s = state.merchant!.stock.find((x) => x.id === cmd.stockId)!;
      s.price = cmd.price;
      s.currency = cmd.currency;
      bump(state);
      return { ok: true, state };
    }
    case 'merchantStockRemove': {
      const entry = m0.stock.find((s) => s.id === cmd.stockId);
      if (!entry) return fail(prev, 'This offer no longer exists.');
      if ((prev.arsenal?.staged.length ?? 0) >= MAX_STAGED) return fail(prev, 'The Arsenal tray is full – give or discard some items first.');
      const state = cloneMerchant(prev);
      state.merchant!.stock = state.merchant!.stock.filter((s) => s.id !== cmd.stockId);
      state.arsenal = { ...(state.arsenal ?? { staged: [] }), staged: [...(state.arsenal?.staged ?? []), entry.item] };
      bump(state);
      return { ok: true, state };
    }
    case 'merchantBuy': {
      if (!m0.active) return fail(prev, 'The merchant is not open.');
      if (m0.rev !== cmd.merchantRev) return fail(prev, 'The merchant’s offers changed in the meantime – please look again.');
      const t0 = prev.tokens[cmd.tokenId];
      if (t0?.kind !== 'player') return fail(prev, 'Unknown character.');
      if ((t0.currencyRev ?? 0) !== cmd.currencyRev) return fail(prev, 'Your purse changed in the meantime – please look again.');
      const entry = m0.stock.find((s) => s.id === cmd.stockId);
      if (!entry) return fail(prev, 'This offer is gone – someone else bought it.');
      const qty = Math.floor(cmd.quantity);
      if (qty < 1 || qty > entry.item.quantity) return fail(prev, `The merchant has ${entry.item.quantity} of these.`);
      const total = entry.price * qty;
      if (balanceOf(t0, entry.currency) < total) return fail(prev, `You need ${unitLabel(total, entry.currency)}.`);
      if (entry.currency === 'gold' && m0.gold + total > MERCHANT_LIMITS.gold) return fail(prev, 'The merchant’s coffers are full.');
      const state = cloneMerchant(prev);
      state.tokens = { ...state.tokens, [cmd.tokenId]: structuredClone(t0) };
      const t = state.tokens[cmd.tokenId];
      const m = state.merchant!;
      const rest = entry.item.quantity - qty;
      const bought: Item = structuredClone(entry.item);
      bought.quantity = qty;
      if (rest > 0) bought.id = `${entry.id}-${m.rev}`; // a part of the stack becomes a new item; the offer keeps the rest
      delete bought.container;
      addHistory(state, bought, `Bought from ${m.name} for ${unitLabel(total, entry.currency)}`);
      bought.source = { kind: 'merchant', label: m.name, day: state.day };
      const err = addToInventory(t, bought);
      if (err) return fail(prev, err);
      setBalance(t, entry.currency, balanceOf(t, entry.currency) - total);
      if (entry.currency === 'gold') m.gold += total;
      m.stock = rest > 0 ? m.stock.map((s) => (s.id === entry.id ? { ...s, item: { ...s.item, quantity: rest } } : s)) : m.stock.filter((s) => s.id !== entry.id);
      bump(state);
      audit(state, { by: t.name, action: 'trade', tokenId: t.id, itemId: bought.id, itemName: bought.name, detail: `Bought ${qty} × for ${unitLabel(total, entry.currency)} from ${m.name}` });
      return { ok: true, state, message: `Bought ${qty > 1 ? `${qty} × ` : ''}${bought.name} for ${unitLabel(total, entry.currency)}.` };
    }
    case 'merchantSell': {
      if (!m0.active) return fail(prev, 'The merchant is not open.');
      if (m0.rev !== cmd.merchantRev) return fail(prev, 'The merchant’s offers changed in the meantime – please look again.');
      const t0 = prev.tokens[cmd.tokenId];
      const item0 = t0?.inventory.find((i) => i.id === cmd.itemId);
      if (!t0 || !item0) return fail(prev, 'This item is no longer in your inventory.');
      if ((item0.rev ?? 0) !== cmd.rev) return fail(prev, `“${item0.name}” was changed in the meantime – please look at it again.`);
      const qty = Math.floor(cmd.quantity);
      if (qty < 1 || qty > item0.quantity) return fail(prev, `You have ${item0.quantity} of these.`);
      const offer = sellOffer(m0, t0, item0, qty);
      if ('refused' in offer) return fail(prev, offer.refused);
      if (offer.gold > m0.gold) return fail(prev, `${m0.name} only has ${m0.gold} gold.`);
      if (balanceOf(t0, 'gold') + offer.gold > MAX_CURRENCY) return fail(prev, 'Your purse cannot hold that much gold.');
      if (m0.stock.length >= MERCHANT_LIMITS.stock) return fail(prev, 'The merchant cannot take more goods right now.');
      const state = cloneMerchant(prev);
      state.tokens = { ...state.tokens, [cmd.tokenId]: structuredClone(t0) };
      const t = state.tokens[cmd.tokenId];
      const m = state.merchant!;
      const sold: Item = structuredClone(item0);
      if (qty < item0.quantity) {
        t.inventory = t.inventory.map((i) => (i.id === item0.id ? { ...i, quantity: i.quantity - qty, rev: (i.rev ?? 0) + 1 } : i));
        sold.id = `${item0.id}-s${m.rev}`;
        sold.quantity = qty;
      } else t.inventory = t.inventory.filter((i) => i.id !== item0.id);
      delete sold.container;
      delete sold.prevContainer;
      addHistory(state, sold, `Sold by ${t.name} to ${m.name} for ${offer.gold} gold`);
      setBalance(t, 'gold', balanceOf(t, 'gold') + offer.gold);
      m.gold -= offer.gold;
      // resale price: the reference value (the GM can change it)
      m.stock.push({ id: m.stock.some((s) => s.id === sold.id) ? `${sold.id}-${m.rev}` : sold.id, item: sold, price: itemValue(sold) ?? 1, currency: 'gold' });
      bump(state);
      audit(state, { by: t.name, action: 'trade', tokenId: t.id, itemId: sold.id, itemName: sold.name, detail: `Sold ${qty} × to ${m.name} for ${offer.gold} gold` });
      return { ok: true, state, message: `Sold ${qty > 1 ? `${qty} × ` : ''}${sold.name} for ${offer.gold} gold.` };
    }
  }
}

/** What players see: nothing while closed; otherwise offers (items redacted by the caller's rules) and the purse. */
export function merchantView(state: GameState, redact: (i: Item) => Item): Merchant | null {
  const m = state.merchant;
  if (!m?.active) return null;
  return { ...m, stock: m.stock.map((s) => ({ ...s, item: redact(structuredClone(s.item)) })) };
}
