import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { deriveStats } from '../src/game/equipment';
import { BASE_ITEMS, baseItem } from '../src/game/items/bases';
import { randInt, rollMods, seededRng, weightedPick } from '../src/game/items/generate';
import { createItem, describeMods, redactItem, validateMods } from '../src/game/items/instance';
import { MODIFIERS, eligibleMods, modifier } from '../src/game/items/modifiers';
import { applyDamage, resistanceLabel, resistanceReduction } from '../src/game/items/resistance';
import { AFFIX_RULES, DEFAULT_ITEM_RULES, itemRulesOf } from '../src/game/items/rules';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import type { GameState, Item, RolledMod } from '../src/game/types';
import { buildGmView, buildPlayerView } from '../src/game/visibility';
import { parseCommand } from '../src/server/validate';

const sheet: CharacterSheet = {
  ...emptySheet(),
  attributes: [
    { id: 'a1', name: 'Strength', value: '14', modifier: '+2' },
    { id: 'a2', name: 'Dexterity', value: '12', modifier: '+1' },
  ],
  combat: [
    { id: 'c1', label: 'Armor Class', value: '13' },
    { id: 'c2', label: 'Proficiency bonus', value: '+2' },
  ],
};
const P = { role: 'player' as const, tokenId: 'sinna' };
const GM = { role: 'gm' as const };
const rng = seededRng(12345);
const make = (baseId: string, id: string, mods: RolledMod[], extra: Partial<Item> = {}): Item => ({
  ...createItem(baseItem(baseId)!, { id, rarity: mods.length > 2 ? 'rare' : mods.length ? 'magic' : 'normal', itemLevel: 30, rng, mods }),
  ...extra,
});

describe('base item catalogue', () => {
  it('has unique ids, attribution for every SRD entry and stats for weapons/armour', () => {
    expect(new Set(BASE_ITEMS.map((b) => b.id)).size).toBe(BASE_ITEMS.length);
    for (const b of BASE_ITEMS) {
      if (b.source.name === 'SRD 5.1') expect(b.source.attribution).toMatch(/CC BY 4\.0/);
      if (b.category === 'weapon') expect(b.equip?.damage).toMatch(/^\d+d\d+$|^1$/);
      if (b.category === 'armor') expect(b.equip?.armorBase).toBeGreaterThan(10);
    }
    expect(baseItem('srd-longsword')?.equip).toMatchObject({ damage: '1d8', damageType: 'slashing' });
    expect(baseItem('srd-plate-armor')?.requirements?.str).toBe(15);
  });
});

describe('modifier repository', () => {
  it('is internally consistent', () => {
    expect(new Set(MODIFIERS.map((m) => m.id)).size).toBe(MODIFIERS.length);
    for (const m of MODIFIERS) {
      expect(m.text).toContain('{v}');
      expect(m.tags.length).toBeGreaterThan(0);
      m.tiers.forEach((t, i) => {
        expect(t.min).toBeLessThanOrEqual(t.max);
        expect(t.weight).toBeGreaterThan(0);
        if (i) expect(t.ilvl).toBeGreaterThan(m.tiers[i - 1].ilvl);
      });
    }
  });

  it('respects base tags and item-level gates', () => {
    const sword = baseItem('srd-longsword')!;
    const low = eligibleMods(sword.modTags, 1).map((e) => e.def.id);
    expect(low).toContain('dmg-fire');
    expect(low).not.toContain('to-hit'); // to-hit needs ilvl 12
    expect(low).not.toContain('res-fire'); // resistances never roll on weapons
    expect(eligibleMods(sword.modTags, 30).map((e) => e.def.id)).toContain('to-hit');
    const ring = eligibleMods(baseItem('apex-iron-band')!.modTags, 30).map((e) => e.def.id);
    expect(ring).toContain('res-cold');
    expect(ring).not.toContain('dmg-fire');
    expect(eligibleMods(baseItem('srd-torch')!.modTags, 30)).toEqual([]);
    const fire = eligibleMods(baseItem('apex-iron-band')!.modTags, 10).find((e) => e.def.id === 'res-fire')!;
    expect(fire.tiers.map((t) => t.tier)).toEqual([1, 2]);
  });
});

