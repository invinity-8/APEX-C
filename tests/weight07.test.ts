import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { carryLoad, holdingContainerId, itemWeightKg, itemWeightGrams, lbToKg } from '../src/game/items/weight';
import type { GameState } from '../src/game/types';

const GM = { role: 'gm' as const };
const P = { role: 'player' as const, tokenId: 'sinna' };
function run(s: GameState, c: Command, actor: typeof GM | typeof P = P, seed?: number) {
  const r = executeCommand(s, actor, (seed !== undefined ? { ...c, seed } : c) as Command);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
const refuse = (s: GameState, c: Command, actor: typeof GM | typeof P = P) => {
  const r = executeCommand(s, actor, c);
  return r.ok ? null : r.error;
};
const give = (s: GameState, baseId: string, id: string, quantity?: number) =>
  run(s, { type: 'arsenalGenerate', stagedId: id, baseId, rarity: 'normal', itemLevel: 1, identified: true, giveTo: 'sinna', ...(quantity ? { quantity } : {}) }, GM, 1);
function fresh() {
  const s = createDemoState({ radius: 6, seed: 3 });
  s.tokens.sinna.inventory = [];
  s.tokens.sinna.equipment = undefined;
  s.tokens.sinna.containers = undefined;
  return s;
}

describe('carry weight (kg)', () => {
  it('converts SRD pounds once and counts equipped items exactly once', () => {
    let s = give(fresh(), 'srd-plate-armor', 'plate');
    expect(itemWeightKg(s.tokens.sinna.inventory[0])).toBe(lbToKg(65));
    const before = carryLoad(s.tokens.sinna, 15, 0, false).loadKg;
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'plate', slot: 'chest' });
    expect(carryLoad(s.tokens.sinna, 15, 0, false).loadKg).toBe(before); // equipping changes nothing
    expect(carryLoad(s.tokens.sinna, 15, 0, false).capacityKg).toBe(lbToKg(225));
  });

  it('free-text items weigh what the player enters; quantities multiply; carry modifiers raise capacity', () => {
    let s = run(fresh(), { type: 'invAddItem', tokenId: 'sinna', itemId: 'rock', name: 'Strange rock', quantity: 3, weightKg: 2.5 }, GM);
    expect(carryLoad(s.tokens.sinna, 10, 0, false).loadKg).toBe(7.5);
    s = run(s, { type: 'invUpdateItem', tokenId: 'sinna', itemId: 'rock', rev: 0, weightKg: 1 });
    expect(carryLoad(s.tokens.sinna, 10, 0, false).loadKg).toBe(3);
    expect(carryLoad(s.tokens.sinna, 10, 20, false).capacityKg).toBe(lbToKg(170));
  });

  it('stores manual weights at gram precision and includes small items without rounding each one away', () => {
    const s = run(fresh(), { type: 'invAddItem', tokenId: 'sinna', itemId: 'paper', name: 'Letter', quantity: 3, weightKg: 0.001 }, GM);
    const item = s.tokens.sinna.inventory[0];
    expect(itemWeightGrams(item)).toBe(1);
    expect(itemWeightKg(item)).toBe(0.001);
    expect(carryLoad(s.tokens.sinna, 10, 0, false).loadKg).toBe(0.003);
  });

  it('standard rule: over capacity only; variant: encumbered above STR×5 lb, heavily above STR×10 lb', () => {
    const s = run(fresh(), { type: 'invAddItem', tokenId: 'sinna', itemId: 'load', name: 'Crate', weightKg: lbToKg(60) }, GM);
    expect(carryLoad(s.tokens.sinna, 10, 0, false).state).toBe('ok');
    expect(carryLoad(s.tokens.sinna, 10, 0, true).state).toBe('encumbered');
    expect(carryLoad(s.tokens.sinna, 5, 0, true).state).toBe('heavily');
    expect(carryLoad(s.tokens.sinna, 3, 0, true).state).toBe('over');
    expect(carryLoad(s.tokens.sinna, null, 0, true)).toMatchObject({ assumedStrength: true, state: carryLoad(s.tokens.sinna, 10, 0, true).state }); // no STR → STR 10 assumed
  });
});

