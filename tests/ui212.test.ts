/** APEX 2.12 – fixes and UI: other players' looks in scenes. */
import { describe, expect, it } from 'vitest';
import { emptyMap } from '../src/campaign/maps';
import { encodeTiles, hexCentre, hexSceneMap } from '../src/campaign/hexScene';
import { createDemoState } from '../src/data/demo';
import { FIGURE_PRESETS, lookFromPreset } from '../src/game/figure';
import { figuresFor } from '../src/server/sceneLocal';
import { figureLook } from '../src/components/map/world3d';

describe('APEX 2.12 – other players look like themselves', () => {
  it('a character on a scene carries its chosen look, so every viewer builds the same figure', () => {
    const state = createDemoState({ radius: 6, seed: 3 });
    const pcs = Object.values(state.tokens).filter((t) => t.kind === 'player').slice(0, 2);
    const look = lookFromPreset(FIGURE_PRESETS.find((p) => p.id === 'wizard')!, 7);
    pcs[0].figure = look;
    const map = hexSceneMap(emptyMap('battle'), encodeTiles(5, 'battle', () => 'grass'));
    const at = hexCentre(map, { q: 0, r: 0 });
    const figs = figuresFor(state, 'scene-1', map, pcs.map((t) => ({ tokenId: t.id, userId: 'u', ...at, stored: true })), [], null, false);
    const mine = figs.find((f) => f.tokenId === pcs[0].id)!;
    expect(mine.look).toEqual(look);
    // the client: without the token in the viewer's own view, the look from the figure is used (not a random preset)
    expect(figureLook({ tokenId: pcs[0].id, x: 0, y: 0, name: 'x', color: '#888888', look: mine.look })).toEqual(look);
  });
});
