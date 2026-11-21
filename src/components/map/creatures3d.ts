/**
 * APEX 2.10 – the creature catalogue: every model id with its label, group, default size and builder. The models are
 * assembled from the building-block kit (kit3d.ts) by parametric archetypes (beasts3d.ts: four-legged animals, birds,
 * serpents, arthropods, dragons, two-legged brutes) and one-of-a-kind builders (monsters3d.ts). Facing +z, standing
 * on y = 0, sized as a MEDIUM creature (the battle map scales by the stat block's size).
 *
 * Wings are separate pivots (they flap: `userData.flapZ`, `userData.side`, `userData.amp`) and fold along the body on
 * the ground; everything else is merged per material. `creatureFor(text)` picks a model from a creature's name/type.
 */
import * as THREE from 'three';
import { mergeByMaterial } from './merge3d';
import { blob, claw, featherWing, horn, insectWing, membraneWing, skin, tentacle, tone, tube, type V3 } from './kit3d';
import { arthropod, avian, beast, brute, dragon, foldWing, neckHead, serpent, varyBeast, type Beast } from './beasts3d';
import * as X from './monsters3d';

/** A wing pivot at `at` for side s (+1 right, −1 left), spanning `span` units outward (also used by the figure kit). */
export function wing(at: V3, s: number, span: number, kind: 'feather' | 'membrane' | 'insect', c1: string, c2: string, amp = 0.55): THREE.Group {
  return kind === 'feather' ? featherWing(at, s, span, c1, c2, amp) : kind === 'membrane' ? membraneWing(at, s, span, c1, c2, amp) : insectWing(at, s, span, c1, amp);
}
/** A pair of wings at the shoulders: spread and flapping in the air, folded along the body on the ground. */
const pair = (at: (x: number) => V3, kind: 'feather' | 'membrane', span: number, c1: string, c2: string, air: boolean | undefined, g: THREE.Group, amp = 0.5): THREE.Group[] => {
  const w = [-1, 1].map((x) => kind === 'feather' ? featherWing(at(x), x, span, c1, c2, air ? amp : 0.06) : membraneWing(at(x), x, span, c1, c2, air ? amp : 0.06, '#e8dcc0'));
  if (!air) for (const p of w) foldWing(p, kind, span);
  for (const p of w) g.add(p);
  return w;
};
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export interface CreatureModel { group: THREE.Group; height: number; wings: THREE.Object3D[]; ride?: number; /** default size class if the stat block gives none */ size: string; flies: boolean; /** where a rider sits */ seat?: V3; /** APEX 2.10 – the head (portraits frame it) */ head?: V3 }
/** APEX 2.3 – male / female / young (see varyBeast: a cow has no bull horns, a lioness no mane, young ones big heads). */
export type CreatureVariant = 'male' | 'female' | 'young';
/** Builds into `g`; `height` is measured from the model when left out. `airborne`: wings spread (else folded). */
type Builder = (g: THREE.Group, tint?: string, variant?: CreatureVariant, airborne?: boolean) => { wings?: THREE.Group[]; height?: number; seat?: V3; head?: V3 } | void;
type Extra = (g: THREE.Group, r: { back: V3; headAt: V3; neckBase: V3; tailRoot: V3 }, v?: CreatureVariant) => void;

/** A kit-built four-legged animal; `extra` adds parts, `wings` adds a pair of wings at the shoulders. */
const B = (s: Beast, o: { seat?: boolean; extra?: Extra; wings?: { kind: 'feather' | 'membrane'; span: number; c1: string; c2: string } } = {}): Builder => (g, _t, v, air) => {
  const r = beast(g, varyBeast(s, v));
  o.extra?.(g, r, v);
  const w = o.wings;
  const wings = w ? pair((x) => [x * s.girth * 0.55, r.back[1] - s.girth * 0.15, s.len * 0.3], w.kind, w.span, w.c1, w.c2, air, g) : undefined;
  return { ...(o.seat ? { seat: r.back } : {}), ...(wings ? { wings } : {}), head: r.headAt };
};

// ---------------------------------------------------------------- species presets (spread, then override)
const HORSE = { len: 0.95, leg: 0.74, girth: 0.29, chest: 1.08, legR: 0.07, neck: 0.5, neckUp: 1.0, neckR: 1.15, headDown: 0.85, head: 0.19, snout: 1.35, snoutR: 0.95, feet: 'hoof', ears: 'pointed', earSize: 0.75, tail: 'horse', tailLen: 0.9, mane: 'horse' } satisfies Partial<Beast>;
const WOLF = { len: 0.95, leg: 0.5, girth: 0.21, neck: 0.32, neckUp: 0.55, head: 0.17, snout: 0.85, snoutR: 0.75, feet: 'paw', ears: 'pointed', tail: 'bushy' } satisfies Partial<Beast>;
const DOG = { len: 0.85, leg: 0.42, girth: 0.19, neck: 0.26, neckUp: 0.65, head: 0.17, snout: 0.7, snoutR: 0.85, feet: 'paw', ears: 'floppy', tail: 'thin', tailUp: 0.35 } satisfies Partial<Beast>;
const BEAR = { len: 1.0, leg: 0.42, girth: 0.33, legR: 0.11, neck: 0.18, neckUp: 0.3, head: 0.21, snout: 0.55, snoutR: 0.95, plantigrade: true, feet: 'paw', ears: 'round', earSize: 0.8, tail: 'stub' } satisfies Partial<Beast>;
const DEER = { len: 0.82, leg: 0.66, girth: 0.2, legR: 0.045, neck: 0.42, neckUp: 0.95, head: 0.15, snout: 0.85, snoutR: 0.8, headDown: 0.45, feet: 'cloven', ears: 'pointed', earSize: 1.35, tail: 'stub' } satisfies Partial<Beast>;
const GOAT = { len: 0.72, leg: 0.44, girth: 0.2, legR: 0.045, neck: 0.27, neckUp: 0.9, head: 0.15, snout: 0.75, snoutR: 0.8, headDown: 0.35, feet: 'cloven', ears: 'floppy', earSize: 0.8, tail: 'stub', beard: true, pupil: 'goat', iris: '#c8a030' } satisfies Partial<Beast>;
const CAT = { len: 0.95, leg: 0.44, girth: 0.21, neck: 0.24, neckUp: 0.45, head: 0.17, snout: 0.3, feet: 'paw', ears: 'round', earSize: 0.8, whiskers: true, tail: 'thin', tailLen: 0.9, tailUp: 0.4 } satisfies Partial<Beast>;
const LION = { len: 1.05, leg: 0.5, girth: 0.25, neck: 0.25, neckUp: 0.45, head: 0.2, snout: 0.32, snoutR: 1.0, feet: 'paw', ears: 'round', earSize: 0.7, whiskers: true, iris: '#d8a030' } satisfies Partial<Beast>;
const RABBIT = { len: 0.4, leg: 0.17, girth: 0.14, legR: 0.035, neck: 0.06, neckUp: 0.9, head: 0.12, snout: 0.25, snoutR: 0.9, ears: 'long', earSize: 2.3, tail: 'stub', feet: 'paw', nose: '#d89090', whiskers: true } satisfies Partial<Beast>;
const FOX = { len: 0.7, leg: 0.32, girth: 0.14, legR: 0.035, neck: 0.2, neckUp: 0.6, head: 0.13, snout: 1.0, snoutR: 0.65, ears: 'pointed', earSize: 1.4, tail: 'bushy', tailLen: 0.7, tailUp: 0.1, feet: 'paw', iris: '#d8a030', pupil: 'slit' } satisfies Partial<Beast>;
const REPTILE = { sprawl: true, ears: 'none', tail: 'thick', iris: '#e8c030', pupil: 'slit', feet: 'paw' } satisfies Partial<Beast>;

