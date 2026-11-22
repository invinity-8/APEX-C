/**
 * APEX 2.10 – the one-of-a-kind creatures built from the kit (kit3d.ts): eye tyrants, ghosts, elementals, golems and
 * animated armour, oozes, treants, tentacled horrors, the mimic, frogs, fish, hydras, turtles, snails, fungi,
 * carnivorous plants, brains, cloakers, whales, jellyfish, ropers, bats and butterflies. Facing +z, standing on y = 0,
 * sized as a MEDIUM creature; wings are flapping pivots (see kit3d.ts).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { blob, claw, ear, eye, hand, horn, insectWing, limb, membraneWing, mixHex, part, profile2, skin, spikeRow, tail, teeth, tentacle, tone, tube, type V3 } from './kit3d';
import { beast, foldWing, withPattern } from './beasts3d';
import type { Surface } from './surface3d';

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const IVORY = '#efe6cf';
/** n points along a gentle arc from `a` to `b`, bulging by `bend`. */
const arc = (a: V3, b: V3, bend: V3, n = 4): V3[] => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, k = Math.sin(t * Math.PI); return [a[0] + (b[0] - a[0]) * t + bend[0] * k, a[1] + (b[1] - a[1]) * t + bend[1] * k, a[2] + (b[2] - a[2]) * t + bend[2] * k]; });
/** A glowing bead (eyes of spirits and constructs). */
const glowDot = (g: THREE.Object3D, at: V3, r: number, c: string, k = 1.8) => blob(g, [r, r, r], skin(c, { glow: k, rough: 0.2 }), at);
const rbox = (w: number, h: number, d: number, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2));

