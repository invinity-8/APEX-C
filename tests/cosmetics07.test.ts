import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { activeCosmetics } from '../src/game/cosmetics';
import { buildPlayerView } from '../src/game/visibility';
import { parseCommand } from '../src/server/validate';

const GM = { role: 'gm' as const };
const P = { role: 'player' as const, tokenId: 'sinna' };

describe('cosmetic rewards (APEX 0.7)', () => {
  it('only the GM grants; players select only what they own; revoking clears the selection', () => {
    let s = createDemoState({ radius: 6, seed: 1 });
    expect(executeCommand(s, P, { type: 'gmCosmetic', tokenId: 'sinna', cosmeticId: 'wreath-gold', grant: true }).ok).toBe(false);
    expect(executeCommand(s, P, { type: 'setCosmetics', tokenId: 'sinna', selected: { wreath: 'wreath-gold' } }).ok).toBe(false); // not unlocked
    s = executeCommand(s, GM, { type: 'gmCosmetic', tokenId: 'sinna', cosmeticId: 'wreath-gold', grant: true }).state;
    s = executeCommand(s, GM, { type: 'gmCosmetic', tokenId: 'sinna', cosmeticId: 'title-champion', grant: true }).state;
    const before = structuredClone(s.tokens.sinna);
    s = executeCommand(s, P, { type: 'setCosmetics', tokenId: 'sinna', selected: { wreath: 'wreath-gold', title: 'title-champion' } }).state;
    expect(activeCosmetics(s.tokens.sinna.cosmetics).wreath?.id).toBe('wreath-gold');
    expect({ ...s.tokens.sinna, cosmetics: undefined }).toEqual({ ...before, cosmetics: undefined }); // nothing else changes
    expect(executeCommand(s, P, { type: 'setCosmetics', tokenId: 'sinna', selected: { frame: 'wreath-gold' } }).ok).toBe(false); // wrong kind
    expect(executeCommand(s, { role: 'player', tokenId: 'aster' }, { type: 'setCosmetics', tokenId: 'sinna', selected: { wreath: null } }).ok).toBe(false);
    s = executeCommand(s, GM, { type: 'gmCosmetic', tokenId: 'sinna', cosmeticId: 'wreath-gold', grant: false }).state;
    expect(s.tokens.sinna.cosmetics!.selected.wreath).toBeUndefined();
    expect(s.tokens.sinna.cosmetics!.selected.title).toBe('title-champion');
  });

  it('others see the chosen cosmetics, never the owned list', () => {
    let s = createDemoState({ radius: 6, seed: 1 });
    s = executeCommand(s, GM, { type: 'gmCosmetic', tokenId: 'sinna', cosmeticId: 'frame-gilded', grant: true }).state;
    s = executeCommand(s, GM, { type: 'gmCosmetic', tokenId: 'sinna', cosmeticId: 'orn-star', grant: true }).state;
    s = executeCommand(s, P, { type: 'setCosmetics', tokenId: 'sinna', selected: { frame: 'frame-gilded' } }).state;
    const own = buildPlayerView(s, 'sinna').tokens.find((t) => t.id === 'sinna')!;
    expect(own.cosmetics!.unlocked.sort()).toEqual(['frame-gilded', 'orn-star']);
    const other = buildPlayerView(s, 'aster').tokens.find((t) => t.id === 'sinna');
    if (other) {
      expect(other.cosmetics?.selected.frame).toBe('frame-gilded');
      expect(other.cosmetics?.unlocked ?? []).toEqual([]);
    }
    expect(parseCommand({ type: 'setCosmetics', tokenId: 'sinna', selected: { aura: 'x' } }).ok).toBe(false);
  });
});
