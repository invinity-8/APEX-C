/**
 * APEX 2.1 – low-poly figure builder: turns a FigureLook (game/figure.ts) into a chunky, flat-shaded tabletop
 * miniature – big head, short limbs, faceted shapes. Facing +z, standing on y = 0, a medium human is ≈ 2 units tall
 * (6 ft at the battle map's scale). Every part is a handful of low-segment primitives; at the end the meshes are
 * merged per material, so a whole figure costs only a few draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FigureLook } from '../../game/figure';

type C = THREE.ColorRepresentation;
const cache = new Map<string, THREE.MeshStandardMaterial>();
function M(color: C, o: { metal?: boolean; glow?: boolean; side?: boolean; rough?: number } = {}): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}|${o.metal ? 1 : 0}${o.glow ? 1 : 0}${o.side ? 1 : 0}${o.rough ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: o.rough ?? (o.metal ? 0.35 : 0.85), metalness: o.metal ? 0.65 : 0, ...(o.glow ? { emissive: c, emissiveIntensity: 0.9 } : {}), side: o.side ? THREE.DoubleSide : THREE.FrontSide });
    cache.set(key, m);
  }
  return m;
}
const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const mix = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

/** Adds a mesh: position, rotation (radians), scale. */
function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number] = [0, 0, 0], r: [number, number, number] = [0, 0, 0], s: [number, number, number] | number = 1): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...p); m.rotation.set(...r);
  if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(...s);
  parent.add(m);
  return m;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 6, open = false, ts = 0, tl = Math.PI * 2) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, ts, tl);
const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);
const cone = (r: number, h: number, seg = 5) => new THREE.ConeGeometry(r, h, seg);
const sph = (r: number, ws = 7, hs = 5, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl);
const tor = (r: number, t: number, arc = Math.PI * 2, rs = 4, ts = 10) => new THREE.TorusGeometry(r, t, rs, ts, arc);

interface Dims { s: number; leg: number; th: number; tw: number; hr: number; limb: number }
const ANCESTRY: Record<FigureLook['body'], Dims> = {
  human: { s: 1, leg: 0.5, th: 0.62, tw: 0.3, hr: 0.34, limb: 0.075 },
  dwarf: { s: 0.8, leg: 0.36, th: 0.62, tw: 0.37, hr: 0.36, limb: 0.085 },
  elf: { s: 1.05, leg: 0.58, th: 0.64, tw: 0.26, hr: 0.31, limb: 0.065 },
  halfling: { s: 0.64, leg: 0.42, th: 0.56, tw: 0.28, hr: 0.37, limb: 0.07 },
  gnome: { s: 0.58, leg: 0.38, th: 0.52, tw: 0.27, hr: 0.39, limb: 0.068 },
  orc: { s: 1.08, leg: 0.52, th: 0.68, tw: 0.36, hr: 0.34, limb: 0.09 },
  goblin: { s: 0.62, leg: 0.4, th: 0.5, tw: 0.25, hr: 0.39, limb: 0.06 },
  tiefling: { s: 1, leg: 0.52, th: 0.62, tw: 0.29, hr: 0.33, limb: 0.07 },
  dragonborn: { s: 1.1, leg: 0.52, th: 0.7, tw: 0.35, hr: 0.33, limb: 0.085 },
  lizardfolk: { s: 1.02, leg: 0.5, th: 0.64, tw: 0.31, hr: 0.32, limb: 0.075 },
  skeleton: { s: 1, leg: 0.52, th: 0.62, tw: 0.27, hr: 0.32, limb: 0.04 },
  zombie: { s: 1, leg: 0.5, th: 0.62, tw: 0.3, hr: 0.33, limb: 0.075 },
  ogre: { s: 1, leg: 0.5, th: 0.74, tw: 0.46, hr: 0.3, limb: 0.11 },
};
const BUILD: Record<FigureLook['build'], { w: number; leg: number; belly: number }> = {
  average: { w: 1, leg: 1, belly: 0 }, slim: { w: 0.85, leg: 1.04, belly: 0 }, stocky: { w: 1.14, leg: 0.88, belly: 0.1 }, broad: { w: 1.25, leg: 1, belly: 0 }, heavy: { w: 1.32, leg: 0.94, belly: 0.24 },
};

export interface LowPolyFigure { group: THREE.Group; height: number }
/** The ancestry's own scale (a halfling is smaller than a human); stat-block sizes replace it for enemies. */
export const ancestryScale = (look: FigureLook) => (ANCESTRY[look.body] ?? ANCESTRY.human).s;

