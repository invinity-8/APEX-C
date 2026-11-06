/**
 * Flexible, free-text inventory (APEX 0.3).
 *
 * The inventory stays where it always was – Token.inventory in the authoritative GameState –
 * so GM and player edit the same record and existing items are preserved. Containers are
 * optional per token; older saves without containers get the default set, and items without
 * a container are shown in a sensible default (weapons/armour → Equipped, rest → Backpack).
 *
 * All changes are commands (see commands.ts). Edits of an existing item must name the item's
 * revision: if another device changed the item in the meantime, the edit is rejected instead
 * of silently overwriting it.
 */
import type { InventoryContainer, Item, Token } from './types.js';

export const DEFAULT_CONTAINERS: readonly InventoryContainer[] = [
  { id: 'backpack', name: 'Backpack' },
  { id: 'pockets', name: 'Pockets' },
  { id: 'side-pouch', name: 'Side Pouch' },
  { id: 'equipped', name: 'Equipped / Worn' },
  { id: 'other', name: 'Other' },
];

export const INVENTORY_LIMITS = {
  items: 300,
  containers: 30,
  name: 200,
  description: 2000,
  notes: 2000,
  containerName: 40,
  quantity: 100000,
};

export function containersOf(t: Pick<Token, 'containers'>): InventoryContainer[] {
  return t.containers?.length ? t.containers : DEFAULT_CONTAINERS.map((c) => ({ ...c }));
}

/** The container an item is shown in. */
export function containerOfItem(item: Item, containers: readonly InventoryContainer[]): string {
  if (item.container && containers.some((c) => c.id === item.container)) return item.container;
  const fallback = item.kind === 'weapon' || item.kind === 'armor' ? 'equipped' : 'backpack';
  if (containers.some((c) => c.id === fallback)) return fallback;
  return containers[containers.length - 1]?.id ?? 'other';
}

/** Makes containers and item containers explicit (called inside commands, on a copy). */
export function materializeInventory(t: Token): void {
  t.containers = containersOf(t);
  for (const i of t.inventory) i.container = containerOfItem(i, t.containers);
}

/** Stacks may be split/merged only when nothing makes copies distinguishable (no equipment or item-system data). */
export function isStackable(i: Item): boolean {
  return !i.equip && !i.rarity && i.itemLevel === undefined && !(i.mods?.length) && !i.uniqueId && !i.charge && !i.quest && !i.grant;
}
export function canMerge(a: Item, b: Item, containers: readonly InventoryContainer[] = DEFAULT_CONTAINERS): boolean {
  return isStackable(a) && isStackable(b)
    && containerOfItem(a, containers) === containerOfItem(b, containers)
    && a.name.trim().toLowerCase() === b.name.trim().toLowerCase()
    && (a.description ?? '') === (b.description ?? '')
    && (a.notes ?? '') === (b.notes ?? '')
    && a.kind === b.kind
    && a.baseId === b.baseId
    && a.itemLevel === b.itemLevel
    && a.weightKg === b.weightKg
    && a.identified === b.identified
    && a.bound === b.bound
    && a.locked === b.locked
    && JSON.stringify(a.source) === JSON.stringify(b.source)
    && JSON.stringify(a.history) === JSON.stringify(b.history);
}
