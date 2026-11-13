/** APEX 2.4: richer faces, more and fuller hair, hair under headwear. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_LOOK, FIGURE_PARTS, parseLook } from '../src/game/figure';
import { HAIR_STYLES, buildHair } from '../src/components/map/hair3d';
import { buildLowPoly } from '../src/components/map/lowpoly';

const mats = { hair: new THREE.MeshBasicMaterial(), dark: new THREE.MeshBasicMaterial(), shaved: new THREE.MeshBasicMaterial(), tie: new THREE.MeshBasicMaterial() };
const hairMeshes = (style: string, cover: 'none' | 'brim' | 'full') => { const g = new THREE.Group(); buildHair(g, style, 0.3, 'round', mats, cover); return g.children.length; };

describe('faces and hair 2.4', () => {
  it('new face parts are valid and old looks still parse (face defaults to plain)', () => {
    expect(FIGURE_PARTS.face.length).toBeGreaterThanOrEqual(12);
    expect(FIGURE_PARTS.eyes).toEqual(expect.arrayContaining(['almond', 'round', 'catlike', 'hooded']));
    expect(HAIR_STYLES.length).toBeGreaterThanOrEqual(36);
    expect([...FIGURE_PARTS.hair].sort()).toEqual([...HAIR_STYLES].sort());
    const { face: _f, ...old } = DEFAULT_LOOK; void _f;
    expect(parseLook(old)?.face).toBe('plain');
    expect(parseLook({ ...DEFAULT_LOOK, face: 'lipstick', eyes: 'catlike', mouth: 'smirk' })).toMatchObject({ face: 'lipstick' });
  });
  it('every face option builds', () => {
    for (const face of FIGURE_PARTS.face) for (const eyes of ['almond', 'round', 'catlike', 'hooded', 'bright'] as const) expect(buildLowPoly({ ...DEFAULT_LOOK, face, eyes }).height).toBeGreaterThan(1);
    for (const nose of FIGURE_PARTS.nose) for (const mouth of FIGURE_PARTS.mouth) for (const brows of FIGURE_PARTS.brows) expect(buildLowPoly({ ...DEFAULT_LOOK, nose, mouth, brows }).height).toBeGreaterThan(1);
  });
  it('hair stays visible under every kind of headwear', () => {
    for (const style of HAIR_STYLES) {
      if (style === 'none') continue;
      expect(hairMeshes(style, 'none'), style).toBeGreaterThan(0);
      if (['buzz', 'tonsure', 'mohawk', 'topknot', 'crest'].includes(style)) continue;
      expect(hairMeshes(style, 'brim'), `${style} under a helmet`).toBeGreaterThan(2);
      expect(hairMeshes(style, 'full'), `${style} under a hood`).toBeGreaterThan(2);
    }
  });
});