// ---------------------------------------------------------------- aberrations
/** The eye tyrant: a floating orb with a great central eye, a toothy maw and ten eye stalks. */
export function beholder(g: THREE.Group, c: string, eyeC = '#7ad84a', small = false): void {
  const S = small ? 0.6 : 1, y = small ? 1.15 : 1.35;
  const body = skin(c, { rough: 0.55, surface: 'skin' }), dark = skin(tone(c, 0.62), { rough: 0.6, surface: 'skin' });
  blob(g, [0.62 * S, 0.58 * S, 0.6 * S], body, [0, y, 0], undefined, 1.4);
  for (let i = 0; i < 18; i++) { const a = i * 2.39996, el = Math.acos(1 - 2 * ((i + 0.5) / 18)); const p: V3 = [Math.sin(el) * Math.cos(a), Math.cos(el), Math.sin(el) * Math.sin(a)]; if (p[2] > 0.45) continue; blob(g, [0.08 * S, 0.08 * S, 0.05 * S], dark, [p[0] * 0.6 * S, y + p[1] * 0.56 * S, p[2] * 0.58 * S], p); }
  // the great eye under a heavy lid
  eye(g, [0, y + 0.1 * S, 0.47 * S], 0.25 * S, { iris: eyeC, pupil: 'slit', glow: 0.45, look: [0, 0, 1] });
  tube(g, [[-0.3 * S, y + 0.28 * S, 0.42 * S], [0, y + 0.4 * S, 0.55 * S], [0.3 * S, y + 0.28 * S, 0.42 * S]], () => 0.07 * S, body, { sides: 10 });
  // the maw
  blob(g, [0.36 * S, 0.13 * S, 0.14 * S], skin('#3a0e12', { rough: 0.4 }), [0, y - 0.3 * S, 0.46 * S]);
  teeth(g, [-0.3 * S, y - 0.22 * S, 0.54 * S], [0.3 * S, y - 0.22 * S, 0.54 * S], 9, 0.09 * S, skin(IVORY));
  teeth(g, [-0.26 * S, y - 0.4 * S, 0.52 * S], [0.26 * S, y - 0.4 * S, 0.52 * S], 8, 0.08 * S, skin(IVORY), false);
  // eye stalks
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3, base: V3 = [Math.cos(a) * 0.28 * S, y + 0.48 * S, Math.sin(a) * 0.26 * S - 0.04 * S];
    const tip: V3 = [Math.cos(a) * 0.66 * S, y + (0.98 + (i % 3) * 0.1) * S, Math.sin(a) * 0.56 * S - 0.06 * S];
    tube(g, arc(base, tip, [Math.cos(a) * 0.12 * S, 0.12 * S, 0], 4), (t) => 0.045 * S * (1 - t * 0.35), body, { sides: 8 });
    eye(g, tip, 0.075 * S, { iris: eyeC, glow: 0.55, look: [Math.cos(a) * 0.5, 0.25, 0.7 + Math.sin(a) * 0.35] });
  }
}
/** Aboleth, otyugh, gibbering mouther, octopus / kraken. */
export function tentacled(g: THREE.Group, kind: 'aboleth' | 'otyugh' | 'octopus' | 'mouther', c: string): void {
  const body = skin(c, { rough: 0.45, surface: 'skin' }), dark = skin(tone(c, 0.6), { rough: 0.5, surface: 'skin' }), under = skin(mixHex(c, '#e8d8c8', 0.45), { rough: 0.5, surface: 'skin' });
  if (kind === 'mouther') {
    // a heap of flesh full of eyes and mouths
    for (let i = 0; i < 12; i++) { const a = i * 2.39996, r = 0.25 + (i % 3) * 0.08; blob(g, [r, r * 0.8, r], i % 4 ? body : dark, [Math.cos(a) * 0.38 * (i / 12 + 0.4), 0.25 + (i % 4) * 0.13, Math.sin(a) * 0.34 * (i / 12 + 0.4)]); }
    for (let i = 0; i < 11; i++) { const a = i * 1.7, h = 0.25 + (i % 4) * 0.15; const p: V3 = [Math.cos(a) * 0.48, h, Math.sin(a) * 0.42 + 0.06]; eye(g, p, 0.05 + (i % 3) * 0.02, { iris: ['#e8c030', '#7ad84a', '#d8603a', '#7ab8e8'][i % 4], look: [Math.cos(a), 0.2, Math.sin(a) + 0.5] }); }
    for (let i = 0; i < 4; i++) { const a = i * 1.5 + 0.4, p: V3 = [Math.cos(a) * 0.5, 0.3 + i * 0.1, Math.sin(a) * 0.4 + 0.12]; blob(g, [0.1, 0.05, 0.06], skin('#3a0e12'), p); teeth(g, add(p, [-0.07, 0.03, 0.04]), add(p, [0.07, 0.03, 0.04]), 4, 0.05, skin(IVORY)); }
    return;
  }
  if (kind === 'otyugh') {
    blob(g, [0.6, 0.5, 0.58], body, [0, 0.75, 0]);
    blob(g, [0.45, 0.25, 0.42], under, [0, 0.45, 0.05]);
    for (const [x, z] of [[-0.35, 0.25], [0.35, 0.25], [0, -0.42]]) { limb(g, [[x, 0.55, z], [x * 1.35, 0.3, z * 1.3], [x * 1.4, 0.03, z * 1.4]], [0.15, 0.12, 0.1], body, 0.25, 10); blob(g, [0.13, 0.06, 0.16], dark, [x * 1.4, 0.04, z * 1.4 + 0.04]); }
    // the mouth on top, an eye stalk, two tentacles with spiked pads
    blob(g, [0.32, 0.12, 0.2], skin('#3a0e12'), [0, 1.18, 0.22]);
    teeth(g, [-0.26, 1.24, 0.32], [0.26, 1.24, 0.32], 7, 0.1, skin(IVORY));
    teeth(g, [-0.22, 1.1, 0.34], [0.22, 1.1, 0.34], 6, 0.08, skin(IVORY), false);
    tube(g, arc([0, 1.2, -0.1], [0.05, 1.75, 0.05], [0, 0, -0.15], 4), (t) => 0.05 * (1 - t * 0.3), body, { sides: 8 });
    eye(g, [0.05, 1.78, 0.08], 0.09, { iris: '#e8e070', look: [0, 0, 1] });
    for (const x of [-1, 1]) {
      const tip: V3 = [x * 1.15, 1.3, 0.65];
      tentacle(g, arc([x * 0.5, 0.95, 0], tip, [x * 0.15, 0.4, -0.1], 5), 0.1, body);
      blob(g, [0.13, 0.09, 0.16], dark, tip);
      for (let k = 0; k < 4; k++) claw(g, tip, [Math.cos(k * 1.57) * 0.7, Math.sin(k * 1.57) * 0.7, 0.6], 0.14, 0.03, skin(IVORY), 0);
    }
    return;
  }
  if (kind === 'aboleth') {
    // a slimy fish-body, three stacked eyes, a tail fin and four tentacles under the head
    tube(g, [[0, 0.5, -1.15], [0, 0.55, -0.5], [0, 0.6, 0.2], [0, 0.55, 0.85]], profile2([[0.05, 0.12], [0.36, 0.34], [0.46, 0.42], [0.32, 0.3]]), skin(c, { rough: 0.25 }), { sides: 16 });
    blob(g, [0.36, 0.18, 0.7], under, [0, 0.35, 0.15]);
    for (const s of [-1, 1]) tube(g, [[0, 0.5, -1.1], [0, 0.5 + s * 0.35, -1.45]], (t) => [0.05, 0.3 * (1 - t * 0.6)], dark, { sides: 8 });
    for (const x of [-1, 1]) tube(g, [[x * 0.38, 0.5, 0.1], [x * 0.75, 0.32, -0.15]], (t) => [0.22 * (1 - t * 0.5), 0.03], dark, { sides: 8 });
    spikeRow(g, [[0, 0.98, 0.3], [0, 0.95, -0.4], [0, 0.65, -1.0]], 6, 0.25, dark, { plates: true, lean: 0.7 });
    for (let i = 0; i < 3; i++) for (const x of [-1, 1]) eye(g, [x * 0.24, 0.82 - i * 0.06, 0.55 - i * 0.2], 0.07, { iris: '#e83a2a', glow: 0.6, look: [x, 0.3, 0.6] });
    for (let i = 0; i < 4; i++) { const a = (i / 3 - 0.5) * 1.3; tentacle(g, arc([Math.sin(a) * 0.25, 0.35, 0.75], [Math.sin(a) * 0.65, 0.04, 1.55], [0, 0.18, 0], 5), 0.08, body, under); }
    return;
  }
  // octopus / kraken: a soft mantle, big eyes and eight curling arms with suckers
  tube(g, [[0, 0.55, 0.05], [0, 0.95, -0.1], [0, 1.45, -0.35], [0, 1.7, -0.6]], profile2([[0.42, 0.4], [0.5, 0.48], [0.42, 0.4], [0.18, 0.18]]), body, { sides: 16 });
  for (const x of [-1, 1]) eye(g, [x * 0.33, 0.78, 0.3], 0.12, { iris: '#e8c030', pupil: 'goat', look: [x * 0.6, 0, 1] });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2, d: V3 = [Math.cos(a), 0, Math.sin(a)]; tentacle(g, [[d[0] * 0.25, 0.5, d[2] * 0.25], [d[0] * 0.6, 0.15, d[2] * 0.6], [d[0] * 1.0, 0.06, d[2] * 1.0], [d[0] * 1.2 - d[2] * 0.25, 0.25, d[2] * 1.2 + d[0] * 0.25]], 0.11, body, under); }
}
/** Floating brain with a beak and tentacles (grell), the brain on legs (intellect devourer), the flumph. */
export function brainy(g: THREE.Group, kind: 'grell' | 'devourer' | 'flumph'): void {
  if (kind === 'flumph') {
    const m = skin('#c8e0d8', { rough: 0.5 }), glow = skin('#a8d8ff', { glow: 0.45, opacity: 0.85 });
    tube(g, [[0, 1.18, 0], [0, 1.32, 0], [0, 1.4, 0]], (t) => 0.55 * Math.sqrt(1 - t * 0.7), m, { sides: 18 });
    for (const x of [-1, 1]) { tube(g, arc([x * 0.15, 1.42, 0.2], [x * 0.22, 1.78, 0.32], [x * 0.05, 0, -0.05], 3), () => 0.03, m, { sides: 6 }); eye(g, [x * 0.22, 1.8, 0.33], 0.06, { look: [0, 0, 1] }); }
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; tentacle(g, arc([Math.cos(a) * 0.32, 1.16, Math.sin(a) * 0.32], [Math.cos(a) * 0.45, 0.55, Math.sin(a) * 0.45], [Math.sin(i) * 0.08, 0.05, 0], 4), 0.04, glow); }
    return;
  }
  const pink = skin('#c87a8a', { rough: 0.35, surface: 'skin' }), fold = skin('#a85a6a', { rough: 0.4, surface: 'skin' });
  const y = kind === 'grell' ? 1.45 : 0.62, R = kind === 'grell' ? 0.42 : 0.34;
  blob(g, [R, R * 0.8, R * 1.15], pink, [0, y, 0]);
  // the folds of a brain: winding grooves over both halves
  for (const x of [-1, 1]) for (let k = 0; k < 4; k++) { const pts: V3[] = []; for (let i = 0; i <= 10; i++) { const t = i / 10, a = (t - 0.5) * 2.6, r = 0.35 + k * 0.17; pts.push([x * (R * 0.25 + Math.sin(i * 1.9 + k) * R * 0.06 + r * R * 0.55), y + Math.cos(a) * R * 0.78 * Math.sqrt(1 - r * r * 0.45), Math.sin(a) * R * 1.1]); } tube(g, pts, () => R * 0.07, fold, { sides: 6 }); }
  blob(g, [R * 0.05, R * 0.82, R * 1.18], skin('#8a4a5a'), [0, y + R * 0.05, 0]);
  if (kind === 'grell') {
    tube(g, [[0, y - 0.15, 0.4], [0, y - 0.3, 0.6], [0, y - 0.48, 0.66]], (t) => [0.12 * (1 - t) + 0.005, 0.15 * (1 - t) + 0.005], skin('#3a3a2a', { rough: 0.4 }), { sides: 8, capEnd: false });
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; tentacle(g, arc([Math.cos(a) * 0.25, y - 0.25, Math.sin(a) * 0.25], [Math.cos(a) * 0.55, 0.12, Math.sin(a) * 0.55], [0, 0.25, 0], 5), 0.055, pink); }
  } else for (const [x, z] of [[-0.25, 0.25], [0.25, 0.25], [-0.25, -0.25], [0.25, -0.25]]) {
    limb(g, [[x, y - 0.12, z], [x * 1.8, 0.4, z * 1.8], [x * 2.0, 0.04, z * 2.0]], [0.06, 0.045, 0.035], fold, 0.2, 8);
    claw(g, [x * 2.0, 0.04, z * 2.0], [x, -0.2, z], 0.12, 0.025, skin('#2a1a1a'), 0.6);
  }
}
/** Cloaker and darkmantle: a manta-like cape with red eyes and a whip tail. */
export function cloaker(g: THREE.Group, c: string, small = false): void {
  const k = small ? 0.55 : 1, y = small ? 1.9 : 1.6;
  const m = skin(c, { side: true, rough: 0.7 }), ridge = skin(tone(c, 1.25), { rough: 0.6 });
  // the cape: a curved, scalloped sheet
  const pos: number[] = [];
  const ring = (u: number) => { const pts: V3[] = []; for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; const rx = Math.cos(a), rz = Math.sin(a); const edge = 1 - 0.18 * Math.abs(Math.sin(a * 5)) * u; pts.push([rx * u * edge * 1.05 * k, y - (rx * rx) * 0.45 * u * k, (rz * 0.75 - 0.35) * u * edge * k]); } return pts; };
  const rows = [ring(0.05), ring(0.35), ring(0.7), ring(1)];
  for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < 16; i++) { const a = rows[r][i], b = rows[r][i + 1], c2 = rows[r + 1][i], d = rows[r + 1][i + 1]; pos.push(...a, ...c2, ...b, ...b, ...c2, ...d); }
  for (const z of [-1]) { const back = rows.map((row) => row.map((p) => [p[0], p[1], -0.35 * k * z * 0 + (-(p[2] + 0.35 * k) - 0.35 * k)] as V3)); for (let r = 0; r < back.length - 1; r++) for (let i = 0; i < 16; i++) { const a = back[r][i], b = back[r][i + 1], c2 = back[r + 1][i], d = back[r + 1][i + 1]; pos.push(...a, ...b, ...c2, ...b, ...d, ...c2); } }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals(); geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  part(g, geo, m);
  tube(g, [[0, y + 0.05, 0.3 * k], [0, y + 0.08, -0.2 * k], [0, y, -0.65 * k]], (t) => [0.2 * k * (1 - t * 0.5), 0.1 * k], ridge, { sides: 10 });
  for (const x of [-1, 1]) glowDot(g, [x * 0.09 * k, y + 0.14, 0.28 * k], 0.04 * k, '#e83a2a', 1.4);
  tail(g, arc([0, y, -0.65 * k], [0, y - 0.5 * k, -1.5 * k], [0, 0.3 * k, 0], 5), 0.06 * k, ridge);
  if (small) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; tentacle(g, arc([Math.cos(a) * 0.3, y - 0.1, Math.sin(a) * 0.25 - 0.1], [Math.cos(a) * 0.38, y - 0.75, Math.sin(a) * 0.3 - 0.1], [0, 0.05, 0], 3), 0.04, ridge); }
}
/** Giant jellyfish: a glowing bell, a frilly rim, oral arms and long tentacles. */
export function jellyfish(g: THREE.Group): void {
  const bell = skin('#c8a0ff', { opacity: 0.6, glow: 0.5, side: true }), inner = skin('#ff9ad8', { glow: 0.8, opacity: 0.8 }), str = skin('#e0c8ff', { opacity: 0.7, glow: 0.4 });
  part(g, new THREE.SphereGeometry(0.6, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), bell, [0, 1.35, 0], [0, 0, 0], [1, 0.8, 1]);
  blob(g, [0.25, 0.18, 0.25], inner, [0, 1.48, 0]);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; blob(g, [0.08, 0.05, 0.08], bell, [Math.cos(a) * 0.57, 1.22, Math.sin(a) * 0.57]); }
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; tube(g, arc([Math.cos(a) * 0.12, 1.25, Math.sin(a) * 0.12], [Math.cos(a) * 0.2, 0.45, Math.sin(a) * 0.2], [Math.sin(i * 2) * 0.12, 0, Math.cos(i * 2) * 0.12], 6), (t) => [0.08 * (1 - t * 0.6), 0.02], inner, { sides: 8 }); }
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; tentacle(g, arc([Math.cos(a) * 0.5, 1.22, Math.sin(a) * 0.5], [Math.cos(a) * 0.55, 0.12, Math.sin(a) * 0.55], [Math.sin(i * 1.3) * 0.12, 0, Math.cos(i * 1.7) * 0.12], 6), 0.025, str); }
}
/** Roper: a stalagmite with one eye, a toothy mouth and grasping tendrils. */
export function roper(g: THREE.Group): void {
  const rock = skin('#6a6458', { rough: 0.95, surface: 'stone' }), dark = skin('#4a463e', { rough: 0.95, surface: 'stone' });
  tube(g, [[0, 0, 0], [0.03, 0.8, 0], [-0.02, 1.5, 0.02], [0, 2.1, 0.03]], profile2([[0.58, 0.55], [0.46, 0.44], [0.32, 0.3], [0.05, 0.05]]), rock, { sides: 9, capStart: false });
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; tube(g, [[Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5], [Math.cos(a) * 0.36, 1.1, Math.sin(a) * 0.36], [Math.cos(a) * 0.12, 1.85, Math.sin(a) * 0.12]], () => 0.05, dark, { sides: 5 }); }
  eye(g, [0, 1.35, 0.33], 0.13, { iris: '#e8e070', glow: 0.8, pupil: 'slit', look: [0, 0, 1] });
  blob(g, [0.24, 0.1, 0.1], skin('#3a0e12'), [0, 0.95, 0.42]);
  teeth(g, [-0.2, 1.0, 0.48], [0.2, 1.0, 0.48], 7, 0.08, skin(IVORY));
  teeth(g, [-0.18, 0.88, 0.47], [0.18, 0.88, 0.47], 6, 0.07, skin(IVORY), false);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; tentacle(g, arc([Math.cos(a) * 0.38, 1.05, Math.sin(a) * 0.38], [Math.cos(a) * 1.25, 0.15, Math.sin(a) * 1.25], [0, 0.5, 0], 6), 0.045, skin('#8a847a', { rough: 0.8 })); }
}

