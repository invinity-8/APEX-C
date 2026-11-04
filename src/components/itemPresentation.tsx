/**
 * Shared item presentation (APEX 0.6): category for filters, sort keys, and the item name badge.
 * Rarity / item level are optional on items (free-text items have neither), so everything degrades to the
 * plain name – narrative items and structured equipment coexist.
 */
import { baseItem } from '../game/items/bases';
import { describeMods } from '../game/items/instance';
import type { Rarity } from '../game/items/rules';
import type { Item } from '../game/types';

export type ItemCategory = 'weapon' | 'armor' | 'accessory' | 'consumable' | 'other';
const RARITY_RANK: Record<Rarity, number> = { normal: 0, magic: 1, rare: 2, unique: 3 };

const meta = (i: Item) => ({ ...i, category: baseItem(i.baseId)?.category as string | undefined });

export function itemCategory(i: Item): ItemCategory {
  const k = i.equip?.kind ?? meta(i).category ?? i.kind;
  if (k === 'weapon' || k === 'focus') return 'weapon';
  if (k === 'armor' || k === 'shield' || k === 'head' || k === 'gloves' || k === 'boots') return 'armor';
  if (k === 'ring' || k === 'amulet' || k === 'cloak' || k === 'belt') return 'accessory';
  if (k === 'consumable' || k === 'currency') return 'consumable';
  return 'other';
}

const byName = (a: Item, b: Item) => a.name.localeCompare(b.name);
export const itemSortKeys: Record<'name' | 'type' | 'quantity' | 'rarity' | 'level', (a: Item, b: Item) => number> = {
  name: byName,
  type: (a, b) => itemCategory(a).localeCompare(itemCategory(b)) || byName(a, b),
  quantity: (a, b) => b.quantity - a.quantity || byName(a, b),
  rarity: (a, b) => RARITY_RANK[meta(b).rarity ?? 'normal'] - RARITY_RANK[meta(a).rarity ?? 'normal'] || byName(a, b),
  level: (a, b) => (meta(b).itemLevel ?? 0) - (meta(a).itemLevel ?? 0) || byName(a, b),
};

export const RARITY_STYLE: Record<Rarity, { label: string; color: string; border: string }> = {
  normal: { label: 'Normal', color: '#c8c3b8', border: 'rgba(200,195,184,.45)' },
  magic: { label: 'Magic', color: '#7da2ff', border: 'rgba(125,162,255,.6)' },
  rare: { label: 'Rare', color: '#e3c25b', border: 'rgba(227,194,91,.7)' },
  unique: { label: 'Unique', color: '#c9733a', border: 'rgba(201,115,58,.7)' },
};

/** Item name with rarity colour AND a text label (never colour alone). */
export function ItemBadges({ item }: { item: Item }) {
  const m = meta(item);
  const r = m.rarity ? RARITY_STYLE[m.rarity] : null;
  return (
    <>
      <span style={r ? { color: r.color } : undefined} data-rarity={m.rarity ?? ''}>
        {m.identified === false ? `Unidentified ${item.name}` : item.name}
      </span>
      {r && m.rarity !== 'normal' && (
        <span className="ml-1.5 rounded px-1 text-[10px] uppercase tracking-wider" style={{ color: r.color, border: `1px solid ${r.border}` }}>
          {r.label}
        </span>
      )}
      {m.itemLevel !== undefined && <span className="ml-1 text-[10px] text-marble-500">ilvl {m.itemLevel}</span>}
      {item.quest && <span className="ml-1.5 rounded border border-gold-400/40 px-1 text-[10px] uppercase tracking-wider text-gold-300">Quest</span>}
    </>
  );
}

/** Modifier lines of an identified item (or the "unidentified" note). Nothing for plain items. */
export function ItemModLines({ item }: { item: Item }) {
  if (item.identified !== false && !item.mods?.length) return null;
  const lines = describeMods(item);
  const color = item.rarity ? RARITY_STYLE[item.rarity].color : undefined;
  return (
    <ul className="text-[11px]" aria-label={`Properties of ${item.name}`}>
      {lines.map((l, i) => (
        <li key={i} style={{ color }} className={item.identified === false ? 'italic text-marble-500' : undefined}>
          {l}
        </li>
      ))}
    </ul>
  );
}
