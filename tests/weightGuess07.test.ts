import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { estimateWeightKg, estimateWeightLb } from '../src/game/items/weightGuess';
import { carryLoad, itemWeightKg } from '../src/game/items/weight';
import { stripLegacy } from '../src/game/migrate';

describe('rough weights for free-text items', () => {
  it('uses SRD catalogue and gear weights, keywords and a small default', () => {
    expect(estimateWeightLb('Longsword')).toBe(3);
    expect(estimateWeightLb('Chain Mail')).toBe(55);
    expect(estimateWeightLb('Leather Armor +1')).toBe(10);
    expect(estimateWeightLb("Explorer's Pack")).toBe(59);
    expect(estimateWeightLb('Rope, Hempen (50 feet)')).toBe(10);
    expect(estimateWeightLb('Arrows')).toBe(0.05);
    expect(estimateWeightLb('Druidic Focus (Yew Wand)')).toBe(1);
    expect(estimateWeightLb('Elven Moonblade Sword')).toBe(3);
    expect(estimateWeightLb('Strange Trinket from Home')).toBe(0);
    expect(estimateWeightLb('Mysterious Thingamajig')).toBe(0.5);
    expect(estimateWeightLb('Gladius')).toBe(3); // Roman gear seen in the live campaign
    expect(estimateWeightLb('Scutum')).toBe(6);
    expect(estimateWeightLb('Tent, Two—Person')).toBe(20);
    expect(estimateWeightKg('Chain Mail')).toBe(24.95);
    expect(estimateWeightKg('Backpack')).toBe(2.25);
  });

  it('existing items without a weight are back-filled once; explicit weights stay', () => {
    const s = createDemoState({ radius: 4, seed: 1 });
    s.tokens.sinna.inventory = [
      { id: 'a', name: 'Chain Mail', kind: 'misc', description: '', quantity: 1 },
      { id: 'b', name: 'Torch', kind: 'misc', description: '', quantity: 5 },
      { id: 'c', name: 'Feather', kind: 'misc', description: '', quantity: 1, weightKg: 0 },
      { id: 'd', name: 'Longsword', kind: 'weapon', description: '', quantity: 1, baseId: 'srd-longsword' },
    ];
    expect(stripLegacy(s)).toBe(true);
    const inv = s.tokens.sinna.inventory;
    expect(inv.map((i) => i.weightKg)).toEqual([24.95, 0.45, 0, undefined]);
    expect(itemWeightKg(inv[3])).toBeCloseTo(1.36, 2);
    expect(stripLegacy(s)).toBe(false); // idempotent
    const load = carryLoad({ inventory: inv, currency: { gold: 100 } }, null, 0, false);
    expect(load.assumedStrength).toBe(true);
    expect(load.capacityKg).toBeCloseTo(68.04, 1); // STR 10 × 15 lb
    expect(load.coinsKg).toBeCloseTo(0.91, 2); // 100 gp = 2 lb
    expect(load.loadKg).toBeCloseTo(24.95 + 5 * 0.45 + 1.36 + 0.91, 1);
  });

  it('new free-text items (manual or imported) get an estimate unless a weight is given', () => {
    const s = createDemoState({ radius: 4, seed: 1 });
    const P = { role: 'player' as const, tokenId: 'sinna' };
    let r = executeCommand(s, P, { type: 'invAddItem', tokenId: 'sinna', itemId: 'x1', name: 'Bedroll' });
    expect(r.ok && r.state.tokens.sinna.inventory.find((i) => i.id === 'x1')!.weightKg).toBe(3.2);
    r = executeCommand(r.state, P, { type: 'invAddItem', tokenId: 'sinna', itemId: 'x2', name: 'Bedroll', weightKg: 1 });
    expect(r.ok && r.state.tokens.sinna.inventory.find((i) => i.id === 'x2')!.weightKg).toBe(1);
  });
});