// ---------------------------------------------------------------- spirits and elementals
/** Ghosts, wraiths, specters: a flowing hooded shroud with reaching hands and a tattered hem. */
export function ghost(g: THREE.Group, c: string, glow = 0.4): void {
  const m = skin(c, { opacity: 0.6, glow, side: true }), dark = skin('#0a0c12', { opacity: 0.9 });
  tube(g, [[0, 2.02, 0.02], [0, 1.62, 0], [0, 1.05, -0.08], [0, 0.45, -0.25]], profile2([[0.25, 0.27], [0.4, 0.33], [0.46, 0.4], [0.55, 0.46]]), m, { sides: 18, capEnd: false });
  blob(g, [0.2, 0.25, 0.12], dark, [0, 1.9, 0.18]);
  for (const x of [-1, 1]) glowDot(g, [x * 0.075, 1.93, 0.27], 0.035, '#bfe8ff', 2);
  for (const x of [-1, 1]) {
    tube(g, [[x * 0.32, 1.66, 0.02], [x * 0.46, 1.42, 0.22], [x * 0.4, 1.32, 0.5]], (t) => [0.1 * (1 - t * 0.45), 0.09 * (1 - t * 0.45)], m, { sides: 10 });
    hand(g, [x * 0.4, 1.32, 0.52], [0, -0.35, 1], [0, -1, 0], 0.15, m, { curl: 0.45, long: 1.5 });
  }
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; claw(g, [Math.cos(a) * 0.5, 0.5, Math.sin(a) * 0.44 - 0.25], [Math.cos(a) * 0.35, -1, Math.sin(a) * 0.35], 0.42 + (i % 3) * 0.08, 0.08, m, 0.1); }
}
/** Will-o'-wisp: a bright core in a soft halo with drifting sparks. */
export function wisp(g: THREE.Group): void {
  glowDot(g, [0, 1.3, 0], 0.22, '#e8f8ff', 2.4);
  blob(g, [0.42, 0.42, 0.42], skin('#7ac8ff', { glow: 0.8, opacity: 0.28 }), [0, 1.3, 0]);
  for (let i = 0; i < 6; i++) glowDot(g, [Math.cos(i * 2.4) * 0.5, 1.3 + Math.sin(i * 1.7) * 0.35, Math.sin(i * 2.4) * 0.45], 0.04, '#bfe8ff', 2);
}
/** Elementals: fire, water, air (earth is a rocky golem). */
export function elemental(g: THREE.Group, kind: 'fire' | 'water' | 'air' | 'earth'): void {
  if (kind === 'earth') { golem(g, '#7a6a52', '#ffb347', 'rough'); return; }
  if (kind === 'air') {
    const m = skin('#d8e8f0', { opacity: 0.35, side: true }), m2 = skin('#ffffff', { opacity: 0.28, side: true });
    const pts: V3[] = []; for (let i = 0; i <= 30; i++) { const t = i / 30, a = t * 12; pts.push([Math.cos(a) * 0.06 * (1 + t * 3), 0.05 + t * 2.0, Math.sin(a) * 0.06 * (1 + t * 3)]); }
    tube(g, pts, (t) => 0.05 + t * 0.48, m, { sides: 14, steps: 60, capEnd: false });
    for (let i = 0; i < 6; i++) part(g, new THREE.TorusGeometry(0.15 + i * 0.1, 0.035, 6, 24), m2, [Math.sin(i) * 0.04, 0.3 + i * 0.3, 0], [Math.PI / 2 + (i % 2 ? 0.25 : -0.2), 0, i * 0.3]);
    for (const x of [-1, 1]) tube(g, arc([x * 0.35, 1.6, 0], [x * 0.95, 1.2, 0.45], [x * 0.1, 0.35, -0.1], 5), (t) => 0.14 * (1 - t * 0.7), m, { sides: 10 });
    for (const x of [-1, 1]) glowDot(g, [x * 0.1, 2.05, 0.38], 0.045, '#e8f8ff', 2);
    return;
  }
  const fire = kind === 'fire';
  const core = fire ? skin('#ff5a1a', { glow: 1.3, opacity: 0.9 }) : skin('#3a8ac8', { opacity: 0.72, rough: 0.08, glow: 0.12 });
  const hot = fire ? skin('#ffcf3a', { glow: 1.7, opacity: 0.92 }) : skin('#d8f0ff', { opacity: 0.82, glow: 0.3, rough: 0.1 });
  // a swirling column that widens into a chest and a head
  const col: V3[] = []; for (let i = 0; i <= 12; i++) { const t = i / 12; col.push([Math.sin(t * 7) * 0.06, 0.05 + t * 1.55, Math.cos(t * 5) * 0.04]); }
  tube(g, col, (t) => (fire ? 0.12 + t * 0.32 : 0.48 - t * 0.2 + Math.sin(t * Math.PI) * 0.05), core, { sides: 14, steps: 40 });
  blob(g, [0.42, 0.42, 0.32], core, [0, 1.45, 0.02]);
  blob(g, [0.22, 0.26, 0.22], core, [0, 1.92, 0.05]);
  if (!fire) part(g, new THREE.TorusGeometry(0.5, 0.11, 10, 28), hot, [0, 0.1, 0], [Math.PI / 2, 0, 0]);
  // flames / foam crests
  for (let i = 0; i < 12; i++) { const a = i * 2.39996, r = 0.15 + (i % 3) * 0.08; const base: V3 = [Math.cos(a) * r, 1.55 + (i % 4) * 0.12, Math.sin(a) * r * 0.8]; horn(g, base, [Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4 - 0.2], (fire ? 0.45 : 0.25) + (i % 3) * 0.1, fire ? 0.08 : 0.06, i % 2 ? hot : core, { curl: 0.6, axis: [Math.sin(a), 0, -Math.cos(a)] }); }
  for (const x of [-1, 1]) {
    tube(g, arc([x * 0.35, 1.6, 0], [x * 0.85, 1.05, 0.35], [x * 0.12, 0.3, 0], 5), (t) => 0.15 * (1 - t * 0.35), core, { sides: 10 });
    hand(g, [x * 0.86, 1.02, 0.38], [0, -0.6, 0.8], [-x, 0, 0], 0.2, core, { curl: 0.35 });
  }
  for (const x of [-1, 1]) glowDot(g, [x * 0.08, 1.96, 0.24], 0.04, fire ? '#fff8d0' : '#e8f8ff', 2);
}

