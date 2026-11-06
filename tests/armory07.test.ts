import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { deriveStats, itemBonuses } from '../src/game/equipment';
import { baseItem } from '../src/game/items/bases';
import { seededRng } from '../src/game/items/generate';
import { createItem } from '../src/game/items/instance';
import { transmuteTable } from '../src/game/items/loot';
import { modifier, MODIFIERS } from '../src/game/items/modifiers';
import { AFFIX_RULES, itemRulesOf } from '../src/game/items/rules';
import { emptySheet } from '../src/game/sheet';
import type { GameState, Item, RolledMod } from '../src/game/types';
import { parseCommand } from '../src/server/validate';

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
const item = (s: GameState, id: string) => s.tokens.sinna.inventory.find((i) => i.id === id)!;
const make = (baseId: string, id: string, rarity: 'normal' | 'magic' | 'rare', mods: RolledMod[], ilvl = 20): Item => ({
  ...createItem(baseItem(baseId)!, { id, rarity, itemLevel: ilvl, rng: seededRng(1), mods }),
  container: 'backpack',
});
function fresh(items: Item[] = [], currency: Record<string, number> = {}) {
  const s = createDemoState({ radius: 6, seed: 3 });
  s.tokens.sinna.inventory = items;
  s.tokens.sinna.equipment = undefined;
  s.tokens.sinna.containers = undefined;
  s.tokens.sinna.currency = currency;
  s.tokens.sinna.currencyRev = 0;
  return s;
}

describe('equipment location sync', () => {
  it('equipped items live in Equipped / Worn and return to their previous container', () => {
    const sword = make('srd-longsword', 'sw', 'normal', []);
    sword.container = 'pockets';
    const axe = make('srd-battleaxe', 'ax', 'normal', []);
    let s = fresh([sword, axe]);
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'sw', slot: 'main1' });
    expect(item(s, 'sw')).toMatchObject({ container: 'equipped', prevContainer: 'pockets' });
    // replacing the item in the slot sends the old one back
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'ax', slot: 'main1' });
    expect(item(s, 'sw').container).toBe('pockets');
    expect(item(s, 'sw').prevContainer).toBeUndefined();
    expect(item(s, 'ax').container).toBe('equipped');
    // weapon set 2 and resting keep the item worn (only inactive)
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'sw', slot: 'main2' });
    s = run(s, { type: 'setWeaponSet', tokenId: 'sinna', set: 2 });
    s = run(s, { type: 'setResting', tokenId: 'sinna', resting: true });
    expect(item(s, 'sw').container).toBe('equipped');
    s = run(s, { type: 'unequipSlot', tokenId: 'sinna', slot: 'main2' });
    expect(item(s, 'sw').container).toBe('pockets');
    expect(s.tokens.sinna.inventory).toHaveLength(2); // nothing duplicated
  });

  it('worn items cannot be moved away and equipment is not "worn" by moving it', () => {
    let s = fresh([make('srd-longsword', 'sw', 'normal', [])]);
    s = run(s, { type: 'invAddItem', tokenId: 'sinna', itemId: 'cape', name: 'Red festival cape' }, GM);
    expect(refuse(s, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'sw', rev: 0, container: 'equipped' })).toMatch(/Use “Equip”/);
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'sw', slot: 'main1' });
    expect(refuse(s, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'sw', rev: 0, container: 'backpack' })).toMatch(/unequip it first/);
    // narrative items may still be placed in Equipped / Worn
    s = run(s, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'cape', rev: 0, container: 'equipped' });
    expect(item(s, 'cape').container).toBe('equipped');
  });

  it('a missing Equipped / Worn container is created when needed', () => {
    let s = fresh([make('srd-longsword', 'sw', 'normal', [])]);
    s.tokens.sinna.containers = [{ id: 'bag', name: 'Bag' }];
    s.tokens.sinna.inventory[0].container = 'bag';
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'sw', slot: 'main1' });
    expect(s.tokens.sinna.containers!.map((c) => c.id)).toEqual(['bag', 'equipped']);
    s = run(s, { type: 'unequipSlot', tokenId: 'sinna', slot: 'main1' });
    expect(item(s, 'sw').container).toBe('bag');
  });

  it('body type is cosmetic only', () => {
    const s = fresh();
    const before = structuredClone(s.tokens.sinna);
    const next = run(s, { type: 'setAppearance', tokenId: 'sinna', bodyType: 'feminine' });
    expect(next.tokens.sinna.bodyType).toBe('feminine');
    expect({ ...next.tokens.sinna, bodyType: undefined }).toEqual({ ...before, bodyType: undefined });
    expect(parseCommand({ type: 'setAppearance', tokenId: 'sinna', bodyType: 'dragon' }).ok).toBe(false);
  });
});