describe('generation', () => {
  it('rolls within the rarity rules (count, prefix/suffix budget, unique families, value ranges)', () => {
    const r = seededRng(7);
    for (const baseId of ['srd-longsword', 'srd-chain-mail', 'apex-silver-ring', 'apex-leather-belt', 'apex-soft-boots']) {
      const base = baseItem(baseId)!;
      for (const rarity of ['normal', 'magic', 'rare'] as const) {
        for (let i = 0; i < 300; i++) {
          const mods = rollMods(base, rarity, randInt(r, 1, 30), r);
          const rule = AFFIX_RULES[rarity];
          expect(mods.length).toBeLessThanOrEqual(rule.max);
          const defs = mods.map((m) => modifier(m.modId)!);
          expect(defs.filter((d) => d.affix === 'prefix').length).toBeLessThanOrEqual(rule.maxPrefixes);
          expect(defs.filter((d) => d.affix === 'suffix').length).toBeLessThanOrEqual(rule.maxSuffixes);
          expect(new Set(defs.map((d) => d.family)).size).toBe(defs.length);
          for (const m of mods) {
            const tier = modifier(m.modId)!.tiers.find((t) => t.tier === m.tier)!;
            expect(m.value).toBeGreaterThanOrEqual(tier.min);
            expect(m.value).toBeLessThanOrEqual(tier.max);
          }
        }
      }
    }
  });

  it('magic always gets at least one modifier, rare at least three on bases with a rich pool', () => {
    const r = seededRng(99);
    for (let i = 0; i < 300; i++) {
      expect(rollMods(baseItem('srd-longsword')!, 'magic', 20, r).length).toBeGreaterThanOrEqual(1);
      expect(rollMods(baseItem('apex-silver-ring')!, 'rare', 20, r).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('is deterministic for a seed', () => {
    const a = rollMods(baseItem('srd-longsword')!, 'rare', 25, seededRng(42));
    const b = rollMods(baseItem('srd-longsword')!, 'rare', 25, seededRng(42));
    expect(a).toEqual(b);
  });

  it('weighted choice is unbiased (distribution test)', () => {
    const r = seededRng(2024);
    const n = 40000;
    let heavy = 0;
    for (let i = 0; i < n; i++) if (weightedPick(r, [{ value: 'a', weight: 1 }, { value: 'b', weight: 3 }]) === 'b') heavy++;
    expect(heavy / n).toBeGreaterThan(0.74);
    expect(heavy / n).toBeLessThan(0.76);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) counts[randInt(r, 0, 5)]++;
    for (const c of counts) expect(Math.abs(c / n - 1 / 6)).toBeLessThan(0.01);
  });

  it('tier frequencies follow the tier weights', () => {
    const r = seededRng(5);
    const tiers: Record<number, number> = {};
    let total = 0;
    for (let i = 0; i < 20000; i++) {
      for (const m of rollMods(baseItem('apex-iron-band')!, 'magic', 30, r)) {
        if (m.modId !== 'res-fire') continue;
        tiers[m.tier] = (tiers[m.tier] ?? 0) + 1;
        total++;
      }
    }
    const w = modifier('res-fire')!.tiers.map((t) => t.weight);
    const sum = w.reduce((a, b) => a + b, 0);
    w.forEach((wt, i) => expect(Math.abs(tiers[i + 1] / total - wt / sum)).toBeLessThan(0.03));
  });

  it('validates manual modifiers', () => {
    const sword = baseItem('srd-longsword')!;
    expect(validateMods(sword, 30, [{ modId: 'dmg-fire', tier: 4, value: 4 }], 'magic')).toBeNull();
    expect(validateMods(sword, 10, [{ modId: 'dmg-fire', tier: 4, value: 4 }], 'magic')).toMatch(/item level/);
    expect(validateMods(sword, 30, [{ modId: 'dmg-fire', tier: 1, value: 9 }], 'magic')).toMatch(/value/);
    expect(validateMods(sword, 30, [{ modId: 'res-fire', tier: 1, value: 5 }], 'magic')).toMatch(/cannot appear/);
    expect(validateMods(sword, 30, [{ modId: 'dmg-fire', tier: 1, value: 1 }, { modId: 'dmg-cold', tier: 1, value: 1 }], 'rare')).toMatch(/family/);
    expect(validateMods(sword, 30, [{ modId: 'dmg-fire', tier: 1, value: 1 }, { modId: 'to-hit', tier: 1, value: 1 }], 'magic')).toMatch(/prefix/);
  });
});

describe('resistances', () => {
  it('uses min(points, 100) / 200', () => {
    expect(resistanceReduction(30)).toBe(0.15);
    expect(resistanceReduction(100)).toBe(0.5);
    expect(resistanceReduction(180)).toBe(0.5);
    expect(resistanceReduction(-20)).toBe(0);
    expect(resistanceReduction(80, 60)).toBe(0.3);
    expect(resistanceLabel('fire', 30)).toBe('Fire Resistance: 30 points (15% damage reduction)');
  });

  it('applies immunity → D&D resistance/vulnerability → APEX reduction in that order', () => {
    expect(applyDamage({ amount: 20, immune: true, apexPoints: 100 }).final).toBe(0);
    expect(applyDamage({ amount: 21, dndResistant: true, apexPoints: 100 }).final).toBe(5); // 10, then −5
    expect(applyDamage({ amount: 10, dndVulnerable: true, apexPoints: 30 }).final).toBe(17); // 20, −3
    expect(applyDamage({ amount: 10, dndResistant: true, dndVulnerable: true }).final).toBe(10);
    expect(applyDamage({ amount: 3, apexPoints: 10 }).final).toBe(3); // 5 % of 3 prevents nothing
  });
});

describe('equipment integration', () => {
  function withItems(items: Item[], slots: Record<string, string>, extra: Partial<GameState['tokens'][string]['equipment']> = {}) {
    return { inventory: items, equipment: { slots, activeSet: 1 as const, resting: false, restingKeep: ['amulet', 'ring1', 'ring2', 'cloak', 'belt'] as never, ...extra } };
  }
  const ring1 = make('apex-iron-band', 'r1', [{ modId: 'res-fire', tier: 4, value: 34 }, { modId: 'max-hp', tier: 3, value: 12 }]);
  const ring2 = make('apex-silver-ring', 'r2', [{ modId: 'res-fire', tier: 4, value: 34 }]);
  const amulet = make('apex-bronze-torc', 'am', [{ modId: 'res-fire', tier: 4, value: 34 }, { modId: 'max-hp', tier: 3, value: 12 }]);
  const sword = make('srd-longsword', 'sw', [{ modId: 'to-hit', tier: 2, value: 2 }, { modId: 'dmg-fire', tier: 3, value: 3 }]);
  const sword2 = make('srd-longsword', 'sw2', [{ modId: 'dmg-cold', tier: 4, value: 4 }]);

  it('sums resistances of active equipped items and caps them', () => {
    const d = deriveStats(sheet, withItems([ring1, ring2, amulet], { ring1: 'r1', ring2: 'r2', amulet: 'am' }));
    expect(d.bonuses.resistances.fire.total).toBe(102);
    expect(d.bonuses.resistances.fire.value).toBe(100);
    expect(d.bonuses.resistances.fire.reduction).toBe(0.5);
    expect(d.bonuses.maxHp.value).toBe(20); // 24 capped at 20
    expect(d.bonuses.maxHp.steps.at(-1)?.op).toBe('cap');
  });

  it('ignores unequipped items, the inactive weapon set and unidentified items', () => {
    const hidden = { ...ring2, identified: false };
    const d = deriveStats(sheet, withItems([ring1, hidden, sword, sword2], { ring1: 'r1', ring2: 'r2', main2: 'sw2' }));
    expect(d.bonuses.resistances.fire.total).toBe(34);
    expect(d.attacks).toEqual([]);
    const d2 = deriveStats(sheet, withItems([sword, sword2], { main1: 'sw', main2: 'sw2' }));
    expect(d2.attacks).toHaveLength(1);
    expect(d2.attacks[0].damage).toContain('+ 3 fire');
    expect(d2.attacks[0].damage).not.toContain('cold');
  });

  it('weapon to-hit is local and bounded; the GM rules can lower caps', () => {
    const d = deriveStats(sheet, withItems([sword], { main1: 'sw' }));
    expect(d.attacks[0].toHit).toBe(2 + 2 + 2); // STR + PB + modifier
    const lowered = deriveStats(sheet, withItems([sword], { main1: 'sw' }), itemRulesOf({ itemRules: { toHitCap: 1, flatDamageCap: 2 } }));
    expect(lowered.attacks[0].toHit).toBe(5);
    expect(lowered.attacks[0].damage).toContain('+ 2 fire');
    expect(lowered.attacks[0].extra.join()).toMatch(/capped/);
  });

  it('adds AC modifiers once on top of an imported sheet value', () => {
    const helm = make('apex-iron-helm', 'h', []);
    const plate = { ...make('srd-plate-armor', 'pl', [{ modId: 'ac', tier: 1, value: 1 }]) };
    const d = deriveStats(sheet, withItems([helm, plate], { chest: 'pl' }));
    expect(d.ac.source).toBe('derived');
    expect(d.ac.value).toBe(18 + 1);
    const ringAc = { ...ring1, mods: [{ modId: 'ac', tier: 1, value: 1 }] }; // forced for the test only
    const d2 = deriveStats(sheet, withItems([ringAc], { ring1: 'r1' }));
    expect(d2.ac.source).toBe('imported');
    expect(d2.ac.value).toBe(14);
  });
});

describe('server authority and privacy', () => {
  function state() {
    const s = createDemoState({ radius: 6, seed: 1 });
    s.tokens.sinna.inventory = [make('apex-iron-band', 'secret', [{ modId: 'res-cold', tier: 1, value: 7 }], { identified: false }), make('srd-longsword', 'blade', [{ modId: 'dmg-fire', tier: 1, value: 1 }])];
    return s;
  }

  it('players never receive the modifiers of unidentified items; the GM does', () => {
    const s = state();
    const mine = buildPlayerView(s, 'sinna').tokens.find((t) => t.id === 'sinna')!.details!.inventory;
    const secret = mine.find((i) => i.id === 'secret')!;
    expect(secret.mods).toBeUndefined();
    expect(JSON.stringify(mine)).not.toContain('res-cold');
    expect(describeMods(secret)).toEqual(['Unidentified – its properties are unknown.']);
    expect(mine.find((i) => i.id === 'blade')!.mods).toHaveLength(1);
    expect(buildGmView(s).tokens.find((t) => t.id === 'sinna')!.details!.inventory.find((i) => i.id === 'secret')!.mods).toHaveLength(1);
    expect(redactItem(s.tokens.sinna.inventory[1])).toBe(s.tokens.sinna.inventory[1]);
  });

  it('players cannot change generated items or the balance rules', () => {
    const s = state();
    const blade = s.tokens.sinna.inventory[1];
    expect(executeCommand(s, P, { type: 'invUpdateItem', tokenId: 'sinna', itemId: 'blade', rev: blade.rev ?? 0, quantity: 5 }).ok).toBe(false);
    expect(executeCommand(s, P, { type: 'setItemEquip', tokenId: 'sinna', itemId: 'blade', rev: blade.rev ?? 0, equip: { kind: 'weapon', damage: '9d12', attackBonus: 9 } }).ok).toBe(false);
    expect(executeCommand(s, P, { type: 'invSplitStack', tokenId: 'sinna', itemId: 'blade', rev: 0, quantity: 1, newItemId: 'dupe' }).ok).toBe(false);
    expect(executeCommand(s, P, { type: 'setItemRules', rules: { toHitCap: 3 } }).ok).toBe(false);
    // invAddItem only ever creates plain items – extra fields are dropped by the validator
    const parsed = parseCommand({ type: 'invAddItem', tokenId: 'sinna', itemId: 'x', name: 'Fake', rarity: 'rare', mods: [{ modId: 'to-hit', tier: 2, value: 2 }] });
    expect(parsed.ok && JSON.stringify(parsed.command)).not.toContain('mods');
  });

  it('the GM can adjust caps within hard limits', () => {
    let s = state();
    const parsed = parseCommand({ type: 'setItemRules', rules: { resistanceCap: 500, toHitCap: 1 } });
    expect(parsed.ok).toBe(true);
    const r = executeCommand(s, GM, (parsed as unknown as { command: never }).command);
    expect(r.ok).toBe(true);
    s = r.state;
    expect(itemRulesOf(s)).toMatchObject({ resistanceCap: 100, toHitCap: 1 });
    expect(buildPlayerView(s, 'sinna').itemRules.toHitCap).toBe(1);
    expect(parseCommand({ type: 'setItemRules', rules: { hacked: 1 } }).ok).toBe(false);
    s = executeCommand(s, GM, { type: 'setItemRules', rules: null }).state;
    expect(itemRulesOf(s)).toEqual(DEFAULT_ITEM_RULES);
  });
});
