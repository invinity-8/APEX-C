import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import type { GameState } from '../src/game/types';

const P = { role: 'player' as const, tokenId: 'sinna' };
function run(s: GameState, c: Command, actor: typeof P | { role: 'gm' } = P) {
  const r = executeCommand(s, actor, c);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
function setup() {
  let s = createDemoState({ radius: 6, seed: 1 });
  s.tokens.sinna.inventory = [];
  for (const [id, name, q] of [['a', 'Rope', 1], ['b', 'Torch', 6], ['c', 'Old iron key wrapped in red cloth', 1], ['d', 'Torch', 2]] as const)
    s = run(s, { type: 'invAddItem', tokenId: 'sinna', itemId: id, name, quantity: q }, { role: 'gm' });
  return s;
}
const ids = (s: GameState) => s.tokens.sinna.inventory.map((i) => i.id);
const rev = (s: GameState, id: string) => s.tokens.sinna.inventory.find((i) => i.id === id)!.rev ?? 0;

describe('inventory usability (APEX 0.6)', () => {
  it('reorders inside a container and the order persists in the state', () => {
    let s = setup();
    s = run(s, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'c', rev: 0, container: 'backpack', beforeItemId: 'a' });
    expect(ids(s)).toEqual(['c', 'a', 'b', 'd']);
    s = run(s, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'c', rev: 1, container: 'backpack' }); // to the end
    expect(ids(s)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('moves between containers; stale revisions are refused (no silent overwrite)', () => {
    let s = setup();
    s = run(s, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'a', rev: 0, container: 'pockets' });
    expect(s.tokens.sinna.inventory.find((i) => i.id === 'a')!.container).toBe('pockets');
    expect(executeCommand(s, P, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'a', rev: 0, container: 'backpack' }).ok).toBe(false);
    expect(executeCommand(s, P, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'a', rev: rev(s, 'a'), container: 'nowhere' }).ok).toBe(false);
  });

  it('splits and merges stacks without creating or losing units', () => {
    let s = setup();
    s = run(s, { type: 'invSplitStack', tokenId: 'sinna', itemId: 'b', rev: 0, quantity: 2, newItemId: 'b2' });
    const total = () => s.tokens.sinna.inventory.filter((i) => i.name === 'Torch').reduce((n, i) => n + i.quantity, 0);
    expect(total()).toBe(8);
    expect(s.tokens.sinna.inventory.find((i) => i.id === 'b2')!.quantity).toBe(2);
    expect(executeCommand(s, P, { type: 'invSplitStack', tokenId: 'sinna', itemId: 'b', rev: rev(s, 'b'), quantity: 4, newItemId: 'x' }).ok).toBe(false); // whole stack
    s = run(s, { type: 'invMergeStack', tokenId: 'sinna', itemId: 'b2', rev: 0, intoItemId: 'd', intoRev: 0 });
    expect(total()).toBe(8);
    expect(ids(s)).not.toContain('b2');
    expect(executeCommand(s, P, { type: 'invMergeStack', tokenId: 'sinna', itemId: 'a', rev: 0, intoItemId: 'b', intoRev: rev(s, 'b') }).ok).toBe(false); // different items
  });

  it('equipment-defined items are not stackable; other players cannot touch the inventory', () => {
    let s = setup();
    s = run(s, { type: 'setItemEquip', tokenId: 'sinna', itemId: 'b', rev: 0, equip: { kind: 'weapon', damage: '1d4' } }, { role: 'gm' });
    expect(executeCommand(s, P, { type: 'invSplitStack', tokenId: 'sinna', itemId: 'b', rev: 1, quantity: 1, newItemId: 'z' }).ok).toBe(false);
    expect(executeCommand(s, { role: 'player', tokenId: 'aster' }, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'a', rev: 0, container: 'pockets' }).ok).toBe(false);
  });
});