describe('Orb of Augmentation', () => {
  it('adds exactly one eligible modifier, respects the rarity cap and keeps existing ones', () => {
    const ring = make('apex-silver-ring', 'r', 'magic', [{ modId: 'res-fire', tier: 1, value: 7 }]);
    let s = fresh([ring], { augment: 3 });
    s = run(s, { type: 'itemAugment', tokenId: 'sinna', itemId: 'r', rev: 0 }, P, 11);
    const r = item(s, 'r');
    expect(r.mods).toHaveLength(2);
    expect(r.mods).toContainEqual({ modId: 'res-fire', tier: 1, value: 7 });
    const defs = r.mods!.map((m) => modifier(m.modId)!);
    expect(defs.filter((d) => d.affix === 'prefix')).toHaveLength(1); // magic: 1 prefix + 1 suffix
    expect(s.tokens.sinna.currency!.augment).toBe(2);
    expect(refuse(s, { type: 'itemAugment', tokenId: 'sinna', itemId: 'r', rev: 1, seed: 1 })).toMatch(/No free affix slot/);
    expect(s.tokens.sinna.currency!.augment).toBe(2); // nothing consumed on refusal
  });

  it('refuses normal, unidentified and orb-less items without spending anything', () => {
    const plain = make('srd-longsword', 'n', 'normal', []);
    const hidden = { ...make('apex-silver-ring', 'h', 'magic', [{ modId: 'res-fire', tier: 1, value: 7 }]), identified: false };
    const s = fresh([plain, hidden], { augment: 1 });
    expect(refuse(s, { type: 'itemAugment', tokenId: 'sinna', itemId: 'n', rev: 0, seed: 1 })).toMatch(/Ascension first/);
    expect(refuse(s, { type: 'itemAugment', tokenId: 'sinna', itemId: 'h', rev: 0, seed: 1 })).toMatch(/Identify/);
    const none = fresh([make('apex-silver-ring', 'r', 'magic', [{ modId: 'res-fire', tier: 1, value: 7 }])]);
    expect(refuse(none, { type: 'itemAugment', tokenId: 'sinna', itemId: 'r', rev: 0, seed: 1 })).toMatch(/Requires 1 Orb of Augmentation/);
  });
});

describe('Orb of Ascension', () => {
  it('Normal → Magic → Rare, keeping base, item level and existing modifiers', () => {
    let s = fresh([make('srd-longsword', 'sw', 'normal', [], 15)], { ascend: 2 });
    s = run(s, { type: 'itemAscend', tokenId: 'sinna', itemId: 'sw', rev: 0 }, P, 5);
    const magic = item(s, 'sw');
    expect(magic).toMatchObject({ rarity: 'magic', baseId: 'srd-longsword', itemLevel: 15 });
    expect(magic.mods).toHaveLength(1);
    s = run(s, { type: 'itemAscend', tokenId: 'sinna', itemId: 'sw', rev: 1 }, P, 6);
    const rare = item(s, 'sw');
    expect(rare.rarity).toBe('rare');
    expect(rare.mods!.length).toBeGreaterThanOrEqual(AFFIX_RULES.rare.min);
    expect(rare.mods).toContainEqual(magic.mods![0]);
    expect(new Set(rare.mods!.map((m) => modifier(m.modId)!.family)).size).toBe(rare.mods!.length);
    for (const m of rare.mods!) expect(modifier(m.modId)!.tiers.find((x) => x.tier === m.tier)!.ilvl).toBeLessThanOrEqual(15);
    expect(s.tokens.sinna.currency!.ascend).toBe(0);
    expect(refuse(run(s, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'ascend', amount: 1 }, GM), { type: 'itemAscend', tokenId: 'sinna', itemId: 'sw', rev: 2, seed: 1 })).toMatch(/Rare is the highest/);
  });
});