export function buildLowPoly(look: FigureLook): LowPolyFigure {
  const root = new THREE.Group();
  const g = new THREE.Group(); root.add(g);
  const a = ANCESTRY[look.body] ?? ANCESTRY.human;
  const b = BUILD[look.build] ?? BUILD.average;
  const leg = a.leg * b.leg, th = a.th, tw = a.tw * b.w, hr = a.hr, limb = a.limb * (look.build === 'slim' ? 0.9 : look.build === 'average' ? 1 : 1.12);
  const bone = look.body === 'skeleton';
  const skin = M(look.skin), skinD = M(shade(look.skin, 0.8));
  const hairM = M(look.hairColor);
  const prim = M(look.primary), primD = M(shade(look.primary, 0.62)), sec = M(look.secondary);
  const leather = M(look.leather), leatherD = M(shade(look.leather, 0.65));
  const metal = M(look.metal, { metal: true }), metalD = M(shade(look.metal, 0.6), { metal: true });
  const gold = M('#d8b25a', { metal: true });
  const dark = M('#14110d', { rough: 0.6 }), white = M('#f2ecdc');
  const armoured = ['chain', 'scale', 'plate'].includes(look.torso);
  const footY = 0.1, hip = footY + leg, top = hip + th, neck = top + 0.05, headY = neck + hr * 0.92;

  // ---- feet
  for (const sx of [-1, 1]) {
    const x = sx * 0.11 * b.w;
    const fm = look.boots === 'bare' ? skin : look.boots === 'sandals' ? skin : look.boots === 'armored' ? metal : look.boots === 'wraps' ? M(mix(look.secondary, '#d8c9a8', 0.6)) : leatherD;
    add(g, box(0.15, 0.1, 0.24), fm, [x, 0.05, 0.04]);
    if (look.boots === 'sandals') add(g, box(0.16, 0.025, 0.25), leather, [x, 0.012, 0.04]);
    if (look.boots === 'tall' || look.boots === 'armored') add(g, cyl(limb * 1.35, limb * 1.25, leg * 0.5, 6), look.boots === 'armored' ? metal : leatherD, [x, footY + leg * 0.22, 0]);
    if (look.boots === 'wraps') for (let i = 0; i < 3; i++) add(g, tor(limb * 1.15, 0.018, Math.PI * 2, 3, 6), fm, [x, footY + 0.05 + i * 0.07, 0], [Math.PI / 2, 0, 0.2]);
  }
  // ---- legs
  const legM = bone ? skin : look.legs === 'shorts' ? prim : look.legs === 'greaves' ? metal : look.legs === 'rags' ? M(shade(look.primary, 0.5)) : primD;
  for (const sx of [-1, 1]) {
    const x = sx * 0.11 * b.w;
    add(g, cyl(limb * 1.1, limb, leg, 6), look.legs === 'trousers' && !bone ? M(shade(look.leather, 0.85)) : legM, [x, footY + leg / 2, 0]);
    if (look.legs === 'shorts' && !bone) add(g, cyl(limb * 0.95, limb * 0.9, leg * 0.5, 6), skin, [x, footY + leg * 0.25, 0]);
    if (look.legs === 'greaves') add(g, ico(limb * 1.4), metalD, [x, footY + leg * 0.5, 0.03]);
  }
  if (look.legs === 'skirt' || look.legs === 'kilt') add(g, cyl(tw * 0.92, tw * (look.legs === 'kilt' ? 1.05 : 1.2), leg * (look.legs === 'kilt' ? 0.45 : 0.75), 7), look.legs === 'kilt' ? sec : prim, [0, hip - leg * (look.legs === 'kilt' ? 0.2 : 0.35), 0]);
  if (look.legs === 'robe' || look.torso === 'dress') add(g, cyl(tw * 0.9, tw * 1.3, leg + 0.06, 8), look.torso === 'robe' || look.torso === 'cultrobe' || look.torso === 'dress' ? prim : primD, [0, footY + leg / 2 - 0.02, 0]);
  if (look.legs === 'rags') add(g, cyl(tw * 0.9, tw * 1.1, leg * 0.45, 5), M(shade(look.primary, 0.5)), [0, hip - leg * 0.18, 0], [0, 0.3, 0]);

  // ---- torso
  const torsoC = look.torso === 'bare' ? skin : look.torso === 'shirt' || look.torso === 'apron' ? sec : look.torso === 'leather' || look.torso === 'studded' ? leather : look.torso === 'chain' ? M(shade(look.metal, 0.85), { metal: true, rough: 0.55 }) : look.torso === 'scale' || look.torso === 'plate' ? metal : look.torso === 'rags' ? M(shade(look.primary, 0.55)) : look.torso === 'furs' ? leather : prim;
  if (bone && (look.torso === 'bare' || look.torso === 'rags')) {
    add(g, cyl(0.035, 0.035, th, 5), skin, [0, hip + th / 2, -0.05]);
    for (let i = 0; i < 4; i++) add(g, tor(tw * (0.85 - i * 0.08), 0.025, Math.PI * 1.6, 3, 8), skin, [0, top - 0.1 - i * 0.12, 0], [Math.PI / 2, 0, Math.PI * 0.7]);
    add(g, cyl(tw * 0.7, tw * 0.75, 0.12, 6), skin, [0, hip + 0.04, 0]);
  } else {
    add(g, cyl(tw, tw * 0.84, th, 7), torsoC, [0, hip + th / 2, 0]);
    if (b.belly) add(g, ico(tw * (0.62 + b.belly * 0.6), 1), torsoC, [0, hip + th * 0.35, tw * 0.25 + b.belly * 0.2], [0, 0, 0], [1, 0.85, 0.75]);
  }
  const front = (y: number) => tw * (0.84 + 0.16 * ((y - hip) / th)) + 0.005;
  switch (look.torso) {
    case 'tunic': add(g, tor(tw * 0.55, 0.035, Math.PI * 2, 3, 8), sec, [0, top - 0.01, 0], [Math.PI / 2, 0, 0]); add(g, cyl(tw * 0.86, tw * 1.0, th * 0.3, 7), prim, [0, hip - th * 0.05, 0]); break;
    case 'shirt': add(g, box(0.12, th * 0.3, 0.02), skin, [0, top - th * 0.17, front(top - 0.1)], [-0.08, 0, 0]); break;
    case 'vest': for (const sx of [-1, 1]) add(g, box(tw * 0.62, th * 0.95, 0.04), prim, [sx * tw * 0.42, hip + th / 2, front(hip + th / 2) - 0.02], [-0.06, 0, 0]); break;
    case 'robe': case 'cultrobe': add(g, box(0.1, th, 0.02), sec, [0, hip + th / 2, front(hip + th / 2)], [-0.08, 0, 0]); if (look.torso === 'cultrobe') { add(g, ico(0.09), sec, [0, top - th * 0.3, front(top) + 0.02]); add(g, cyl(tw * 1.1, tw * 1.1, 0.12, 7, true), primD, [0, top - 0.02, 0]); } break;
    case 'leather': add(g, box(0.06, th * 1.15, 0.03), leatherD, [0, hip + th / 2, front(hip + th / 2)], [-0.07, 0, 0.6]); break;
    case 'studded': for (let i = 0; i < 9; i++) add(g, ico(0.025), metal, [((i % 3) - 1) * tw * 0.45, hip + th * (0.25 + Math.floor(i / 3) * 0.25), front(hip + th * 0.5) + 0.01]); break;
    case 'chain': add(g, box(tw * 0.8, th * 1.1, 0.03), prim, [0, hip + th * 0.45, front(hip + th / 2)], [-0.07, 0, 0]); add(g, box(tw * 0.3, tw * 0.3, 0.035), sec, [0, hip + th * 0.65, front(hip + th / 2) + 0.02], [-0.07, 0, Math.PI / 4]); break;
    case 'scale': for (let i = 0; i < 4; i++) add(g, cyl(tw * (0.98 - i * 0.02) + 0.02, tw * (0.9 - i * 0.02) + 0.03, 0.08, 7, true), metalD, [0, hip + th * (0.2 + i * 0.22), 0]); break;
    case 'plate': add(g, ico(tw * 0.75, 0), metal, [0, hip + th * 0.62, tw * 0.35], [0, 0, 0], [1.1, 0.9, 0.7]); add(g, cyl(tw * 0.95, tw * 1.05, th * 0.25, 7), metalD, [0, hip + th * 0.05, 0]); break;
    case 'rags': for (let i = 0; i < 5; i++) add(g, cone(0.06, 0.16, 3), M(shade(look.primary, 0.5)), [Math.cos(i * 1.3) * tw * 0.85, hip - 0.06, Math.sin(i * 1.3) * tw * 0.85], [Math.PI, 0, 0]); break;
    case 'apron': add(g, box(tw * 1.1, th * 0.9 + leg * 0.5, 0.03), leather, [0, hip + th * 0.35 - leg * 0.2, front(hip + th * 0.35) + 0.02], [-0.05, 0, 0]); break;
    case 'coat': add(g, cyl(tw * 0.86, tw * 1.15, leg * 0.6, 7, true), prim, [0, hip - leg * 0.28, 0]); for (let i = 0; i < 3; i++) add(g, ico(0.022), gold, [0, hip + th * (0.3 + i * 0.22), front(hip + th * 0.5) + 0.01]); add(g, tor(tw * 0.62, 0.05, Math.PI * 2, 3, 8), sec, [0, top - 0.01, 0], [Math.PI / 2, 0, 0]); break;
    case 'dress': add(g, tor(tw * 0.6, 0.03, Math.PI * 2, 3, 8), sec, [0, top - 0.02, 0], [Math.PI / 2, 0, 0]); break;
    case 'furs': add(g, tor(tw * 0.75, 0.1, Math.PI * 2, 4, 8), M(mix(look.hairColor, '#d9c9a8', 0.7)), [0, top - 0.03, 0], [Math.PI / 2, 0, 0]); break;
  }
  // belly button–level details
  switch (look.belt) {
    case 'belt': add(g, cyl(tw * 0.88, tw * 0.88, 0.07, 7), leatherD, [0, hip + 0.06, 0]); add(g, box(0.08, 0.07, 0.03), gold, [0, hip + 0.06, tw * 0.88]); break;
    case 'sash': add(g, cyl(tw * 0.9, tw * 0.9, 0.1, 7), sec, [0, hip + 0.07, 0]); add(g, box(0.08, 0.25, 0.02), sec, [tw * 0.5, hip - 0.05, tw * 0.75], [0, 0.5, 0.1]); break;
    case 'pouches': add(g, cyl(tw * 0.88, tw * 0.88, 0.06, 7), leatherD, [0, hip + 0.06, 0]); for (const sx of [-1, 1]) add(g, box(0.1, 0.12, 0.07), leather, [sx * tw * 0.7, hip, tw * 0.55]); break;
    case 'rope': add(g, tor(tw * 0.88, 0.022, Math.PI * 2, 3, 8), M('#c9b48a'), [0, hip + 0.06, 0], [Math.PI / 2, 0, 0]); break;
  }
  // ---- shoulders
  for (const sx of [-1, 1]) {
    const p: [number, number, number] = [sx * (tw + 0.02), top - 0.05, 0];
    if (look.shoulders === 'pads') add(g, sph(0.13, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), leather, p, [0, 0, -sx * 0.4]);
    if (look.shoulders === 'plate') add(g, sph(0.15, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), metal, p, [0, 0, -sx * 0.4]);
    if (look.shoulders === 'fur') add(g, ico(0.15, 0), M(mix(look.hairColor, '#d9c9a8', 0.6)), p, [0, 0, 0], [1, 0.7, 1]);
    if (look.shoulders === 'spiked') { add(g, sph(0.13, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), metalD, p, [0, 0, -sx * 0.4]); add(g, cone(0.04, 0.16, 4), metal, [p[0] + sx * 0.05, p[1] + 0.1, 0], [0, 0, -sx * 0.5]); }
  }
  // ---- arms (pivots at the shoulders; the hands carry the gear)
  const armLen = th * 0.92;
  const sleeve = bone ? skin : ['bare', 'vest'].includes(look.torso) ? skin : look.torso === 'plate' ? metal : look.torso === 'chain' || look.torso === 'scale' ? M(shade(look.metal, 0.8), { metal: true, rough: 0.55 }) : torsoC;
  const zombie = look.body === 'zombie';
  const hands: THREE.Group[] = [];
  for (const sx of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (tw + limb * 0.6), top - 0.07, 0);
    pivot.rotation.set(zombie ? -1.35 : sx > 0 ? -0.55 : -0.25, 0, sx * (zombie ? 0.05 : 0.14));
    add(pivot, cyl(limb * 1.05, limb * 0.9, armLen, 6), sleeve, [0, -armLen / 2, 0]);
    if (look.extra === 'tattoos' && !['bare', 'vest'].includes(look.torso)) { /* tattoos only show on bare arms */ }
    if (look.extra === 'tattoos' && ['bare', 'vest'].includes(look.torso)) add(pivot, cyl(limb * 1.08, limb * 1.08, 0.05, 6), M(shade(look.skin, 0.45)), [0, -armLen * 0.4, 0]);
    const hand = new THREE.Group(); hand.position.set(0, -armLen, 0); pivot.add(hand);
    add(hand, ico(limb * 1.25, 0), armoured && look.torso === 'plate' ? metal : skin, [0, 0, 0]);
    g.add(pivot); hands.push(hand);
  }
  // ---- neck and head
  if (!bone) add(g, cyl(hr * 0.35, hr * 0.4, 0.12, 6), skin, [0, top + 0.03, 0]); else add(g, cyl(0.03, 0.03, 0.12, 4), skin, [0, top + 0.03, 0]);
  const head = new THREE.Group(); head.position.set(0, headY, 0); g.add(head);
  let fz = hr * 0.9; // front surface of the face
  const snout = look.body === 'dragonborn' || look.body === 'lizardfolk';
  switch (bone ? 'skull' : look.head) {
    case 'skull': add(head, ico(hr, 1), skin, [0, 0.03, 0], [0, 0, 0], [0.95, 1, 1]); add(head, box(hr * 1.1, hr * 0.4, hr * 0.9), skin, [0, -hr * 0.75, 0.05]); fz = hr * 0.92; break;
    case 'square': add(head, box(hr * 1.6, hr * 1.6, hr * 1.5), skin); fz = hr * 0.76; break;
    case 'oval': add(head, ico(hr, 1), skin, [0, 0, 0], [0, 0, 0], [0.9, 1.12, 0.95]); fz = hr * 0.86; break;
    case 'long': add(head, cyl(hr * 0.85, hr * 0.72, hr * 2.1, 7), skin); fz = hr * 0.8; break;
    case 'wide': add(head, ico(hr, 1), skin, [0, 0, 0], [0, 0, 0], [1.2, 0.9, 1]); fz = hr * 0.92; break;
    case 'pointed': add(head, new THREE.DodecahedronGeometry(hr, 0), skin, [0, 0, 0], [0, 0, 0], [0.95, 1.05, 1]); add(head, cone(hr * 0.45, hr * 0.5, 5), skin, [0, -hr * 0.85, hr * 0.15], [Math.PI, 0, 0]); fz = hr * 0.85; break;
    default: add(head, ico(hr, 1), skin); fz = hr * 0.92;
  }
  if (snout) { add(head, box(hr * 1.0, hr * 0.7, hr * 1.0), skin, [0, -hr * 0.3, hr * 0.85]); add(head, box(hr * 0.9, hr * 0.18, hr * 0.9), skinD, [0, -hr * 0.62, hr * 0.85]); if (look.body === 'lizardfolk') for (let i = 0; i < 3; i++) add(head, cone(0.05, 0.18, 3), M(look.secondary), [0, hr * 0.9 - i * 0.05, -i * hr * 0.4]); }
  if (look.body === 'ogre' || look.body === 'orc') add(head, box(hr * 1.4, hr * 0.6, hr * 1.1), skin, [0, -hr * 0.55, hr * 0.15]);
  const faceZ = snout ? fz + hr * 0.05 : fz;
  const ey = hr * 0.12, ex = hr * 0.36;
  const eyeM = look.eyes === 'glowing' ? M(look.eyeColor, { glow: true }) : M(look.eyeColor, { rough: 0.3 });
  for (const sx of [-1, 1]) {
    const p: [number, number, number] = [sx * ex, ey, faceZ];
    switch (look.eyes) {
      case 'dots': add(head, ico(hr * 0.1), eyeM, p); break;
      case 'wide': add(head, ico(hr * 0.17, 1), white, [p[0], p[1], p[2] - 0.02]); add(head, ico(hr * 0.09), eyeM, [p[0], p[1], p[2] + hr * 0.12]); break;
      case 'narrow': add(head, box(hr * 0.28, hr * 0.06, 0.03), eyeM, p); break;
      case 'angry': add(head, box(hr * 0.24, hr * 0.09, 0.03), eyeM, p, [0, 0, sx * 0.35]); break;
      case 'sleepy': add(head, box(hr * 0.24, hr * 0.05, 0.03), eyeM, [p[0], p[1] - hr * 0.03, p[2]]); add(head, box(hr * 0.28, hr * 0.08, 0.04), skinD, [p[0], p[1] + hr * 0.04, p[2]]); break;
      case 'happy': add(head, tor(hr * 0.1, hr * 0.03, Math.PI, 3, 6), dark, p); break;
      case 'glowing': add(head, ico(hr * 0.12, 0), eyeM, p); break;
      case 'patch': if (sx < 0) add(head, box(hr * 0.32, hr * 0.28, 0.04), dark, p); else add(head, ico(hr * 0.1), eyeM, p); break;
      case 'scarred': add(head, ico(hr * 0.1), eyeM, p); if (sx > 0) add(head, box(hr * 0.05, hr * 0.55, 0.03), M('#8e3b44'), [p[0], p[1], p[2] + 0.01], [0, 0, 0.3]); break;
      case 'closed': add(head, box(hr * 0.24, hr * 0.03, 0.03), dark, p); break;
      case 'hollow': add(head, ico(hr * 0.15), dark, [p[0], p[1], p[2] - 0.02]); break;
    }
    // brows
    const bp: [number, number, number] = [sx * ex, ey + hr * 0.24, faceZ - 0.01];
    const bm = look.brows === 'bushy' ? hairM : M(shade(look.hairColor, 0.8));
    if (look.brows === 'thin') add(head, box(hr * 0.28, hr * 0.05, 0.03), bm, bp);
    if (look.brows === 'thick') add(head, box(hr * 0.32, hr * 0.1, 0.04), bm, bp);
    if (look.brows === 'angry') add(head, box(hr * 0.32, hr * 0.09, 0.04), bm, bp, [0, 0, sx * 0.45]);
    if (look.brows === 'worried') add(head, box(hr * 0.3, hr * 0.07, 0.04), bm, bp, [0, 0, -sx * 0.35]);
    if (look.brows === 'bushy') add(head, ico(hr * 0.13, 0), bm, bp, [0, 0, 0], [1.5, 0.7, 0.6]);
    // ears
    const ears = look.ears === 'normal' && ['elf', 'orc', 'tiefling'].includes(look.body) ? 'pointed' : look.ears === 'normal' && look.body === 'goblin' ? 'big' : look.ears;
    if (!snout && !bone) {
      const ep: [number, number, number] = [sx * hr * 0.95, ey - hr * 0.05, 0];
      if (ears === 'normal') add(head, ico(hr * 0.16, 0), skin, ep, [0, 0, 0], [0.5, 1, 0.8]);
      if (ears === 'pointed') add(head, cone(hr * 0.13, hr * 0.5, 4), skin, [ep[0] + sx * 0.04, ep[1] + hr * 0.12, -0.02], [0, 0, -sx * 1.1]);
      if (ears === 'long') add(head, cone(hr * 0.13, hr * 0.8, 4), skin, [ep[0] + sx * 0.1, ep[1] + hr * 0.18, -0.04], [0, 0, -sx * 1.15]);
      if (ears === 'big') add(head, cone(hr * 0.3, hr * 0.7, 4), skin, [ep[0] + sx * 0.12, ep[1] + hr * 0.1, -0.02], [0, 0, -sx * 1.35], [1, 1, 0.35]);
    }
  }
  // nose and mouth
  if (!snout && !bone) {
    const np: [number, number, number] = [0, -hr * 0.1, faceZ + 0.02];
    if (look.nose === 'button') add(head, ico(hr * 0.11, 0), skinD, np);
    if (look.nose === 'pointy') add(head, cone(hr * 0.1, hr * 0.32, 4), skinD, [0, np[1], np[2] + hr * 0.1], [Math.PI / 2, 0, 0]);
    if (look.nose === 'broad') add(head, box(hr * 0.3, hr * 0.18, hr * 0.15), skinD, np);
    if (look.nose === 'hooked') add(head, cone(hr * 0.1, hr * 0.34, 4), skinD, [0, np[1] - hr * 0.04, np[2] + hr * 0.08], [Math.PI / 2 + 0.6, 0, 0]);
  }
  const my = snout ? -hr * 0.45 : -hr * 0.42, mz = snout ? faceZ + hr * 0.82 : faceZ - 0.01;
  switch (look.mouth) {
    case 'smile': add(head, tor(hr * 0.17, hr * 0.035, Math.PI, 3, 6), dark, [0, my + hr * 0.08, mz], [0, 0, Math.PI]); break;
    case 'flat': add(head, box(hr * 0.32, hr * 0.05, 0.03), dark, [0, my, mz]); break;
    case 'frown': add(head, tor(hr * 0.15, hr * 0.035, Math.PI, 3, 6), dark, [0, my - hr * 0.06, mz]); break;
    case 'open': add(head, ico(hr * 0.13, 0), dark, [0, my, mz], [0, 0, 0], [1.2, 1, 0.4]); break;
    case 'grin': add(head, box(hr * 0.42, hr * 0.12, 0.03), white, [0, my, mz]); add(head, box(hr * 0.46, hr * 0.02, 0.035), dark, [0, my, mz]); break;
    case 'tusks': add(head, box(hr * 0.3, hr * 0.05, 0.03), dark, [0, my, mz]); for (const sx of [-1, 1]) add(head, cone(hr * 0.07, hr * 0.28, 4), white, [sx * hr * 0.22, my + hr * 0.1, mz + 0.03]); break;
    case 'fangs': add(head, box(hr * 0.3, hr * 0.05, 0.03), dark, [0, my, mz]); for (const sx of [-1, 1]) add(head, cone(hr * 0.05, hr * 0.15, 3), white, [sx * hr * 0.1, my - hr * 0.07, mz + 0.02], [Math.PI, 0, 0]); break;
  }
  // face details
  const ex2 = (fn: (sx: number) => void) => { fn(-1); fn(1); };
  switch (look.extra) {
    case 'warpaint': ex2((sx) => { add(head, box(hr * 0.08, hr * 0.4, 0.02), M('#b3261e'), [sx * hr * 0.55, -hr * 0.05, faceZ - 0.05], [0, sx * 0.4, 0]); }); break;
    case 'scar': add(head, box(hr * 0.06, hr * 0.5, 0.02), M('#8e3b44'), [-hr * 0.5, -hr * 0.15, faceZ - 0.05], [0, -0.45, 0.4]); break;
    case 'freckles': ex2((sx) => { for (let i = 0; i < 3; i++) add(head, ico(hr * 0.025), M(shade(look.skin, 0.6)), [sx * hr * (0.4 + i * 0.08), -hr * 0.12 - (i % 2) * hr * 0.06, faceZ - 0.03]); }); break;
    case 'blush': ex2((sx) => add(head, ico(hr * 0.1, 0), M(mix(look.skin, '#e06070', 0.5)), [sx * hr * 0.55, -hr * 0.2, faceZ - 0.06], [0, 0, 0], [1, 0.6, 0.3])); break;
    case 'monocle': add(head, tor(hr * 0.15, 0.012, Math.PI * 2, 3, 10), gold, [ex, ey, faceZ + 0.02]); break;
    case 'pipe': add(head, cyl(0.015, 0.015, hr * 0.5, 4), leatherD, [hr * 0.15, my, mz + hr * 0.2], [Math.PI / 2 - 0.3, 0, 0]); add(head, cyl(0.04, 0.03, 0.08, 5), leatherD, [hr * 0.15, my + hr * 0.05, mz + hr * 0.45]); break;
    case 'earring': add(head, tor(0.035, 0.01, Math.PI * 2, 3, 6), gold, [hr * 0.98, -hr * 0.2, 0]); break;
    case 'tattoos': add(head, box(hr * 0.06, hr * 0.5, 0.02), M(shade(look.skin, 0.45)), [hr * 0.5, 0, faceZ - 0.06], [0, 0.45, 0]); break;
  }
  // ---- beard
  const beardM = hairM, by = -hr * 0.5;
  switch (look.beard) {
    case 'stubble': add(head, sph(hr * 1.01, 8, 4, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.55, Math.PI * 0.4), M(mix(look.skin, look.hairColor, 0.45)), [0, 0, 0]); break;
    case 'moustache': ex2((sx) => add(head, box(hr * 0.3, hr * 0.09, 0.05), beardM, [sx * hr * 0.15, -hr * 0.27, faceZ + 0.01], [0, 0, -sx * 0.25])); break;
    case 'handlebar': ex2((sx) => { add(head, box(hr * 0.3, hr * 0.09, 0.05), beardM, [sx * hr * 0.15, -hr * 0.27, faceZ + 0.01], [0, 0, -sx * 0.2]); add(head, tor(hr * 0.09, 0.02, Math.PI, 3, 5), beardM, [sx * hr * 0.33, -hr * 0.2, faceZ], [0, 0, sx > 0 ? -1.5 : Math.PI + 1.5]); }); break;
    case 'goatee': add(head, cone(hr * 0.15, hr * 0.4, 5), beardM, [0, by - hr * 0.25, faceZ - hr * 0.15], [Math.PI, 0, 0]); break;
    case 'chin': add(head, box(hr * 0.45, hr * 0.25, hr * 0.3), beardM, [0, by - hr * 0.2, faceZ - hr * 0.2]); break;
    case 'full': case 'long': case 'forked': case 'braided':
      add(head, ico(hr * 0.75, 0), beardM, [0, by - hr * 0.08, hr * 0.35], [0, 0, 0], [1.15, 0.85, 0.75]);
      ex2((sx) => add(head, box(hr * 0.3, hr * 0.09, 0.05), beardM, [sx * hr * 0.15, -hr * 0.27, faceZ + 0.01], [0, 0, -sx * 0.25]));
      if (look.beard === 'long') add(head, cone(hr * 0.45, hr * 1.1, 5), beardM, [0, by - hr * 0.75, hr * 0.5], [Math.PI, 0, 0]);
      if (look.beard === 'forked') ex2((sx) => add(head, cone(hr * 0.2, hr * 0.8, 4), beardM, [sx * hr * 0.2, by - hr * 0.7, hr * 0.5], [Math.PI, 0, sx * 0.15]));
      if (look.beard === 'braided') { add(head, cyl(hr * 0.15, hr * 0.1, hr * 1.0, 5), beardM, [0, by - hr * 0.8, hr * 0.5]); for (let i = 0; i < 2; i++) add(head, cyl(hr * 0.17, hr * 0.17, 0.05, 6), gold, [0, by - hr * (0.6 + i * 0.45), hr * 0.5]); }
      break;
    case 'mutton': ex2((sx) => add(head, box(hr * 0.3, hr * 0.7, hr * 0.5), beardM, [sx * hr * 0.75, -hr * 0.3, hr * 0.3])); break;
  }
  // ---- hair
  const coverTop = ['hood', 'cowl', 'helmet', 'greathelm', 'horned', 'turban', 'wizard', 'cap', 'tricorn', 'feathercap', 'strawhat', 'skullcap'].includes(look.hat);
  const cap = (k = 0.58) => add(head, sph(hr * 1.07, 8, 5, 0, Math.PI * 2, 0, Math.PI * k), hairM, [0, hr * 0.02, -hr * 0.03]);
  if (!bone && look.hair !== 'none') {
    if (!coverTop) {
      if (['short', 'messy', 'spiky', 'bob', 'long', 'ponytail', 'bun', 'braids', 'curly', 'pigtails'].includes(look.hair)) cap(look.hair === 'bob' || look.hair === 'long' ? 0.62 : 0.52);
      if (look.hair === 'buzz') add(head, sph(hr * 1.02, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.45), M(mix(look.skin, look.hairColor, 0.7)), [0, hr * 0.02, -hr * 0.03]);
      if (look.hair === 'short' || look.hair === 'bob') add(head, box(hr * 1.3, hr * 0.25, hr * 0.3), hairM, [0, hr * 0.65, hr * 0.62], [0.35, 0, 0]);
      if (look.hair === 'messy') for (let i = 0; i < 6; i++) add(head, cone(hr * 0.16, hr * 0.4, 4), hairM, [Math.cos(i * 1.05) * hr * 0.6, hr * 0.8, Math.sin(i * 1.05) * hr * 0.6], [Math.sin(i) * 0.7, 0, Math.cos(i * 1.05) * -0.7]);
      if (look.hair === 'spiky') for (let i = 0; i < 7; i++) add(head, cone(hr * 0.17, hr * 0.6, 4), hairM, [Math.cos(i * 0.9) * hr * 0.45, hr * 0.95, Math.sin(i * 0.9) * hr * 0.45 - hr * 0.1], [Math.sin(i * 0.9) * 0.6, 0, -Math.cos(i * 0.9) * 0.6]);
      if (look.hair === 'mohawk') for (let i = 0; i < 5; i++) add(head, cone(hr * 0.13, hr * 0.55, 4), hairM, [0, hr * (0.95 - Math.abs(i - 1.5) * 0.08), hr * (0.55 - i * 0.32)], [-(i - 1.5) * 0.35, 0, 0]);
      if (look.hair === 'curly') for (let i = 0; i < 9; i++) add(head, ico(hr * 0.26, 0), hairM, [Math.cos(i * 0.7) * hr * 0.7, hr * (0.55 + (i % 3) * 0.12), Math.sin(i * 0.7) * hr * 0.7 - hr * 0.1]);
      if (look.hair === 'wild') add(head, ico(hr * 1.25, 0), hairM, [0, hr * 0.3, -hr * 0.2], [0.3, 0.5, 0.2], [1.05, 0.9, 1]);
      if (look.hair === 'topknot') { add(head, cyl(hr * 0.12, hr * 0.15, hr * 0.3, 5), hairM, [0, hr * 1.05, -hr * 0.1]); add(head, ico(hr * 0.2, 0), hairM, [0, hr * 1.25, -hr * 0.1]); }
      if (look.hair === 'sidecut') add(head, sph(hr * 1.07, 8, 5, Math.PI * 0.5, Math.PI, 0, Math.PI * 0.55), hairM, [0, hr * 0.02, 0], [0, 0, -0.3]);
      if (look.hair === 'bun') add(head, ico(hr * 0.35, 0), hairM, [0, hr * 0.7, -hr * 0.75]);
    }
    if (look.hair === 'long' || look.hair === 'bob' || look.hair === 'wild') add(head, box(hr * 1.9, hr * (look.hair === 'long' ? 1.9 : 0.9), hr * 0.5), hairM, [0, look.hair === 'long' ? -hr * 0.55 : -hr * 0.05, -hr * 0.65]);
    if (look.hair === 'ponytail') add(head, cyl(hr * 0.18, hr * 0.08, hr * 1.4, 5), hairM, [0, -hr * 0.2, -hr * 1.05], [0.35, 0, 0]);
    if (look.hair === 'braids' || look.hair === 'pigtails') ex2((sx) => { add(head, cyl(hr * 0.13, hr * 0.09, hr * (look.hair === 'braids' ? 1.5 : 0.8), 5), hairM, [sx * hr * 0.85, -hr * (look.hair === 'braids' ? 0.6 : 0.2), hr * 0.05], [0, 0, sx * 0.1]); if (look.hair === 'pigtails') add(head, ico(hr * 0.25, 0), hairM, [sx * hr * 0.95, hr * 0.3, -hr * 0.1]); });
  }
  // ---- horns
  const hornM = M('#e8dcc0', { rough: 0.6 });
  const horns = look.horns === 'none' && look.body === 'tiefling' ? 'small' : look.horns;
  ex2((sx) => {
    if (horns === 'small') add(head, cone(hr * 0.12, hr * 0.4, 5), M('#3a2a2a'), [sx * hr * 0.4, hr * 0.9, hr * 0.2], [-0.3, 0, -sx * 0.35]);
    if (horns === 'curled') add(head, tor(hr * 0.3, hr * 0.09, Math.PI * 1.2, 4, 8), M('#3a2a2a'), [sx * hr * 0.5, hr * 0.8, -hr * 0.1], [0, Math.PI / 2, sx > 0 ? 0.3 : Math.PI - 0.3]);
    if (horns === 'ram') add(head, tor(hr * 0.32, hr * 0.12, Math.PI * 1.6, 4, 9), hornM, [sx * hr * 0.95, hr * 0.2, -hr * 0.1], [0, sx * Math.PI / 2, 0]);
    if (horns === 'long') add(head, cone(hr * 0.13, hr * 1.1, 5), M('#3a2a2a'), [sx * hr * 0.4, hr * 0.85, -hr * 0.5], [-1.1, 0, -sx * 0.25]);
  });
  // ---- headwear
  const hatM = look.hat === 'hood' || look.hat === 'cowl' ? M(shade(look.primary, 0.7)) : prim;
  switch (look.hat) {
    case 'hood': case 'cowl':
      add(head, sph(hr * 1.2, 9, 6, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.72), hatM, [0, hr * 0.05, -hr * 0.05]);
      add(head, sph(hr * 1.2, 9, 6, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.72), M(shade(look.primary, 0.4), { side: true }), [0, hr * 0.05, -hr * 0.05], [0, 0, 0], 0.98);
      if (look.hat === 'cowl') add(head, cone(hr * 0.5, hr * 0.9, 5), hatM, [0, hr * 0.9, -hr * 0.7], [-1.1, 0, 0]);
      add(g, cyl(tw * 0.75, tw * 1.0, 0.16, 7), hatM, [0, top + 0.02, 0]);
      break;
    case 'wizard': add(head, cyl(hr * 1.75, hr * 1.75, 0.04, 9), prim, [0, hr * 0.62, 0]); add(head, cone(hr * 0.95, hr * 2.3, 7), prim, [0, hr * 1.7, -hr * 0.1], [-0.15, 0, 0.08]); add(head, cyl(hr * 0.98, hr * 1.02, 0.08, 7), sec, [0, hr * 0.7, 0]); break;
    case 'cap': add(head, sph(hr * 1.08, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), prim, [0, hr * 0.05, 0]); add(head, box(hr * 1.2, 0.03, hr * 0.6), primD, [0, hr * 0.1, hr * 0.95]); break;
    case 'bandana': add(head, sph(hr * 1.06, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), sec, [0, hr * 0.08, 0]); add(head, ico(hr * 0.18, 0), sec, [0, hr * 0.35, -hr * 1.0]); add(head, box(0.05, hr * 0.5, 0.02), sec, [0.03, hr * 0.05, -hr * 1.05], [0.3, 0, 0.2]); break;
    case 'headband': add(head, cyl(hr * 1.02, hr * 1.02, hr * 0.18, 9, true), sec, [0, hr * 0.4, 0]); break;
    case 'helmet': add(head, sph(hr * 1.12, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.52), metal, [0, hr * 0.05, 0]); add(head, box(hr * 0.12, hr * 0.6, 0.04), metal, [0, hr * 0.1, hr * 1.1]); add(head, cyl(hr * 1.14, hr * 1.14, 0.06, 9), metalD, [0, hr * 0.1, 0]); break;
    case 'greathelm': add(head, cyl(hr * 1.08, hr * 1.02, hr * 2.15, 8), metal, [0, 0, 0]); add(head, box(hr * 1.4, hr * 0.1, 0.05), dark, [0, hr * 0.12, hr * 1.04]); add(head, box(hr * 0.12, hr * 0.7, 0.05), dark, [0, -hr * 0.2, hr * 1.04]); add(head, sph(hr * 1.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), metal, [0, hr * 1.05, 0], [0, 0, 0], [1, 0.4, 1]); break;
    case 'horned': add(head, sph(hr * 1.12, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.52), metal, [0, hr * 0.05, 0]); ex2((sx) => add(head, cone(hr * 0.17, hr * 0.85, 5), hornM, [sx * hr * 0.95, hr * 0.75, 0], [0, 0, -sx * 0.85])); break;
    case 'crown': add(head, cyl(hr * 0.8, hr * 0.75, hr * 0.35, 8, true), gold, [0, hr * 0.95, 0]); for (let i = 0; i < 6; i++) add(head, cone(hr * 0.12, hr * 0.3, 4), gold, [Math.cos(i * 1.047) * hr * 0.78, hr * 1.25, Math.sin(i * 1.047) * hr * 0.78]); add(head, ico(hr * 0.1, 0), M('#b3261e', { glow: true }), [0, hr * 0.95, hr * 0.82]); break;
    case 'circlet': add(head, tor(hr * 1.0, 0.025, Math.PI * 2, 3, 12), gold, [0, hr * 0.45, 0], [Math.PI / 2 - 0.12, 0, 0]); add(head, ico(hr * 0.1, 0), M(look.eyeColor === '#141210' ? '#7fd6ff' : look.eyeColor, { glow: true }), [0, hr * 0.42, hr * 1.02]); break;
    case 'tricorn': add(head, cyl(hr * 1.6, hr * 1.6, 0.06, 3), M('#1d1612'), [0, hr * 0.62, 0], [0, Math.PI, 0]); add(head, cyl(hr * 0.9, hr * 1.0, hr * 0.5, 8), M('#1d1612'), [0, hr * 0.85, 0]); add(head, tor(hr * 1.55, 0.02, Math.PI * 2, 3, 3), gold, [0, hr * 0.65, 0], [Math.PI / 2, 0, Math.PI / 2]); break;
    case 'feathercap': add(head, sph(hr * 1.08, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), prim, [0, hr * 0.05, 0], [0, 0, -0.15]); add(head, cone(hr * 0.13, hr * 1.4, 4), sec, [hr * 0.5, hr * 1.2, -hr * 0.4], [-0.8, 0, -0.4], [1, 1, 0.3]); break;
    case 'strawhat': add(head, cone(hr * 2.0, hr * 0.5, 9), M('#d8c48a'), [0, hr * 0.85, 0]); add(head, cyl(hr * 0.85, hr * 0.95, hr * 0.45, 8), M('#c9b06a'), [0, hr * 0.9, 0]); break;
    case 'turban': add(head, tor(hr * 0.85, hr * 0.32, Math.PI * 2, 5, 8), prim, [0, hr * 0.6, 0], [Math.PI / 2, 0, 0]); add(head, ico(hr * 0.85, 0), prim, [0, hr * 0.85, 0], [0, 0, 0], [1, 0.6, 1]); add(head, ico(hr * 0.12, 0), M('#7fd6ff', { glow: true }), [0, hr * 0.65, hr * 1.12]); break;
    case 'skullcap': add(head, sph(hr * 1.06, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), leather, [0, hr * 0.1, 0]); break;
    case 'antlers': ex2((sx) => { add(head, cyl(0.03, 0.04, hr * 1.2, 4), M('#8a6a45'), [sx * hr * 0.6, hr * 1.2, 0], [0, 0, -sx * 0.5]); add(head, cyl(0.025, 0.03, hr * 0.6, 4), M('#8a6a45'), [sx * hr * 0.95, hr * 1.5, 0.05], [0.3, 0, sx * 0.3]); add(head, cyl(0.025, 0.03, hr * 0.5, 4), M('#8a6a45'), [sx * hr * 0.6, hr * 1.55, -0.05], [-0.4, 0, -sx * 0.1]); }); break;
    case 'mask': add(head, box(hr * 1.6, hr * 0.7, hr * 0.3), M(shade(look.primary, 0.5)), [0, -hr * 0.4, hr * 0.8]); break;
  }
  // ---- neck jewellery, scarf
  if (look.extra === 'necklace' || look.extra === 'amulet') { add(g, tor(tw * 0.55, 0.018, Math.PI * 2, 3, 10), gold, [0, top - 0.05, 0.03], [Math.PI / 2 - 0.35, 0, 0]); if (look.extra === 'amulet') add(g, ico(0.06, 0), M(look.eyeColor === '#141210' ? '#b3261e' : look.eyeColor, { glow: true }), [0, top - 0.18, tw * 0.82]); }
  if (look.extra === 'scarf') { add(g, tor(tw * 0.6, 0.08, Math.PI * 2, 4, 8), sec, [0, top + 0.02, 0], [Math.PI / 2, 0, 0]); add(g, box(0.1, 0.35, 0.04), sec, [tw * 0.4, top - 0.2, tw * 0.75], [-0.1, 0, 0.2]); }

  // ---- cloak and back
  const cloakM = look.cloak === 'cape' ? M(look.secondary, { side: true }) : look.cloak === 'fur' ? M(look.leather, { side: true }) : M(shade(look.primary, 0.68), { side: true });
  const cl = look.cloak === 'short' || look.cloak === 'mantle' ? th * 0.75 : look.cloak === 'none' ? 0 : top - 0.08;
  if (cl > 0) {
    const seg = look.cloak === 'tattered' ? 5 : 8;
    add(g, cyl(tw * 1.05, tw * (look.cloak === 'short' ? 1.25 : 1.55), cl, seg, true, Math.PI / 2 + 0.2, Math.PI - 0.4), cloakM, [0, top - cl / 2, -0.04]);
    if (look.cloak === 'tattered') for (let i = 0; i < 4; i++) add(g, cone(0.08, 0.2, 3), cloakM, [-tw + i * tw * 0.65, top - cl - 0.06, -tw * 1.3], [Math.PI, 0, 0]);
    if (look.cloak === 'fur') add(g, tor(tw * 0.85, 0.12, Math.PI * 2, 4, 8), M(mix(look.hairColor, '#d9c9a8', 0.75)), [0, top, 0], [Math.PI / 2, 0, 0]);
    if (look.cloak === 'mantle') add(g, cyl(tw * 1.1, tw * 1.35, 0.25, 8), cloakM, [0, top - 0.1, 0]);
    ex2((sx) => add(g, ico(0.04, 0), gold, [sx * tw * 0.6, top - 0.03, tw * 0.6]));
  }
  switch (look.back) {
    case 'backpack': add(g, box(tw * 1.3, th * 0.7, 0.25), leather, [0, hip + th * 0.5, -tw - 0.12]); add(g, cyl(0.09, 0.09, tw * 1.5, 6), M(look.secondary), [0, hip + th * 0.9, -tw - 0.12], [0, 0, Math.PI / 2]); break;
    case 'quiver': add(g, cyl(0.08, 0.07, th * 0.9, 6), leather, [tw * 0.4, hip + th * 0.6, -tw - 0.06], [0.15, 0, -0.35]); for (let i = 0; i < 3; i++) add(g, cyl(0.012, 0.012, 0.25, 3), M('#e8d4a6'), [tw * 0.4 + 0.12 + i * 0.02, hip + th * 1.05, -tw - 0.1], [0.15, 0, -0.35]); break;
    case 'bedroll': add(g, cyl(0.1, 0.1, tw * 1.7, 6), M('#5c7a2a'), [0, top - 0.02, -tw - 0.08], [0, 0, Math.PI / 2]); break;
    case 'banner': add(g, cyl(0.02, 0.02, 1.6, 4), M('#6b4a2b'), [tw * 0.5, hip + 0.8, -tw - 0.08]); add(g, box(0.45, 0.55, 0.02), prim, [tw * 0.5 + 0.24, hip + 1.3, -tw - 0.08]); add(g, ico(0.07, 0), sec, [tw * 0.5 + 0.24, hip + 1.3, -tw - 0.06]); break;
    case 'scabbard': add(g, cyl(0.04, 0.03, 0.9, 5), leatherD, [0, hip + th * 0.5, -tw - 0.06], [0, 0, 0.7]); break;
    case 'wings': ex2((sx) => { const w = add(g, new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.9, 0.5), new THREE.Vector2(1.1, -0.1), new THREE.Vector2(0.75, -0.25), new THREE.Vector2(0.4, -0.15)])), M(shade(look.primary, 0.6), { side: true }), [sx * 0.08, top - 0.05, -tw - 0.05], [0, sx > 0 ? -0.35 : Math.PI + 0.35, 0]); w.scale.y = 1; }); break;
  }
  // ---- tail
  if (look.tail || look.body === 'tiefling' || look.body === 'dragonborn' || look.body === 'lizardfolk') {
    const thick = look.body !== 'tiefling';
    add(g, cone(thick ? 0.13 : 0.04, thick ? 0.9 : 0.85, 5), skin, [0, hip - 0.1, -tw - 0.3], [-1.9, 0, 0]);
    if (!thick) add(g, cone(0.07, 0.12, 3), skin, [0, hip - 0.38, -tw - 0.72], [-1.2, 0, 0]);
  }

  // ---- gear in the hands
  const [rightHand, leftHand] = hands;
  const weapon = weaponModel(look.main, { metal, metalD, leather, leatherD, prim, sec, gold, wood: M('#7a5533'), glow: M(look.eyeColor === '#141210' ? '#7fd6ff' : look.eyeColor, { glow: true }), flame: M('#ffb347', { glow: true }) });
  if (weapon) { weapon.obj.rotation.x = weapon.tilt; weapon.obj.position.y = -weapon.grip * Math.cos(weapon.tilt); weapon.obj.position.z = -weapon.grip * Math.sin(weapon.tilt); rightHand.add(weapon.obj); }
  const offItem = offModel(look.off, { metal, metalD, leather, leatherD, prim, sec, gold, wood: M('#7a5533'), glow: M(look.eyeColor === '#141210' ? '#ffd36b' : look.eyeColor, { glow: true }), flame: M('#ffb347', { glow: true }), bone: hornM, dark });
  if (offItem) leftHand.add(offItem);

  // the whole figure on the ancestry's scale, merged for speed
  g.scale.setScalar(a.s);
  const hatH = { wizard: hr * 2.6, crown: hr * 1.4, antlers: hr * 1.6, horned: hr * 1.4, cowl: hr * 1.2, strawhat: hr * 1.1, feathercap: hr * 1.6 }[look.hat as string] ?? hr * 1.05;
  const height = (headY + hatH) * a.s;
  return { group: mergeByMaterial(root), height };
}

