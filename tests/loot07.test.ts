import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { itemBonuses } from '../src/game/equipment';
import { baseItem } from '../src/game/items/bases';
import { seededRng } from '../src/game/items/generate';
import { createItem } from '../src/game/items/instance';
import { BOSS_ILVL_SPREAD, CONSUMABLE_BASES, draftItemLevel, POTION_BASE, QUEST_BASE, rollDraft, ROLLED_CATEGORIES } from '../src/game/items/lootDraft';
import { modifier, MODIFIERS } from '../src/game/items/modifiers';
import { DEFAULT_ITEM_RULES } from '../src/game/items/rules';
import type { GameState, Item, RolledMod } from '../src/game/types';
import { buildPlayerView } from '../src/game/visibility';
import { parseCommand } from '../src/server/validate';

const GM = { role: 'gm' as const };
const P = { role: 'player' as const, tokenId: 'sinna' };
function run(s: GameState, c: Command, actor: typeof GM | typeof P = GM, seed?: number) {
  const r = executeCommand(s, actor, (seed !== undefined ? { ...c, seed } : c) as Command);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
const refuse = (s: GameState, c: Command, actor: typeof GM | typeof P = GM) => {
  const r = executeCommand(s, actor, c);
  return r.ok ? null : r.error;
};
function fresh() {
  const s = createDemoState({ radius: 6, seed: 3 });
  s.tokens.sinna.inventory = [];
  s.tokens.sinna.equipment = undefined;
  s.tokens.sinna.containers = undefined;
  s.tokens.sinna.currency = {};
  return s;
}
const make = (baseId: string, id: string, mods: RolledMod[]): Item => createItem(baseItem(baseId)!, { id, rarity: 'rare', itemLevel: 30, rng: seededRng(1), mods });

describe('APEX 0.7 modifier families', () => {
  it('every new family exists, is rare and has bounded values', () => {
    for (const id of ['spell-attack', 'spell-dc', 'attr-str', 'attr-cha', 'thorns', 'skill-acrobatics']) expect(modifier(id), id).toBeTruthy();
    const dc = modifier('spell-dc')!;
    expect(dc.tiers).toHaveLength(1);
    expect(dc.tiers[0].max).toBe(1);
    expect(dc.tiers[0].ilvl).toBeGreaterThanOrEqual(20);
    expect(modifier('spell-attack')!.tiers[0].max).toBe(1);
    // APEX 1.0: +1 from ilvl 10, +2 only from ilvl 24 and rare; the per-ability cap (+2) bounds the total
    for (const m of MODIFIERS.filter((m) => m.family === 'attribute')) expect(m.tiers.every((t) => t.max <= 2 && (t.max === 1 ? t.ilvl >= 10 : t.ilvl >= 24 && t.weight <= 20))).toBe(true);
    expect(modifier('thorns')!.text).toMatch(/once per turn.*melee attack/);
  });
  it('caps apply across all equipped items (spell attack/DC +1, ability +1, thorns 4)', () => {
    const ringA = make('apex-silver-ring', 'ra', [
      { modId: 'spell-attack', tier: 1, value: 1 },
      { modId: 'spell-dc', tier: 1, value: 1 },
      { modId: 'attr-str', tier: 1, value: 1 },
    ]);
    const ringB = make('apex-silver-ring', 'rb', [
      { modId: 'spell-attack', tier: 1, value: 1 },
      { modId: 'spell-dc', tier: 1, value: 1 },
      { modId: 'attr-str', tier: 1, value: 1 },
    ]);
    const armour = make('srd-chain-mail', 'cm', [{ modId: 'thorns', tier: 2, value: 3 }]);
    const shield = make('srd-shield', 'sh', [{ modId: 'thorns', tier: 2, value: 3 }]);
    const b = itemBonuses([
      { slot: 'ring1', item: ringA },
      { slot: 'ring2', item: ringB },
      { slot: 'chest', item: armour },
      { slot: 'off1', item: shield },
    ]);
    expect([b.spellAttack.total, b.spellAttack.value]).toEqual([2, DEFAULT_ITEM_RULES.spellAttackCap]);
    expect([b.spellDc.total, b.spellDc.value]).toEqual([2, 1]);
    expect([b.abilities.str!.total, b.abilities.str!.value]).toEqual([2, DEFAULT_ITEM_RULES.abilityCap]); // cap 2 since APEX 1.0
    expect([b.thorns.total, b.thorns.value]).toEqual([6, 4]);
  });
});

describe('loot draft roller', () => {
  it('rolls only enabled categories, never quest/custom, with level-based item level', () => {
    for (let seed = 1; seed < 60; seed++) {
      const e = rollDraft('elite', 8, ['weapon', 'potion'], seededRng(seed), 'd');
      expect(e).toHaveLength(3);
      for (const x of e) {
        expect(['weapon', 'potion']).toContain(x.category);
        if (x.category === 'weapon') expect(x.itemLevel).toBe(8 + 3);
        if (x.category === 'potion') expect(x.baseId).toBe(POTION_BASE);
      }
    }
    expect(rollDraft('boss', 5, [], seededRng(1), 'd')).toEqual([]);
  });
  it('boss item level spread is 85/12/3', () => {
    expect(BOSS_ILVL_SPREAD.map((x) => x.weight)).toEqual([85, 12, 3]);
    const counts = [0, 0, 0];
    const rng = seededRng(7);
    for (let i = 0; i < 20000; i++) counts[draftItemLevel('boss', 10, rng) - 15]++;
    expect(counts[0] / 20000).toBeGreaterThan(0.82);
    expect(counts[2] / 20000).toBeLessThan(0.05);
  });
  it('all referenced bases exist', () => {
    for (const id of [POTION_BASE, QUEST_BASE, ...CONSUMABLE_BASES]) expect(baseItem(id), id).toBeTruthy();
    expect(ROLLED_CATEGORIES).not.toContain('quest');
  });
});

describe('loot draft commands', () => {
  const create = (s: GameState, extra: Partial<Extract<Command, { type: 'lootDraftCreate' }>> = {}) =>
    run(s, { type: 'lootDraftCreate', draftId: 'drop1', encounter: 'standard', referenceLevel: 5, categories: ['weapon', 'armor', 'accessory', 'fragment', 'seal', 'potion'], ...extra }, GM, 42);

  it('only the GM can create or edit drafts; a seed is required', () => {
    const s = fresh();
    expect(refuse(s, { type: 'lootDraftCreate', draftId: 'x', encounter: 'boss', referenceLevel: 3, categories: ['weapon'], seed: 1 }, P)).toMatch(/Game Master/);
    expect(refuse(s, { type: 'lootDraftCreate', draftId: 'x', encounter: 'boss', referenceLevel: 3, categories: ['weapon'] })).toMatch(/seed/);
    const parsed = parseCommand({ type: 'lootDraftCreate', draftId: 'x', encounter: 'boss', referenceLevel: 3, categories: ['weapon'], seed: 5 });
    expect(parsed.ok && 'seed' in parsed.command).toBe(false); // client seeds are dropped
    expect(parseCommand({ type: 'lootDraftCreate', draftId: 'x', encounter: 'boss', referenceLevel: 3, categories: ['quest'] }).ok).toBe(false);
  });

  it('is invisible to players and creates no item before approval', () => {
    const s = create(fresh());
    expect(s.arsenal!.draft!.entries).toHaveLength(2);
    expect(s.arsenal!.staged).toHaveLength(0);
    expect(s.tokens.sinna.inventory).toHaveLength(0);
    expect(JSON.stringify(buildPlayerView(s, 'sinna'))).not.toContain('drop1');
    expect(refuse(s, { type: 'lootDraftCreate', draftId: 'drop2', encounter: 'boss', referenceLevel: 3, categories: ['weapon'], seed: 3 })).toMatch(/current loot draft/);
  });

  it('editing: remove, change quantity/item level/rarity/identified, add quest, custom and currency; revision check', () => {
    let s = create(fresh());
    const [a, b] = s.arsenal!.draft!.entries;
    s = run(s, { type: 'lootDraftEdit', rev: 0, op: { kind: 'remove', key: b.key } });
    expect(refuse(s, { type: 'lootDraftEdit', rev: 0, op: { kind: 'remove', key: a.key } })).toMatch(/changed in the meantime/);
    s = run(s, { type: 'lootDraftEdit', rev: 1, op: { kind: 'add', entry: { key: 'w1', category: 'weapon', baseId: 'srd-longsword', rarity: 'rare', itemLevel: 12, identified: false, quantity: 1 } } });
    s = run(s, { type: 'lootDraftEdit', rev: 2, op: { kind: 'set', key: 'w1', itemLevel: 14, identified: true } });
    expect(s.arsenal!.draft!.entries.find((e) => e.key === 'w1')).toMatchObject({ itemLevel: 14, identified: true, rarity: 'rare' });
    s = run(s, { type: 'lootDraftEdit', rev: 3, op: { kind: 'add', entry: { key: 'q1', category: 'quest', name: 'Signet of the Seventh Legion', description: 'Opens the vault.', image: 'https://example.org/signet.png', gmNotes: 'The traitor wears its twin.', noTransfer: true, quantity: 1 } } });
    s = run(s, { type: 'lootDraftEdit', rev: 4, op: { kind: 'add', entry: { key: 'c1', category: 'custom', name: 'Bag of Figs', quantity: 3 } } });
    s = run(s, { type: 'lootDraftEdit', rev: 5, op: { kind: 'add', entry: { key: 'f1', category: 'fragment', quantity: 7 } } });
    s = run(s, { type: 'lootDraftEdit', rev: 6, op: { kind: 'add', entry: { key: 'p1', category: 'potion', baseId: POTION_BASE, quantity: 2 } } });
    // invalid edits are refused and change nothing
    expect(refuse(s, { type: 'lootDraftEdit', rev: 7, op: { kind: 'add', entry: { key: 'bad', category: 'quest', quantity: 1 } } })).toMatch(/name/);
    expect(refuse(s, { type: 'lootDraftEdit', rev: 7, op: { kind: 'add', entry: { key: 'bad', category: 'quest', name: 'X', image: 'javascript:alert(1)', quantity: 1 } } })).toMatch(/https/);
    expect(refuse(s, { type: 'lootDraftEdit', rev: 7, op: { kind: 'add', entry: { key: 'bad', category: 'weapon', baseId: 'srd-chain-mail', quantity: 1 } } })).toMatch(/base item/);
    expect(s.arsenal!.draft!.rev).toBe(7);

    // approve → real items in the tray, nothing distributed
    expect(refuse(s, { type: 'lootDraftApprove', rev: 7 })).toMatch(/seed/);
    s = run(s, { type: 'lootDraftApprove', rev: 7 }, GM, 99);
    expect(s.arsenal!.draft).toBeUndefined();
    expect(s.arsenal!.staged).toHaveLength(6);
    expect(s.tokens.sinna.inventory).toHaveLength(0);
    const tray = s.arsenal!.staged;
    const sword = tray.find((i) => i.baseId === 'srd-longsword')!;
    expect(sword).toMatchObject({ rarity: 'rare', itemLevel: 14 });
    expect(sword.identified).not.toBe(false);
    expect(sword.mods!.length).toBeGreaterThanOrEqual(3);
    const quest = tray.find((i) => i.quest)!;
    expect(quest).toMatchObject({ name: 'Signet of the Seventh Legion', locked: true, bound: true, baseId: QUEST_BASE, quest: { image: 'https://example.org/signet.png', gmNotes: 'The traitor wears its twin.' } });
    expect(tray.find((i) => i.name === 'Bag of Figs')!.locked).toBeUndefined(); // custom items follow the normal rules
    const frag = tray.find((i) => i.grant?.amount === 7)!;
    expect(frag.grant).toEqual({ currency: 'fragment', amount: 7 });

    // giving: currency goes into the purse, the quest item into the inventory without GM notes for the player
    s = run(s, { type: 'arsenalGive', stagedId: frag.id, tokenId: 'sinna' });
    expect(s.tokens.sinna.currency?.fragment).toBe(7);
    expect(s.tokens.sinna.inventory).toHaveLength(0);
    s = run(s, { type: 'arsenalGive', stagedId: quest.id, tokenId: 'sinna' });
    const view = buildPlayerView(s, 'sinna');
    const mine = view.tokens.find((t) => t.id === 'sinna')!.details!.inventory.find((i) => i.id === quest.id)!;
    expect(mine.quest).toEqual({ image: 'https://example.org/signet.png' });
    expect(JSON.stringify(view)).not.toContain('traitor');
    // quest items cannot be salvaged or deleted by the player
    expect(refuse(s, { type: 'itemSalvage', tokenId: 'sinna', itemId: quest.id, rev: 0 }, P)).toBeTruthy();
    expect(refuse(s, { type: 'invUpdateItem', tokenId: 'sinna', itemId: quest.id, rev: 0, name: 'Fake' } as Command, P)).toMatch(/Game Master/);
    expect(refuse(s, { type: 'invRemoveItem', tokenId: 'sinna', itemId: quest.id, rev: 0 } as Command, P)).toMatch(/restricted/);
  });

  it('an approved draft cannot be approved twice; discard keeps the tray', () => {
    let s = create(fresh());
    s = run(s, { type: 'lootDraftApprove', rev: 0 }, GM, 1);
    expect(refuse(s, { type: 'lootDraftApprove', rev: 0, seed: 2 })).toMatch(/no loot draft/);
    const n = s.arsenal!.staged.length;
    s = create(s, { draftId: 'drop2' });
    s = run(s, { type: 'lootDraftDiscard' });
    expect(s.arsenal!.draft).toBeUndefined();
    expect(s.arsenal!.staged).toHaveLength(n);
    expect(s.itemAudit!.some((a) => a.action === 'draft' && /discarded/.test(a.detail ?? ''))).toBe(true);
  });

  it('other Arsenal actions keep the draft', () => {
    let s = create(fresh());
    s = run(s, { type: 'arsenalGenerate', stagedId: 'x1', baseId: 'srd-dagger', rarity: 'normal', itemLevel: 1, identified: true }, GM, 5);
    s = run(s, { type: 'arsenalDiscard', stagedId: 'x1' });
    expect(s.arsenal!.draft?.id).toBe('drop1');
  });
});