/** The ribs and spine of a skeletal horse over a dark body. */
const ribs: Extra = (g, r) => {
  const bone = skin('#e8e2cc', { rough: 0.6 }), G = 0.25, cy = r.back[1] - G * 1.05;
  for (let i = 0; i < 6; i++) { const z = 0.3 - i * 0.1; tube(g, [[-G * 1.02, cy - G * 0.55, z], [-G * 0.92, cy + G * 0.55, z - 0.02], [0, cy + G * 1.12, z - 0.04], [G * 0.92, cy + G * 0.55, z - 0.02], [G * 1.02, cy - G * 0.55, z]], () => 0.022, bone, { sides: 6 }); }
  for (let i = 0; i < 9; i++) blob(g, [0.035, 0.04, 0.035], bone, [0, cy + G * 1.12, 0.45 - i * 0.12]);
  blob(g, [G * 0.9, G * 0.5, G * 0.6], bone, [0, cy + G * 0.35, -0.45]);
};
/** A chimera's goat and dragon heads beside the lion's. */
const chimeraHeads: Extra = (g, r) => {
  neckHead(g, add3(r.neckBase, [0.16, 0.05, -0.05]), [0.55, 0.75, 0.3], 0.32, 0.18, { c: '#8a8580', belly: '#d8d0c0', len: 0, leg: 0, girth: 0, neck: 0.32, neckUp: 0.8, head: 0.15, snout: 0.7, snoutR: 0.8, headDown: 0.3, feet: 'cloven', ears: 'floppy', earSize: 0.8, horns: 'goat', beard: true, pupil: 'goat', iris: '#c8a030' }, undefined, 0.3);
  neckHead(g, add3(r.neckBase, [-0.16, 0.05, -0.05]), [-0.55, 0.75, 0.3], 0.36, 0.18, { c: '#a8281e', belly: '#e8a050', len: 0, leg: 0, girth: 0, neck: 0.36, neckUp: 0.8, head: 0.15, snout: 1.0, snoutR: 0.85, headDown: 0.1, feet: 'talon', ears: 'fin', earSize: 0.7, horns: 'dragon', fangs: true, eye: '#ffcf3a', eyeGlow: 1 }, undefined, -0.3);
};
/** A displacer beast's two shoulder tentacles with spiked pads. */
const displacerTentacles: Extra = (g, r) => {
  const m = skin('#2a2e4a', { rough: 0.7 });
  for (const x of [-1, 1]) {
    const tip: V3 = [x * 0.7, r.back[1] + 0.85, 0.35];
    tentacle(g, [[x * 0.12, r.back[1] - 0.02, 0.2], [x * 0.35, r.back[1] + 0.55, -0.05], tip], 0.06, m);
    blob(g, [0.12, 0.07, 0.16], m, tip);
    for (let k = 0; k < 5; k++) claw(g, tip, [Math.cos(k * 1.26) * 0.8, Math.sin(k * 1.26) * 0.8, 0.5], 0.14, 0.025, skin('#e8dcc0'), 0);
  }
};

