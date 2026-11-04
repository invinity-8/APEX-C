/**
 * Bag of Holding (APEX 0.7) – SRD 5.1 wondrous item: weighs 15 lb, holds up to 500 lb (64 cubic feet).
 *
 * Persistent identity: the bag's container id is derived from the bag's item id (`hold-<itemId>`), so the
 * container belongs to that exact bag. While the bag is in a character's inventory its contents are ordinary
 * inventory items in that container (their weight does not count towards the character's load – only the bag's).
 * When the bag LEAVES a character (GM revoke, later transfers) the contents are packed into the bag item (`held`)
 * and travel with it; when it arrives at a character they are unpacked again. Nothing is duplicated or deleted:
 *  - a bag that still holds items cannot be deleted, discarded or salvaged ("empty it first");
 *  - a bag can never be put into a bag (SRD: that would destroy both – APEX simply refuses);
 *  - the 500 lb capacity is enforced;
 *  - recovery policy: if a holding container ever loses its bag (e.g. an old save edited by hand), its items are
 *    moved to a "Recovered from a Bag of Holding" container for the GM to sort out – never silently deleted.
 */
import type { InventoryContainer, Item, Token } from '../types.js';
import { containersOf } from '../inventory.js';
import { BAG_CAPACITY_KG, bagContentsKg, holdingContainerId, isBagOfHolding, itemWeightKg } from './weight.js';

export const RECOVERED_CONTAINER = 'recovered';

/** Makes containers match the bags the character owns; unpacks arriving bags. Mutates `t` (call on a copy). */
export function syncHolding(t: Token): void {
  const bags = t.inventory.filter(isBagOfHolding);
  const hasHoldingContainers = (t.containers ?? []).some((c) => c.holding);
  if (!bags.length && !hasHoldingContainers) return;
  let containers: InventoryContainer[] = containersOf(t).map((c) => ({ ...c }));
  for (const bag of bags) {
    const id = holdingContainerId(bag.id);
    if (!containers.some((c) => c.id === id)) containers.push({ id, name: bag.name || 'Bag of Holding', holding: bag.id });
    if (bag.held?.length) {
      const taken = new Set(t.inventory.map((i) => i.id));
      for (const h of bag.held) {
        if (taken.has(h.id)) continue; // never duplicate an id that already exists
        t.inventory.push({ ...h, container: id });
        taken.add(h.id);
      }
    }
    delete bag.held;
  }
  // a holding container whose bag is gone: recover its items, never delete them
  const live = new Set(bags.map((b) => holdingContainerId(b.id)));
  const orphan = containers.filter((c) => c.holding && !live.has(c.id)).map((c) => c.id);
  if (orphan.length) {
    if (!containers.some((c) => c.id === RECOVERED_CONTAINER)) containers.push({ id: RECOVERED_CONTAINER, name: 'Recovered from a Bag of Holding' });
    for (const i of t.inventory) if (i.container && orphan.includes(i.container)) i.container = RECOVERED_CONTAINER;
    containers = containers.filter((c) => !orphan.includes(c.id));
  }
  t.containers = containers;
}

/** Removes the bag's contents from the inventory and packs them into the bag (the bag item must be removed by the caller). */
export function packBag(t: Token, bag: Item): Item {
  const id = holdingContainerId(bag.id);
  const held = t.inventory.filter((i) => i.container === id);
  t.inventory = t.inventory.filter((i) => i.container !== id);
  t.containers = (t.containers ?? []).filter((c) => c.id !== id);
  return { ...bag, ...(held.length ? { held: held.map((h) => ({ ...h, container: undefined })) } : {}) };
}

export function bagItemCount(t: Pick<Token, 'inventory'>, bag: Item): number {
  const id = holdingContainerId(bag.id);
  return t.inventory.filter((i) => i.container === id).length;
}

/** Why `item` (quantity `qty`) may not go into container `container`, or null. */
export function holdingRefusal(t: Token, item: Pick<Item, 'id' | 'baseId' | 'weightKg' | 'quantity'>, container: string, qty = item.quantity): string | null {
  const bag = t.inventory.find((b) => isBagOfHolding(b) && holdingContainerId(b.id) === container);
  if (!bag) return null;
  if (isBagOfHolding(item)) return 'A Bag of Holding cannot be placed inside a Bag of Holding (it would destroy both).';
  const already = t.inventory.find((i) => i.id === item.id)?.container === container ? itemWeightKg(item) * item.quantity : 0;
  const after = bagContentsKg(t, bag.id) - already + itemWeightKg(item) * qty;
  if (after > BAG_CAPACITY_KG + 1e-9) return `${bag.name} holds at most ${BAG_CAPACITY_KG} kg (500 lb) – it would hold ${Math.round(after * 10) / 10} kg.`;
  return null;
}
