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

describe('APEX 2.12 – figure proportions', () => {
  it('real proportions: hip at about half the height, the head about an eighth', async () => {
    const THREE = await import('three');
    const { buildLowPoly } = await import('../src/components/map/lowpoly');
    const f = buildLowPoly({ ...lookFromPreset(FIGURE_PRESETS.find((p) => p.id === 'monk')!, 1), hat: 'none', hair: 'none' });
    const head = new THREE.Vector3(); f.head!.getWorldPosition(head);
    expect(head.y / f.height).toBeGreaterThan(0.86); // the head's centre sits high: legs no longer stretch the figure
    expect(head.y / f.height).toBeLessThan(0.97);
  });
  it('the proportion sliders are kept, checked and change the figure', async () => {
    const { parseLook, DEFAULT_LOOK } = await import('../src/game/figure');
    expect(parseLook({ ...DEFAULT_LOOK, shape: { height: 0.5, legs: -0.3, nonsense: 1 } })).toBeNull();
    expect(parseLook({ ...DEFAULT_LOOK, shape: { height: 2 } })).toBeNull();
    expect(parseLook({ ...DEFAULT_LOOK, shape: { height: 0.53, head: 0 } })?.shape).toEqual({ height: 0.5 });
    const { buildLowPoly } = await import('../src/components/map/lowpoly');
    const tall = buildLowPoly({ ...DEFAULT_LOOK, shape: { height: 1 } }).height, small = buildLowPoly({ ...DEFAULT_LOOK, shape: { height: -1 } }).height;
    expect(tall).toBeGreaterThan(small * 1.1);
  });
});