/** Every model with its default size, colour and builder. */
export const CREATURES: Record<string, { label: string; group: 'Beasts' | 'Mounts' | 'Monstrosities' | 'Dragons' | 'Aberrations' | 'Elementals & oozes' | 'Constructs & plants' | 'Undead & spirits' | 'Fiends'; size: string; flies?: boolean; mount?: boolean; /** scale when ridden by a medium hero (default: the size class) */ ride?: number; build: Builder }> = {
  // beasts
  wolf: { label: 'Wolf', group: 'Beasts', size: 'medium', build: B({ ...WOLF, c: '#7d7a72', belly: '#d2ccc0', mane: 'ruff', hair: '#8a867e', iris: '#d8a030' }) },
  dog: { label: 'Dog / hound', group: 'Beasts', size: 'medium', build: B({ ...DOG, c: '#8a6a45', belly: '#e0cca4', iris: '#5a3a1a' }) },
  hyena: { label: 'Hyena', group: 'Beasts', size: 'medium', build: B({ c: '#a08858', belly: '#c8b088', socks: '#6a5236', len: 0.85, leg: 0.48, girth: 0.21, chest: 1.3, neck: 0.25, neckUp: 0.45, head: 0.18, snout: 0.6, snoutR: 0.95, feet: 'paw', ears: 'round', earSize: 1.2, tail: 'bushy', tailLen: 0.35, mane: 'horse', hair: '#3a2a1a', pattern: { kind: 'spotted', mark: '#4a3a2a' }, iris: '#6a4a1a' }) },
  bear: { label: 'Bear', group: 'Beasts', size: 'large', build: B({ ...BEAR, c: '#5a3a22', belly: '#7a5a3a', iris: '#3a2210' }) },
  polarbear: { label: 'Polar bear', group: 'Beasts', size: 'large', build: B({ ...BEAR, c: '#f2ecdc', belly: '#e6dece', nose: '#1a1612', neck: 0.3, head: 0.19, snout: 0.75, snoutR: 0.85, earSize: 0.7 }) },
  boar: { label: 'Boar', group: 'Beasts', size: 'medium', build: B({ c: '#4a3a2a', belly: '#5a4a3a', nose: '#3a2a22', len: 0.8, leg: 0.3, girth: 0.26, chest: 1.2, neck: 0.08, neckUp: 0.1, head: 0.2, snout: 0.75, snoutR: 0.8, headDown: 0.25, tusks: true, mane: 'horse', hair: '#2a2018', feet: 'cloven', ears: 'pointed', earSize: 0.8, tail: 'thin', tailLen: 0.25 }) },
  deer: { label: 'Deer / elk', group: 'Beasts', size: 'large', build: B({ ...DEER, c: '#9a6a3a', belly: '#e8d8b8', horns: 'antler', iris: '#2a1a10' }) },
  goat: { label: 'Goat / ram', group: 'Beasts', size: 'medium', build: B({ ...GOAT, c: '#d8d0c0', belly: '#e8e2d6', hair: '#c0b8a8', horns: 'ram' }) },
  ox: { label: 'Ox / bull', group: 'Beasts', size: 'large', build: B({ c: '#5a3a22', belly: '#6a4a2e', nose: '#3a2a22', len: 1.05, leg: 0.45, girth: 0.33, legR: 0.09, neck: 0.15, neckUp: 0.25, head: 0.22, snout: 0.55, snoutR: 1.15, headDown: 0.3, horns: 'bull', hump: true, feet: 'cloven', ears: 'floppy', earSize: 0.7, tail: 'tuft', tailLen: 0.7 }) },
  cat: { label: 'Big cat (lion, panther, tiger)', group: 'Beasts', size: 'large', build: B({ ...LION, c: '#c8963a', belly: '#ecd8ae', tail: 'tuft', tailLen: 1.0, mane: 'lion', hair: '#7a4a1a' }) },
  panther: { label: 'Panther', group: 'Beasts', size: 'medium', build: B({ ...CAT, c: '#2a2a2e', belly: '#34343a', eye: '#e8c030', eyeGlow: 0.5 }) },
  tiger: { label: 'Tiger', group: 'Beasts', size: 'large', build: B({ ...LION, c: '#d8742a', belly: '#f2ecdc', tail: 'thin', tailLen: 0.95, tailUp: 0.2, pattern: { kind: 'tiger', mark: '#1a1612' } }) },
  sabertooth: { label: 'Sabre-toothed cat', group: 'Beasts', size: 'large', build: B({ ...LION, c: '#c8a060', belly: '#ecdcb8', girth: 0.28, sabre: true, tail: 'stub', earSize: 0.6 }) },
  rat: { label: 'Giant rat', group: 'Beasts', size: 'small', build: B({ c: '#6a5a4a', belly: '#a89a8a', nose: '#d89090', len: 0.55, leg: 0.2, girth: 0.15, legR: 0.035, neck: 0.08, neckUp: 0.2, head: 0.12, snout: 0.95, snoutR: 0.7, feet: 'paw', ears: 'round', earSize: 1.4, tail: 'thin', tailLen: 0.9, tailUp: -0.3, eye: '#b3261e', eyeGlow: 0.4, whiskers: true }) },
  weasel: { label: 'Weasel / giant weasel', group: 'Beasts', size: 'small', build: B({ c: '#8a5a32', belly: '#f2e6d0', len: 0.75, leg: 0.16, girth: 0.11, legR: 0.03, neck: 0.2, neckUp: 0.4, head: 0.1, snout: 0.65, snoutR: 0.75, feet: 'paw', ears: 'round', earSize: 0.8, tail: 'thin', tailLen: 0.5, tailUp: 0.1, iris: '#1a1210', whiskers: true }) },
  crocodile: { label: 'Crocodile / giant lizard', group: 'Beasts', size: 'large', build: B({ ...REPTILE, c: '#4a5a32', belly: '#a0a070', len: 1.0, leg: 0.16, girth: 0.2, legR: 0.05, neck: 0.1, neckUp: 0.05, head: 0.15, snout: 2.2, snoutR: 0.7, headDown: 0, tailLen: 1.2, ridge: '#3a4a22', ridgeLen: 0.35, fangs: true }) },
  lizard: { label: 'Giant lizard', group: 'Mounts', size: 'large', mount: true, build: B({ ...REPTILE, c: '#5a7a4a', belly: '#c8c090', len: 0.95, leg: 0.28, girth: 0.24, neck: 0.22, neckUp: 0.35, head: 0.16, snout: 0.85, snoutR: 0.8, headDown: 0.1, tailLen: 1.0, saddle: true }, { seat: true }) },
  elephant: { label: 'Elephant / mammoth', group: 'Beasts', size: 'huge', build: B({ c: '#8a8580', belly: '#8a8580', len: 0.95, leg: 0.66, girth: 0.42, legR: 0.14, neck: 0.08, neckUp: 0.2, head: 0.3, snout: 0.15, snoutR: 1.1, headDown: 0.3, ears: 'floppy', earSize: 2.2, trunk: true, tusks: true, tail: 'tuft', tailLen: 0.6, feet: 'pad' }) },
  mammoth: { label: 'Mammoth', group: 'Beasts', size: 'huge', build: B({ c: '#6a4a2a', belly: '#6a4a2a', hair: '#4a321e', len: 0.95, leg: 0.62, girth: 0.45, legR: 0.15, neck: 0.08, neckUp: 0.25, head: 0.3, snout: 0.15, headDown: 0.3, ears: 'round', earSize: 0.7, trunk: true, tusks: true, hump: true, mane: 'ruff', tail: 'tuft', feet: 'pad' }) },
  ape: { label: 'Ape', group: 'Beasts', size: 'medium', build: (g) => { brute(g, { c: '#3a3632', c2: '#5a524a', height: 1.8, bulk: 1.1, armLen: 1.25, hunch: 0.5, head: 'ape', fur: true, ears: 'small' }); } },
  frog: { label: 'Giant frog / toad', group: 'Beasts', size: 'medium', build: (g) => { X.frog(g, '#5a8a3a'); } },
  shark: { label: 'Shark', group: 'Beasts', size: 'large', build: (g) => { X.fish(g, '#6a7a8a', true); } },
  fish: { label: 'Giant fish', group: 'Beasts', size: 'medium', build: (g) => { X.fish(g, '#3a8a9a', false); } },
  snake: { label: 'Snake / constrictor', group: 'Beasts', size: 'large', build: (g) => { serpent(g, { c: '#5a7a3a', belly: '#c8c090', len: 1.8, r: 0.12, pattern: { kind: 'blotch', mark: '#3a4a22' } }); } },
  cobra: { label: 'Cobra / viper', group: 'Beasts', size: 'medium', build: (g) => { serpent(g, { c: '#8a6a2a', belly: '#e8d4a6', len: 1.4, r: 0.1, hood: true, rise: 0.75, pattern: { kind: 'banded', mark: '#4a3a1a' } }); } },
  spider: { label: 'Giant spider', group: 'Beasts', size: 'large', build: (g, tint) => { arthropod(g, { kind: 'spider', c: tint ?? '#2a2622', c2: tint ? tone(tint, 0.7) : '#1a1614', ...(tint ? { glow: 0.8 } : {}) }); } },
  scorpion: { label: 'Giant scorpion', group: 'Beasts', size: 'large', build: (g) => { arthropod(g, { kind: 'scorpion', c: '#7a4a2a', c2: '#4a2a1a' }); } },
  beetle: { label: 'Giant beetle', group: 'Beasts', size: 'medium', build: (g) => { arthropod(g, { kind: 'beetle', c: '#2d4a5a', c2: '#1a2a32' }); } },
  crab: { label: 'Giant crab', group: 'Beasts', size: 'medium', build: (g) => { arthropod(g, { kind: 'crab', c: '#b3402a', c2: '#7a2a1a' }); } },
  centipede: { label: 'Giant centipede', group: 'Beasts', size: 'small', build: (g) => { arthropod(g, { kind: 'centipede', c: '#7a3a1a', c2: '#3a1a0a' }); } },
  eagle: { label: 'Eagle / hawk', group: 'Beasts', size: 'small', flies: true, build: (g, _t, _v, air) => ({ wings: avian(g, { c: '#5a3a22', c2: '#7a5a3a', headC: '#f2ecdc', beak: '#e8b030', legs: '#e8b030', size: 1, hooked: true, eyeColour: '#e8a020' }, air) }) },
  owl: { label: 'Owl', group: 'Beasts', size: 'small', flies: true, build: (g, _t, _v, air) => ({ wings: avian(g, { c: '#8a6a45', c2: '#d8c49a', beak: '#3a3632', legs: '#d8c49a', size: 1, owl: true }, air) }) },
  raven: { label: 'Raven / crow', group: 'Beasts', size: 'tiny', flies: true, build: (g, _t, _v, air) => ({ wings: avian(g, { c: '#1a1a22', c2: '#2a2a36', beak: '#2a2a2e', legs: '#2a2a2e', size: 0.9 }, air) }) },
  vulture: { label: 'Vulture', group: 'Beasts', size: 'medium', flies: true, build: (g, _t, _v, air) => ({ wings: avian(g, { c: '#3a2a22', c2: '#5a4a3a', headC: '#c88a7a', beak: '#d8c49a', legs: '#8a8070', size: 1.1, neck: 0.2, hooked: true }, air) }) },
  roc: { label: 'Roc / giant eagle', group: 'Mounts', size: 'large', flies: true, mount: true, build: (g, _t, _v, air) => ({ wings: avian(g, { c: '#6a4a2a', c2: '#d8c49a', beak: '#e8b030', legs: '#e8b030', size: 1.4, crest: true, hooked: true, eyeColour: '#e8a020' }, air), seat: [0, 1.18, 0] }) },
  bat: { label: 'Bat', group: 'Beasts', size: 'small', flies: true, build: (g, _t, _v, air) => ({ wings: X.bat(g, !!air) }) },
  // mounts
  horse: { label: 'Horse', group: 'Mounts', size: 'large', mount: true, build: B({ ...HORSE, c: '#7a4a2a', belly: '#8a5a3a', nose: '#2a1a12', hair: '#2a1a12', iris: '#2a1a12' }, { seat: true }) },
  warhorse: { label: 'Warhorse (barding)', group: 'Mounts', size: 'large', mount: true, build: B({ ...HORSE, c: '#3a3632', belly: '#3a3632', nose: '#1a1612', hair: '#1a1612', girth: 0.31, saddle: true, barding: '#8a2a22' }, { seat: true }) },
  pony: { label: 'Pony / mule', group: 'Mounts', size: 'medium', mount: true, ride: 1.45, build: B({ ...HORSE, c: '#a0784a', belly: '#b08858', nose: '#2a1a12', hair: '#4a3a2a', len: 0.75, leg: 0.45, girth: 0.25, legR: 0.06, neck: 0.35, headDown: 0.7, head: 0.17, snout: 1.1, snoutR: 0.8, tailLen: 0.6, saddle: true }, { seat: true }) },
  camel: { label: 'Camel', group: 'Mounts', size: 'large', mount: true, build: B({ c: '#c8a070', belly: '#d8b890', len: 0.85, leg: 0.78, girth: 0.25, legR: 0.055, neck: 0.6, neckUp: 0.55, head: 0.15, snout: 0.9, snoutR: 0.8, headDown: 0, hump: true, ears: 'small', feet: 'pad', tail: 'tuft', saddle: true }, { seat: true }) },
  wardog: { label: 'War wolf / worg', group: 'Mounts', size: 'large', mount: true, build: B({ ...WOLF, c: '#4a4440', belly: '#7a746c', hair: '#3a3430', len: 1.05, leg: 0.52, girth: 0.26, neck: 0.3, neckUp: 0.5, head: 0.2, snout: 0.8, snoutR: 0.85, mane: 'ruff', saddle: true, eye: '#e8c030', eyeGlow: 0.6, fangs: true }, { seat: true }) },
  pegasus: { label: 'Pegasus', group: 'Mounts', size: 'large', flies: true, mount: true, build: B({ ...HORSE, c: '#f2ecdc', belly: '#f2ecdc', nose: '#8a8580', hair: '#e8dcc0' }, { seat: true, wings: { kind: 'feather', span: 1.3, c1: '#f2ecdc', c2: '#e8dcc0' } }) },
  unicorn: { label: 'Unicorn', group: 'Mounts', size: 'large', mount: true, build: B({ ...HORSE, c: '#f8f4ec', belly: '#f8f4ec', nose: '#d8b25a', hair: '#e8d4a6', horns: 'unicorn', iris: '#5a7ad8' }, { seat: true }) },
  nightmare: { label: 'Nightmare', group: 'Mounts', size: 'large', mount: true, build: B({ ...HORSE, c: '#1a1612', belly: '#1a1612', nose: '#3a2a22', hair: '#ff7a2a', mane: 'flame', eye: '#ff6a2a', eyeGlow: 1.2 }, { seat: true }) },
  griffon: { label: 'Griffon', group: 'Mounts', size: 'large', flies: true, mount: true, build: B({ c: '#c8963a', belly: '#e0b870', face: '#f2ecdc', hair: '#f2ecdc', beak: 'eagle', feet: 'talon', rearFeet: 'paw', len: 0.9, leg: 0.45, girth: 0.25, neck: 0.3, neckUp: 0.8, head: 0.2, snout: 0, ears: 'none', mane: 'ruff', tail: 'tuft', tailLen: 0.8, iris: '#e8a020' }, { seat: true, wings: { kind: 'feather', span: 1.25, c1: '#7a5a32', c2: '#f2ecdc' } }) },
  hippogriff: { label: 'Hippogriff', group: 'Mounts', size: 'large', flies: true, mount: true, build: B({ ...HORSE, c: '#8a6a45', belly: '#9a7a55', face: '#d8c49a', hair: '#d8c49a', nose: '#2a1a12', beak: 'eagle', feet: 'talon', rearFeet: 'hoof', mane: 'ruff', ears: 'none', headDown: 0.2, neckUp: 0.8, snout: 0, iris: '#e8a020' }, { seat: true, wings: { kind: 'feather', span: 1.2, c1: '#6a4a2a', c2: '#d8c49a' } }) },
  // monstrosities
  owlbear: { label: 'Owlbear', group: 'Monstrosities', size: 'large', build: B({ ...BEAR, c: '#6a4a2a', belly: '#8a6a45', face: '#d8c49a', hair: '#8a6a45', beak: 'owl', snout: 0, head: 0.25, mane: 'ruff', ears: 'none', iris: '#e8c030' }) },
  basilisk: { label: 'Basilisk', group: 'Monstrosities', size: 'medium', build: B({ ...REPTILE, c: '#4a6a3a', belly: '#a8a870', len: 1.1, leg: 0.2, girth: 0.22, legPairs: 3, neck: 0.15, neckUp: 0.25, head: 0.17, snout: 0.7, snoutR: 0.85, tailLen: 0.9, ridge: '#2a3a1a', eye: '#7ad84a', eyeGlow: 1.2, fangs: true }) },
  manticore: { label: 'Manticore', group: 'Monstrosities', size: 'large', flies: true, build: B({ ...LION, c: '#b3542a', belly: '#d8844a', mane: 'lion', hair: '#5a2a1a', tail: 'sting', tailLen: 0.7, claws: '#2a1a12', fangs: true, iris: '#e8c030' }, { wings: { kind: 'membrane', span: 1.15, c1: '#5a2a1a', c2: '#7a3a2a' } }) },
  hydra: { label: 'Hydra', group: 'Monstrosities', size: 'huge', build: (g) => { X.hydra(g, '#3a6a4a', '#a8a870'); } },
  worm: { label: 'Giant worm (purple worm)', group: 'Monstrosities', size: 'gargantuan', build: (g) => { serpent(g, { c: '#5a2a6e', belly: '#8a5aa0', len: 1.6, r: 0.24, worm: true, rise: 1.3, pattern: { kind: 'banded', mark: '#4a1e5a' } }); } },
  mimic: { label: 'Mimic', group: 'Monstrosities', size: 'medium', build: (g) => { X.mimic(g); } },
  rustmonster: { label: 'Rust monster', group: 'Monstrosities', size: 'medium', build: B({ c: '#b87333', belly: '#d8a060', len: 0.8, leg: 0.28, girth: 0.27, neck: 0.1, neckUp: 0.2, head: 0.18, snout: 0.35, ears: 'none', antennae: '#7a4a1a', tail: 'spade', ridge: '#7a4a1a', plates: true, feet: 'paw', iris: '#1a1210' }) },
  // dragons
  dragon: { label: 'Dragon (wyrmling to ancient)', group: 'Dragons', size: 'huge', flies: true, build: (g, tint, _v, air) => ({ wings: dragon(g, { ...dragonColours(tint), kind: 'dragon' }, air) }) },
  wyvern: { label: 'Wyvern', group: 'Dragons', size: 'large', flies: true, mount: true, build: (g, _t, _v, air) => ({ wings: dragon(g, { c: '#5a5a3a', c2: '#8a8a5a', horn: '#2a2a1a', kind: 'wyvern' }, air), seat: [0, 1.03, 0] }) },
  drake: { label: 'Drake (wingless)', group: 'Dragons', size: 'medium', mount: true, ride: 1.6, build: (g, tint) => { dragon(g, { ...dragonColours(tint ?? 'green'), kind: 'drake' }); return { seat: [0, 0.95, 0] }; } },
  pseudodragon: { label: 'Pseudodragon', group: 'Dragons', size: 'tiny', flies: true, build: (g, _t, _v, air) => ({ wings: dragon(g, { c: '#b87a3a', c2: '#e8c090', horn: '#5a3a1a', kind: 'dragon', tail: 'sting', eye: '#e8a020' }, air) }) },
  // aberrations
  beholder: { label: 'Beholder (eye tyrant)', group: 'Aberrations', size: 'large', flies: true, build: (g) => { X.beholder(g, '#7a3a5a'); } },
  aboleth: { label: 'Aboleth', group: 'Aberrations', size: 'large', build: (g) => { X.tentacled(g, 'aboleth', '#5a7a8a'); } },
  otyugh: { label: 'Otyugh', group: 'Aberrations', size: 'large', build: (g) => { X.tentacled(g, 'otyugh', '#7a6a4a'); } },
  mouther: { label: 'Gibbering mouther', group: 'Aberrations', size: 'medium', build: (g) => { X.tentacled(g, 'mouther', '#9a6a7a'); } },
  octopus: { label: 'Octopus / kraken spawn', group: 'Aberrations', size: 'large', build: (g) => { X.tentacled(g, 'octopus', '#b3542a'); } },
  // elementals & oozes
  fire: { label: 'Fire elemental', group: 'Elementals & oozes', size: 'large', build: (g) => { X.elemental(g, 'fire'); } },
  water: { label: 'Water elemental', group: 'Elementals & oozes', size: 'large', build: (g) => { X.elemental(g, 'water'); } },
  air: { label: 'Air elemental', group: 'Elementals & oozes', size: 'large', flies: true, build: (g) => { X.elemental(g, 'air'); } },
  earth: { label: 'Earth elemental', group: 'Elementals & oozes', size: 'large', build: (g) => { X.elemental(g, 'earth'); } },
  ooze: { label: 'Ooze / slime / pudding', group: 'Elementals & oozes', size: 'large', build: (g, tint) => { X.ooze(g, tint ?? '#5aa040'); } },
  cube: { label: 'Gelatinous cube', group: 'Elementals & oozes', size: 'large', build: (g) => { X.ooze(g, '#7ad8a0', true); } },
  wisp: { label: 'Will-o’-wisp', group: 'Elementals & oozes', size: 'tiny', flies: true, build: (g) => { X.wisp(g); return { height: 1.6 }; } },
  // constructs & plants
  golem: { label: 'Golem (stone / iron / clay)', group: 'Constructs & plants', size: 'large', build: (g, tint) => { X.golem(g, tint ?? '#8a847a', '#7ad8ff', tint === '#5a5f68' ? 'iron' : tint === '#a0704a' || tint === '#b88a7a' ? 'clay' : 'stone'); } },
  armor: { label: 'Animated armour', group: 'Constructs & plants', size: 'medium', build: (g) => { X.armour(g); } },
  gargoyle: { label: 'Gargoyle', group: 'Constructs & plants', size: 'medium', flies: true, build: (g, _t, _v, air) => { brute(g, { c: '#6a6660', c2: '#5a5650', height: 1.8, bulk: 0.9, hunch: 0.65, head: 'beast', horns: 'demon', ears: 'pointed', tail: 'spade', claws: true, flat: true, eye: '#e83a2a', eyeGlow: 1 }); return { wings: pair((x) => [x * 0.2, 1.35, -0.15], 'membrane', 1.0, '#6a6660', '#5a5650', air, g, 0.3) }; } },
  treant: { label: 'Treant / awakened tree', group: 'Constructs & plants', size: 'huge', build: (g) => { X.treant(g); } },
  shambling: { label: 'Shambling mound / blight', group: 'Constructs & plants', size: 'large', build: (g) => { X.treant(g, true); } },
  // undead & spirits
  ghost: { label: 'Ghost / specter / wraith', group: 'Undead & spirits', size: 'medium', flies: true, build: (g, tint) => { X.ghost(g, tint ?? '#bfd8e8'); } },
  // fiends
  demon: { label: 'Demon / devil (large)', group: 'Fiends', size: 'large', flies: true, build: (g, _t, _v, air) => { brute(g, { c: '#8a2a1a', c2: '#5a1a10', height: 2.2, bulk: 1.05, head: 'beast', horns: 'demon', ears: 'pointed', tail: 'spade', claws: true, hooves: true, eye: '#ffcf3a', eyeGlow: 1.2 }); return { wings: pair((x) => [x * 0.24, 1.55, -0.2], 'membrane', 1.25, '#5a1a10', '#7a2a1a', air, g, 0.3) }; } },
  devil: { label: 'Barbed devil', group: 'Fiends', size: 'medium', build: (g) => { brute(g, { c: '#7a2a22', c2: '#5a1a14', height: 2.0, bulk: 0.9, head: 'beast', horns: 'demon', ears: 'pointed', tail: 'spade', claws: true, spikes: '#2a1a14', eye: '#ffcf3a', eyeGlow: 1.2 }); } },
  imp: { label: 'Imp', group: 'Fiends', size: 'tiny', flies: true, build: (g, _t, _v, air) => { brute(g, { c: '#a8281e', c2: '#c8483a', height: 1.15, bulk: 0.72, armLen: 0.95, hunch: 0.3, head: 'imp', horns: 'demon', ears: 'pointed', tail: 'spade', claws: true, eye: '#ffcf3a', eyeGlow: 1.2 }); return { wings: pair((x) => [x * 0.12, 0.86, -0.12], 'membrane', 0.6, '#7a1a14', '#a8281e', air, g, 0.6) }; } },
  quasit: { label: 'Quasit', group: 'Fiends', size: 'tiny', build: (g) => { brute(g, { c: '#5a7a3a', c2: '#7a9a4a', height: 1.0, bulk: 0.65, armLen: 1.15, hunch: 0.5, head: 'imp', horns: 'curl', ears: 'pointed', claws: true, eye: '#e8e070', eyeGlow: 1, tail: 'thin' }); } },
  vrock: { label: 'Vrock (vulture demon)', group: 'Fiends', size: 'large', flies: true, build: (g, _t, _v, air) => { brute(g, { c: '#5a6a5a', c2: '#7a8a6a', height: 2.3, bulk: 1.0, hunch: 0.45, head: 'vulture', claws: true, eye: '#ff4a2a', eyeGlow: 1.2 }); return { wings: pair((x) => [x * 0.24, 1.6, -0.2], 'feather', 1.3, '#3a4a3a', '#5a6a5a', air, g, 0.4) }; } },
  minotaur: { label: 'Minotaur', group: 'Monstrosities', size: 'large', build: (g) => { brute(g, { c: '#5a3a22', c2: '#7a5a3a', height: 2.2, bulk: 1.1, head: 'bull', fur: true, hair: '#3a2414', tail: 'tuft', hooves: true, loincloth: '#6a2a1a' }); } },
  yeti: { label: 'Yeti', group: 'Monstrosities', size: 'large', build: (g) => { brute(g, { c: '#e8e4dc', c2: '#a8b8c8', height: 2.1, bulk: 1.15, armLen: 1.2, hunch: 0.4, head: 'ape', fur: true, claws: true, ears: 'small', eye: '#7ab8e8' }); } },
  troll: { label: 'Troll', group: 'Monstrosities', size: 'large', build: (g) => { brute(g, { c: '#5a7a4a', c2: '#7a9a62', height: 2.4, bulk: 0.85, armLen: 1.3, hunch: 0.6, head: 'troll', ears: 'pointed', claws: true, hair: '#2a3a22', eye: '#e8c030', loincloth: '#4a3a2a' }); } },
  ogre: { label: 'Ogre', group: 'Monstrosities', size: 'large', build: (g) => { brute(g, { c: '#b08a62', c2: '#c8a07a', height: 2.3, bulk: 1.3, hunch: 0.3, head: 'ogre', tusks: true, belly: true, ears: 'small', loincloth: '#6a4a2a', club: true, eye: '#5a3a1a' }); } },
  ettin: { label: 'Ettin (two-headed giant)', group: 'Monstrosities', size: 'large', build: (g) => { brute(g, { c: '#8a7a62', c2: '#a08a6a', height: 2.5, bulk: 1.35, hunch: 0.25, head: 'ogre', heads: 2, tusks: true, ears: 'small', loincloth: '#4a3a2a', club: true, fur: true, hair: '#5a4a32', eye: '#4a2a12' }); } },
  hellhound: { label: 'Hell hound', group: 'Fiends', size: 'medium', build: B({ ...DOG, c: '#3a1a12', belly: '#5a2a1a', ears: 'pointed', tail: 'thin', tailUp: 0.4, mane: 'flame', eye: '#ffcf3a', eyeGlow: 1.4, fangs: true, claws: '#1a1210' }) },
  // ---------------------------------------------------------------- APEX 2.3: farm, wild and small animals
  rabbit: { label: 'Rabbit / hare', group: 'Beasts', size: 'tiny', build: B({ ...RABBIT, c: '#a08868', belly: '#e8dcc8' }) },
  squirrel: { label: 'Squirrel', group: 'Beasts', size: 'tiny', build: B({ c: '#b0602a', belly: '#f2dcc0', len: 0.38, leg: 0.16, girth: 0.11, legR: 0.03, neck: 0.06, neckUp: 0.8, head: 0.1, snout: 0.35, ears: 'pointed', earSize: 1.1, tail: 'bushy', tailLen: 0.55, tailUp: 1.4, feet: 'paw' }) },
  hedgehog: { label: 'Hedgehog', group: 'Beasts', size: 'tiny', build: B({ c: '#e8d4b8', belly: '#e8d4b8', len: 0.32, leg: 0.08, girth: 0.15, legR: 0.03, neck: 0.04, neckUp: 0.1, head: 0.1, snout: 0.7, snoutR: 0.7, ears: 'round', earSize: 0.6, spines: true, tail: 'none', feet: 'paw' }) },
  fox: { label: 'Fox', group: 'Beasts', size: 'small', build: B({ ...FOX, c: '#d0642a', belly: '#f2ecdc', socks: '#2a1a12', hair: '#f2ecdc' }) },
  badger: { label: 'Badger', group: 'Beasts', size: 'small', build: B({ c: '#5a5a5a', belly: '#2a2a2a', face: '#e8e4dc', socks: '#2a2a2a', len: 0.6, leg: 0.14, girth: 0.17, legR: 0.045, neck: 0.08, neckUp: 0.15, head: 0.13, snout: 0.7, snoutR: 0.8, plantigrade: true, ears: 'round', earSize: 0.6, tail: 'stub', feet: 'paw' }) },
  housecat: { label: 'Cat', group: 'Beasts', size: 'tiny', build: B({ c: '#8a8580', belly: '#e0d8c8', len: 0.62, leg: 0.3, girth: 0.13, legR: 0.035, neck: 0.16, neckUp: 0.75, head: 0.13, snout: 0.22, snoutR: 0.8, feet: 'paw', ears: 'pointed', earSize: 1.1, tail: 'thin', tailLen: 0.75, tailUp: 0.55, iris: '#d8c030', pupil: 'slit', whiskers: true, pattern: { kind: 'tiger', mark: '#3a3530' } }) },
  sheep: { label: 'Sheep / ram / lamb', group: 'Beasts', size: 'medium', build: B({ c: '#f2ecdc', belly: '#e8e0cc', face: '#2a2622', socks: '#2a2622', wool: true, len: 0.72, leg: 0.36, girth: 0.27, legR: 0.045, neck: 0.16, neckUp: 0.55, head: 0.15, snout: 0.55, snoutR: 0.85, headDown: 0.3, ears: 'floppy', earSize: 0.9, tail: 'stub', horns: 'ram', feet: 'cloven' }) },
  cow: { label: 'Cow / bull / calf', group: 'Beasts', size: 'large', build: B({ c: '#f2ecdc', belly: '#f2ecdc', nose: '#e8a0a0', len: 1.05, leg: 0.46, girth: 0.32, legR: 0.08, neck: 0.18, neckUp: 0.3, head: 0.2, snout: 0.65, snoutR: 1.05, headDown: 0.3, horns: 'bull', ears: 'floppy', earSize: 0.8, tail: 'tuft', tailLen: 0.75, feet: 'cloven', pattern: { kind: 'blotch', mark: '#2a2622' } }) },
  pig: { label: 'Pig / sow / piglet', group: 'Beasts', size: 'medium', build: B({ c: '#e8a8a0', belly: '#f0b8b0', nose: '#d88880', len: 0.8, leg: 0.24, girth: 0.27, legR: 0.06, neck: 0.06, neckUp: 0.1, head: 0.19, snout: 0.45, snoutR: 0.95, headDown: 0.15, ears: 'floppy', earSize: 0.9, tail: 'curl', feet: 'cloven' }) },
  chicken: { label: 'Chicken / rooster', group: 'Beasts', size: 'tiny', flies: true, build: (g, _t, v, air) => ({ wings: avian(g, { c: v === 'female' ? '#c8946a' : '#f2ecdc', c2: v === 'female' ? '#e8c8a0' : '#e8d4b8', beak: '#e8b030', legs: '#e8b030', size: 0.75, comb: true, legLen: 0.22, tailLen: v === 'female' ? 0.25 : 0.42 }, air) }) },
  duck: { label: 'Duck / goose', group: 'Beasts', size: 'tiny', flies: true, build: (g, _t, _v, air) => ({ wings: avian(g, { c: '#7a6a52', c2: '#c8b890', headC: '#2a6a3a', beak: '#e8a030', legs: '#e8a030', size: 0.75, duck: true, legLen: 0.15, neck: 0.16 }, air) }) },
  swan: { label: 'Swan', group: 'Beasts', size: 'small', flies: true, build: (g, _t, _v, air) => ({ wings: avian(g, { c: '#f8f4ec', c2: '#e8e4dc', beak: '#e87830', legs: '#2a2622', size: 1, duck: true, longNeck: true, legLen: 0.12 }, air) }) },
  billygoat: { label: 'Billy goat', group: 'Beasts', size: 'medium', build: B({ ...GOAT, c: '#8a6a45', belly: '#d8c49a', hair: '#5a4a3a', horns: 'goat' }) },
  donkey: { label: 'Donkey', group: 'Mounts', size: 'medium', mount: true, ride: 1.45, build: B({ ...HORSE, c: '#8a8580', belly: '#e8e4dc', nose: '#3a3632', hair: '#3a3632', len: 0.82, leg: 0.55, girth: 0.24, legR: 0.055, neck: 0.38, neckUp: 0.85, neckR: 1.1, headDown: 0.6, head: 0.18, snout: 1.1, snoutR: 0.8, ears: 'long', earSize: 1.9, tail: 'tuft', saddle: true }, { seat: true }) },
  zebra: { label: 'Zebra', group: 'Beasts', size: 'large', build: B({ ...HORSE, c: '#f2ecdc', belly: '#f2ecdc', nose: '#1a1612', hair: '#1a1612', tail: 'tuft', tailLen: 0.7, pattern: { kind: 'zebra', mark: '#1a1612' } }) },
  llama: { label: 'Llama / alpaca', group: 'Mounts', size: 'medium', mount: true, ride: 1.45, build: B({ c: '#e8dcc0', belly: '#e8dcc0', wool: true, len: 0.7, leg: 0.55, girth: 0.22, legR: 0.045, neck: 0.6, neckUp: 1.35, head: 0.13, snout: 0.6, snoutR: 0.75, headDown: 0.1, ears: 'long', earSize: 1.4, feet: 'pad', tail: 'stub' }, { seat: true }) },
  bison: { label: 'Bison / buffalo / yak', group: 'Beasts', size: 'large', build: B({ c: '#4a3222', belly: '#4a3222', hair: '#2a1a12', len: 1.05, leg: 0.4, girth: 0.35, legR: 0.09, neck: 0.1, neckUp: 0.1, head: 0.22, snout: 0.45, snoutR: 1.1, headDown: 0.6, horns: 'bull', hump: true, mane: 'ruff', beard: true, feet: 'cloven', tail: 'tuft', ears: 'round', earSize: 0.6 }) },
  rhino: { label: 'Rhinoceros', group: 'Beasts', size: 'large', build: B({ c: '#8a8580', belly: '#8a8580', len: 1.05, leg: 0.36, girth: 0.36, legR: 0.12, neck: 0.08, neckUp: 0.15, head: 0.24, snout: 0.8, snoutR: 0.95, headDown: 0.4, horns: 'rhino', ears: 'pointed', earSize: 0.8, feet: 'pad', tail: 'thin', tailLen: 0.3 }) },
  hippo: { label: 'Hippopotamus', group: 'Beasts', size: 'large', build: B({ c: '#8a6a7a', belly: '#d8a8b0', len: 1.05, leg: 0.24, girth: 0.42, legR: 0.14, neck: 0.05, neckUp: 0.1, head: 0.3, snout: 0.55, snoutR: 1.35, headDown: 0.05, ears: 'round', earSize: 0.4, tusks: true, feet: 'pad', tail: 'stub' }) },
  giraffe: { label: 'Giraffe', group: 'Beasts', size: 'huge', build: B({ c: '#f0d4a0', belly: '#f2e2c0', hair: '#8a4a1a', len: 0.8, leg: 1.0, girth: 0.22, legR: 0.05, neck: 1.3, neckUp: 1.25, head: 0.14, snout: 0.9, snoutR: 0.75, headDown: 0.35, horns: 'ossicone', ears: 'pointed', mane: 'horse', tail: 'tuft', feet: 'cloven', pattern: { kind: 'net', mark: '#a05a22' } }) },
  turtle: { label: 'Turtle / tortoise', group: 'Beasts', size: 'medium', build: (g) => { X.turtle(g, { c: '#7a8a5a', shell: '#5a6a3a' }); } },
  snail: { label: 'Giant snail', group: 'Beasts', size: 'medium', build: (g) => { X.snail(g, '#b8a888', '#a0603a'); } },
  butterfly: { label: 'Butterfly / moth', group: 'Beasts', size: 'tiny', flies: true, build: (g, tint) => ({ wings: X.butterfly(g, tint ?? '#e070a0') }) },
  // ---------------------------------------------------------------- magical beasts
  displacer: { label: 'Displacer beast', group: 'Monstrosities', size: 'large', build: B({ ...CAT, c: '#2a2e4a', belly: '#3a3e5a', legPairs: 3, len: 1.1, eye: '#7fd6ff', eyeGlow: 1.2 }, { extra: displacerTentacles }) },
  blinkdog: { label: 'Blink dog', group: 'Monstrosities', size: 'medium', build: B({ ...DOG, c: '#e8c870', belly: '#f2ecdc', ears: 'pointed', earSize: 1.2, eye: '#7fd6ff', eyeGlow: 1.4, glow: 0.12 }) },
  winterwolf: { label: 'Winter wolf / frost wolf', group: 'Monstrosities', size: 'large', build: B({ ...WOLF, c: '#d8e8f0', belly: '#f8fcff', hair: '#b8d0e0', len: 1.05, leg: 0.52, girth: 0.25, mane: 'ruff', eye: '#7fd6ff', eyeGlow: 1.5, ridge: '#a8e0ff', ridgeLen: 0.6 }) },
  ghostwolf: { label: 'Spectral wolf / ghost beast', group: 'Undead & spirits', size: 'medium', build: B({ ...WOLF, c: '#a8d8ff', belly: '#a8d8ff', ghost: true, eye: '#ffffff', eyeGlow: 2 }) },
  spectralstag: { label: 'Spectral / silver stag', group: 'Undead & spirits', size: 'large', build: B({ ...DEER, c: '#c8e8ff', belly: '#c8e8ff', horns: 'antler', ghost: true, eye: '#ffffff', eyeGlow: 2 }) },
  jackalope: { label: 'Jackalope', group: 'Monstrosities', size: 'tiny', build: B({ ...RABBIT, c: '#a08868', belly: '#e8dcc8', horns: 'antler' }) },
  moonhare: { label: 'Moon hare', group: 'Monstrosities', size: 'tiny', build: B({ ...RABBIT, c: '#d8e8ff', belly: '#ffffff', glow: 0.5, eye: '#7fd6ff', eyeGlow: 1.5 }) },
  kitsune: { label: 'Kitsune (many-tailed fox)', group: 'Monstrosities', size: 'small', build: B({ ...FOX, c: '#f2ecdc', belly: '#ffffff', socks: '#f2ecdc', hair: '#ffb347', tails: 7, glow: 0.15, eye: '#ffb347', eyeGlow: 1.2 }) },
  firefox: { label: 'Fire fox / flame beast', group: 'Monstrosities', size: 'small', build: B({ ...FOX, c: '#d8542a', belly: '#ffb347', socks: '#8a2a12', hair: '#ffd36b', tails: 2, glow: 0.4, mane: 'flame', eye: '#ffd36b', eyeGlow: 1.5 }) },
  cockatrice: { label: 'Cockatrice', group: 'Monstrosities', size: 'small', flies: true, build: (g, _t, _v, air) => ({ wings: avian(g, { c: '#c8a050', c2: '#e8d4a6', beak: '#e8b030', legs: '#e8b030', size: 0.85, comb: true, legLen: 0.22, lizardTail: '#5a7a3a', membrane: ['#5a7a3a', '#7a9a5a'] }, air) }) },
  phoenix: { label: 'Phoenix', group: 'Monstrosities', size: 'large', flies: true, build: (g, _t, _v, air) => { const w = avian(g, { c: '#ff6a2a', c2: '#ffd36b', beak: '#ffd36b', legs: '#ffd36b', size: 1.3, crest: true, glow: 0.9, tailLen: 0.5, eyeColour: '#fff8d0' }, air); const fl = skin('#ffd36b', { glow: 1.5 }); for (let i = 0; i < 5; i++) horn(g, [(i - 2) * 0.06, 0.78, -0.42], [(i - 2) * 0.25, -0.15, -1], 0.9 + (2 - Math.abs(i - 2)) * 0.15, 0.06, fl, { curl: -0.6, axis: [1, 0, 0] }); return { wings: w }; } },
  thunderbird: { label: 'Thunderbird / storm eagle', group: 'Monstrosities', size: 'huge', flies: true, build: (g, _t, _v, air) => { const w = avian(g, { c: '#2d4f8f', c2: '#e8e070', beak: '#e8e070', legs: '#e8e070', size: 1.3, crest: true, hooked: true, eyeColour: '#fff8a0' }, air); const bolt = skin('#fff8a0', { glow: 2 }); for (let i = 0; i < 3; i++) { const a = i * 2.1, x = Math.cos(a) * 0.55, z = Math.sin(a) * 0.4; tube(g, [[x, 1.75, z], [x + 0.12, 1.55, z], [x - 0.05, 1.42, z], [x + 0.08, 1.2, z]], () => 0.02, bolt, { sides: 5, linear: true }); } return { wings: w }; } },
  cerberus: { label: 'Three-headed hound (cerberus)', group: 'Fiends', size: 'large', build: B({ ...WOLF, c: '#3a1a12', belly: '#5a2a1a', len: 1.0, girth: 0.25, neck: 0.3, neckUp: 0.5, snout: 0.75, snoutR: 0.85, heads: 3, tail: 'thin', tailUp: 0.4, mane: 'flame', eye: '#ffcf3a', eyeGlow: 1.4, fangs: true, claws: '#1a1210' }) },
  guarddog3: { label: 'Three-headed guard dog', group: 'Monstrosities', size: 'huge', build: B({ ...DOG, c: '#7a5232', belly: '#a07a52', len: 1.0, leg: 0.48, girth: 0.27, neck: 0.28, neckUp: 0.55, head: 0.18, snout: 0.6, snoutR: 0.95, heads: 3, earSize: 1.1, tailUp: 0.3, iris: '#4a2a12', fangs: true }) },
  chimera: { label: 'Chimera', group: 'Monstrosities', size: 'large', flies: true, build: B({ ...LION, c: '#b3742a', belly: '#d8a060', mane: 'lion', hair: '#6a3a1a', tail: 'thick', tailLen: 0.7, fangs: true }, { wings: { kind: 'membrane', span: 1.05, c1: '#7a2a1a', c2: '#a8281e' }, extra: chimeraHeads }) },
  // ---------------------------------------------------------------- monsters
  bulette: { label: 'Bulette (land shark)', group: 'Monstrosities', size: 'large', build: B({ c: '#5a6a7a', belly: '#a8a890', len: 1.0, leg: 0.3, girth: 0.38, legR: 0.11, neck: 0.05, neckUp: 0.1, head: 0.3, snout: 0.5, snoutR: 1.2, headDown: 0.2, ears: 'none', tail: 'stub', feet: 'paw', claws: '#2a2a2a', ridge: '#3a4a5a', plates: true, fin: '#3a4a5a', fangs: true, iris: '#e8c030' }) },
  ankheg: { label: 'Ankheg', group: 'Monstrosities', size: 'large', build: (g) => { arthropod(g, { kind: 'beetle', c: '#8a6a2a', c2: '#4a3a1a', size: 1.25 }); } },
  carrioncrawler: { label: 'Carrion crawler', group: 'Monstrosities', size: 'large', build: (g) => { arthropod(g, { kind: 'centipede', c: '#6a8a5a', c2: '#3a4a2a', size: 1.4 }); const m = skin('#c8d0a0', { rough: 0.5 }); for (let i = 0; i < 6; i++) tentacle(g, [[(i - 2.5) * 0.04, 0.22, 0.9], [(i - 2.5) * 0.1, 0.3, 1.15], [(i - 2.5) * 0.18, 0.12, 1.35]], 0.025, m); } },
  umberhulk: { label: 'Umber hulk', group: 'Monstrosities', size: 'large', build: (g) => { brute(g, { c: '#3a2a1a', c2: '#5a4a2a', height: 2.1, bulk: 1.25, hunch: 0.35, head: 'beast', mandibles: true, claws: true, eye: '#e8e070', eyeGlow: 1 }); } },
  roper: { label: 'Roper / piercer', group: 'Monstrosities', size: 'large', build: (g) => { X.roper(g); } },
  darkmantle: { label: 'Darkmantle', group: 'Monstrosities', size: 'small', flies: true, build: (g) => { X.cloaker(g, '#2a2638', true); } },
  seaserpent: { label: 'Sea serpent', group: 'Monstrosities', size: 'gargantuan', build: (g) => { serpent(g, { c: '#1f5a7a', belly: '#a8d0d8', len: 2.0, r: 0.18, sea: true, rise: 1.0 }); } },
  jellyfish: { label: 'Giant jellyfish', group: 'Aberrations', size: 'large', flies: true, build: (g) => { X.jellyfish(g); } },
  kraken: { label: 'Kraken', group: 'Aberrations', size: 'gargantuan', build: (g) => { X.tentacled(g, 'octopus', '#5a2a3a'); } },
  // ---------------------------------------------------------------- aberrations and horrors
  grell: { label: 'Grell', group: 'Aberrations', size: 'medium', flies: true, build: (g) => { X.brainy(g, 'grell'); } },
  devourer: { label: 'Intellect devourer', group: 'Aberrations', size: 'tiny', build: (g) => { X.brainy(g, 'devourer'); } },
  flumph: { label: 'Flumph', group: 'Aberrations', size: 'small', flies: true, build: (g) => { X.brainy(g, 'flumph'); } },
  gazer: { label: 'Gazer / spectator', group: 'Aberrations', size: 'tiny', flies: true, build: (g) => { X.beholder(g, '#5a3a6a', '#e83a2a', true); } },
  nothic: { label: 'Nothic', group: 'Aberrations', size: 'medium', build: (g) => { brute(g, { c: '#6a7a6a', c2: '#3a4a3a', height: 1.7, bulk: 0.85, armLen: 1.2, hunch: 0.55, head: 'ape', oneEye: true, eye: '#e8e070', eyeGlow: 1.2, claws: true }); } },
  cloaker: { label: 'Cloaker', group: 'Aberrations', size: 'large', flies: true, build: (g) => { X.cloaker(g, '#1e1e24'); } },
  slaad: { label: 'Slaad (frog fiend)', group: 'Aberrations', size: 'large', build: (g) => { brute(g, { c: '#b3402a', c2: '#e8a050', height: 2.1, bulk: 1.1, head: 'frog', claws: true, eye: '#e8e070', tail: 'thin' }); } },
  // ---------------------------------------------------------------- plants and fungi
  myconid: { label: 'Myconid / walking mushroom', group: 'Constructs & plants', size: 'medium', build: (g, tint) => { X.mushroom(g, tint ?? '#b3402a'); } },
  glowshroom: { label: 'Glowing mushroom giant', group: 'Constructs & plants', size: 'large', build: (g) => { X.mushroom(g, '#7ae0d0', 0.9); } },
  flytrap: { label: 'Carnivorous plant', group: 'Constructs & plants', size: 'large', build: (g) => { X.flytrap(g); } },
  // ---------------------------------------------------------------- undead beasts and dragons
  bonedragon: { label: 'Bone dragon (dracolich)', group: 'Dragons', size: 'huge', flies: true, build: (g, _t, _v, air) => ({ wings: dragon(g, { c: '#e8e2cc', c2: '#3a3a4a', horn: '#2a2a2a', kind: 'dragon', eye: '#7ad8ff' }, air) }) },
  skelhorse: { label: 'Skeletal steed', group: 'Undead & spirits', size: 'large', mount: true, build: B({ ...HORSE, c: '#2a2826', belly: '#2a2826', face: '#e8e2cc', socks: '#e8e2cc', nose: '#3a3632', mane: 'none', tail: 'thin', tailLen: 0.6, eye: '#7ad8ff', eyeGlow: 1.6, girth: 0.25 }, { seat: true, extra: ribs }) },
  // ---------------------------------------------------------------- bosses
  worldturtle: { label: 'World turtle (boss)', group: 'Monstrosities', size: 'gargantuan', build: (g) => { X.turtle(g, { c: '#6a7a5a', shell: '#4a5a3a', world: true }); } },
  skywhale: { label: 'Sky whale (boss)', group: 'Monstrosities', size: 'gargantuan', flies: true, build: (g) => { X.whale(g, '#3a5a8a', true); } },
  colossus: { label: 'Obsidian colossus (boss)', group: 'Constructs & plants', size: 'gargantuan', build: (g) => { X.golem(g, '#1e1c22', '#ff6a2a', 'rough'); const lava = skin('#ff6a2a', { glow: 1.4 }); for (let i = 0; i < 6; i++) { const a = i * 1.1; tube(g, [[Math.cos(a) * 0.45, 1.1 + i * 0.08, Math.sin(a) * 0.25 + 0.05], [Math.cos(a + 0.4) * 0.48, 1.3 + i * 0.07, Math.sin(a + 0.4) * 0.27 + 0.05], [Math.cos(a + 0.8) * 0.44, 1.45 + i * 0.05, Math.sin(a + 0.8) * 0.25 + 0.05]], () => 0.018, lava, { sides: 5 }); } } },
};