// ---------------------------------------------------------------- constructs
/**
 * Golems and animated statues: heavy chiselled limbs, block hands and a glowing core. `kind`: smooth stone / iron,
 * rough rock (earth elemental, colossus) or soft clay / flesh.
 */
export function golem(g: THREE.Group, c: string, eyeC = '#7ad8ff', kind: 'stone' | 'iron' | 'rough' | 'clay' = 'stone'): void {
  const rough = kind === 'rough', metal = kind === 'iron' ? 0.65 : 0;
  const o = { flat: kind !== 'clay', rough: metal ? 0.38 : 0.9, ...(metal ? { metal } : {}), surface: (metal ? 'metal' : kind === 'clay' ? 'skin' : 'stone') as Surface };
  const st = skin(c, o), d = skin(tone(c, 0.72), o), glow = skin(eyeC, { glow: 1.6 });
  const chunk = (r: number, at: V3, sc: V3 = [1, 1, 1]) => part(g, new THREE.DodecahedronGeometry(r, 0), st, at, [at[0] * 3, at[1] * 2, at[2] * 5], sc);
  for (const x of [-1, 1]) {
    limb(g, [[x * 0.24, 0.95, 0], [x * 0.27, 0.5, 0.05], [x * 0.26, 0.14, 0]], [0.17, 0.14, 0.13], st, 0.15, rough ? 6 : 8);
    part(g, rbox(0.32, 0.15, 0.42, 0.04), d, [x * 0.26, 0.075, 0.06]);
  }
  part(g, rbox(0.66, 0.26, 0.4), d, [0, 0.98, 0]);
  part(g, rbox(1.0, 0.8, 0.58, 0.12), st, [0, 1.42, 0.02], [0.08, 0, 0]);
  part(g, rbox(0.62, 0.3, 0.5, 0.08), d, [0, 1.02 + 0.3, 0.06]);
  glowDot(g, [0, 1.48, 0.33], 0.09, eyeC, 1.4);
  for (let i = 0; i < 3; i++) part(g, new THREE.BoxGeometry(0.5 - i * 0.12, 0.025, 0.02), glow, [0, 1.62 - i * 0.07, 0.31]);
  part(g, rbox(0.38, 0.36, 0.38, 0.07), st, [0, 1.98, 0.1]);
  part(g, new THREE.BoxGeometry(0.28, 0.05, 0.04), skin('#0a0a0c'), [0, 2.0, 0.29]);
  for (const x of [-1, 1]) glowDot(g, [x * 0.07, 2.0, 0.3], 0.03, eyeC, 2);
  for (const x of [-1, 1]) {
    part(g, rbox(0.36, 0.3, 0.38, 0.08), d, [x * 0.62, 1.72, 0]);
    limb(g, [[x * 0.62, 1.66, 0], [x * 0.74, 1.22, 0.08], [x * 0.72, 0.82, 0.18]], [0.16, 0.14, 0.13], st, 0.18, rough ? 6 : 8);
    hand(g, [x * 0.72, 0.8, 0.2], [0, -1, 0.2], [-x, 0, 0], 0.26, st, { curl: 0.85, thick: 1.6 });
  }
  if (rough) for (let i = 0; i < 16; i++) { const a = i * 2.39996; chunk(0.09 + (i % 3) * 0.04, [Math.cos(a) * 0.48, 1.0 + (i % 5) * 0.22, Math.sin(a) * 0.3]); }
  if (kind === 'clay') for (let i = 0; i < 8; i++) blob(g, [0.08, 0.05, 0.03], d, [Math.cos(i * 1.7) * 0.35, 1.2 + (i % 4) * 0.12, 0.3]);
}
/** Animated armour: an empty suit of plate with a light in the visor and a sword. */
export function armour(g: THREE.Group, metal = '#a8b0b8'): void {
  const m = skin(metal, { metal: 0.75, rough: 0.32, surface: 'metal' }), dk = skin(tone(metal, 0.55), { metal: 0.7, rough: 0.4, surface: 'metal' }), gap = skin('#0a0a0c');
  for (const x of [-1, 1]) {
    limb(g, [[x * 0.15, 0.95, 0], [x * 0.17, 0.52, 0.04], [x * 0.16, 0.12, 0]], [0.11, 0.09, 0.075], m, 0.12, 12);
    blob(g, [0.1, 0.09, 0.08], dk, [x * 0.17, 0.52, 0.09]);
    part(g, rbox(0.17, 0.12, 0.3, 0.04), m, [x * 0.16, 0.06, 0.05]);
  }
  tube(g, [[0, 0.92, 0], [0, 1.1, 0.02]], (t) => [0.26 + t * 0.02, 0.18], dk, { sides: 14 });
  tube(g, [[0, 1.08, 0.02], [0, 1.3, 0.04], [0, 1.55, 0.02]], profile2([[0.25, 0.17], [0.3, 0.21], [0.28, 0.19]]), m, { sides: 16 });
  for (let i = 0; i < 3; i++) tube(g, [[-0.22, 1.13 + i * 0.06, 0.16], [0, 1.12 + i * 0.06, 0.2], [0.22, 1.13 + i * 0.06, 0.16]], () => 0.012, dk, { sides: 5 });
  blob(g, [0.11, 0.06, 0.11], gap, [0, 1.58, 0.02]);
  for (const x of [-1, 1]) {
    blob(g, [0.17, 0.12, 0.17], m, [x * 0.33, 1.52, 0]);
    limb(g, [[x * 0.35, 1.46, 0], [x * 0.42, 1.18, 0.04], [x * 0.4, 0.9, 0.14]], [0.075, 0.065, 0.06], m, 0.1, 10);
    blob(g, [0.06, 0.06, 0.06], dk, [x * 0.42, 1.18, 0.04]);
    hand(g, [x * 0.4, 0.88, 0.16], [0, -1, 0.25], [-x, 0, 0], 0.12, dk, { curl: x === 1 ? 0.95 : 0.4, thick: 1.4 });
  }
  // the helmet with the light inside
  blob(g, [0.15, 0.17, 0.16], m, [0, 1.75, 0.03]);
  part(g, new THREE.BoxGeometry(0.2, 0.025, 0.04), gap, [0, 1.77, 0.18]);
  for (const x of [-1, 1]) glowDot(g, [x * 0.045, 1.77, 0.19], 0.018, '#7ad8ff', 2.2);
  spikeRow(g, [[0, 1.9, 0.08], [0, 1.93, -0.04], [0, 1.85, -0.14]], 4, 0.07, dk, { plates: true, lean: 0.3 });
  // a sword in the right hand, pointing down
  const blade = skin('#d8dce0', { metal: 0.85, rough: 0.2 });
  part(g, new THREE.BoxGeometry(0.05, 0.75, 0.012), blade, [0.4, 0.42, 0.24]);
  part(g, new THREE.BoxGeometry(0.2, 0.03, 0.04), dk, [0.4, 0.82, 0.22]);
}

