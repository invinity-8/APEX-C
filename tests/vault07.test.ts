import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { CURRENCY_IDS } from '../src/game/items/currency';
import { hasCube } from '../src/game/items/loot';
import type { GameState } from '../src/game/types';
import { buildPlayerView } from '../src/game/visibility';

const GM = { role: 'gm' as const };
const P = { role: 'player' as const, tokenId: 'sinna' };
function run(s: GameState, c: Command, actor: typeof GM | typeof P = P, seed?: number) {
  const r = executeCommand(s, actor, (seed !== undefined ? { ...c, seed } : c) as Command);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
const transmute = (s: GameState, rev = s.tokens.sinna.currencyRev ?? 0) => executeCommand(s, P, { type: 'transmuteFragments', tokenId: 'sinna', sets: 1, currencyRev: rev, seed: 9 });
function fresh() {
  const s = createDemoState({ radius: 6, seed: 3 });
  s.tokens.sinna.currency = { fragment: 40 };
  s.tokens.sinna.currencyRev = 0;
  return s;
}

describe('Imperial Transmutation Cube', () => {
  it('advanced transmutation is locked without the cube – on the server, not only in the UI', () => {
    const s = fresh();
    expect(hasCube(s.tokens.sinna)).toBe(false);
    expect(transmute(s)).toMatchObject({ ok: false, error: expect.stringMatching(/Imperial Transmutation Cube/) });
    expect(buildPlayerView(s, 'sinna').tokens.find((t) => t.id === 'sinna')!.details!.transmuteUnlocked).toBeUndefined();
    // basic functions stay available
    expect(executeCommand(s, P, { type: 'combineFragments', tokenId: 'sinna', sets: 1, currencyRev: 0 }).ok).toBe(true);
  });

  it('carrying the cube unlocks it; losing the cube locks it again (current possession)', () => {
    let s = run(fresh(), { type: 'arsenalGenerate', stagedId: 'cube', baseId: 'apex-imperial-transmutation-cube', rarity: 'normal', itemLevel: 1, identified: true, giveTo: 'sinna' }, GM, 1);
    expect(buildPlayerView(s, 'sinna').tokens.find((t) => t.id === 'sinna')!.details!.transmuteUnlocked).toBe(true);
    const r = transmute(s);
    expect(r.ok).toBe(true);
    s = r.state;
    s = run(s, { type: 'gmRevokeItem', tokenId: 'sinna', itemId: 'cube' }, GM);
    expect(transmute(s).ok).toBe(false);
  });

  it('the GM can grant permanent access; players cannot grant themselves anything', () => {
    let s = fresh();
    expect(executeCommand(s, P, { type: 'gmSetCubeAccess', tokenId: 'sinna', permanent: true }).ok).toBe(false);
    s = run(s, { type: 'gmSetCubeAccess', tokenId: 'sinna', permanent: true }, GM);
    expect(transmute(s).ok).toBe(true);
    s = run(s, { type: 'gmSetCubeAccess', tokenId: 'sinna', permanent: false }, GM);
    expect(transmute(s).ok).toBe(false);
  });

  it('all currencies keep their balances and have a vault slot', () => {
    expect(CURRENCY_IDS).toEqual(['gold', 'seal', 'orb', 'augment', 'ascend', 'fragment']);
  });
});