const DRAGON: Record<string, { c: string; c2: string; horn: string }> = {
  red: { c: '#a8281e', c2: '#e8a050', horn: '#2a1a14' }, blue: { c: '#2d5a9a', c2: '#a8c8e8', horn: '#e8e4dc' }, green: { c: '#2f6b3a', c2: '#a8c070', horn: '#2a2a1a' },
  black: { c: '#1e1e24', c2: '#4a4a3a', horn: '#d8d0c0' }, white: { c: '#e8eef2', c2: '#b8c8d8', horn: '#7a8a9a' }, gold: { c: '#d8a830', c2: '#f2dc94', horn: '#7a5a1a' },
  silver: { c: '#b8c0c8', c2: '#e8eef2', horn: '#5a6470' }, bronze: { c: '#a06a2a', c2: '#d8b070', horn: '#3a2a1a' }, copper: { c: '#b8642a', c2: '#e8a070', horn: '#2f6b5a' },
  brass: { c: '#c8a050', c2: '#e8d090', horn: '#6a4a2a' }, shadow: { c: '#2a2638', c2: '#4a4458', horn: '#141210' }, fairy: { c: '#a07ad8', c2: '#e0c8ff', horn: '#e8d4a6' },
};
function dragonColours(tint?: string) { return DRAGON[tint ?? 'red'] ?? DRAGON.red; }
export const DRAGON_COLOURS = Object.keys(DRAGON);