// ---------------------------------------------------------------- oozes and plants
/** Oozes, slimes and puddings: a glossy dome with lobes, bubbles and swallowed debris; the gelatinous cube. */
export function ooze(g: THREE.Group, c: string, cube = false): void {
  const m = skin(c, { opacity: cube ? 0.45 : 0.68, rough: 0.06, glow: 0.12 });
  const bone = skin(IVORY, { rough: 0.5 }), bubble = skin('#ffffff', { opacity: 0.45, rough: 0.05 });
  if (cube) {
    part(g, rbox(1.5, 1.5, 1.5, 0.14), m, [0, 0.75, 0]);
    blob(g, [0.13, 0.15, 0.14], bone, [0.2, 0.65, 0.1]);
    for (const x of [-1, 1]) blob(g, [0.035, 0.04, 0.02], skin('#2a2622'), [0.2 + x * 0.05, 0.67, 0.23]);
    tube(g, [[-0.4, 0.35, -0.2], [-0.1, 0.45, 0.0]], () => 0.025, bone, { sides: 6 });
    tube(g, [[0.35, 1.05, -0.3], [0.5, 0.8, 0.1]], () => 0.02, bone, { sides: 6 });
    part(g, new THREE.BoxGeometry(0.05, 0.6, 0.01), skin('#c8ccd0', { metal: 0.8, rough: 0.25 }), [-0.3, 0.95, 0.25], [0.3, 0.4, 0.9]);
    for (let i = 0; i < 6; i++) part(g, new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14), skin('#d8b25a', { metal: 0.8, rough: 0.3 }), [Math.cos(i * 2.3) * 0.4, 0.1 + i * 0.05, Math.sin(i * 2.3) * 0.4], [0.6 * i, 0, 0.3]);
    for (let i = 0; i < 10; i++) blob(g, [0.03, 0.03, 0.03], bubble, [Math.cos(i * 1.9) * 0.55, 0.2 + (i % 5) * 0.25, Math.sin(i * 2.7) * 0.55]);
    return;
  }
  part(g, new THREE.SphereGeometry(0.72, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), m, [0, 0, 0], [0, 0, 0], [1.15, 0.78, 1.1]);
  for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3, r = 0.2 + (i % 3) * 0.08; blob(g, [r, r * 0.45, r], m, [Math.cos(a) * 0.72, 0.08, Math.sin(a) * 0.66]); }
  for (let i = 0; i < 5; i++) blob(g, [0.1, 0.13, 0.1], m, [Math.cos(i * 2.2) * 0.3, 0.55 + (i % 2) * 0.04, Math.sin(i * 2.2) * 0.25]);
  for (let i = 0; i < 9; i++) blob(g, [0.04, 0.04, 0.04], bubble, [Math.cos(i * 2.1) * 0.4, 0.15 + (i % 3) * 0.12, Math.sin(i * 2.1) * 0.35]);
  blob(g, [0.1, 0.11, 0.1], bone, [0.15, 0.28, -0.05]);
  tube(g, [[-0.35, 0.18, 0.1], [-0.05, 0.22, -0.2]], () => 0.022, bone, { sides: 6 });
}
/** Treants and shambling mounds. */
export function treant(g: THREE.Group, shambling = false): void {
  const bark = skin(shambling ? '#4a5a2a' : '#5a3e26', { rough: 0.95, surface: 'wood' }), barkD = skin(shambling ? '#2a3a1a' : '#3a2818', { rough: 0.95, surface: 'wood' });
  const leaf = skin(shambling ? '#3a5a2a' : '#3a6a32', { rough: 0.9 }), leaf2 = skin(shambling ? '#5a7a32' : '#5a8a3a', { rough: 0.9 });
  if (shambling) {
    blob(g, [0.55, 0.75, 0.5], barkD, [0, 0.85, 0]);
    for (let i = 0; i < 26; i++) { const a = i * 2.39996, h = 0.15 + (i / 26) * 1.5; const r = 0.5 * Math.sin(Math.PI * Math.min(1, h / 1.7 + 0.1)) + 0.15; tube(g, arc([Math.cos(a) * r, h, Math.sin(a) * r * 0.9], [Math.cos(a + 1.4) * r, h + 0.3, Math.sin(a + 1.4) * r * 0.9], [Math.cos(a + 0.7) * 0.15, 0.05, Math.sin(a + 0.7) * 0.15], 4), () => 0.045, i % 3 ? bark : leaf, { sides: 6 }); }
    for (let i = 0; i < 14; i++) { const a = i * 1.9; blob(g, [0.14, 0.06, 0.1], i % 2 ? leaf : leaf2, [Math.cos(a) * 0.5, 0.4 + (i % 7) * 0.2, Math.sin(a) * 0.45], [Math.cos(a), 0.5, Math.sin(a)]); }
    for (const x of [-1, 1]) { tube(g, arc([x * 0.45, 1.35, 0], [x * 0.75, 0.45, 0.35], [x * 0.25, 0, 0], 5), (t) => 0.13 * (1 - t * 0.4), bark, { sides: 8 }); blob(g, [0.16, 0.14, 0.16], leaf, [x * 0.75, 0.42, 0.37]); }
    for (const x of [-1, 1]) glowDot(g, [x * 0.12, 1.55, 0.42], 0.04, '#e8e070', 1.2);
    return;
  }
  // trunk with bark ridges and spreading roots
  tube(g, [[0, 0.02, 0], [0.04, 0.9, 0], [-0.03, 1.8, 0.04], [0, 2.55, 0]], profile2([[0.52, 0.46], [0.36, 0.33], [0.4, 0.35], [0.3, 0.27]]), bark, { sides: 12 });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; tube(g, [[Math.cos(a) * 0.46, 0.1, Math.sin(a) * 0.42], [Math.cos(a) * 0.35, 1.0, Math.sin(a) * 0.32], [Math.cos(a) * 0.38, 1.8, Math.sin(a) * 0.34], [Math.cos(a) * 0.28, 2.5, Math.sin(a) * 0.25]], () => 0.035, barkD, { sides: 5 }); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.25; tube(g, arc([Math.cos(a) * 0.35, 0.35, Math.sin(a) * 0.32], [Math.cos(a) * 0.95, 0.02, Math.sin(a) * 0.9], [0, 0.15, 0], 4), (t) => 0.15 * (1 - t * 0.75), bark, { sides: 8 }); }
  // arms with twig fingers
  for (const x of [-1, 1]) {
    const el: V3 = [x * 0.9, 1.95, 0.15], wr: V3 = [x * 1.05, 1.3, 0.5];
    limb(g, [[x * 0.3, 2.1, 0], el, wr], [0.16, 0.12, 0.09], bark, 0.1, 8);
    for (let k = 0; k < 4; k++) { const a = (k - 1.5) * 0.4; tube(g, arc(wr, add(wr, [x * Math.sin(a) * 0.3 + x * 0.05, -0.38, 0.12 + Math.cos(a) * 0.1]), [x * 0.05, 0.05, 0.05], 3), (t) => 0.04 * (1 - t * 0.8), barkD, { sides: 5 }); }
    for (let k = 0; k < 3; k++) blob(g, [0.16, 0.12, 0.16], k % 2 ? leaf : leaf2, add(el, [x * (0.1 - k * 0.1), 0.15 + k * 0.05, -0.05]));
  }
  // crown
  for (let i = 0; i < 12; i++) { const a = i * 2.39996, r = 0.35 + (i % 3) * 0.18; blob(g, [0.42, 0.34, 0.42], i % 2 ? leaf : leaf2, [Math.cos(a) * r, 2.7 + (i % 4) * 0.17, Math.sin(a) * r * 0.85], undefined, 0.9); }
  // face: brow, deep-set glowing eyes, a nose knot and a dark mouth
  blob(g, [0.32, 0.08, 0.12], barkD, [0, 1.98, 0.36]);
  for (const x of [-1, 1]) { blob(g, [0.08, 0.06, 0.05], skin('#141008'), [x * 0.13, 1.88, 0.38]); glowDot(g, [x * 0.13, 1.88, 0.41], 0.03, '#e8e070', 1.3); }
  blob(g, [0.06, 0.1, 0.07], bark, [0, 1.76, 0.4]);
  blob(g, [0.16, 0.05, 0.05], skin('#141008'), [0, 1.58, 0.37]);
  for (let i = 0; i < 4; i++) blob(g, [0.12, 0.05, 0.08], leaf2, [Math.cos(i * 2.6) * 0.32, 2.2 + i * 0.05, Math.sin(i * 2.6) * 0.28]);
}
/** Myconids and fungal giants: a stalk body with arms and a spotted cap. */
export function mushroom(g: THREE.Group, cap: string, glow = 0): void {
  const stalk = skin('#d8ccb0', { rough: 0.85, surface: 'skin' }), c = skin(cap, glow ? { glow, rough: 0.6 } : { rough: 0.6, surface: 'skin' }), gill = skin(mixHex(cap, '#f2e6d0', 0.6), { rough: 0.9 });
  for (const x of [-1, 1]) { limb(g, [[x * 0.13, 0.35, 0], [x * 0.16, 0.18, 0.03], [x * 0.15, 0.04, 0]], [0.1, 0.085, 0.08], stalk, 0.1, 8); blob(g, [0.09, 0.05, 0.13], stalk, [x * 0.15, 0.04, 0.05]); }
  tube(g, [[0, 0.3, 0], [0, 0.65, 0.01], [0, 1.02, 0]], profile2([[0.26, 0.24], [0.22, 0.2], [0.24, 0.22]]), stalk, { sides: 14 });
  part(g, new THREE.TorusGeometry(0.23, 0.04, 8, 20), stalk, [0, 0.82, 0], [Math.PI / 2, 0, 0]);
  for (const x of [-1, 1]) { limb(g, [[x * 0.2, 0.78, 0], [x * 0.38, 0.55, 0.08], [x * 0.42, 0.36, 0.16]], [0.06, 0.05, 0.045], stalk, 0.1, 8); hand(g, [x * 0.42, 0.34, 0.18], [0, -1, 0.3], [-x, 0, 0], 0.09, stalk, { fingers: 3, curl: 0.4 }); }
  part(g, new THREE.SphereGeometry(0.62, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), c, [0, 1.0, 0], [0, 0, 0], [1, 0.58, 1]);
  part(g, new THREE.CylinderGeometry(0.6, 0.2, 0.06, 28), gill, [0, 0.99, 0]);
  for (let i = 0; i < 9; i++) { const a = i * 2.39996, r = 0.18 + (i % 3) * 0.14; const y = 1.0 + 0.36 * Math.sqrt(Math.max(0, 1 - (r / 0.62) ** 2)); blob(g, [0.07, 0.025, 0.07], skin(glow ? '#ffffff' : '#f2ecdc', glow ? { glow: 0.6 } : {}), [Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a) * r, 0.6, Math.sin(a) * r]); }
  for (const x of [-1, 1]) eye(g, [x * 0.09, 0.86, 0.21], 0.04, glow ? { glow: 1.2, iris: cap } : {});
  blob(g, [0.06, 0.02, 0.02], skin('#3a2a22'), [0, 0.76, 0.23]);
}
/** Carnivorous plant: a curving stalk with spiked jaws, leaves and creepers. */
export function flytrap(g: THREE.Group): void {
  const stem = skin('#3a6a2a', { rough: 0.8 }), jaw = skin('#8a3a3a', { rough: 0.6 }), green = skin('#5c8a3a', { rough: 0.8 }), spikeM = skin('#e8e4c8', { rough: 0.5 });
  tube(g, arc([0, 0, 0], [0, 1.45, 0.3], [0.18, 0.1, -0.1], 6), (t) => 0.13 * (1 - t * 0.4), stem, { sides: 10 });
  const head: V3 = [0, 1.55, 0.45];
  for (const s of [-1, 1]) {
    const lobe = part(g, new THREE.SphereGeometry(0.42, 20, 10, 0, Math.PI, 0, Math.PI), s > 0 ? green : jaw, head, [s * 0.45 - Math.PI / 2, 0, Math.PI / 2], [1, 0.42, 1]);
    void lobe;
    for (let i = 0; i < 8; i++) { const a = (i / 7 - 0.5) * 2.6; claw(g, add(head, [Math.sin(a) * 0.38, s * 0.12, Math.cos(a) * 0.38 * 0.6 + 0.05]), [0, -s, 0.15], 0.15, 0.025, spikeM, 0); }
  }
  blob(g, [0.3, 0.06, 0.25], skin('#b84a4a', { rough: 0.4 }), head);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; tube(g, arc([Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15], [Math.cos(a) * 0.85, 0.05, Math.sin(a) * 0.85], [0, 0.28, 0], 4), (t) => [0.17 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) + 0.02, 0.02], green, { sides: 10, up: [0, 1, 0] }); }
  for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.5; tube(g, arc([Math.cos(a) * 0.1, 0.5, Math.sin(a) * 0.1], [Math.cos(a) * 0.65, 0.05, Math.sin(a) * 0.6], [Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2], 5), (t) => 0.035 * (1 - t * 0.7), stem, { sides: 6 }); }
}