describe('Arcane Transmutation', () => {
  it('server-random Orbs by weight, atomic, no double spend', () => {
    let s = fresh([], { fragment: 10_000 });
    s.tokens.sinna.cubeAccess = true; // APEX 0.7: Arcane Transmutation needs the cube
    const n = 900;
    s = run(s, { type: 'transmuteFragments', tokenId: 'sinna', sets: n, currencyRev: 0 } as Command, P, 42);
    const c = s.tokens.sinna.currency!;
    expect(c.fragment).toBe(10_000 - n * 10);
    expect((c.orb ?? 0) + (c.augment ?? 0) + (c.ascend ?? 0)).toBe(n);
    expect(Math.abs((c.orb ?? 0) / n - 0.65)).toBeLessThan(0.06);
    expect(Math.abs((c.augment ?? 0) / n - 0.3)).toBeLessThan(0.06);
    expect(Math.abs((c.ascend ?? 0) / n - 0.05)).toBeLessThan(0.03);
    expect(s.tokens.sinna.lastTransmute?.rev).toBe(s.tokens.sinna.currencyRev);
    expect(refuse(s, { type: 'transmuteFragments', tokenId: 'sinna', sets: 1, currencyRev: 0, seed: 1 })).toMatch(/changed in the meantime/);
    const poor = fresh([], { fragment: 9 });
    poor.tokens.sinna.cubeAccess = true;
    expect(refuse(poor, { type: 'transmuteFragments', tokenId: 'sinna', sets: 1, currencyRev: 0, seed: 1 })).toMatch(/Requires 10/);
    expect(parseCommand({ type: 'transmuteFragments', tokenId: 'sinna', sets: 1, currencyRev: 0, seed: 7 }).ok && 'seed' in (parseCommand({ type: 'transmuteFragments', tokenId: 'sinna', sets: 1, currencyRev: 0, seed: 7 }) as { command: object }).command).toBe(false);
  });

  it('the GM changes weights and cost', () => {
    const rules = itemRulesOf({ itemRules: { transmuteWeightRenewal: 0, transmuteWeightAugment: 0, transmuteWeightAscension: 1, fragmentsPerRandomOrb: 4 } });
    expect(transmuteTable(rules).filter((x) => x.weight > 0).map((x) => x.value)).toEqual(['ascend']);
    const base = fresh([], { fragment: 8 });
    base.tokens.sinna.cubeAccess = true;
    let s = run(base, { type: 'setItemRules', rules: { transmuteWeightRenewal: 0, transmuteWeightAugment: 0, transmuteWeightAscension: 1, fragmentsPerRandomOrb: 4 } }, GM);
    s = run(s, { type: 'transmuteFragments', tokenId: 'sinna', sets: 2, currencyRev: 0 } as Command, P, 3);
    expect(s.tokens.sinna.currency).toMatchObject({ fragment: 0, ascend: 2 });
  });
});

describe('flavour modifiers', () => {
  it('are marked situational/cosmetic and never added to automatic totals', () => {
    const flavour = MODIFIERS.filter((m) => m.flavor);
    expect(flavour.length).toBeGreaterThanOrEqual(6);
    for (const m of flavour) expect(['situational', 'cosmetic']).toContain(m.effect.type);
    const cloak = make('apex-travelling-cloak', 'c', 'rare', [{ modId: 'hearth', tier: 1, value: 10 }, { modId: 'res-cold', tier: 1, value: 5 }]);
    const b = itemBonuses([{ slot: 'cloak', item: cloak }]);
    expect(b.resistances.cold.total).toBe(5); // environmental-cold flavour is not counted
  });
});