interface Mats { metal: THREE.Material; metalD: THREE.Material; leather: THREE.Material; leatherD: THREE.Material; prim: THREE.Material; sec: THREE.Material; gold: THREE.Material; wood: THREE.Material; glow: THREE.Material; flame: THREE.Material; bone?: THREE.Material; dark?: THREE.Material }

/** Weapons are modelled along +y with the grip at the origin; `grip` slides it in the hand, `tilt` angles it forward. */
function weaponModel(id: FigureLook['main'], m: Mats): { obj: THREE.Group; grip: number; tilt: number } | null {
  const o = new THREE.Group();
  const haft = (len: number, r = 0.025) => add(o, cyl(r, r, len, 5), m.wood, [0, len / 2 - 0.1, 0]);
  const blade = (len: number, w = 0.07) => { add(o, box(w, len, 0.018), m.metal, [0, 0.12 + len / 2, 0]); add(o, cone(w * 0.72, 0.1, 4), m.metal, [0, 0.17 + len, 0], [0, Math.PI / 4, 0], [1, 1, 0.26]); add(o, box(0.22, 0.04, 0.05), m.metalD, [0, 0.1, 0]); add(o, cyl(0.022, 0.022, 0.16, 5), m.leatherD, [0, 0, 0]); add(o, ico(0.035, 0), m.gold, [0, -0.09, 0]); };
  switch (id) {
    case 'none': return null;
    case 'sword': blade(0.6); return { obj: o, grip: 0, tilt: 0.95 };
    case 'longsword': blade(0.8); return { obj: o, grip: 0, tilt: 0.9 };
    case 'greatsword': blade(1.05, 0.1); add(o, cyl(0.024, 0.024, 0.3, 5), m.leatherD, [0, -0.06, 0]); return { obj: o, grip: 0, tilt: 0.65 };
    case 'dagger': add(o, box(0.05, 0.28, 0.015), m.metal, [0, 0.22, 0]); add(o, box(0.13, 0.03, 0.04), m.metalD, [0, 0.08, 0]); add(o, cyl(0.02, 0.02, 0.12, 5), m.leatherD); return { obj: o, grip: 0, tilt: 1.2 };
    case 'scimitar': for (let i = 0; i < 4; i++) add(o, box(0.075, 0.2, 0.016), m.metal, [i * i * 0.012, 0.18 + i * 0.18, 0], [0, 0, -i * 0.12]); add(o, tor(0.07, 0.012, Math.PI, 3, 6), m.gold, [0.03, 0.06, 0], [0, 0, Math.PI]); add(o, cyl(0.022, 0.022, 0.14, 5), m.leatherD); return { obj: o, grip: 0, tilt: 0.95 };
    case 'axe': haft(0.75); add(o, box(0.22, 0.2, 0.025), m.metal, [0.1, 0.55, 0]); return { obj: o, grip: 0, tilt: 0.85 };
    case 'greataxe': haft(1.15, 0.03); for (const sx of [-1, 1]) add(o, box(0.26, 0.3, 0.03), m.metal, [sx * 0.14, 0.92, 0], [0, 0, sx * 0.1]); return { obj: o, grip: 0.1, tilt: 0.55 };
    case 'mace': haft(0.55); add(o, ico(0.1, 0), m.metal, [0, 0.47, 0]); for (let i = 0; i < 4; i++) add(o, box(0.04, 0.16, 0.12), m.metalD, [Math.cos(i * 1.57) * 0.07, 0.47, Math.sin(i * 1.57) * 0.07], [0, -i * 1.57, 0]); return { obj: o, grip: 0, tilt: 0.85 };
    case 'hammer': haft(0.55); add(o, box(0.22, 0.12, 0.12), m.metal, [0, 0.47, 0]); return { obj: o, grip: 0, tilt: 0.85 };
    case 'warhammer': haft(0.95, 0.03); add(o, box(0.3, 0.17, 0.17), m.metal, [0, 0.82, 0]); add(o, cone(0.05, 0.18, 4), m.metalD, [-0.22, 0.82, 0], [0, 0, Math.PI / 2]); return { obj: o, grip: 0, tilt: 0.6 };
    case 'club': add(o, cyl(0.07, 0.03, 0.6, 6), m.wood, [0, 0.22, 0]); add(o, ico(0.07, 0), m.wood, [0, 0.52, 0]); return { obj: o, grip: 0, tilt: 0.85 };
    case 'spear': haft(1.6, 0.022); add(o, cone(0.05, 0.22, 4), m.metal, [0, 1.6, 0]); return { obj: o, grip: 0.55, tilt: 0.6 };
    case 'halberd': haft(1.7, 0.024); add(o, cone(0.04, 0.22, 4), m.metal, [0, 1.7, 0]); add(o, box(0.22, 0.24, 0.02), m.metal, [0.11, 1.45, 0]); add(o, cone(0.03, 0.12, 4), m.metalD, [-0.08, 1.45, 0], [0, 0, Math.PI / 2]); return { obj: o, grip: 0.55, tilt: 0.55 };
    case 'trident': haft(1.5, 0.022); for (const x of [-0.07, 0, 0.07]) add(o, cone(0.022, 0.22, 4), m.metal, [x, 1.5, 0]); add(o, box(0.18, 0.03, 0.03), m.metal, [0, 1.38, 0]); return { obj: o, grip: 0.5, tilt: 0.6 };
    case 'staff': add(o, cyl(0.028, 0.032, 1.75, 5), m.wood, [0, 0.55, 0]); add(o, ico(0.08, 0), m.glow, [0, 1.48, 0]); add(o, tor(0.07, 0.015, Math.PI * 2, 3, 6), m.wood, [0, 1.4, 0], [Math.PI / 2, 0, 0]); return { obj: o, grip: 0.0, tilt: 0.55 };
    case 'wand': add(o, cyl(0.015, 0.02, 0.32, 5), m.wood, [0, 0.1, 0]); add(o, ico(0.03, 0), m.glow, [0, 0.27, 0]); return { obj: o, grip: 0, tilt: 1.2 };
    case 'bow': { const arc = add(o, tor(0.6, 0.022, 2.3, 3, 10), m.wood, [-0.45, 0.25, 0], [0, 0, -1.15]); arc.scale.set(1, 1, 1); add(o, cyl(0.004, 0.004, 1.1, 3), m.sec, [0.08, 0.25, 0]); return { obj: o, grip: 0, tilt: 0.55 }; }
    case 'crossbow': add(o, box(0.06, 0.6, 0.06), m.wood, [0, 0.2, 0]); add(o, tor(0.3, 0.02, 2.2, 3, 8), m.wood, [0, 0.48, 0.0], [Math.PI / 2, 0, Math.PI / 2 + 0.0], [1, 1, 1]); return { obj: o, grip: 0, tilt: 1.45 };
    case 'torch': add(o, cyl(0.03, 0.02, 0.45, 5), m.wood, [0, 0.12, 0]); add(o, cone(0.07, 0.22, 5), m.flame, [0, 0.45, 0]); return { obj: o, grip: 0, tilt: 0.5 };
    case 'pick': haft(0.7); add(o, cyl(0.025, 0.012, 0.5, 4), m.metal, [0, 0.58, 0], [0, 0, Math.PI / 2 + 0.25]); return { obj: o, grip: 0, tilt: 0.75 };
    case 'scythe': haft(1.6, 0.022); add(o, tor(0.38, 0.03, 1.6, 3, 8), m.metal, [-0.35, 1.45, 0], [0, 0, 0.2], [1, 1, 0.4]); return { obj: o, grip: 0.5, tilt: 0.55 };
    case 'flail': add(o, cyl(0.025, 0.025, 0.4, 5), m.wood, [0, 0.1, 0]); for (let i = 0; i < 3; i++) add(o, tor(0.025, 0.008, Math.PI * 2, 3, 5), m.metalD, [0.03 * i, 0.33 + i * 0.05, 0]); add(o, ico(0.08, 0), m.metal, [0.12, 0.42, 0]); for (let i = 0; i < 5; i++) add(o, cone(0.02, 0.07, 3), m.metalD, [0.12 + Math.cos(i * 1.25) * 0.08, 0.42 + Math.sin(i * 1.25) * 0.08, 0], [0, 0, i * 1.25 - Math.PI / 2]); return { obj: o, grip: 0, tilt: 0.95 };
    case 'lute': add(o, ico(0.18, 0), m.wood, [0, 0, 0], [0, 0, 0], [1, 1.2, 0.45]); add(o, box(0.05, 0.45, 0.03), m.leatherD, [0, 0.38, 0]); add(o, box(0.08, 0.08, 0.04), m.wood, [0, 0.62, 0], [0, 0, 0.3]); return { obj: o, grip: 0, tilt: 1.2 };
    case 'sickle': add(o, cyl(0.022, 0.022, 0.2, 5), m.wood, [0, 0, 0]); add(o, tor(0.16, 0.02, Math.PI * 1.2, 3, 8), m.metal, [0.12, 0.22, 0], [0, 0, 0.6], [1, 1, 0.5]); return { obj: o, grip: 0, tilt: 1.0 };
    case 'whip': add(o, cyl(0.02, 0.02, 0.2, 5), m.leatherD, [0, 0, 0]); add(o, tor(0.12, 0.012, Math.PI * 2 * 0.9, 3, 10), m.leather, [0.1, 0.18, 0], [0, 0, 0]); add(o, tor(0.09, 0.012, Math.PI * 2 * 0.9, 3, 10), m.leather, [0.1, 0.18, 0.03], [0, 0.3, 0]); return { obj: o, grip: 0, tilt: 1.3 };
  }
  return null;
}