describe('Bag of Holding', () => {
  it('unlocks its own container; contents do not count, the bag (15 lb) does', () => {
    let s = give(fresh(), 'srd-bag-of-holding', 'bag');
    const hold = holdingContainerId('bag');
    expect(s.tokens.sinna.containers!.find((c) => c.id === hold)).toMatchObject({ holding: 'bag' });
    s = give(s, 'srd-chain-mail', 'mail');
    const before = carryLoad(s.tokens.sinna, 15, 0, false);
    expect(before.loadKg).toBe(lbToKg(15) + lbToKg(55));
    s = run(s, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'mail', rev: 0, container: hold });
    const after = carryLoad(s.tokens.sinna, 15, 0, false);
    expect(after.loadKg).toBe(lbToKg(15));
    expect(after.bags[0].contentsKg).toBe(lbToKg(55));
  });

  it('enforces 500 lb, refuses nesting, refuses deleting a filled bag or its container', () => {
    let s = give(fresh(), 'srd-bag-of-holding', 'bag');
    s = give(s, 'srd-bag-of-holding', 'bag2');
    const hold = holdingContainerId('bag');
    expect(refuse(s, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'bag2', rev: 0, container: hold })).toMatch(/cannot be placed inside/);
    expect(refuse(s, { type: 'invAddItem', tokenId: 'sinna', itemId: 'anvil', name: 'Anvil', weightKg: 300, container: hold }, GM)).toMatch(/holds at most/);
    s = run(s, { type: 'invAddItem', tokenId: 'sinna', itemId: 'gem', name: 'Gem', weightKg: 0.1, container: hold }, GM);
    expect(refuse(s, { type: 'invRemoveItem', tokenId: 'sinna', itemId: 'bag', rev: 0 })).toMatch(/Empty/);
    expect(refuse(s, { type: 'invRemoveContainer', tokenId: 'sinna', containerId: hold })).toMatch(/belongs to a Bag of Holding/);
    expect(refuse(s, { type: 'invUpdateItem', tokenId: 'sinna', itemId: 'gem', rev: 0, weightKg: 400 })).toMatch(/holds at most/);
  });

  it('contents travel with the bag (revoke → tray → another character) without duplication', () => {
    let s = give(fresh(), 'srd-bag-of-holding', 'bag');
    const hold = holdingContainerId('bag');
    s = run(s, { type: 'invAddItem', tokenId: 'sinna', itemId: 'gem', name: 'Gem', weightKg: 0.1, container: hold }, GM);
    s = run(s, { type: 'gmRevokeItem', tokenId: 'sinna', itemId: 'bag' }, GM);
    expect(s.tokens.sinna.inventory.some((i) => i.id === 'gem' || i.id === 'bag')).toBe(false);
    expect(s.tokens.sinna.containers!.some((c) => c.id === hold)).toBe(false);
    const staged = s.arsenal!.staged.find((i) => i.id === 'bag')!;
    expect(staged.held!.map((i) => i.id)).toEqual(['gem']);
    expect(refuse(s, { type: 'arsenalDiscard', stagedId: 'bag' }, GM)).toMatch(/still holds/);
    s = run(s, { type: 'arsenalGive', stagedId: 'bag', tokenId: 'aster' }, GM);
    const aster = s.tokens.aster;
    expect(aster.inventory.find((i) => i.id === 'gem')?.container).toBe(hold);
    expect(aster.inventory.find((i) => i.id === 'bag')?.held).toBeUndefined();
    const all = Object.values(s.tokens).flatMap((t) => t.inventory).filter((i) => i.id === 'gem');
    expect(all).toHaveLength(1);
  });

  it('an orphaned holding container is recovered, never deleted', () => {
    let s = give(fresh(), 'srd-bag-of-holding', 'bag');
    s = run(s, { type: 'invAddItem', tokenId: 'sinna', itemId: 'gem', name: 'Gem', container: holdingContainerId('bag') }, GM);
    // simulate a hand-edited save where the bag vanished
    s.tokens.sinna.inventory = s.tokens.sinna.inventory.filter((i) => i.id !== 'bag');
    s = run(s, { type: 'invAddItem', tokenId: 'sinna', itemId: 'x', name: 'x' }, GM);
    expect(s.tokens.sinna.inventory.find((i) => i.id === 'gem')?.container).toBe('recovered');
  });
});

