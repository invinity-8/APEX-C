import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CREATURES, buildCreature, creatureFor } from '../src/components/map/creatures3d';
import { blob, hand, limb, loft, tube } from '../src/components/map/kit3d';
import { applyCoat, patterned } from '../src/components/map/coat3d';
import { individualOf } from '../src/game/individual';
import { buildLowPoly } from '../src/components/map/lowpoly';
import { BUILTIN_BESTIARY } from '../src/game/bestiary';
import { CREATURE_KINDS } from '../src/game/creatures';
import { FIGURE_PRESETS, lookFromPreset } from '../src/game/figure';
import { play } from '../src/audio/sound';

const meshes = (o: THREE.Object3D) => { let n = 0; o.traverse((x) => { if ((x as THREE.Mesh).isMesh) n++; }); return n; };
const tris = (o: THREE.Object3D) => { let n = 0; o.traverse((x) => { const g = (x as THREE.Mesh).geometry; if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3; }); return n; };

describe('APEX 2.10 – building-block kit', () => {
  it('lofts a smooth closed tube with normals and uvs along a curve', () => {
    const geo = loft([[0, 0, 0], [0, 1, 0.2], [0, 2, 0]], (t) => 0.3 - t * 0.1, { sides: 12, steps: 20 });
    expect(geo.attributes.position.count).toBeGreaterThan(12 * 21);
    expect(geo.attributes.normal).toBeTruthy();
    expect(geo.attributes.uv).toBeTruthy();
    geo.computeBoundingBox();
    expect(geo.boundingBox!.max.y).toBeGreaterThan(1.9);
  });
  it('builds jointed limbs, blobs and a hand with fingers and a thumb', () => {
    const g = new THREE.Group();
    limb(g, [[0, 1, 0], [0, 0.5, 0.05], [0, 0, 0]], [0.1, 0.08, 0.06], new THREE.MeshStandardMaterial());
    blob(g, [0.2, 0.1, 0.3], new THREE.MeshStandardMaterial(), [0, 1, 0]);
    expect(meshes(g)).toBe(2);
    const h = new THREE.Group();
    hand(h, [0, 0, 0], [0, -1, 0], [1, 0, 0], 0.2, new THREE.MeshStandardMaterial(), { fingers: 4 });
    expect(meshes(h)).toBeGreaterThanOrEqual(6); // palm, four fingers, thumb
  });
  it('paints species markings (tiger, zebra, giraffe net, cow blotches) with a shader patch', () => {
    for (const k of ['tiger', 'zebra', 'net', 'blotch'] as const) {
      const m = patterned(new THREE.MeshStandardMaterial(), new THREE.Color('#d8742a'), new THREE.Color('#1a1612'), k, new THREE.Vector3(1, 1, 2), 0, false);
      expect(typeof m.onBeforeCompile, k).toBe('function');
      expect(m.customProgramCacheKey(), k).toContain('apex-coat');
    }
  });
  it('an individual coat keeps the species marking (a tiger stays striped, a cow keeps its blotches)', () => {
    const keys = (o: THREE.Object3D) => { const out = new Set<string>(); o.traverse((x) => { const m = (x as THREE.Mesh).material as THREE.Material | undefined; if (m && !Array.isArray(m)) out.add(m.customProgramCacheKey()); }); return out; };
    for (const [kind, breed, id] of [['tiger', 'Tiger beast', 6], ['cow', 'Cow beast', 9], ['zebra', 'Zebra beast', 7]] as const) for (const seed of ['a', 'b', 'c']) {
      const m = buildCreature(kind)!;
      applyCoat(m.group, individualOf(breed, seed));
      expect([...keys(m.group)], `${kind} ${seed}`).toContain(`apex-coat-${id}`);
    }
  });
  it('a tube is a mesh added to its parent', () => {
    const g = new THREE.Group();
    tube(g, [[0, 0, 0], [1, 0, 0]], () => 0.1, new THREE.MeshStandardMaterial());
    expect(g.children.length).toBe(1);
  });
});