function offModel(id: FigureLook['off'], m: Mats): THREE.Object3D | null {
  const o = new THREE.Group();
  // the off-hand pivot hangs with a slight forward tilt; shields face forward (+z) and outward
  const face = (obj: THREE.Object3D, out = 0.1) => { obj.rotation.x = Math.PI / 2 + 0.25; obj.position.set(-out, 0.1, 0.12); };
  switch (id) {
    case 'none': return null;
    case 'roundshield': { const s = new THREE.Group(); add(s, cyl(0.32, 0.32, 0.05, 9), m.prim); add(s, ico(0.08, 0), m.metal, [0, 0.04, 0]); add(s, tor(0.32, 0.025, Math.PI * 2, 3, 9), m.metalD, [0, 0, 0], [Math.PI / 2, 0, 0]); add(s, box(0.08, 0.06, 0.6), m.sec, [0, 0.03, 0]); face(s); o.add(s); return o; }
    case 'kiteshield': { const s = new THREE.Group(); const shp = new THREE.Shape([new THREE.Vector2(-0.28, 0.3), new THREE.Vector2(0.28, 0.3), new THREE.Vector2(0.25, -0.05), new THREE.Vector2(0, -0.5), new THREE.Vector2(-0.25, -0.05)]); add(s, new THREE.ExtrudeGeometry(shp, { depth: 0.05, bevelEnabled: false }), m.prim, [0, 0, -0.025]); add(s, box(0.08, 0.7, 0.03), m.sec, [0, -0.08, 0.04]); add(s, box(0.5, 0.08, 0.03), m.sec, [0, 0.12, 0.04]); s.rotation.set(0.15, 0, 0); s.position.set(-0.12, 0.05, 0.12); o.add(s); return o; }
    case 'towershield': { const s = new THREE.Group(); add(s, box(0.6, 0.95, 0.06), m.prim); add(s, box(0.64, 0.06, 0.07), m.metalD, [0, 0.45, 0]); add(s, box(0.64, 0.06, 0.07), m.metalD, [0, -0.45, 0]); add(s, ico(0.08, 0), m.metal, [0, 0.05, 0.05]); s.rotation.set(0.15, 0, 0); s.position.set(-0.12, 0.1, 0.14); o.add(s); return o; }
    case 'buckler': { const s = new THREE.Group(); add(s, cyl(0.18, 0.18, 0.04, 8), m.metal); add(s, ico(0.05, 0), m.gold, [0, 0.03, 0]); face(s, 0.06); o.add(s); return o; }
    case 'dagger': { add(o, box(0.05, 0.28, 0.015), m.metal, [0, 0.2, 0.05], [0.9, 0, 0]); add(o, cyl(0.02, 0.02, 0.12, 5), m.leatherD, [0, 0, 0], [0.9, 0, 0]); return o; }
    case 'handaxe': { add(o, cyl(0.022, 0.022, 0.5, 5), m.wood, [0, 0.15, 0.1], [0.9, 0, 0]); add(o, box(0.16, 0.14, 0.022), m.metal, [0.06, 0.28, 0.27], [0.9, 0, 0]); return o; }
    case 'book': { add(o, box(0.24, 0.3, 0.08), m.leather, [0, 0.05, 0.08], [0.3, 0, 0]); add(o, box(0.22, 0.28, 0.06), M('#f2ecdc'), [0.015, 0.05, 0.085], [0.3, 0, 0]); add(o, ico(0.03, 0), m.gold, [0, 0.05, 0.13]); return o; }
    case 'lantern': { add(o, tor(0.04, 0.008, Math.PI, 3, 5), m.metalD, [0, -0.05, 0]); add(o, box(0.12, 0.16, 0.12), m.metalD, [0, -0.17, 0]); add(o, ico(0.055, 0), m.flame, [0, -0.17, 0]); add(o, cone(0.08, 0.06, 4), m.metalD, [0, -0.06, 0], [0, Math.PI / 4, 0]); return o; }
    case 'orb': { add(o, ico(0.11, 1), m.glow, [0, 0.12, 0.06]); return o; }
    case 'torch': { add(o, cyl(0.03, 0.02, 0.45, 5), m.wood, [0, 0.12, 0.05], [0.4, 0, 0]); add(o, cone(0.07, 0.22, 5), m.flame, [0, 0.36, 0.16], [0.4, 0, 0]); return o; }
    case 'holy': { add(o, cyl(0.12, 0.12, 0.03, 8), m.gold, [0, 0.1, 0.08], [Math.PI / 2 + 0.3, 0, 0]); for (let i = 0; i < 8; i++) add(o, cone(0.025, 0.08, 3), m.gold, [Math.cos(i * 0.785) * 0.16, 0.1 + Math.sin(i * 0.785) * 0.16, 0.08], [0.3, 0, i * 0.785 - Math.PI / 2]); return o; }
    case 'potion': { add(o, ico(0.08, 1), M('#c97fff', { glow: true }), [0, 0.07, 0.04]); add(o, cyl(0.025, 0.03, 0.08, 5), M('#e8e8f0'), [0, 0.17, 0.04]); add(o, cyl(0.03, 0.03, 0.03, 5), m.wood, [0, 0.22, 0.04]); return o; }
    case 'skull': { add(o, ico(0.12, 1), m.bone ?? m.sec, [0, 0.12, 0.05]); add(o, box(0.12, 0.05, 0.1), m.bone ?? m.sec, [0, 0.03, 0.08]); for (const sx of [-1, 1]) add(o, ico(0.03, 0), m.dark ?? m.leatherD, [sx * 0.045, 0.14, 0.16]); return o; }
  }
  return null;
}

/** Merges all meshes of a group per material (one draw call per material); keeps transforms baked. */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (!mm.isMesh || Array.isArray(mm.material)) return;
    const geo = (mm.geometry.index ? mm.geometry.toNonIndexed() : mm.geometry.clone()).applyMatrix4(mm.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    buckets.set(mm.material, [...(buckets.get(mm.material) ?? []), geo]);
    mm.geometry.dispose();
  });
  const out = new THREE.Group();
  for (const [material, list] of buckets) {
    const merged = mergeGeometries(list, false);
    list.forEach((x) => x.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}