describe('Niri’s Timetwister', () => {
  const setup = () => {
    let s = fresh();
    s = run(s, { type: 'arsenalGenerateUnique', stagedId: 'niri', uniqueId: 'niris-timetwister', giveTo: 'sinna' }, GM);
    return s;
  };
  it('is created by the GM only, never by random generation', () => {
    expect(refuse(fresh(), { type: 'arsenalGenerateUnique', stagedId: 'x', uniqueId: 'niris-timetwister', giveTo: 'sinna' })).toBeTruthy();
    expect(parseCommand({ type: 'arsenalGenerate', stagedId: 'x', baseId: 'apex-imperial-medallion', rarity: 'unique', itemLevel: 20, identified: true }).ok).toBe(false);
    const n = item(setup(), 'niri');
    expect(n).toMatchObject({ rarity: 'unique', uniqueId: 'niris-timetwister', charge: { spent: false } });
  });

  it('activates once while worn, the postponed turn belongs to the character, and the GM resolves it', () => {
    let s = setup();
    expect(refuse(s, { type: 'itemActivate', tokenId: 'sinna', itemId: 'niri', rev: 0 })).toMatch(/Wear it/);
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'niri', slot: 'amulet' });
    s = run(s, { type: 'itemActivate', tokenId: 'sinna', itemId: 'niri', rev: 0 });
    expect(s.tokens.sinna.timeTwist).toMatchObject({ itemId: 'niri' });
    expect(item(s, 'niri').charge!.spent).toBe(true);
    expect(s.log.at(-1)!.text).toMatch(/twists time/);
    // retry with the old revision or a new one: refused (no second postponed turn)
    expect(refuse(s, { type: 'itemActivate', tokenId: 'sinna', itemId: 'niri', rev: 0 })).toBeTruthy();
    expect(refuse(s, { type: 'itemActivate', tokenId: 'sinna', itemId: 'niri', rev: 1 })).toMatch(/Spent/);
    // taking the amulet off does not take the pending turn with it
    s = run(s, { type: 'unequipSlot', tokenId: 'sinna', slot: 'amulet' });
    expect(s.tokens.sinna.timeTwist).toBeDefined();
    expect(refuse(s, { type: 'gmTimeTwist', tokenId: 'sinna', action: 'resolve' })).toBeTruthy(); // player cannot resolve
    s = run(s, { type: 'gmTimeTwist', tokenId: 'sinna', action: 'resolve' }, GM);
    expect(s.tokens.sinna.timeTwist).toBeUndefined();
    expect(refuse(s, { type: 'gmTimeTwist', tokenId: 'sinna', action: 'resolve' }, GM)).toMatch(/No postponed turn/);
    s = run(s, { type: 'gmRechargeItem', tokenId: 'sinna', itemId: 'niri' }, GM);
    expect(item(s, 'niri').charge!.spent).toBe(false);
  });

  it('cannot be salvaged, rerolled, augmented or ascended', () => {
    const s = setup();
    s.tokens.sinna.currency = { orb: 1, augment: 1, ascend: 1 };
    expect(refuse(s, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'niri', rev: 0 })).toMatch(/Unique/);
    expect(refuse(s, { type: 'itemReroll', tokenId: 'sinna', itemId: 'niri', rev: 0, seed: 1 })).toBeTruthy();
    expect(refuse(s, { type: 'itemAugment', tokenId: 'sinna', itemId: 'niri', rev: 0, seed: 1 })).toBeTruthy();
    expect(refuse(s, { type: 'itemAscend', tokenId: 'sinna', itemId: 'niri', rev: 0, seed: 1 })).toBeTruthy();
  });

  it('its fixed +2 initiative counts while worn', () => {
    let s = setup();
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'niri', slot: 'amulet' });
    expect(deriveStats(emptySheet(), s.tokens.sinna).bonuses.initiative.value).toBe(2);
  });
});