describe('APEX 2.10 – creatures rebuilt on the kit', () => {
  it('every kind builds; the pure list and the builders match', () => {
    expect(CREATURE_KINDS.slice().sort()).toEqual(Object.keys(CREATURES).sort());
    for (const k of CREATURE_KINDS) {
      const m = buildCreature(k, undefined, false)!;
      expect(m, k).toBeTruthy();
      expect(m.height, k).toBeGreaterThan(0.3);
      expect(tris(m.group), k).toBeLessThan(45000);
    }
  });
  it('four-legged animals, birds, serpents and brutes know where their head is (portraits frame it)', () => {
    for (const k of ['wolf', 'dog', 'housecat', 'horse', 'guarddog3', 'eagle', 'snake', 'troll', 'dragon', 'owlbear']) expect(buildCreature(k)!.head, k).toBeTruthy();
  });
  it('wings fold along the body on the ground and spread to flap in the air', () => {
    for (const k of ['eagle', 'pegasus', 'griffon', 'dragon', 'bat', 'imp', 'demon']) {
      const ground = buildCreature(k, undefined, false)!, air = buildCreature(k, undefined, true)!;
      expect(ground.wings.length, k).toBe(2);
      expect(air.wings.length, k).toBe(2);
      const gw = new THREE.Box3().setFromObject(ground.wings[1]).getSize(new THREE.Vector3());
      const aw = new THREE.Box3().setFromObject(air.wings[1]).getSize(new THREE.Vector3());
      // folded: the span lies back along the body (narrow sideways); spread: wide sideways
      expect(aw.x, k).toBeGreaterThan(gw.x * 1.5);
      expect(ground.wings[0].userData.amp, k).toBeLessThanOrEqual(0.15);
    }
  });
  it('a three-headed hound has three heads (three pairs of eyes more than a dog)', () => {
    const count = (k: string) => { let n = 0; buildCreature(k)!.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) n += m.geometry.attributes.position.count; }); return n; };
    expect(count('guarddog3')).toBeGreaterThan(count('dog') * 1.4);
    expect(creatureFor('giant three headed guard dog')?.kind).toBe('guarddog3');
  });
  it('monsters get their own model instead of a generic one or a figure', () => {
    expect(creatureFor('Troll giant')?.kind).toBe('troll');
    expect(creatureFor('Ogre giant')?.kind).toBe('ogre');
    expect(creatureFor('Ettin giant')?.kind).toBe('ettin');
    expect(creatureFor('Giant weasel beast')?.kind).toBe('weasel');
    expect(creatureFor('Saber-toothed tiger beast')?.kind).toBe('sabertooth');
    expect(creatureFor('Warhorse skeleton undead')?.kind).toBe('skelhorse');
    expect(creatureFor('Vrock fiend (demon)')?.kind).toBe('vrock');
    expect(creatureFor('Barbed devil fiend (devil)')?.kind).toBe('devil');
    expect(creatureFor('Animated armor construct')?.kind).toBe('armor');
    // the walking dead stay humanoid figures
    expect(creatureFor('Ogre zombie undead')).toBeNull();
    expect(creatureFor('Zombie undead')).toBeNull();
    const byId = (id: string) => BUILTIN_BESTIARY.find((b) => b.id === id)!;
    expect(byId('imp').creature?.kind).toBe('imp');
    expect(byId('quasit').creature?.kind).toBe('quasit');
    expect(byId('pseudodragon').creature?.kind).toBe('pseudodragon');
  });
  it('every non-humanoid stat block that is not undead or a true giant has a creature model', () => {
    const missing = BUILTIN_BESTIARY.filter((b) => !/humanoid|undead/i.test(b.type) && !/fire giant|frost giant|hill giant/i.test(b.name) && !b.look && !(b.creature ?? creatureFor(`${b.name} ${b.type}`))).map((b) => b.name);
    expect(missing).toEqual([]);
  });
});

describe('APEX 2.10 – figures and sound', () => {
  it('every figure preset builds as man and woman with a head pivot and a sane height', () => {
    for (const p of FIGURE_PRESETS) for (const sex of ['male', 'female'] as const) {
      const f = buildLowPoly(lookFromPreset(p, 5, sex));
      expect(f.head, p.id).toBeTruthy();
      expect(f.height, p.id).toBeGreaterThan(1.0);
      expect(f.height, p.id).toBeLessThan(4.5);
    }
  });
  it('the new recorded sounds are safe to call without an audio device', () => {
    for (const s of ['slice', 'chop', 'step', 'equip', 'page', 'book', 'coins', 'door', 'drop'] as const) expect(() => play(s)).not.toThrow();
  });
});
