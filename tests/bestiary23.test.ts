/** APEX 2.3: bestiary 2.0 – variants, German names, exceptions, ambient animals. */
import { describe, expect, it } from 'vitest';
import { CREATURES, buildCreature, creatureFor } from '../src/components/map/creatures3d';
import { CREATURE_KINDS, parseCreature } from '../src/game/creatures';
import { FAUNA, LAYOUT_FAUNA, faunaNodes } from '../src/game/fauna';
import { generateBattleScene, hexSceneMap, type HexPreset } from '../src/campaign/hexScene';
import { emptyMap, parseMap } from '../src/campaign/maps';
import { publicMap } from '../src/server/sceneRuntime';

describe('bestiary 2.0', () => {
  it('130+ models; every model builds as adult, female and young (young ones smaller)', () => {
    expect(CREATURE_KINDS.length).toBeGreaterThanOrEqual(130);
    expect(CREATURE_KINDS.slice().sort()).toEqual(Object.keys(CREATURES).sort());
    for (const k of CREATURE_KINDS) {
      const adult = buildCreature(k)!, young = buildCreature(k, undefined, false, 'young')!, female = buildCreature(k, undefined, false, 'female')!;
      expect(young.height, k).toBeLessThan(adult.height);
      expect(female.height, k).toBeLessThanOrEqual(adult.height);
    }
  });
  it('German names, variants and exceptions', () => {
    const k = (t: string) => creatureFor(t);
    expect(k('Bärin')).toMatchObject({ kind: 'bear', variant: 'female' });
    expect(k('Bear cub')).toMatchObject({ kind: 'bear', variant: 'young' });
    expect(k('Lioness')).toMatchObject({ kind: 'cat', variant: 'female' });
    expect(k('Hirschkuh')).toMatchObject({ kind: 'deer', variant: 'female' });
    expect(k('Lamm')).toMatchObject({ kind: 'sheep', variant: 'young' });
    expect(k('Schaf')?.kind).toBe('sheep');
    expect(k('Kuh')).toMatchObject({ kind: 'cow', variant: 'female' });
    expect(k('Wolf Spider beast')?.kind).toBe('spider');
    expect(k('Werewolf')).toBeNull();
    expect(k('Werwolf')).toBeNull();
    expect(k('Winter Wolf monstrosity')?.kind).toBe('winterwolf');
    expect(k('Dracolich undead')?.kind).toBe('bonedragon');
    expect(k('Roter Drache')).toMatchObject({ kind: 'dragon', tint: 'red' });
    expect(k('Young Blue Dragon')).toMatchObject({ kind: 'dragon', tint: 'blue', variant: 'young' });
    expect(k('Displacer Beast')?.kind).toBe('displacer');
    expect(k('Hase')?.kind).toBe('rabbit');
    expect(k('Cat')?.kind).toBe('housecat');
    expect(k('Pig')?.kind).toBe('pig');
    expect(k('Otter')).toBeNull();
    expect(parseCreature({ kind: 'bear', variant: 'young' })).toEqual({ kind: 'bear', variant: 'young' });
    expect(parseCreature({ kind: 'bear', variant: 'old' })).toBeNull();
  });
  it('ambient animals: layouts place their animals; fauna markers survive parseMap and reach players', () => {
    for (const [preset, groups] of Object.entries(LAYOUT_FAUNA)) {
      for (const [species] of groups!) expect(CREATURE_KINDS, species).toContain(species);
      const map = hexSceneMap(emptyMap('battle'), generateBattleScene(preset as HexPreset, 10, 5));
      const nodes = faunaNodes(map, preset as HexPreset, 5);
      expect(nodes.length, preset).toBeGreaterThan(0);
      const parsed = parseMap({ ...map, nodes })!;
      expect(parsed, preset).not.toBeNull();
      expect(publicMap(parsed)!.nodes.filter((n) => n.kind === 'fauna').length).toBe(nodes.length);
    }
    for (const f of FAUNA) expect(CREATURE_KINDS, f.id).toContain(f.id);
    const map = hexSceneMap(emptyMap('battle'), generateBattleScene('blank', 6, 1));
    expect(parseMap({ ...map, nodes: [{ id: 'f', x: map.width / 2, y: map.height / 2, label: 'Sheep', description: '', kind: 'fauna', visible: true, width: 50, height: 50, targetScene: null, species: 'sheep', count: 40 }] })).toBeNull();
  });
});