// ---------------------------------------------------------------- animals with a body of their own
/** The mimic: a chest whose lid is a toothed maw, a long tongue and pseudopod legs. */
export function mimic(g: THREE.Group): void {
  const wood = skin('#8a5f36', { rough: 0.85, surface: 'wood' }), woodD = skin('#5a3a20', { rough: 0.9, surface: 'wood' }), gold = skin('#d8b25a', { metal: 0.75, rough: 0.3, surface: 'metal' }), flesh = skin('#8a3a3a', { rough: 0.6, surface: 'skin' });
  part(g, rbox(0.92, 0.52, 0.62, 0.04), wood, [0, 0.32, 0]);
  part(g, new THREE.CylinderGeometry(0.31, 0.31, 0.92, 18, 1, false, 0, Math.PI), wood, [0, 0.72, -0.14], [-0.55, 0, Math.PI / 2]);
  for (const x of [-0.32, 0.32]) { part(g, new THREE.BoxGeometry(0.07, 0.54, 0.64), gold, [x, 0.32, 0]); }
  part(g, new THREE.BoxGeometry(0.14, 0.14, 0.04), gold, [0, 0.5, 0.32]);
  for (let i = 0; i < 5; i++) part(g, new THREE.BoxGeometry(0.9, 0.012, 0.012), woodD, [0, 0.12 + i * 0.1, 0.315]);
  blob(g, [0.4, 0.1, 0.26], skin('#3a0e12'), [0, 0.6, 0.08]);
  teeth(g, [-0.38, 0.58, 0.3], [0.38, 0.58, 0.3], 10, 0.12, skin(IVORY), false);
  teeth(g, [-0.38, 0.78, 0.34], [0.38, 0.78, 0.34], 10, 0.11, skin(IVORY));
  tube(g, arc([0, 0.6, 0.15], [0.12, 0.05, 0.95], [0, 0.32, 0.1], 6), (t) => [0.09 * (1 - t * 0.4), 0.035], skin('#c0392b', { rough: 0.35 }), { sides: 10, up: [0, 1, 0] });
  for (const x of [-1, 1]) for (const z of [-0.2, 0.2]) tube(g, arc([x * 0.4, 0.2, z], [x * 0.7, 0.02, z * 1.8 + 0.1], [x * 0.05, 0.12, 0], 4), (t) => 0.07 * (1 - t * 0.5), flesh, { sides: 8 });
  for (const x of [-1, 1]) eye(g, [x * 0.18, 0.98, 0.12], 0.07, { iris: '#e8e070', pupil: 'slit', look: [x * 0.2, 0.3, 1] });
}
/** Giant frog / toad: a squat body, folded hind legs, bulging eyes and a wide mouth. */
export function frog(g: THREE.Group, c: string): void {
  const b = skin(c, { rough: 0.45, surface: 'skin' }), l = skin(mixHex(c, '#f2e6b0', 0.45), { rough: 0.5, surface: 'skin' });
  tube(g, [[0, 0.28, -0.38], [0, 0.36, -0.1], [0, 0.4, 0.2], [0, 0.38, 0.42]], profile2([[0.25, 0.18], [0.42, 0.3], [0.4, 0.3], [0.3, 0.2]]), b, { sides: 16 });
  blob(g, [0.36, 0.16, 0.42], l, [0, 0.2, 0.05]);
  tube(g, [[-0.32, 0.32, 0.38], [0, 0.29, 0.56], [0.32, 0.32, 0.38]], () => 0.018, skin('#2a1410'), { sides: 6 });
  for (const x of [-1, 1]) {
    blob(g, [0.13, 0.12, 0.13], b, [x * 0.2, 0.55, 0.3]);
    eye(g, [x * 0.21, 0.58, 0.36], 0.1, { iris: '#e8c030', pupil: 'goat', look: [x * 0.5, 0.3, 0.8] });
    // folded hind leg: thigh, shin back, long webbed foot
    blob(g, [0.16, 0.16, 0.24], b, [x * 0.36, 0.25, -0.22]);
    limb(g, [[x * 0.36, 0.25, -0.22], [x * 0.52, 0.24, 0.05], [x * 0.48, 0.07, -0.32], [x * 0.52, 0.03, 0.02]], [0.13, 0.09, 0.06, 0.04], b, 0.25, 9);
    for (let k = -1; k <= 1; k++) tube(g, [[x * 0.52, 0.03, 0.02], [x * (0.56 + k * 0.08), 0.02, 0.22]], (t) => [0.03 + t * 0.03, 0.01], b, { sides: 6 });
    limb(g, [[x * 0.24, 0.3, 0.28], [x * 0.3, 0.13, 0.36], [x * 0.32, 0.03, 0.42]], [0.07, 0.05, 0.04], b, 0.15, 8);
    for (let k = -1; k <= 1; k++) blob(g, [0.025, 0.02, 0.05], b, [x * (0.32 + k * 0.04), 0.02, 0.48]);
  }
  withPattern(g, b, 'spotted', tone(c, 0.55));
}
/** Fish and sharks: a lofted body, fins, a forked tail. Swims a little above the ground. */
export function fish(g: THREE.Group, c: string, shark: boolean): void {
  const b = skin(c, { rough: shark ? 0.5 : 0.3, surface: shark ? 'skin' : 'scales' }), belly = skin(mixHex(c, '#f2ecdc', 0.65), { rough: 0.4 }), fin = skin(tone(c, 0.8), { rough: 0.5, side: true });
  const y = 0.62;
  tube(g, [[0, y, -1.0], [0, y, -0.5], [0, y + 0.02, 0.1], [0, y, 0.6], [0, y - 0.04, 0.9]], profile2(shark ? [[0.05, 0.06], [0.2, 0.25], [0.27, 0.34], [0.22, 0.27], [0.06, 0.08]] : [[0.04, 0.08], [0.14, 0.26], [0.2, 0.36], [0.16, 0.28], [0.05, 0.1]]), b, { sides: 16, steps: 30 });
  tube(g, [[0, y - 0.14, -0.6], [0, y - 0.18, 0.1], [0, y - 0.13, 0.65]], () => [shark ? 0.2 : 0.14, 0.12], belly, { sides: 12 });
  for (const s of [-1, 1]) tube(g, [[0, y, -0.95], [0, y + s * 0.22, -1.2], [0, y + s * (shark ? 0.5 : 0.36), shark && s > 0 ? -1.45 : -1.35]], (t) => [0.03, 0.12 * (1 - t * 0.6) + 0.02], fin, { sides: 8 });
  tube(g, [[0, y + (shark ? 0.3 : 0.32), 0.15], [0, y + (shark ? 0.62 : 0.48), -0.1], [0, y + (shark ? 0.58 : 0.4), -0.25]], (t) => [0.025, 0.2 * (1 - t)], fin, { sides: 8 });
  for (const x of [-1, 1]) tube(g, [[x * 0.18, y - 0.12, 0.35], [x * 0.48, y - 0.3, 0.12]], (t) => [0.14 * (1 - t * 0.6), 0.02], fin, { sides: 8 });
  for (const x of [-1, 1]) eye(g, [x * (shark ? 0.15 : 0.13), y + 0.08, 0.68], shark ? 0.04 : 0.065, shark ? {} : { iris: '#e8c030', look: [x, 0, 0.4] });
  if (shark) {
    for (const x of [-1, 1]) for (let i = 0; i < 3; i++) tube(g, [[x * 0.22, y + 0.08, 0.42 - i * 0.07], [x * 0.24, y - 0.1, 0.4 - i * 0.07]], () => 0.008, skin('#2a3036'), { sides: 4, steps: 2 });
    teeth(g, [-0.12, y - 0.12, 0.8], [0.12, y - 0.12, 0.8], 6, 0.05, skin(IVORY));
  }
}
/** Bat: a furry body, big ears, fangs and leathery wings. */
export function bat(g: THREE.Group, airborne: boolean): THREE.Group[] {
  const fur = skin('#3a2e2a', { rough: 0.9, surface: 'fur' }), face = skin('#5a4440', { rough: 0.8, surface: 'skin' });
  blob(g, [0.2, 0.26, 0.2], fur, [0, 0.9, 0]);
  blob(g, [0.15, 0.14, 0.15], fur, [0, 1.18, 0.06]);
  blob(g, [0.08, 0.07, 0.09], face, [0, 1.14, 0.18]);
  for (const x of [-1, 1]) { ear(g, [x * 0.08, 1.28, 0.04], [x * 0.4, 1, -0.1], 0.13, fur, 'pointed', skin('#c88a8a')); eye(g, [x * 0.06, 1.21, 0.17], 0.025, { glow: 0.8 }); claw(g, [x * 0.03, 1.1, 0.24], [0, -1, 0.2], 0.05, 0.012, skin('#f2ecdc'), 0.2); }
  for (const x of [-1, 1]) tube(g, [[x * 0.07, 0.68, 0], [x * 0.08, 0.55, -0.02]], () => 0.025, face, { sides: 6 });
  const wings = [-1, 1].map((x) => membraneWing([x * 0.15, 1.0, 0], x, 0.8, '#3a2e2a', '#4a3a36', airborne ? 0.7 : 0.08, '#f2ecdc'));
  if (!airborne) for (const w of wings) foldWing(w, 'membrane', 0.8);
  for (const w of wings) g.add(w);
  return wings;
}
/** Butterfly / moth: a slim segmented body with antennae and big see-through wings. */
export function butterfly(g: THREE.Group, c: string): THREE.Group[] {
  const b = skin('#2a2622', { rough: 0.6 });
  tube(g, [[0, 1.1, -0.18], [0, 1.1, 0], [0, 1.12, 0.12]], (t) => 0.03 + Math.sin(t * Math.PI) * 0.02, b, { sides: 8 });
  blob(g, [0.035, 0.035, 0.035], b, [0, 1.13, 0.15]);
  for (const x of [-1, 1]) tube(g, arc([x * 0.015, 1.15, 0.16], [x * 0.1, 1.3, 0.3], [0, 0.03, -0.02], 3), () => 0.005, b, { sides: 4 });
  const wings = [-1, 1].map((x) => insectWing([x * 0.03, 1.12, 0], x, 0.55, c, 0.9));
  for (const w of wings) g.add(w);
  return wings;
}
/** Hydra: a heavy reptile body with five necks. */
export function hydra(g: THREE.Group, c: string, c2: string): void {
  beast(g, { c, belly: c2, nose: tone(c, 0.5), len: 0.95, leg: 0.3, girth: 0.34, legR: 0.1, neck: 0.75, neckUp: 0.9, head: 0.15, snout: 1.0, snoutR: 0.85, headDown: 0.2, heads: 5, feet: 'talon', ears: 'fin', earSize: 0.6, tail: 'thick', tailLen: 1.0, iris: '#e8c030', pupil: 'slit', fangs: true, ridge: tone(c, 0.6) });
}
/** Turtles and tortoises (a scute-patterned shell); the world turtle carries a little landscape. */
export function turtle(g: THREE.Group, o: { c: string; shell: string; world?: boolean }): void {
  const b = skin(o.c, { rough: 0.7, surface: 'scales' }), sh = skin(o.shell, { rough: 0.6, surface: 'chitin' }), rim = skin(tone(o.shell, 0.7), { rough: 0.7, surface: 'chitin' });
  const shell = part(g, new THREE.SphereGeometry(0.6, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), sh, [0, 0.24, 0], [0, 0, 0], [1, 0.66, 1.25]);
  void shell;
  part(g, new THREE.TorusGeometry(0.6, 0.06, 8, 32), rim, [0, 0.25, 0], [Math.PI / 2, 0, 0], [1, 1.25, 1]);
  blob(g, [0.55, 0.08, 0.7], skin(mixHex(o.shell, '#e8d8a8', 0.5)), [0, 0.2, 0]);
  for (const [x, z] of [[-0.42, 0.42], [0.42, 0.42], [-0.42, -0.42], [0.42, -0.42]]) { limb(g, [[x * 0.9, 0.24, z * 0.9], [x * 1.15, 0.14, z * 1.1], [x * 1.18, 0.04, z * 1.12]], [0.11, 0.1, 0.09], b, 0.15, 9); blob(g, [0.11, 0.05, 0.12], b, [x * 1.18, 0.04, z * 1.14]); }
  tube(g, [[0, 0.28, 0.6], [0, 0.36, 0.78], [0, 0.42, 0.9]], () => 0.1, b, { sides: 10 });
  blob(g, [0.13, 0.11, 0.17], b, [0, 0.44, 0.98]);
  for (const x of [-1, 1]) eye(g, [x * 0.08, 0.48, 1.06], 0.03, { look: [x, 0, 0.6] });
  claw(g, [0, 0.24, -0.72], [0, -0.3, -1], 0.15, 0.04, b, 0.2);
  withPattern(g, sh, 'net', tone(o.shell, 1.25));
  if (o.world) {
    for (let i = 0; i < 6; i++) { const a = i * 1.3, r = 0.22 + (i % 2) * 0.12; const p: V3 = [Math.cos(a) * r, 0.62 - r * 0.25, Math.sin(a) * r * 1.2]; tube(g, [p, add(p, [0, 0.22, 0])], () => 0.025, skin('#6a4a2a'), { sides: 6 }); blob(g, [0.1, 0.12, 0.1], skin('#3a6a32'), add(p, [0, 0.3, 0])); }
    part(g, new THREE.ConeGeometry(0.16, 0.32, 6), skin('#8a847a', { flat: true }), [0.05, 0.78, -0.08]);
    part(g, new THREE.CylinderGeometry(0.06, 0.07, 0.22, 8), skin('#c8bca8'), [-0.18, 0.72, 0.15]);
    part(g, new THREE.ConeGeometry(0.08, 0.1, 8), skin('#8a3a2a'), [-0.18, 0.88, 0.15]);
  }
}
/** Giant snail: a soft foot under a spiral shell, eye stalks. */
export function snail(g: THREE.Group, c: string, shell: string): void {
  const b = skin(c, { rough: 0.35, surface: 'skin' }), sh = skin(shell, { rough: 0.5, surface: 'chitin' });
  tube(g, [[0, 0.1, -0.6], [0, 0.14, -0.1], [0, 0.2, 0.4], [0, 0.36, 0.62]], profile2([[0.08, 0.05], [0.28, 0.12], [0.24, 0.15], [0.14, 0.14]]), b, { sides: 12 });
  const pts: V3[] = []; for (let i = 0; i <= 40; i++) { const a = i * 0.32, r = 0.42 * Math.exp(-0.09 * a); pts.push([-i * 0.004, 0.55 + Math.sin(a) * r, -0.12 + Math.cos(a) * r]); }
  tube(g, pts, (t) => 0.24 * (1 - t * 0.85), sh, { sides: 14, steps: 90 });
  withPattern(g, sh, 'striped', tone(shell, 0.7));
  for (const x of [-1, 1]) { tube(g, arc([x * 0.07, 0.42, 0.6], [x * 0.13, 0.72, 0.72], [0, 0, -0.04], 3), (t) => 0.025 * (1 - t * 0.3), b, { sides: 6 }); eye(g, [x * 0.13, 0.74, 0.73], 0.035, { look: [x * 0.4, 0.2, 1] }); }
}
/** A sky whale or sea monster. */
export function whale(g: THREE.Group, c: string, sky: boolean): void {
  const b = skin(c, { rough: 0.55, surface: 'skin' }), belly = skin(mixHex(c, '#e8ecf0', 0.6), { rough: 0.6, surface: 'skin' }), y = sky ? 2.6 : 0.5;
  tube(g, [[0, y + 0.05, -2.0], [0, y + 0.1, -1.0], [0, y + 0.12, 0.2], [0, y, 1.3], [0, y - 0.1, 1.75]], profile2([[0.1, 0.1], [0.55, 0.5], [0.85, 0.72], [0.7, 0.58], [0.3, 0.25]]), b, { sides: 18, steps: 36 });
  tube(g, [[0, y - 0.38, -0.8], [0, y - 0.5, 0.3], [0, y - 0.38, 1.4]], () => [0.55, 0.25], belly, { sides: 14 });
  tail(g, [[0, y + 0.05, -1.95], [0, y + 0.05, -2.15]], 0.18, b, { end: 'fluke' });
  for (const x of [-1, 1]) tube(g, [[x * 0.65, y - 0.25, 0.7], [x * 1.25, y - 0.55, 0.3]], (t) => [0.3 * (1 - t * 0.6), 0.05], b, { sides: 10 });
  for (const x of [-1, 1]) eye(g, [x * 0.6, y - 0.05, 1.2], 0.07, { look: [x, 0, 0.3] });
  tube(g, [[-0.5, y - 0.2, 1.45], [0, y - 0.28, 1.72], [0.5, y - 0.2, 1.45]], () => 0.025, skin(tone(c, 0.45)), { sides: 6 });
  if (sky) for (let i = 0; i < 7; i++) { const z = -1.2 + i * 0.4; tube(g, [[-0.25, y + 0.68, z], [0, y + 0.76, z + 0.1], [0.25, y + 0.68, z]], () => 0.025, skin('#7fd6ff', { glow: 1.6 }), { sides: 5 }); }
}