export { creatureFor } from '../../game/creatureKinds';

/** Builds a creature model (merged, wings as separate flapping pivots). */
export function buildCreature(kind: string, tint?: string, airborne = false, variant?: CreatureVariant): CreatureModel | null {
  const spec = CREATURES[kind];
  if (!spec) return null;
  const raw = new THREE.Group();
  const r = spec.build(raw, tint, variant, airborne) ?? {};
  const wingsList = r.wings ?? [];
  for (const w of wingsList) raw.remove(w);
  // height: as given, else measured (top of the body, wings left out)
  let height = r.height ?? Math.max(0.45, new THREE.Box3().setFromObject(raw).max.y + 0.04);
  // young ones are smaller, females a little smaller (the stat block's size class still sets the overall scale)
  const vs = variant === 'young' ? 0.58 : variant === 'female' ? 0.93 : 1;
  if (vs !== 1) { raw.scale.setScalar(vs); height *= vs; for (const w of wingsList) { w.position.multiplyScalar(vs); w.scale.setScalar(vs); } }
  const group = mergeByMaterial(raw);
  for (const w of wingsList) {
    // bake the wing's own (folded) pose relative to its pivot, not the pivot's world position
    const inner = w.children[0] ?? w, holder = new THREE.Group();
    if (inner !== w) { w.remove(inner); holder.add(inner); }
    const merged = mergeByMaterial(inner === w ? w : holder);
    const pivot = new THREE.Group(); pivot.position.copy(w.position); pivot.scale.copy(w.scale); pivot.userData = { ...w.userData, amp: airborne ? (w.userData.amp ?? 0.55) : Math.min(0.15, w.userData.amp ?? 0.15) };
    pivot.add(merged); group.add(pivot);
  }
  const wings = group.children.filter((c) => c.userData.flapZ);
  const seat = r.seat && vs !== 1 ? (r.seat.map((x) => x * vs) as V3) : r.seat;
  const h0 = r.head ?? (raw.userData.head as V3 | undefined);
  const head = h0 ? (h0.map((x) => x * vs) as V3) : undefined;
  return { group, height, wings, size: spec.size, ...(spec.ride ? { ride: spec.ride } : {}), flies: !!spec.flies, ...(seat ? { seat } : {}), ...(head ? { head } : {}) };
}
export const MOUNT_KINDS = Object.entries(CREATURES).filter(([, v]) => v.mount).map(([k]) => k);
