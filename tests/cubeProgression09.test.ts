import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { CUBE_BASE, cubeCostForNextLevel, cubeLevelOf, requiredCubeLevel } from '../src/game/items/cubeProgression';
import { canAugment, canAscend, canReroll } from '../src/game/items/loot';
import { itemRulesOf } from '../src/game/items/rules';
import { migrateState } from '../src/game/migrate';
import type { GameState, Item } from '../src/game/types';
import { parseCommand } from '../src/server/validate';

const GM = { role: 'gm' as const };
const PLAYER = { role: 'player' as const, tokenId: 'sinna' };

function apply(state: GameState, command: Command, actor: typeof GM | typeof PLAYER = PLAYER) {
  return executeCommand(state, actor, command);
}

const oldCube = (): Item => ({ id: 'old-cube', baseId: CUBE_BASE, name: 'Imperial Transmutation Cube', kind: 'misc', description: '', quantity: 1 });

describe('APEX 0.9 Cube progression', () => {
  it('grants a new Cube at level 0 and upgrades it with separate server-validated fragments', () => {
    let state = createDemoState({ radius: 6, seed: 13 });
    state.tokens.sinna.inventory = [];
    state.tokens.sinna.currency = { fragment: 20 };
    state.tokens.sinna.currencyRev = 0;
    const granted = apply(state, { type: 'arsenalGenerate', stagedId: 'cube', baseId: CUBE_BASE, rarity: 'normal', itemLevel: 1, identified: true, giveTo: 'sinna', seed: 1 }, GM);
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    state = granted.state;
    expect(state.tokens.sinna.cubeProgression).toEqual({ level: 0 });
    expect(apply(state, { type: 'transmuteFragments', tokenId: 'sinna', sets: 1, currencyRev: 0, seed: 1 }).ok).toBe(false);
    expect(apply(state, { type: 'cubeUpgrade', tokenId: 'sinna', expectedLevel: 0, currencyRev: 0 }).ok).toBe(false);

    const fragments = apply(state, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'cubeFragment', amount: 3 }, GM);
    expect(fragments.ok).toBe(true);
    if (!fragments.ok) return;
    state = fragments.state;
    expect(state.tokens.sinna.currency?.fragment).toBe(20);
    expect(apply(state, { type: 'cubeUpgrade', tokenId: 'sinna', expectedLevel: 0, currencyRev: 0 }).ok).toBe(false);
    const upgrade = apply(state, { type: 'cubeUpgrade', tokenId: 'sinna', expectedLevel: 0, currencyRev: 1 });
    expect(upgrade.ok).toBe(true);
    if (!upgrade.ok) return;
    state = upgrade.state;
    expect(state.tokens.sinna.cubeProgression?.level).toBe(1);
    expect(state.tokens.sinna.currency?.cubeFragment).toBe(0);
    expect(state.tokens.sinna.currency?.fragment).toBe(20);
    expect(apply(state, { type: 'cubeUpgrade', tokenId: 'sinna', expectedLevel: 0, currencyRev: 1 }).ok).toBe(false);
    expect(apply(state, { type: 'transmuteFragments', tokenId: 'sinna', sets: 1, currencyRev: 2, seed: 1 }).ok).toBe(true);
  });

  it('validates GM controls, level caps, stale upgrade revisions and configurable costs', () => {
    const state = createDemoState({ radius: 6, seed: 14 });
    expect(parseCommand({ type: 'gmSetCubeProgression', tokenId: 'sinna', level: 6 }).ok).toBe(false);
    expect(apply(state, { type: 'gmSetCubeProgression', tokenId: 'sinna', level: 3 }).ok).toBe(false);
    const set = apply(state, { type: 'gmSetCubeProgression', tokenId: 'sinna', level: 3 }, GM);
    expect(set.ok).toBe(true);
    expect(cubeCostForNextLevel(0, { ...itemRulesOf({}), cubeLevel1Fragments: 8 })).toBe(8);
    expect(cubeCostForNextLevel(5, itemRulesOf({}))).toBeNull();
    expect([1, 2, 3, 4]).toEqual(['transmute', 'renewal', 'augment', 'ascend'].map((op) => requiredCubeLevel(op as 'transmute' | 'renewal' | 'augment' | 'ascend')));
  });

  it('enforces unlocked operation tiers on the shared player rules', () => {
    const token = { inventory: [oldCube()], cubeProgression: { level: 1 }, currency: { orb: 1, augment: 1, ascend: 1 } };
    const generatedItem: Item = { id: 'magic-item', baseId: 'srd-longsword', name: 'Magic Longsword', kind: 'weapon', description: '', rarity: 'magic', itemLevel: 10, identified: true, quantity: 1 };
    expect(canReroll(token, generatedItem)).toMatchObject({ ok: false, reason: expect.stringMatching(/level 2/) });
    expect(canAugment(token, generatedItem)).toMatchObject({ ok: false, reason: expect.stringMatching(/level 3/) });
    expect(canAscend(token, generatedItem)).toMatchObject({ ok: false, reason: expect.stringMatching(/level 4/) });
    const tier2 = { ...token, cubeProgression: { level: 2 } };
    expect(canReroll(tier2, generatedItem).ok).toBe(true);
    const tier3 = { ...token, cubeProgression: { level: 3 } };
    expect(canAugment(tier3, generatedItem).ok).toBe(true);
    expect(canAscend(tier3, generatedItem)).toMatchObject({ ok: false, reason: expect.stringMatching(/level 4/) });
    const tier4 = { ...token, cubeProgression: { level: 4 } };
    expect(canAscend(tier4, generatedItem).ok).toBe(true);
  });

  it('migrates legacy Cube owners and permanent access without removing prior operations', () => {
    const state = createDemoState({ radius: 6, seed: 15 });
    state.tokens.sinna.inventory = [oldCube()];
    state.tokens.sinna.cubeProgression = undefined;
    state.tokens.aster.cubeAccess = true;
    state.tokens.aster.cubeProgression = undefined;
    const migrated = migrateState(state);
    expect(migrated.tokens.sinna.cubeProgression).toMatchObject({ level: 4, legacyEntitlement: true });
    expect(migrated.tokens.aster.cubeProgression).toMatchObject({ level: 4, gmOverride: true, legacyEntitlement: true });
    expect(cubeLevelOf(migrated.tokens.sinna)).toBe(4);
    expect(cubeLevelOf(migrated.tokens.aster)).toBe(4);
  });
});
