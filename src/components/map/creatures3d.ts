/**
 * APEX 2.2 – low-poly creature kit: beasts, monstrosities, dragons, aberrations, oozes, elementals, constructs,
 * plants, fiends and spirits, built from a few parametric archetypes (quadruped, bird, serpent, arthropod, dragon,
 * floater, blob, golem, treant …). Same chunky, flat-shaded style as the figure kit; facing +z, standing on y = 0,
 * sized as a MEDIUM creature (the battle map scales by the stat block's size).
 *
 * Wings are separate pivots (they flap: `userData.flapZ`, `userData.side`, `userData.amp`); everything else is merged
 * per material. `creatureFor(text)` picks a model from a creature's name and type.
 */
import * as THREE from 'three';
import { mergeByMaterial } from './merge3d';

type V3 = [number, number, number];
const cache = new Map<string, THREE.Material>();
function M(color: THREE.ColorRepresentation, o: { glow?: number; metal?: boolean; side?: boolean; opacity?: number; rough?: number } = {}): THREE.Material {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}|${JSON.stringify(o)}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: o.rough ?? (o.metal ? 0.35 : 0.85), metalness: o.metal ? 0.6 : 0, ...(o.glow ? { emissive: c, emissiveIntensity: o.glow } : {}), ...(o.side ? { side: THREE.DoubleSide } : {}), ...(o.opacity ? { transparent: true, opacity: o.opacity, depthWrite: false } : {}) });
    cache.set(key, m);
  }
  return m;
}
const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
function put(p: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], sc: V3 | number = 1): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...pos); o.rotation.set(...rot);
  if (typeof sc === 'number') o.scale.setScalar(sc); else o.scale.set(...sc);
  p.add(o);
  return o;
}
const ico = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cone = (r: number, h: number, s = 5) => new THREE.ConeGeometry(r, h, s);
const cyl = (a: number, b: number, h: number, s = 6) => new THREE.CylinderGeometry(a, b, h, s);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const blob = (p: THREE.Object3D, r: number, m: THREE.Material, pos: V3, sc: V3 = [1, 1, 1], d = 1) => put(p, ico(r, d), m, pos, [0, 0, 0], sc);
/** A tapered limb between two points. */
function limb(p: THREE.Object3D, a: V3, b: V3, r1: number, r2: number, m: THREE.Material, seg = 5): THREE.Mesh {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const o = new THREE.Mesh(cyl(r2, r1, len, seg), m);
  o.position.copy(va).add(vb).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  p.add(o);
  return o;
}
/** A spike / horn / claw from `a` towards `dir`. */
function spike(p: THREE.Object3D, a: V3, dir: V3, len: number, r: number, m: THREE.Material, s = 4) {
  const d = new THREE.Vector3(...dir).normalize();
  const o = new THREE.Mesh(cone(r, len, s), m);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  o.position.set(...a).add(d.multiplyScalar(len / 2));
  p.add(o);
  return o;
}
/** A chain of segments (tails, necks, tentacles): points along a curve with tapering radius. */
function chain(p: THREE.Object3D, pts: V3[], r0: number, r1: number, m: THREE.Material, seg = 5) {
  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
    limb(p, pts[i], pts[i + 1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, m, seg);
    if (i > 0) blob(p, r0 + (r1 - r0) * t0, m, pts[i], [1, 1, 1], 0);
  }
}
const curve = (from: V3, to: V3, bend: V3, n: number): V3[] => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, k = Math.sin(t * Math.PI); return [from[0] + (to[0] - from[0]) * t + bend[0] * k, from[1] + (to[1] - from[1]) * t + bend[1] * k, from[2] + (to[2] - from[2]) * t + bend[2] * k]; });
const eyes = (p: THREE.Object3D, at: V3, dx: number, r: number, color = '#141210', glow = 0) => { for (const s of [-1, 1]) blob(p, r, M(color, glow ? { glow } : {}), [at[0] + s * dx, at[1], at[2]], [1, 1, 1], 0); };

// ---------------------------------------------------------------- wings

/** A wing pivot at `at` for side s (+1 right, −1 left), spanning `span` units outward. */
export function wing(at: V3, s: number, span: number, kind: 'feather' | 'membrane' | 'insect', c1: string, c2: string, amp = 0.55): THREE.Group {
  const pv = new THREE.Group(); pv.position.set(...at);
  pv.userData = { side: s, flapZ: true, amp };
  const g = new THREE.Group(); pv.add(g);
  if (kind === 'feather') {
    const bone = M(c1), tip = M(c2);
    limb(g, [0, 0, 0], [s * span * 0.45, span * 0.12, -span * 0.05], span * 0.06, span * 0.04, bone);
    limb(g, [s * span * 0.45, span * 0.12, -span * 0.05], [s * span * 0.9, span * 0.05, -span * 0.25], span * 0.04, span * 0.025, bone);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6, x = s * span * (0.12 + t * 0.82), len = span * (0.22 + row * 0.13 + t * 0.12);
      put(g, box(span * 0.13, span * 0.025, len), row === 2 ? tip : bone, [x, span * (0.1 - row * 0.015) - t * span * 0.04, -span * 0.05 - len / 2 - row * span * 0.04], [0, s * (0.15 + t * 0.35), 0]);
    }
  } else if (kind === 'membrane') {
    const bone = M(shade(c1, 0.75)), skin = M(c2, { side: true });
    const fingers: V3[] = [[s * span, span * 0.3, -span * 0.1], [s * span * 0.95, span * 0.0, -span * 0.45], [s * span * 0.7, -span * 0.12, -span * 0.75], [s * span * 0.35, -span * 0.1, -span * 0.85]];
    const elbow: V3 = [s * span * 0.45, span * 0.25, 0.0];
    limb(g, [0, 0, 0], elbow, span * 0.05, span * 0.04, bone);
    for (const f of fingers) limb(g, elbow, f, span * 0.03, span * 0.012, bone, 4);
    const pts = [elbow, ...fingers, [0, -span * 0.05, -span * 0.4] as V3, [0, 0, 0] as V3];
    const pos: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) { pos.push(...elbow, ...pts[i], ...pts[i + 1]); }
    // scalloped trailing edge: dip the membrane between the finger tips
    for (let i = 0; i < fingers.length - 1; i++) { const a = fingers[i], b = fingers[i + 1]; const mid: V3 = [(a[0] + b[0]) / 2 * 0.82, (a[1] + b[1]) / 2 - span * 0.05, (a[2] + b[2]) / 2 * 0.82]; pos.push(...a, ...mid, ...b); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, skin));
    spike(g, fingers[0], [s, 0.6, 0.2], span * 0.12, span * 0.03, M('#e8dcc0'));
  } else {
    const m = M(c2, { opacity: 0.55, side: true, glow: 0.25 });
    put(g, new THREE.CircleGeometry(span * 0.5, 8), m, [s * span * 0.5, span * 0.2, -span * 0.1], [Math.PI / 2, 0.4 * s, 0], [1, 0.55, 1]);
    put(g, new THREE.CircleGeometry(span * 0.35, 8), m, [s * span * 0.38, -span * 0.12, -span * 0.25], [Math.PI / 2, -0.3 * s, 0], [1, 0.55, 1]);
  }
  return pv;
}

// ---------------------------------------------------------------- archetypes

interface Quad {
  len: number; h: number; girth: number; leg: number; neck: number; neckUp: number; head: number; snout: number;
  feet?: 'hoof' | 'paw' | 'claw'; ears?: 'point' | 'round' | 'long' | 'big' | 'bunny' | 'none'; horns?: 'goat' | 'bull' | 'antler' | 'unicorn' | 'ram' | 'dragon' | 'rhino' | 'none';
  tail?: 'thin' | 'bushy' | 'long' | 'club' | 'spade' | 'stub' | 'horse' | 'lizard' | 'scorpion' | 'none'; mane?: 'horse' | 'lion' | 'flame' | 'none'; tusks?: boolean; trunk?: boolean; hump?: boolean; spikes?: number;
  low?: boolean; legs?: number; beak?: boolean; fur?: boolean; stripes?: string; saddle?: boolean; barding?: boolean;
  c: string; c2?: string; dark?: string; accent?: string; eye?: string; eyeGlow?: number;
  /** APEX 2.3 */ wool?: boolean; spots?: string; headC?: string; tails?: number; glow?: number; ghost?: boolean;
}
/** Four (or more) legs: wolves, bears, horses, cats, boars, deer, lizards, owlbears, basilisks … */
function quadruped(g: THREE.Group, q: Quad): { headAt: V3; back: V3 } {
  const body = q.ghost ? M(q.c, { opacity: 0.55, glow: 0.5 }) : q.glow ? M(q.c, { glow: q.glow }) : M(q.c), belly = q.ghost ? body : M(q.c2 ?? shade(q.c, 1.15)), dark = M(q.dark ?? shade(q.c, 0.45)), acc = M(q.accent ?? shade(q.c, 0.6));
  const headM = q.headC ? M(q.headC) : body;
  const y = q.h + q.girth * 0.35;
  // chest and hips
  blob(g, q.girth, body, [0, y + q.girth * 0.12, q.len * 0.3], [1, 1.0, 1.05]);
  blob(g, q.girth * 0.9, body, [0, y, -q.len * 0.28], [0.95, 0.92, 1.05]);
  limb(g, [0, y + q.girth * 0.05, q.len * 0.3], [0, y, -q.len * 0.28], q.girth * 0.88, q.girth * 0.82, body, 7);
  blob(g, q.girth * 0.7, belly, [0, y - q.girth * 0.38, 0], [0.9, 0.5, q.len * 1.3]);
  if (q.stripes) for (let i = 0; i < 4; i++) put(g, box(q.girth * 2.02, q.girth * 0.12, q.girth * 0.18), M(q.stripes), [0, y + q.girth * 0.25, -q.len * 0.25 + i * q.len * 0.17], [0.15, 0, 0]);
  if (q.hump) blob(g, q.girth * 0.6, body, [0, y + q.girth * 0.8, q.len * 0.1]);
  if (q.wool) for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; blob(g, q.girth * 0.42, body, [Math.cos(a) * q.girth * 0.55, y + Math.abs(Math.sin(a)) * q.girth * 0.55 + 0.02, -q.len * 0.3 + (i % 6) * q.len * 0.12], [1, 1, 1], 0); }
  if (q.spots) for (let i = 0; i < 6; i++) blob(g, q.girth * 0.3, M(q.spots), [(i % 2 ? 1 : -1) * q.girth * 0.82, y + q.girth * (0.1 + (i % 3) * 0.15), -q.len * 0.25 + i * q.len * 0.1], [0.25, 0.8, 1.1], 0);
  if (q.fur) for (let i = 0; i < 7; i++) spike(g, [0, y + q.girth * 0.8, q.len * 0.3 - i * q.len * 0.1], [0, 0.4, -1], q.girth * 0.5, q.girth * 0.2, body, 3);
  // legs (pairs along the body); low creatures splay them sideways
  const pairs = Math.max(2, Math.round((q.legs ?? 4) / 2));
  for (let i = 0; i < pairs; i++) {
    const z = q.len * 0.32 - (i / (pairs - 1)) * q.len * 0.62;
    for (const s of [-1, 1]) {
      const hip: V3 = [s * q.girth * 0.6, y - q.girth * 0.2, z];
      const knee: V3 = q.low ? [s * (q.girth + q.leg * 0.9), q.h * 0.55, z] : [s * q.girth * 0.62, q.h * 0.5, z + (i === 0 ? 0.04 : -0.06)];
      const foot: V3 = q.low ? [s * (q.girth + q.leg * 1.1), 0.06, z + 0.05] : [s * q.girth * 0.6, 0.08, z + (i === 0 ? 0.0 : -0.02)];
      limb(g, hip, knee, q.leg * 1.25, q.leg, body);
      limb(g, knee, foot, q.leg, q.leg * 0.8, body);
      if (q.feet === 'hoof') put(g, cyl(q.leg * 0.85, q.leg * 1.0, 0.12, 6), dark, [foot[0], 0.06, foot[2]]);
      else { blob(g, q.leg * 1.2, body, [foot[0], 0.07, foot[2] + 0.04], [1, 0.6, 1.3], 0); if (q.feet === 'claw') for (const k of [-1, 0, 1]) spike(g, [foot[0] + k * q.leg * 0.6, 0.06, foot[2] + q.leg * 1.2], [0, -0.3, 1], q.leg * 0.9, q.leg * 0.25, M('#e8dcc0'), 3); }
    }
  }
  if (q.saddle) { put(g, box(q.girth * 1.5, 0.12, q.len * 0.35), M('#5a3a22'), [0, y + q.girth * 0.92, q.len * 0.02]); put(g, box(q.girth * 2.05, 0.04, q.len * 0.3), M('#b3261e'), [0, y + q.girth * 0.5, q.len * 0.02], [0, 0, 0], [1, 1, 1]); }
  if (q.barding) { blob(g, q.girth * 1.05, M('#9aa0a8', { metal: true }), [0, y + q.girth * 0.15, q.len * 0.25], [1, 0.9, 0.8], 0); put(g, box(q.girth * 2.1, q.girth * 0.9, q.len * 0.5), M('#2d4f8f'), [0, y - q.girth * 0.2, -q.len * 0.05]); }
  // neck and head
  const neckBase: V3 = [0, y + q.girth * 0.5, q.len * 0.42];
  const headAt: V3 = [0, neckBase[1] + Math.sin(q.neckUp) * q.neck, neckBase[2] + Math.cos(q.neckUp) * q.neck];
  if (q.neck > 0.05) limb(g, neckBase, headAt, q.girth * 0.6, q.head * 0.7, body, 6);
  blob(g, q.head, headM, headAt, [0.9, 0.85, 1.05]);
  const snoutEnd: V3 = [0, headAt[1] - q.head * 0.18, headAt[2] + q.head * (0.5 + q.snout * 1.5)];
  if (q.beak) { spike(g, [0, headAt[1] - q.head * 0.05, headAt[2] + q.head * 0.7], [0, -0.55, 1], q.head * 0.8, q.head * 0.35, M(q.accent ?? '#3a3632'), 4); for (const s of [-1, 1]) spike(g, [s * q.head * 0.5, headAt[1] + q.head * 0.6, headAt[2]], [s * 0.4, 1, -0.2], q.head * 0.6, q.head * 0.18, body, 3); }
  else if (q.snout > 0) {
    limb(g, [0, headAt[1] - q.head * 0.1, headAt[2] + q.head * 0.4], snoutEnd, q.head * 0.62, q.head * 0.42, headM, 6);
    if (q.horns === 'rhino') { spike(g, [0, snoutEnd[1] + q.head * 0.2, snoutEnd[2] - q.head * 0.15], [0, 1, 0.35], q.head * 1.1, q.head * 0.22, M(q.accent ?? '#d8d0c0'), 5); spike(g, [0, snoutEnd[1] + q.head * 0.35, snoutEnd[2] - q.head * 0.6], [0, 1, 0.2], q.head * 0.5, q.head * 0.14, M(q.accent ?? '#d8d0c0'), 5); }
    blob(g, q.head * 0.25, dark, snoutEnd, [1.2, 0.8, 0.8], 0);
    put(g, box(q.head * 0.7, q.head * 0.12, q.head * q.snout * 0.9), dark, [0, snoutEnd[1] - q.head * 0.28, (headAt[2] + snoutEnd[2]) / 2 + q.head * 0.2]);
  }
  eyes(g, [0, headAt[1] + q.head * 0.3, headAt[2] + q.head * 0.62], q.head * 0.42, q.head * 0.14, q.eye ?? '#141210', q.eyeGlow);
  // ears
  for (const s of [-1, 1]) {
    const ea: V3 = [s * q.head * 0.55, headAt[1] + q.head * 0.65, headAt[2] - q.head * 0.1];
    if (q.ears === 'point') spike(g, ea, [s * 0.3, 1, -0.1], q.head * 0.6, q.head * 0.25, body, 3);
    if (q.ears === 'round') blob(g, q.head * 0.28, body, ea, [1, 1, 0.5], 0);
    if (q.ears === 'long') spike(g, ea, [s * 0.9, 0.5, -0.2], q.head * 0.8, q.head * 0.22, body, 3);
    if (q.ears === 'bunny') put(g, cone(q.head * 0.22, q.head * 1.5, 4), body, [s * q.head * 0.3, headAt[1] + q.head * 1.2, headAt[2] - q.head * 0.25], [-0.2, 0, -s * 0.15], [1, 1, 0.45]);
    if (q.ears === 'big') put(g, ico(q.head * 0.7, 0), body, [s * q.head * 1.1, headAt[1] + q.head * 0.1, headAt[2] - q.head * 0.2], [0, 0, 0], [0.25, 1.1, 1]);
    const hm = M(q.accent ?? '#e8dcc0');
    if (q.horns === 'goat') spike(g, [s * q.head * 0.35, headAt[1] + q.head * 0.7, headAt[2]], [s * 0.2, 0.7, -0.8], q.head * 0.9, q.head * 0.15, hm);
    if (q.horns === 'bull') spike(g, [s * q.head * 0.7, headAt[1] + q.head * 0.5, headAt[2]], [s * 1, 0.5, 0.2], q.head * 0.9, q.head * 0.15, hm);
    if (q.horns === 'ram') put(g, new THREE.TorusGeometry(q.head * 0.4, q.head * 0.14, 4, 8, Math.PI * 1.5), hm, [s * q.head * 0.75, headAt[1] + q.head * 0.3, headAt[2] - q.head * 0.1], [0, s * Math.PI / 2, 0]);
    if (q.horns === 'antler') { const base: V3 = [s * q.head * 0.4, headAt[1] + q.head * 0.8, headAt[2] - q.head * 0.1]; const top: V3 = [base[0] + s * q.head * 1.0, base[1] + q.head * 1.5, base[2] - q.head * 0.4]; limb(g, base, top, q.head * 0.08, q.head * 0.05, hm, 4); for (let k = 1; k <= 3; k++) { const t = k / 4; spike(g, [base[0] + (top[0] - base[0]) * t, base[1] + (top[1] - base[1]) * t, base[2] + (top[2] - base[2]) * t], [s * 0.2, 1, 0.5], q.head * 0.5, q.head * 0.05, hm, 3); } }
    if (q.horns === 'dragon') spike(g, [s * q.head * 0.4, headAt[1] + q.head * 0.55, headAt[2] - q.head * 0.3], [s * 0.3, 0.45, -1], q.head * 1.2, q.head * 0.17, hm);
    if (q.tusks) spike(g, [s * q.head * 0.35, snoutEnd[1] - q.head * 0.15, snoutEnd[2] - q.head * 0.2], [s * 0.3, 0.6, 1], q.head * 0.55, q.head * 0.1, M('#f2ecdc'), 4);
  }
  if (q.horns === 'unicorn') spike(g, [0, headAt[1] + q.head * 0.7, headAt[2] + q.head * 0.4], [0, 1, 0.8], q.head * 1.3, q.head * 0.12, M(q.accent ?? '#e8d4a6', { glow: 0.3 }), 6);
  if (q.trunk) chain(g, curve([0, headAt[1] - q.head * 0.2, headAt[2] + q.head * 0.8], [0, 0.25, headAt[2] + q.head * 1.2], [0, 0, q.head * 0.4], 4), q.head * 0.3, q.head * 0.14, body, 6);
  // mane
  if (q.mane === 'horse') for (let i = 0; i < 6; i++) { const t = i / 5; spike(g, [0, neckBase[1] + (headAt[1] - neckBase[1]) * t + q.girth * 0.35, neckBase[2] + (headAt[2] - neckBase[2]) * t - q.girth * 0.15], [0, 0.4, -1], q.girth * 0.7, q.girth * 0.18, acc, 3); }
  if (q.mane === 'lion') blob(g, q.head * 1.35, acc, [0, headAt[1] - q.head * 0.05, headAt[2] - q.head * 0.45], [1.1, 1.1, 0.6], 0);
  if (q.mane === 'flame') { const fl = M('#ff8a2a', { glow: 1.1 }), core = M('#ffd36b', { glow: 1.3 }); for (let i = 0; i < 7; i++) { const t = i / 6; const at: V3 = [0, neckBase[1] + (headAt[1] - neckBase[1]) * t + q.girth * 0.3, neckBase[2] + (headAt[2] - neckBase[2]) * t - q.girth * 0.2]; spike(g, at, [0, 1, -0.6], q.girth * (0.9 - t * 0.3), q.girth * 0.2, i % 2 ? core : fl, 4); } for (let i = 0; i < 3; i++) spike(g, [0, y + q.girth * 0.3, -q.len * 0.45], [0, 0.7, -1], q.girth * (1 - i * 0.2), q.girth * 0.2, fl, 4); }
  if (q.spikes) for (let i = 0; i < q.spikes; i++) spike(g, [0, y + q.girth * 0.85, q.len * 0.32 - i * (q.len * 0.7 / q.spikes)], [0, 1, -0.4], q.girth * 0.55, q.girth * 0.18, acc, 4);
  // tail
  const tb: V3 = [0, y + q.girth * 0.1, -q.len * 0.38];
  const tm = q.tail === 'horse' ? acc : body;
  if (q.tail === 'thin') chain(g, curve(tb, [0, y - q.girth * 0.6, -q.len * 0.8], [0, 0.15, 0], 3), q.girth * 0.18, q.girth * 0.06, tm);
  if (q.tail === 'bushy' && !(q.tails && q.tails > 1)) blob(g, q.girth * 0.45, tm, [0, y - q.girth * 0.1, -q.len * 0.62], [0.8, 0.8, 1.6], 0);
  if (q.tails && q.tails > 1) for (let i = 0; i < q.tails; i++) { const a = (i / (q.tails - 1) - 0.5) * 1.8; const tip: V3 = [Math.sin(a) * q.len * 0.45, y + q.girth * 1.6, -q.len * 0.55 - Math.cos(a) * q.len * 0.15]; chain(g, curve(tb, tip, [Math.sin(a) * 0.1, 0.1, -0.15], 3), q.girth * 0.28, q.girth * 0.12, q.glow ? M(q.accent ?? '#ffd36b', { glow: 1 }) : tm, 5); blob(g, q.girth * 0.3, M(q.accent ?? '#f2ecdc', q.glow ? { glow: 1.2 } : {}), tip, [1, 1, 1], 0); }
  if (q.tail === 'horse') spike(g, tb, [0, -1, -0.4], q.h * 0.9, q.girth * 0.3, tm, 4);
  if (q.tail === 'stub') blob(g, q.girth * 0.25, tm, tb, [1, 1, 1], 0);
  if (q.tail === 'long' || q.tail === 'lizard' || q.tail === 'spade' || q.tail === 'club' || q.tail === 'scorpion') {
    const end: V3 = q.tail === 'scorpion' ? [0, y + q.girth * 2.4, -q.len * 0.35] : [0, 0.12, -q.len * (q.tail === 'lizard' ? 1.25 : 1.15)];
    const pts = curve(tb, end, q.tail === 'scorpion' ? [0, 0.4, -q.len * 0.7] : [q.girth * 0.3, 0.1, 0], 6);
    chain(g, pts, q.girth * 0.55, q.girth * 0.1, body, 6);
    const last = pts[pts.length - 1];
    if (q.tail === 'spade') put(g, cone(q.girth * 0.35, q.girth * 0.7, 3), acc, [last[0], last[1], last[2] - q.girth * 0.2], [-Math.PI / 2, 0, 0], [1, 1, 0.3]);
    if (q.tail === 'club') { blob(g, q.girth * 0.4, acc, last, [1, 1, 1], 0); for (let k = 0; k < 4; k++) spike(g, last, [Math.cos(k * 1.57), Math.sin(k * 1.57), -0.3], q.girth * 0.45, q.girth * 0.1, M('#e8dcc0')); }
    if (q.tail === 'scorpion') spike(g, last, [0, -0.3, 1], q.girth * 0.7, q.girth * 0.16, acc, 4);
  }
  return { headAt, back: [0, y + q.girth * 0.95, q.len * 0.02] };
}

/** Birds and bird-headed things: eagles, owls, ravens, vultures, rocs. */
function bird(g: THREE.Group, o: { c: string; c2: string; beak: string; size: number; owl?: boolean; crest?: boolean; neckBare?: boolean }): THREE.Group[] {
  const s = o.size, body = M(o.c), light = M(o.c2), beak = M(o.beak);
  const y = 0.55 * s;
  blob(g, 0.36 * s, body, [0, y, 0], [0.9, 1.0, 1.25]);
  blob(g, 0.26 * s, light, [0, y - 0.04 * s, 0.14 * s], [0.75, 0.9, 0.7]);
  const head: V3 = [0, y + 0.38 * s, 0.24 * s];
  if (o.neckBare) limb(g, [0, y + 0.15 * s, 0.2 * s], head, 0.09 * s, 0.07 * s, M('#c88a7a'));
  blob(g, (o.owl ? 0.27 : 0.2) * s, o.neckBare ? M('#c88a7a') : body, head, o.owl ? [1.1, 1, 0.95] : [1, 1, 1.1]);
  if (o.owl) { for (const x of [-1, 1]) { put(g, new THREE.CircleGeometry(0.11 * s, 8), light, [x * 0.1 * s, head[1], head[2] + 0.24 * s]); blob(g, 0.06 * s, M('#e8b030', { glow: 0.3 }), [x * 0.1 * s, head[1], head[2] + 0.26 * s], [1, 1, 0.5], 0); spike(g, [x * 0.18 * s, head[1] + 0.2 * s, head[2]], [x * 0.3, 1, 0], 0.16 * s, 0.05 * s, body, 3); } }
  else eyes(g, [0, head[1] + 0.05 * s, head[2] + 0.12 * s], 0.12 * s, 0.035 * s, '#e8b030', 0.3);
  spike(g, [0, head[1] - 0.02 * s, head[2] + 0.16 * s], [0, -0.5, 1], 0.2 * s, 0.07 * s, beak, 4);
  if (o.crest) for (let i = 0; i < 3; i++) spike(g, [0, head[1] + 0.15 * s, head[2] - 0.05 * s - i * 0.05 * s], [0, 0.6, -1], 0.22 * s, 0.04 * s, body, 3);
  for (let i = 0; i < 5; i++) put(g, box(0.07 * s, 0.02 * s, 0.4 * s), i % 2 ? body : light, [(i - 2) * 0.06 * s, y - 0.05 * s, -0.5 * s], [0.25, (i - 2) * 0.18, 0]);
  for (const x of [-1, 1]) { limb(g, [x * 0.1 * s, y - 0.25 * s, 0], [x * 0.1 * s, 0.05 * s, 0.03 * s], 0.035 * s, 0.03 * s, beak); for (const k of [-1, 0, 1]) spike(g, [x * 0.1 * s, 0.03 * s, 0.03 * s], [k * 0.5, -0.2, 1], 0.12 * s, 0.02 * s, beak, 3); }
  return [wing([0.25 * s, y + 0.15 * s, 0.05 * s], 1, 0.9 * s, 'feather', o.c, o.c2), wing([-0.25 * s, y + 0.15 * s, 0.05 * s], -1, 0.9 * s, 'feather', o.c, o.c2)];
}

/** Snakes, worms, nagas: a sinuous body with a raised head. */
function serpent(g: THREE.Group, o: { c: string; c2: string; r: number; len: number; rise: number; worm?: boolean; hood?: boolean; heads?: number }) {
  const body = M(o.c), belly = M(o.c2);
  const n = 10, pts: V3[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([Math.sin(t * Math.PI * 2.2) * o.r * 2.2 * (1 - t * 0.3), o.r * 0.8, -t * o.len + o.len * 0.3]); }
  chain(g, pts.slice().reverse(), o.r * 0.25, o.r, body, 7);
  const head: V3 = [0, o.rise, o.len * 0.45];
  chain(g, curve(pts[0], head, [0, o.rise * 0.2, 0], 4), o.r, o.r * 0.85, body, 7);
  for (let i = 1; i < pts.length; i += 2) put(g, cyl(o.r * 0.95, o.r * 0.95, o.r * 0.25, 7), belly, pts[i], [Math.PI / 2, 0, 0]);
  if (o.worm) {
    put(g, cyl(o.r * 1.3, o.r * 1.0, o.r * 0.8, 9), body, head);
    put(g, cyl(o.r * 1.1, o.r * 0.6, o.r * 0.3, 9), M('#3a1010'), [head[0], head[1] + o.r * 0.38, head[2]]);
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; spike(g, [head[0] + Math.cos(a) * o.r * 1.05, head[1] + o.r * 0.4, head[2] + Math.sin(a) * o.r * 1.05], [-Math.cos(a), 0.5, -Math.sin(a)], o.r * 0.6, o.r * 0.12, M('#f2ecdc'), 3); }
    return;
  }
  blob(g, o.r * 1.15, body, [head[0], head[1], head[2] + o.r * 0.4], [1, 0.75, 1.5]);
  eyes(g, [0, head[1] + o.r * 0.4, head[2] + o.r * 1.0], o.r * 0.55, o.r * 0.18, '#e8c030', 0.4);
  spike(g, [0, head[1] - o.r * 0.2, head[2] + o.r * 1.9], [0, 0, 1], o.r * 0.9, o.r * 0.06, M('#b3261e'), 3);
  for (const s of [-1, 1]) spike(g, [s * o.r * 0.3, head[1] - o.r * 0.2, head[2] + o.r * 1.5], [0, -1, 0.2], o.r * 0.4, o.r * 0.08, M('#f2ecdc'), 3);
  if (o.hood) for (const s of [-1, 1]) put(g, ico(o.r * 1.2, 0), body, [s * o.r * 1.0, head[1] - o.r * 0.9, head[2] - o.r * 0.6], [0, 0, 0], [0.8, 1.4, 0.25]);
}

/** Spiders, scorpions, beetles, crabs, centipedes. */
function arthropod(g: THREE.Group, o: { c: string; c2: string; kind: 'spider' | 'scorpion' | 'beetle' | 'crab' | 'centipede'; eye?: string }) {
  const body = M(o.c), dark = M(o.c2), y = 0.5;
  const legPair = (z: number, spread: number, r: number, i: number) => { for (const s of [-1, 1]) { const knee: V3 = [s * spread * 0.8, y + 0.35, z + (i - 1.5) * 0.05]; const foot: V3 = [s * spread * 1.5, 0.02, z + (i - 1.5) * 0.15]; limb(g, [s * 0.15, y, z], knee, r, r * 0.8, dark, 4); limb(g, knee, foot, r * 0.8, r * 0.3, dark, 4); } };
  if (o.kind === 'centipede') {
    for (let i = 0; i < 9; i++) { const z = 0.6 - i * 0.18, x = Math.sin(i * 0.9) * 0.12; blob(g, 0.15 - i * 0.004, i % 2 ? body : dark, [x, 0.22, z], [1.4, 0.7, 1]); for (const s of [-1, 1]) limb(g, [x + s * 0.15, 0.2, z], [x + s * 0.45, 0.02, z + 0.05], 0.025, 0.012, dark, 3); }
    blob(g, 0.16, dark, [0, 0.25, 0.78], [1.2, 0.8, 1]); for (const s of [-1, 1]) spike(g, [s * 0.1, 0.2, 0.9], [s * 0.4, 0, 1], 0.2, 0.03, M('#b3261e'), 3);
    eyes(g, [0, 0.33, 0.85], 0.07, 0.03, o.eye ?? '#b3261e', 0.5);
    return;
  }
  if (o.kind === 'spider') {
    blob(g, 0.42, body, [0, y + 0.05, -0.4], [1, 0.85, 1.15]);
    if (o.c2) put(g, box(0.15, 0.02, 0.4), M('#b3261e'), [0, y + 0.42, -0.4], [0.2, 0, 0]);
    blob(g, 0.24, dark, [0, y, 0.12], [1, 0.8, 1]);
    for (let i = 0; i < 4; i++) legPair(0.25 - i * 0.12, 0.45 + (i === 1 || i === 2 ? 0.08 : 0), 0.04, i);
    for (let i = 0; i < 4; i++) blob(g, 0.035, M(o.eye ?? '#b3261e', { glow: 0.6 }), [(i - 1.5) * 0.06, y + 0.12, 0.33], [1, 1, 1], 0);
    for (const s of [-1, 1]) spike(g, [s * 0.06, y - 0.08, 0.32], [0, -1, 0.3], 0.16, 0.03, M('#2a2622'), 3);
    return;
  }
  if (o.kind === 'scorpion' || o.kind === 'crab') {
    const crab = o.kind === 'crab';
    blob(g, 0.38, body, [0, y - 0.05, 0], crab ? [1.5, 0.6, 1.1] : [1, 0.6, 1.6]);
    for (let i = 0; i < 4; i++) legPair(0.15 - i * 0.14, crab ? 0.6 : 0.45, 0.035, i);
    for (const s of [-1, 1]) { const elbow: V3 = [s * 0.4, y + 0.05, 0.45]; const claw: V3 = [s * 0.32, y, 0.85]; limb(g, [s * 0.25, y, 0.3], elbow, 0.06, 0.05, body); limb(g, elbow, claw, 0.05, 0.08, body); blob(g, 0.14, body, claw, [0.9, 0.6, 1.3], 0); spike(g, [claw[0] + s * 0.05, claw[1], claw[2] + 0.1], [s * 0.2, 0, 1], 0.2, 0.04, dark, 3); spike(g, [claw[0] - s * 0.05, claw[1], claw[2] + 0.1], [-s * 0.2, 0, 1], 0.18, 0.04, dark, 3); }
    eyes(g, [0, y + 0.18, 0.35], 0.08, 0.04, o.eye ?? '#141210');
    if (!crab) { const pts = curve([0, y, -0.5], [0, y + 1.0, -0.1], [0, 0.3, -0.7], 6); chain(g, pts, 0.11, 0.06, body, 5); spike(g, pts[pts.length - 1], [0, -0.4, 1], 0.25, 0.06, dark, 4); }
    return;
  }
  // beetle
  blob(g, 0.45, body, [0, y, -0.1], [1, 0.65, 1.3]);
  put(g, box(0.02, 0.3, 1.0), dark, [0, y + 0.28, -0.1]);
  blob(g, 0.22, dark, [0, y - 0.05, 0.5], [1, 0.8, 0.9]);
  spike(g, [0, y + 0.05, 0.65], [0, 0.6, 1], 0.4, 0.07, dark, 4);
  for (let i = 0; i < 3; i++) legPair(0.25 - i * 0.25, 0.45, 0.04, i);
  eyes(g, [0, y + 0.05, 0.66], 0.1, 0.035, o.eye ?? '#e8c030', 0.3);
}

/** Dragons, wyverns, drakes. */
function dragon(g: THREE.Group, o: { c: string; c2: string; horn: string; kind: 'dragon' | 'wyvern' | 'drake'; eye?: string }): THREE.Group[] {
  const q: Quad = { len: 1.5, h: 0.42, girth: 0.32, leg: 0.08, neck: 0.75, neckUp: 0.75, head: 0.24, snout: 0.75, feet: 'claw', ears: 'none', horns: 'dragon', tail: o.kind === 'wyvern' ? 'scorpion' : 'spade', spikes: 9, c: o.c, c2: o.c2, accent: o.horn, eye: o.eye ?? '#ffcf3a', eyeGlow: 0.8, legs: o.kind === 'wyvern' ? 2 : 4 };
  if (o.kind === 'wyvern') { q.tail = 'long'; }
  const r = quadruped(g, q);
  // jaw with teeth and a frill
  const h = r.headAt;
  put(g, box(q.head * 0.8, q.head * 0.18, q.head * 1.4), M(shade(o.c, 0.7)), [0, h[1] - q.head * 0.5, h[2] + q.head * 0.7], [0.12, 0, 0]);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) spike(g, [s * q.head * 0.3, h[1] - q.head * 0.36, h[2] + q.head * (0.5 + i * 0.25)], [0, -1, 0], q.head * 0.18, q.head * 0.04, M('#f2ecdc'), 3);
  for (const s of [-1, 1]) put(g, cone(q.head * 0.6, q.head * 0.9, 3), M(o.horn), [s * q.head * 0.75, h[1], h[2] - q.head * 0.3], [0, 0, -s * Math.PI / 2], [1, 1, 0.2]);
  if (o.kind === 'drake') return [];
  const span = o.kind === 'wyvern' ? 1.5 : 1.35;
  return [wing([0.25, r.back[1] - 0.05, 0.2], 1, span, 'membrane', o.c, o.c2), wing([-0.25, r.back[1] - 0.05, 0.2], -1, span, 'membrane', o.c, o.c2)];
}

/** Beholders and other floating eye tyrants. */
function beholder(g: THREE.Group, c: string, eye = '#7ad84a') {
  const y = 1.25, body = M(c);
  blob(g, 0.62, body, [0, y, 0], [1, 0.95, 1], 1);
  put(g, ico(0.3, 1), M('#f2ecdc'), [0, y + 0.08, 0.42], [0, 0, 0], [1, 1, 0.6]);
  blob(g, 0.15, M(eye, { glow: 0.6 }), [0, y + 0.08, 0.58], [1, 1, 0.5], 0);
  blob(g, 0.07, M('#141210'), [0, y + 0.08, 0.65], [0.6, 1.4, 0.4], 0);
  put(g, box(0.62, 0.18, 0.2), M('#3a1010'), [0, y - 0.3, 0.5], [0.2, 0, 0]);
  for (let i = 0; i < 7; i++) spike(g, [-0.27 + i * 0.09, y - 0.22, 0.6], [0, -1, 0.2], 0.13, 0.03, M('#f2ecdc'), 3);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, base: V3 = [Math.cos(a) * 0.32, y + 0.5, Math.sin(a) * 0.32 - 0.05];
    const tip: V3 = [Math.cos(a) * 0.75, y + 1.0 + (i % 3) * 0.12, Math.sin(a) * 0.65 - 0.1];
    chain(g, curve(base, tip, [Math.cos(a) * 0.1, 0.25, 0], 3), 0.05, 0.03, body, 4);
    blob(g, 0.08, M('#f2ecdc'), tip, [1, 1, 1], 0); blob(g, 0.04, M(eye, { glow: 0.6 }), [tip[0] + Math.cos(a) * 0.04, tip[1] + 0.02, tip[2] + Math.sin(a) * 0.04 + 0.03], [1, 1, 1], 0);
  }
  for (let i = 0; i < 12; i++) blob(g, 0.05, M(shade(c, 0.7)), [Math.cos(i) * 0.5, y + Math.sin(i * 1.7) * 0.4, -0.35], [1, 1, 0.6], 0);
}

/** Ghosts, wraiths, specters: a trailing translucent shroud. */
function ghost(g: THREE.Group, c: string, glow = 0.4) {
  const m = M(c, { opacity: 0.6, glow }), dark = M('#0a0c12', { opacity: 0.8 });
  put(g, cone(0.45, 1.5, 7), m, [0, 1.05, 0], [Math.PI, 0, 0.05]);
  blob(g, 0.3, m, [0, 1.9, 0.05], [1, 1.1, 1]);
  put(g, new THREE.SphereGeometry(0.34, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.6), dark, [0, 1.92, 0.02], [0.2, 0, 0]);
  eyes(g, [0, 1.92, 0.27], 0.1, 0.05, '#bfe8ff', 1.2);
  for (const s of [-1, 1]) chain(g, curve([s * 0.3, 1.6, 0], [s * 0.55, 1.15, 0.5], [s * 0.15, 0.1, 0], 3), 0.1, 0.04, m, 5);
  for (let i = 0; i < 5; i++) spike(g, [Math.cos(i * 1.3) * 0.25, 0.45, Math.sin(i * 1.3) * 0.25], [Math.cos(i * 1.3) * 0.3, -1, Math.sin(i * 1.3) * 0.3], 0.35, 0.08, m, 3);
}

/** Elementals: fire, water, air, earth. */
function elemental(g: THREE.Group, kind: 'fire' | 'water' | 'air' | 'earth') {
  if (kind === 'earth') { golem(g, '#7a6a52', '#ffb347', true); return; }
  const m = kind === 'fire' ? [M('#ff5a1a', { glow: 1.2, opacity: 0.85 }), M('#ffcf3a', { glow: 1.4, opacity: 0.9 })] : kind === 'water' ? [M('#3a8ac8', { opacity: 0.7, rough: 0.15, glow: 0.15 }), M('#a8e0ff', { opacity: 0.6, glow: 0.2 })] : [M('#d8e8f0', { opacity: 0.35 }), M('#ffffff', { opacity: 0.25 })];
  if (kind === 'air') { for (let i = 0; i < 7; i++) put(g, new THREE.TorusGeometry(0.15 + i * 0.09, 0.05, 4, 12), m[i % 2], [Math.sin(i) * 0.05, 0.25 + i * 0.28, 0], [Math.PI / 2 + (i % 2 ? 0.2 : -0.2), 0, 0]); blob(g, 0.25, m[0], [0, 2.1, 0], [1, 1, 1]); eyes(g, [0, 2.15, 0.2], 0.1, 0.05, '#e8f8ff', 1.5); return; }
  for (let i = 0; i < 8; i++) { const k = i / 7; blob(g, 0.45 - k * 0.2, m[i % 2], [Math.sin(i * 1.7) * 0.08, 0.3 + k * 1.6, Math.cos(i * 1.3) * 0.05], kind === 'fire' ? [1, 1.4, 1] : [1.1, 0.9, 1.1]); }
  if (kind === 'fire') for (let i = 0; i < 6; i++) spike(g, [Math.cos(i) * 0.25, 1.6, Math.sin(i) * 0.25], [Math.cos(i) * 0.3, 1, Math.sin(i) * 0.3], 0.6, 0.12, m[1], 4);
  for (const s of [-1, 1]) chain(g, curve([s * 0.3, 1.4, 0], [s * 0.85, 1.0, 0.35], [s * 0.1, 0.3, 0], 3), 0.16, 0.1, m[0], 5);
  eyes(g, [0, 1.75, 0.28], 0.11, 0.06, kind === 'fire' ? '#fff8d0' : '#e8f8ff', 1.5);
}

/** Golems, animated statues, gargoyles, earth elementals: blocky stone humanoids. */
function golem(g: THREE.Group, c: string, eye = '#7ad8ff', rough = false, wings = false): THREE.Group[] {
  const s = M(c), d = M(shade(c, 0.7));
  const part = (w: number, h: number, dd: number, pos: V3, m = s) => rough ? put(g, new THREE.DodecahedronGeometry(Math.max(w, h, dd) * 0.6, 0), m, pos, [0.3, 0.5, 0.2], [w / Math.max(w, h, dd), h / Math.max(w, h, dd), dd / Math.max(w, h, dd)]) : put(g, box(w, h, dd), m, pos);
  for (const x of [-0.22, 0.22]) { part(0.26, 0.55, 0.3, [x, 0.3, 0], d); part(0.3, 0.12, 0.38, [x, 0.06, 0.05], d); }
  part(0.85, 0.75, 0.5, [0, 1.0, 0]);
  part(0.55, 0.2, 0.4, [0, 0.6, 0], d);
  part(0.38, 0.34, 0.36, [0, 1.58, 0.05]);
  eyes(g, [0, 1.6, 0.24], 0.09, 0.05, eye, 1.2);
  for (const x of [-1, 1]) { part(0.3, 0.3, 0.3, [x * 0.58, 1.3, 0], d); part(0.24, 0.6, 0.26, [x * 0.62, 0.92, 0.05]); part(0.3, 0.28, 0.32, [x * 0.64, 0.5, 0.1], d); }
  if (!wings) return [];
  for (const x of [-1, 1]) spike(g, [x * 0.12, 1.75, 0], [x * 0.3, 1, -0.3], 0.3, 0.06, d);
  return [wing([0.25, 1.3, -0.2], 1, 1.0, 'membrane', c, shade(c, 0.85), 0.3), wing([-0.25, 1.3, -0.2], -1, 1.0, 'membrane', c, shade(c, 0.85), 0.3)];
}

/** Oozes, slimes, jellies and the gelatinous cube. */
function ooze(g: THREE.Group, c: string, cube = false) {
  const m = M(c, { opacity: 0.6, rough: 0.1, glow: 0.15 });
  if (cube) { put(g, box(1.5, 1.5, 1.5), m, [0, 0.75, 0]); put(g, ico(0.15, 0), M('#e8dcc0'), [0.2, 0.6, 0.1]); put(g, cyl(0.03, 0.03, 0.5, 4), M('#e8dcc0'), [-0.3, 0.4, -0.2], [0.5, 0, 1.2]); put(g, box(0.3, 0.2, 0.2), M('#6a4a2a'), [0.3, 0.2, -0.4]); put(g, cyl(0.1, 0.1, 0.03, 8), M('#d8b25a', { metal: true }), [-0.2, 1.0, 0.3], [0.5, 0, 0]); return; }
  put(g, new THREE.SphereGeometry(0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, [0, 0, 0], [0, 0, 0], [1.2, 0.85, 1.1]);
  for (let i = 0; i < 5; i++) blob(g, 0.25 + (i % 2) * 0.1, m, [Math.cos(i * 1.4) * 0.55, 0.12, Math.sin(i * 1.4) * 0.5], [1, 0.5, 1], 0);
  for (let i = 0; i < 6; i++) blob(g, 0.05, M('#ffffff', { opacity: 0.5 }), [Math.cos(i * 2.1) * 0.35, 0.25 + (i % 3) * 0.1, Math.sin(i * 2.1) * 0.3], [1, 1, 1], 0);
  eyes(g, [0, 0.42, 0.55], 0.15, 0.05, '#141210');
}

/** Treants and shambling plants. */
function treant(g: THREE.Group, shambling = false) {
  const bark = M(shambling ? '#4a5a2a' : '#6a4a2a'), leaf = M(shambling ? '#3a5a2a' : '#3a6a32');
  if (shambling) { for (let i = 0; i < 9; i++) blob(g, 0.35, i % 2 ? leaf : bark, [Math.cos(i) * 0.25, 0.3 + i * 0.17, Math.sin(i * 1.3) * 0.2], [1.1, 0.8, 1]); for (const x of [-1, 1]) chain(g, curve([x * 0.35, 1.3, 0], [x * 0.6, 0.4, 0.3], [x * 0.2, 0, 0], 3), 0.12, 0.07, leaf); eyes(g, [0, 1.6, 0.3], 0.12, 0.05, '#e8e070', 0.8); return; }
  put(g, cyl(0.38, 0.5, 2.4, 8), bark, [0, 1.3, 0]);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; limb(g, [Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3], [Math.cos(a) * 0.8, 0.02, Math.sin(a) * 0.8], 0.14, 0.05, bark, 5); }
  for (const x of [-1, 1]) { const el: V3 = [x * 0.85, 1.9, 0.2]; limb(g, [x * 0.3, 2.0, 0], el, 0.13, 0.1, bark); limb(g, el, [x * 1.05, 1.2, 0.5], 0.1, 0.05, bark); for (let k = 0; k < 3; k++) spike(g, [x * 1.05, 1.2, 0.5], [x * (k - 1) * 0.3, -1, 0.3], 0.3, 0.04, bark, 3); }
  for (let i = 0; i < 6; i++) blob(g, 0.55, leaf, [Math.cos(i) * 0.5, 2.8 + (i % 2) * 0.3, Math.sin(i) * 0.45]);
  put(g, box(0.18, 0.08, 0.05), M('#141210'), [-0.13, 1.85, 0.43]); put(g, box(0.18, 0.08, 0.05), M('#141210'), [0.13, 1.85, 0.43]);
  put(g, box(0.3, 0.1, 0.05), M('#141210'), [0, 1.55, 0.45]);
  eyes(g, [0, 1.85, 0.47], 0.13, 0.03, '#e8e070', 1);
}

/** Tentacled horrors: aboleths, otyughs, krakens, gibbering mouthers. */
function tentacled(g: THREE.Group, kind: 'aboleth' | 'otyugh' | 'octopus' | 'mouther', c: string) {
  const body = M(c), dark = M(shade(c, 0.6));
  const tent = (base: V3, tip: V3, bend: V3, r = 0.09) => chain(g, curve(base, tip, bend, 5), r, r * 0.3, body, 5);
  if (kind === 'mouther') {
    for (let i = 0; i < 9; i++) blob(g, 0.32, i % 3 ? body : dark, [Math.cos(i * 2.1) * 0.4, 0.3 + (i % 3) * 0.2, Math.sin(i * 1.7) * 0.35], [1, 0.8, 1]);
    for (let i = 0; i < 8; i++) { const p: V3 = [Math.cos(i * 1.9) * 0.5, 0.3 + (i % 4) * 0.15, Math.sin(i * 1.9) * 0.5 + 0.1]; blob(g, 0.07, M('#f2ecdc'), p, [1, 1, 1], 0); blob(g, 0.035, M('#141210'), [p[0], p[1], p[2] + 0.05], [1, 1, 1], 0); }
    for (let i = 0; i < 4; i++) { const p: V3 = [Math.cos(i * 1.6 + 0.5) * 0.45, 0.25 + i * 0.12, 0.42]; put(g, box(0.16, 0.08, 0.05), M('#3a1010'), p); }
    return;
  }
  if (kind === 'otyugh') {
    blob(g, 0.55, body, [0, 0.7, 0], [1, 0.85, 1]);
    for (const [x, z] of [[-0.35, 0.25], [0.35, 0.25], [0, -0.4]]) limb(g, [x, 0.5, z], [x * 1.3, 0.02, z * 1.3], 0.13, 0.1, body);
    put(g, box(0.5, 0.15, 0.3), M('#3a1010'), [0, 1.15, 0.2]); for (let i = 0; i < 5; i++) spike(g, [-0.2 + i * 0.1, 1.08, 0.35], [0, 1, 0], 0.12, 0.03, M('#f2ecdc'), 3);
    limb(g, [0, 1.15, -0.1], [0, 1.6, 0.0], 0.06, 0.05, body); blob(g, 0.1, M('#e8e070', { glow: 0.5 }), [0, 1.65, 0.05], [1, 1, 1], 0);
    for (const x of [-1, 1]) { tent([x * 0.45, 0.95, 0], [x * 1.1, 1.2, 0.7], [x * 0.2, 0.4, 0], 0.09); blob(g, 0.13, dark, [x * 1.1, 1.2, 0.7], [1.3, 0.5, 1.1], 0); }
    return;
  }
  if (kind === 'aboleth') {
    blob(g, 0.5, body, [0, 0.55, 0], [0.85, 0.75, 2.0]);
    put(g, cone(0.5, 0.6, 3), dark, [0, 0.55, -1.2], [-Math.PI / 2, 0, 0], [1, 1, 0.3]);
    for (let i = 0; i < 3; i++) blob(g, 0.08, M('#e83a2a', { glow: 0.6 }), [0, 0.92, 0.5 - i * 0.2], [1, 1, 1], 0);
    for (const x of [-1, 1]) put(g, cone(0.25, 0.5, 3), dark, [x * 0.45, 0.6, 0], [0, 0, -x * Math.PI / 2], [1, 1, 0.2]);
    for (let i = 0; i < 4; i++) { const a = (i / 3 - 0.5) * 1.2; tent([Math.sin(a) * 0.3, 0.4, 0.85], [Math.sin(a) * 0.6, 0.05, 1.6], [0, 0.2, 0], 0.08); }
    return;
  }
  blob(g, 0.48, body, [0, 0.95, -0.1], [1, 1.25, 1]);
  eyes(g, [0, 0.95, 0.32], 0.2, 0.08, '#e8c030', 0.4);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; tent([Math.cos(a) * 0.25, 0.55, Math.sin(a) * 0.25], [Math.cos(a) * 1.0, 0.05, Math.sin(a) * 1.0], [0, 0.25, 0], 0.1); }
}

/** Bipedal brutes: apes, demons, minotaurs, yetis. */
function brute(g: THREE.Group, o: { c: string; c2?: string; horns?: 'bull' | 'demon' | 'none'; tail?: boolean; fur?: boolean; head?: 'ape' | 'bull' | 'beast'; eye?: string; eyeGlow?: number }) {
  const b = M(o.c), d = M(o.c2 ?? shade(o.c, 0.6));
  for (const x of [-1, 1]) { limb(g, [x * 0.22, 0.75, -0.05], [x * 0.25, 0.4, 0.05], 0.13, 0.11, b); limb(g, [x * 0.25, 0.4, 0.05], [x * 0.25, 0.06, -0.05], 0.11, 0.09, b); blob(g, 0.12, d, [x * 0.25, 0.06, 0.05], [1, 0.6, 1.4], 0); }
  blob(g, 0.45, b, [0, 1.15, 0], [1.2, 1, 0.85]);
  blob(g, 0.33, d, [0, 0.8, 0.05], [1.1, 0.8, 0.8]);
  if (o.fur) for (let i = 0; i < 8; i++) spike(g, [Math.cos(i) * 0.35, 1.4, Math.sin(i) * 0.3], [Math.cos(i) * 0.4, 0.7, Math.sin(i) * 0.4 - 0.2], 0.3, 0.1, b, 3);
  const head: V3 = [0, 1.62, 0.15];
  blob(g, 0.24, b, head, [1, 1, 1.05]);
  if (o.head === 'bull') { limb(g, [0, head[1] - 0.05, head[2] + 0.1], [0, head[1] - 0.12, head[2] + 0.38], 0.15, 0.12, b, 6); blob(g, 0.08, d, [0, head[1] - 0.14, head[2] + 0.4], [1.4, 0.8, 0.6], 0); }
  else if (o.head === 'ape') blob(g, 0.15, d, [0, head[1] - 0.08, head[2] + 0.2], [1.2, 0.8, 0.7], 0);
  else { put(g, box(0.25, 0.12, 0.25), d, [0, head[1] - 0.12, head[2] + 0.2]); for (const x of [-1, 1]) spike(g, [x * 0.08, head[1] - 0.12, head[2] + 0.3], [0, 1, 0.2], 0.08, 0.025, M('#f2ecdc'), 3); }
  eyes(g, [0, head[1] + 0.06, head[2] + 0.2], 0.09, 0.04, o.eye ?? '#141210', o.eyeGlow);
  for (const x of [-1, 1]) {
    if (o.horns === 'bull') spike(g, [x * 0.2, head[1] + 0.12, head[2]], [x * 1, 0.6, 0.2], 0.35, 0.06, M('#e8dcc0'));
    if (o.horns === 'demon') spike(g, [x * 0.12, head[1] + 0.2, head[2]], [x * 0.3, 1, -0.5], 0.45, 0.07, M('#2a1a1a'));
    const sh: V3 = [x * 0.55, 1.35, 0], el: V3 = [x * 0.7, 0.95, 0.15], hand: V3 = [x * 0.65, 0.45, 0.2];
    limb(g, sh, el, 0.14, 0.12, b); limb(g, el, hand, 0.12, 0.1, b); blob(g, 0.13, d, hand, [1, 1, 1], 0);
    for (let k = -1; k <= 1; k++) spike(g, [hand[0] + k * 0.05, hand[1] - 0.08, hand[2] + 0.05], [0, -1, 0.4], 0.1, 0.025, M('#e8dcc0'), 3);
  }
  if (o.tail) chain(g, curve([0, 0.85, -0.3], [0.2, 0.2, -1.0], [0.2, 0.2, 0], 4), 0.06, 0.02, b, 4);
}

function mimic(g: THREE.Group) {
  const wood = M('#8a5f36'), gold = M('#d8b25a', { metal: true });
  put(g, box(0.9, 0.5, 0.6), wood, [0, 0.3, 0]);
  put(g, new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8, 1, false, 0, Math.PI), wood, [0, 0.72, -0.1], [-0.5, 0, Math.PI / 2]);
  for (const x of [-0.3, 0.3]) put(g, box(0.06, 0.55, 0.62), gold, [x, 0.3, 0]);
  for (let i = 0; i < 8; i++) { spike(g, [-0.35 + i * 0.1, 0.55, 0.28], [0, 1, 0.1], 0.13, 0.03, M('#f2ecdc'), 3); spike(g, [-0.35 + i * 0.1, 0.75, 0.3], [0, -1, 0.1], 0.12, 0.03, M('#f2ecdc'), 3); }
  chain(g, curve([0, 0.6, 0.2], [0.1, 0.1, 0.9], [0, 0.3, 0], 4), 0.07, 0.03, M('#c0392b'), 5);
  for (const x of [-1, 1]) limb(g, [x * 0.4, 0.2, 0.2], [x * 0.7, 0.02, 0.5], 0.08, 0.05, M('#8a3a3a'));
  eyes(g, [0, 0.95, 0.15], 0.15, 0.06, '#e8e070', 0.6);
}

function frog(g: THREE.Group, c: string) {
  const b = M(c), l = M(shade(c, 1.3));
  blob(g, 0.4, b, [0, 0.35, 0], [1.1, 0.75, 1.15]); blob(g, 0.28, l, [0, 0.25, 0.15], [1, 0.6, 1]);
  for (const x of [-1, 1]) { blob(g, 0.13, b, [x * 0.22, 0.6, 0.25], [1, 1, 1], 0); blob(g, 0.08, M('#e8c030'), [x * 0.24, 0.63, 0.33], [1, 1, 1], 0); blob(g, 0.25, b, [x * 0.38, 0.15, -0.25], [0.8, 0.6, 1.4], 0); limb(g, [x * 0.25, 0.25, 0.25], [x * 0.35, 0.03, 0.4], 0.07, 0.05, b); blob(g, 0.09, b, [x * 0.38, 0.03, -0.55], [1.4, 0.4, 1.6], 0); }
  put(g, box(0.5, 0.03, 0.05), M('#3a1010'), [0, 0.38, 0.45]);
}
function fish(g: THREE.Group, c: string, shark: boolean) {
  const b = M(c), l = M(shade(c, 1.4));
  blob(g, 0.35, b, [0, 0.55, 0], [0.8, 0.9, 2.2]); blob(g, 0.25, l, [0, 0.42, 0.1], [0.7, 0.5, 1.8]);
  put(g, cone(0.3, 0.55, 3), b, [0, 0.55, -0.95], [-Math.PI / 2, 0, 0], [1, 1, 0.25]);
  if (shark) { put(g, cone(0.2, 0.45, 3), b, [0, 0.95, -0.05], [-0.4, 0, 0], [0.3, 1, 1]); for (let i = 0; i < 5; i++) spike(g, [-0.12 + i * 0.06, 0.4, 0.68], [0, 1, 0.3], 0.07, 0.02, M('#f2ecdc'), 3); }
  for (const x of [-1, 1]) put(g, cone(0.15, 0.35, 3), b, [x * 0.28, 0.45, 0.2], [0.6, 0, -x * 1.2], [1, 1, 0.2]);
  eyes(g, [0, 0.62, 0.62], 0.2, 0.05, '#141210');
}
function wisp(g: THREE.Group) { blob(g, 0.25, M('#bfe8ff', { glow: 2, opacity: 0.85 }), [0, 1.3, 0]); blob(g, 0.4, M('#7ac8ff', { glow: 0.8, opacity: 0.3 }), [0, 1.3, 0]); }
function ape(g: THREE.Group, c: string) { brute(g, { c, head: 'ape', fur: true }); }
function hydra(g: THREE.Group, c: string, c2: string) {
  quadruped(g, { len: 1.2, h: 0.32, girth: 0.42, leg: 0.1, neck: 0.05, neckUp: 0.5, head: 0.01, snout: 0, feet: 'claw', tail: 'lizard', low: true, c, c2 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 4 - 0.5) * 1.5, base: V3 = [Math.sin(a) * 0.25, 0.75, 0.45], head: V3 = [Math.sin(a) * 0.9, 1.5 + (i % 2) * 0.25, 0.8 + Math.cos(a) * 0.3];
    chain(g, curve(base, head, [0, 0.3, 0.1], 4), 0.13, 0.09, M(c), 6);
    blob(g, 0.15, M(c), [head[0], head[1], head[2] + 0.08], [0.9, 0.8, 1.5], 0);
    eyes(g, [head[0], head[1] + 0.07, head[2] + 0.18], 0.07, 0.03, '#e8c030', 0.5);
    for (const s of [-1, 1]) spike(g, [head[0] + s * 0.05, head[1] - 0.07, head[2] + 0.25], [0, -1, 0], 0.07, 0.02, M('#f2ecdc'), 3);
  }
}

// ---------------------------------------------------------------- APEX 2.3: more archetypes

/** Poultry and water birds standing on the ground (chicken, duck, goose, swan, cockatrice …). */
function fowl(g: THREE.Group, o: { c: string; c2: string; beak: string; neck: number; comb?: boolean; size?: number }): THREE.Group[] {
  const s = o.size ?? 1, b = M(o.c), l = M(o.c2), bk = M(o.beak);
  blob(g, 0.3 * s, b, [0, 0.42 * s, 0], [0.9, 0.85, 1.2]);
  blob(g, 0.2 * s, l, [0, 0.36 * s, 0.12 * s], [0.8, 0.7, 0.8]);
  const head: V3 = [0, (0.62 + o.neck) * s, (0.22 + o.neck * 0.25) * s];
  limb(g, [0, 0.55 * s, 0.18 * s], head, 0.08 * s, 0.06 * s, b);
  blob(g, 0.11 * s, b, head, [1, 1, 1.1]);
  spike(g, [0, head[1] - 0.02 * s, head[2] + 0.08 * s], [0, -0.2, 1], 0.12 * s, 0.04 * s, bk, 4);
  eyes(g, [0, head[1] + 0.03 * s, head[2] + 0.06 * s], 0.06 * s, 0.018 * s);
  if (o.comb) { for (let i = 0; i < 3; i++) spike(g, [0, head[1] + 0.08 * s, head[2] - 0.03 * s + i * 0.03 * s], [0, 1, 0.1], 0.08 * s, 0.03 * s, M('#c0392b'), 3); blob(g, 0.035 * s, M('#c0392b'), [0, head[1] - 0.09 * s, head[2] + 0.06 * s], [1, 1.4, 1], 0); }
  for (let i = 0; i < 4; i++) spike(g, [(i - 1.5) * 0.05 * s, 0.5 * s, -0.3 * s], [(i - 1.5) * 0.2, 0.6, -1], 0.22 * s, 0.05 * s, i % 2 ? b : l, 3);
  for (const x of [-1, 1]) { limb(g, [x * 0.1 * s, 0.22 * s, 0], [x * 0.1 * s, 0.03, 0.02], 0.025 * s, 0.022 * s, bk, 4); for (const k of [-1, 0, 1]) spike(g, [x * 0.1 * s, 0.02, 0.02], [k * 0.5, 0, 1], 0.08 * s, 0.015 * s, bk, 3); }
  return [wing([0.24 * s, 0.48 * s, 0.02], 1, 0.4 * s, 'feather', o.c, o.c2, 0.25), wing([-0.24 * s, 0.48 * s, 0.02], -1, 0.4 * s, 'feather', o.c, o.c2, 0.25)];
}
/** Turtles and tortoises; the world turtle carries a little landscape. */
function turtle(g: THREE.Group, o: { c: string; shell: string; world?: boolean }) {
  const b = M(o.c), sh = M(o.shell);
  put(g, new THREE.SphereGeometry(0.6, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), sh, [0, 0.25, 0], [0, 0, 0], [1, 0.7, 1.2]);
  put(g, cyl(0.62, 0.62, 0.1, 9), M(shade(o.shell, 0.7)), [0, 0.25, 0], [0, 0, 0], [1, 1, 1.2]);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; blob(g, 0.13, M(shade(o.shell, 1.25)), [Math.cos(a) * 0.32, 0.6, Math.sin(a) * 0.4], [1, 0.4, 1], 0); }
  for (const [x, z] of [[-0.4, 0.45], [0.4, 0.45], [-0.4, -0.45], [0.4, -0.45]]) limb(g, [x, 0.25, z], [x * 1.15, 0.03, z * 1.1], 0.1, 0.09, b);
  limb(g, [0, 0.3, 0.6], [0, 0.42, 0.85], 0.1, 0.09, b); blob(g, 0.14, b, [0, 0.44, 0.9], [1, 0.9, 1.2]); eyes(g, [0, 0.5, 1.02], 0.07, 0.025);
  if (o.world) { for (let i = 0; i < 5; i++) { const a = i * 1.3; put(g, cyl(0.025, 0.035, 0.3, 5), M('#6a4a2a'), [Math.cos(a) * 0.25, 0.75, Math.sin(a) * 0.3]); blob(g, 0.12, M('#3a6a32'), [Math.cos(a) * 0.25, 0.92, Math.sin(a) * 0.3]); } put(g, cone(0.2, 0.35, 5), M('#8a847a'), [0.05, 0.8, -0.05]); put(g, box(0.12, 0.12, 0.12), M('#c8bca8'), [-0.2, 0.68, 0.1]); }
}
/** Snails (giant snail): a slug body under a spiral shell. */
function snail(g: THREE.Group, c: string, shell: string) {
  const b = M(c);
  blob(g, 0.3, b, [0, 0.15, 0], [0.9, 0.5, 2.0]);
  for (let i = 0; i < 4; i++) put(g, new THREE.TorusGeometry(0.42 - i * 0.1, 0.13 - i * 0.025, 6, 10), M(i % 2 ? shell : shade(shell, 0.8)), [0, 0.55 + i * 0.05, -0.15], [0, Math.PI / 2, 0]);
  for (const x of [-1, 1]) { limb(g, [x * 0.08, 0.25, 0.5], [x * 0.14, 0.6, 0.65], 0.025, 0.015, b, 4); blob(g, 0.04, M('#141210'), [x * 0.14, 0.62, 0.66], [1, 1, 1], 0); }
}
/** Mushroom folk and fungal giants. */
function mushroom(g: THREE.Group, cap: string, glow = 0) {
  const stalk = M('#e8dcc0'), c = M(cap, glow ? { glow } : {});
  put(g, cyl(0.22, 0.3, 1.0, 7), stalk, [0, 0.5, 0]);
  put(g, new THREE.SphereGeometry(0.62, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), c, [0, 0.95, 0], [0, 0, 0], [1, 0.6, 1]);
  for (let i = 0; i < 6; i++) blob(g, 0.07, M('#f2ecdc'), [Math.cos(i) * 0.38, 1.18, Math.sin(i) * 0.38], [1, 0.5, 1], 0);
  eyes(g, [0, 0.75, 0.24], 0.1, 0.04, glow ? cap : '#141210', glow ? 1 : 0);
  for (const x of [-1, 1]) limb(g, [x * 0.25, 0.65, 0], [x * 0.5, 0.35, 0.15], 0.06, 0.05, stalk);
}
/** Carnivorous plants: a stalk with snapping jaws and leaves. */
function flytrap(g: THREE.Group) {
  const stem = M('#3a6a2a'), jaw = M('#7a3a3a'), green = M('#5c8a3a');
  chain(g, curve([0, 0, 0], [0, 1.4, 0.3], [0.15, 0, 0], 4), 0.12, 0.08, stem);
  for (const sx of [-1, 1]) { put(g, new THREE.SphereGeometry(0.4, 8, 5, 0, Math.PI, 0, Math.PI), sx > 0 ? green : jaw, [0, 1.55, 0.45], [sx * 0.5, 0, Math.PI / 2], [1, 0.4, 1]); }
  for (let i = 0; i < 7; i++) spike(g, [Math.cos(i * 0.9) * 0.35, 1.55, 0.45 + Math.sin(i * 0.9) * 0.35], [0, 1, 0], 0.12, 0.025, M('#f2ecdc'), 3);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; put(g, cone(0.25, 0.8, 3), green, [Math.cos(a) * 0.35, 0.15, Math.sin(a) * 0.35], [Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2], [1, 1, 0.25]); }
}
/** Floating brain with a beak and tentacles (grell), the brain on legs (intellect devourer), flumph, gazer. */
function brainy(g: THREE.Group, kind: 'grell' | 'devourer' | 'flumph') {
  const pink = M('#d88a9a'), dark = M('#9a5a6a');
  if (kind === 'flumph') {
    put(g, cyl(0.55, 0.45, 0.25, 9), M('#c8e0d8'), [0, 1.3, 0]); for (const x of [-1, 1]) { limb(g, [x * 0.15, 1.42, 0.25], [x * 0.2, 1.75, 0.3], 0.03, 0.02, M('#c8e0d8'), 4); blob(g, 0.06, M('#141210'), [x * 0.2, 1.77, 0.3], [1, 1, 1], 0); }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; chain(g, curve([Math.cos(a) * 0.35, 1.18, Math.sin(a) * 0.35], [Math.cos(a) * 0.45, 0.5, Math.sin(a) * 0.45], [0, 0.1, 0], 3), 0.04, 0.015, M('#a8c8e8', { glow: 0.3 }), 4); }
    return;
  }
  const y = kind === 'grell' ? 1.4 : 0.55;
  blob(g, 0.42, pink, [0, y, 0], [1, 0.8, 1.15]);
  put(g, box(0.02, 0.3, 0.8), dark, [0, y + 0.25, 0]);
  for (let i = 0; i < 6; i++) put(g, new THREE.TorusGeometry(0.2, 0.03, 4, 8, Math.PI), dark, [(i % 2 ? 1 : -1) * 0.18, y + 0.12, -0.3 + i * 0.12], [0, Math.PI / 2, 0]);
  if (kind === 'grell') { spike(g, [0, y - 0.15, 0.4], [0, -0.6, 1], 0.3, 0.1, M('#3a3a2a'), 4); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; chain(g, curve([Math.cos(a) * 0.25, y - 0.25, Math.sin(a) * 0.25], [Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5], [0, 0.2, 0], 4), 0.05, 0.015, pink, 4); } }
  else for (const [x, z] of [[-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]]) { limb(g, [x, y - 0.1, z], [x * 1.6, 0.25, z * 1.6], 0.06, 0.04, dark); limb(g, [x * 1.6, 0.25, z * 1.6], [x * 1.8, 0.02, z * 1.8], 0.04, 0.03, dark); }
}
/** Cloakers and darkmantles: a cape with eyes and a whip tail. */
function cloaker(g: THREE.Group, c: string, small = false) {
  const k = small ? 0.5 : 1, m = M(c, { side: true }), y = 1.6 * k + (small ? 0.6 : 0);
  const shape = new THREE.Shape([new THREE.Vector2(0, 0.6), new THREE.Vector2(1.0, 0.1), new THREE.Vector2(0.8, -0.5), new THREE.Vector2(0.3, -0.25), new THREE.Vector2(0, -0.6), new THREE.Vector2(-0.3, -0.25), new THREE.Vector2(-0.8, -0.5), new THREE.Vector2(-1.0, 0.1)]);
  put(g, new THREE.ShapeGeometry(shape), m, [0, y, 0], [-Math.PI / 2 + 0.25, 0, 0], k);
  blob(g, 0.22 * k, M(shade(c, 1.2)), [0, y + 0.05, 0.15 * k], [1, 0.6, 1.4]);
  for (const x of [-1, 1]) blob(g, 0.05 * k, M('#e83a2a', { glow: 1 }), [x * 0.1 * k, y + 0.15, 0.3 * k], [1, 1, 1], 0);
  chain(g, curve([0, y, -0.5 * k], [0, y - 0.4 * k, -1.4 * k], [0, 0.3, 0], 4), 0.05 * k, 0.015 * k, M(c), 4);
  if (small) for (let i = 0; i < 6; i++) chain(g, curve([Math.cos(i) * 0.3, y - 0.05, Math.sin(i) * 0.3], [Math.cos(i) * 0.4, y - 0.6, Math.sin(i) * 0.4], [0, 0, 0], 2), 0.035, 0.012, M(c), 4);
}
/** A sky whale or sea monster body. */
function whale(g: THREE.Group, c: string, sky: boolean) {
  const b = M(c), belly = M(shade(c, 1.5)), y = sky ? 2.6 : 0.4;
  blob(g, 0.8, b, [0, y, 0], [0.9, 0.75, 2.4]);
  blob(g, 0.6, belly, [0, y - 0.25, 0.3], [0.8, 0.5, 2.0]);
  put(g, cone(0.6, 0.9, 3), b, [0, y + 0.1, -2.1], [-Math.PI / 2, 0, 0], [1.6, 1, 0.25]);
  for (const x of [-1, 1]) put(g, cone(0.35, 0.9, 3), b, [x * 0.75, y - 0.2, 0.6], [0.3, 0, -x * 1.3], [1, 1, 0.25]);
  eyes(g, [0, y + 0.1, 1.55], 0.55, 0.07);
  if (sky) for (let i = 0; i < 8; i++) put(g, box(0.06, 0.25, 0.06), M('#7fd6ff', { glow: 1.5 }), [Math.sin(i) * 0.4, y + 0.55, -1.2 + i * 0.35], [0.4, 0, 0]);
}

// ---------------------------------------------------------------- catalogue

export interface CreatureModel { group: THREE.Group; height: number; wings: THREE.Object3D[]; ride?: number; /** default size class if the stat block gives none */ size: string; flies: boolean; /** where a rider sits */ seat?: V3 }
type Builder = (g: THREE.Group, tint?: string, variant?: CreatureVariant) => { wings?: THREE.Group[]; height: number; seat?: V3 } | void;

const Q = (q: Partial<Quad> & { c: string }): Quad => ({ len: 1.45, h: 0.5, girth: 0.26, leg: 0.065, neck: 0.32, neckUp: 0.5, head: 0.21, snout: 0.8, feet: 'paw', ears: 'point', tail: 'thin', ...q });
/** APEX 2.3 – male / female / young: a cow has no bull horns, a lioness no mane, a doe no antlers; young ones have
 * big heads, short legs and no horns or tusks. */
export type CreatureVariant = 'male' | 'female' | 'young';
const varyQuad = (q: Quad, v?: CreatureVariant): Quad => {
  if (v === 'female') return { ...q, mane: q.mane === 'lion' ? 'none' : q.mane, horns: q.horns === 'antler' ? 'none' : q.horns === 'bull' || q.horns === 'ram' ? 'goat' : q.horns, tusks: false, girth: q.girth * 0.92, len: q.len * 0.96 };
  if (v === 'young') return { ...q, len: q.len * 0.78, girth: q.girth * 0.88, h: q.h * 0.72, leg: q.leg * 0.85, head: q.head * 1.32, snout: q.snout * 0.65, horns: q.horns === 'unicorn' ? 'unicorn' : 'none', tusks: false, mane: q.mane === 'flame' ? 'flame' : 'none', spikes: 0, saddle: false, barding: false, hump: false };
  return q;
};
const quad = (q: Quad, height: number, seat = false): Builder => (g, _tint, variant) => { const r = quadruped(g, varyQuad(q, variant)); return { height, ...(seat ? { seat: r.back } : {}) }; };

/** Every model with its default size, colour and builder. */
export const CREATURES: Record<string, { label: string; group: 'Beasts' | 'Mounts' | 'Monstrosities' | 'Dragons' | 'Aberrations' | 'Elementals & oozes' | 'Constructs & plants' | 'Undead & spirits' | 'Fiends'; size: string; flies?: boolean; mount?: boolean; /** scale when ridden by a medium hero (default: the size class) */ ride?: number; build: Builder }> = {
  // beasts
  wolf: { label: 'Wolf', group: 'Beasts', size: 'medium', build: quad(Q({ c: '#7d7a72', c2: '#c8c2b6', tail: 'bushy' }), 1.1) },
  dog: { label: 'Dog / hound', group: 'Beasts', size: 'medium', build: quad(Q({ c: '#8a6a45', c2: '#d8c49a', ears: 'round', len: 1.25, h: 0.42, snout: 0.7 }), 1.0) },
  hyena: { label: 'Hyena', group: 'Beasts', size: 'medium', build: quad(Q({ c: '#a08858', stripes: '#4a3a2a', ears: 'round', mane: 'horse', accent: '#3a2a1a' }), 1.0) },
  bear: { label: 'Bear', group: 'Beasts', size: 'large', build: quad(Q({ c: '#5a3a22', c2: '#7a5232', len: 1.55, h: 0.42, girth: 0.42, leg: 0.12, neck: 0.22, head: 0.26, snout: 0.6, ears: 'round', tail: 'stub', feet: 'claw' }), 1.25) },
  polarbear: { label: 'Polar bear', group: 'Beasts', size: 'large', build: quad(Q({ c: '#f2ecdc', c2: '#e0d8c4', len: 1.6, h: 0.42, girth: 0.42, leg: 0.12, neck: 0.3, head: 0.24, snout: 0.7, ears: 'round', tail: 'stub', feet: 'claw' }), 1.25) },
  boar: { label: 'Boar', group: 'Beasts', size: 'medium', build: quad(Q({ c: '#4a3a2a', len: 1.3, h: 0.32, girth: 0.33, leg: 0.06, neck: 0.05, head: 0.23, snout: 0.7, tusks: true, fur: true, tail: 'stub', feet: 'hoof' }), 0.95) },
  deer: { label: 'Deer / elk', group: 'Beasts', size: 'large', build: quad(Q({ c: '#9a6a3a', c2: '#e8d8b8', len: 1.35, h: 0.66, girth: 0.22, leg: 0.05, neck: 0.45, neckUp: 0.95, head: 0.17, snout: 0.8, horns: 'antler', feet: 'hoof', tail: 'stub', accent: '#d8c49a' }), 1.9) },
  goat: { label: 'Goat / ram', group: 'Beasts', size: 'medium', build: quad(Q({ c: '#d8d0c0', len: 1.15, h: 0.46, girth: 0.22, leg: 0.05, neck: 0.3, neckUp: 0.8, head: 0.17, snout: 0.7, horns: 'ram', feet: 'hoof', tail: 'stub', accent: '#8a7a62' }), 1.1) },
  ox: { label: 'Ox / bull', group: 'Beasts', size: 'large', build: quad(Q({ c: '#5a3a22', len: 1.7, h: 0.48, girth: 0.4, leg: 0.1, neck: 0.15, head: 0.24, snout: 0.6, horns: 'bull', hump: true, feet: 'hoof', tail: 'thin', ears: 'round' }), 1.3) },
  cat: { label: 'Big cat (lion, panther, tiger)', group: 'Beasts', size: 'large', build: quad(Q({ c: '#c8963a', c2: '#e8d4a6', len: 1.6, h: 0.44, girth: 0.28, leg: 0.08, neck: 0.25, head: 0.24, snout: 0.45, ears: 'round', mane: 'lion', accent: '#8a5a22', tail: 'thin', feet: 'claw' }), 1.15) },
  panther: { label: 'Panther', group: 'Beasts', size: 'medium', build: quad(Q({ c: '#2a2a2e', c2: '#3a3a40', len: 1.55, h: 0.42, girth: 0.25, leg: 0.07, neck: 0.25, head: 0.2, snout: 0.45, ears: 'round', tail: 'thin', eye: '#e8c030', eyeGlow: 0.5 }), 1.0) },
  tiger: { label: 'Tiger', group: 'Beasts', size: 'large', build: quad(Q({ c: '#d8742a', c2: '#f2ecdc', stripes: '#1a1612', len: 1.65, h: 0.44, girth: 0.3, leg: 0.08, neck: 0.25, head: 0.23, snout: 0.45, ears: 'round', tail: 'thin', feet: 'claw' }), 1.15) },
  rat: { label: 'Giant rat', group: 'Beasts', size: 'small', build: quad(Q({ c: '#6a5a4a', c2: '#a89a8a', len: 1.15, h: 0.26, girth: 0.22, leg: 0.05, neck: 0.1, head: 0.18, snout: 0.8, ears: 'round', tail: 'long', eye: '#b3261e', eyeGlow: 0.4 }), 0.8) },
  crocodile: { label: 'Crocodile / giant lizard', group: 'Beasts', size: 'large', build: quad(Q({ c: '#4a5a32', c2: '#a0a070', len: 1.5, h: 0.15, girth: 0.28, leg: 0.07, neck: 0.1, neckUp: 0.1, head: 0.2, snout: 1.6, low: true, tail: 'lizard', ears: 'none', spikes: 8, accent: '#3a4a22', feet: 'claw', eye: '#e8c030' }), 0.7) },
  lizard: { label: 'Giant lizard', group: 'Mounts', size: 'large', mount: true, build: quad(Q({ c: '#5a7a4a', c2: '#c8c090', len: 1.4, h: 0.25, girth: 0.3, leg: 0.08, neck: 0.25, neckUp: 0.4, head: 0.2, snout: 0.8, low: true, tail: 'lizard', ears: 'none', saddle: true, feet: 'claw', eye: '#e8c030' }), 0.9, true) },
  elephant: { label: 'Elephant / mammoth', group: 'Beasts', size: 'huge', build: quad(Q({ c: '#8a8580', len: 1.3, h: 0.55, girth: 0.55, leg: 0.15, neck: 0.05, head: 0.35, snout: 0, ears: 'big', trunk: true, tusks: true, tail: 'thin', feet: 'hoof', dark: '#5a5550' }), 1.5) },
  mammoth: { label: 'Mammoth', group: 'Beasts', size: 'huge', build: quad(Q({ c: '#6a4a2a', len: 1.3, h: 0.55, girth: 0.58, leg: 0.15, neck: 0.05, head: 0.35, snout: 0, ears: 'round', trunk: true, tusks: true, hump: true, fur: true, tail: 'thin', feet: 'hoof' }), 1.6) },
  ape: { label: 'Ape', group: 'Beasts', size: 'medium', build: (g) => { ape(g, '#3a3632'); return { height: 1.9 }; } },
  frog: { label: 'Giant frog / toad', group: 'Beasts', size: 'medium', build: (g) => { frog(g, '#5a8a3a'); return { height: 0.75 }; } },
  shark: { label: 'Shark', group: 'Beasts', size: 'large', build: (g) => { fish(g, '#6a7a8a', true); return { height: 1.0 }; } },
  fish: { label: 'Giant fish', group: 'Beasts', size: 'medium', build: (g) => { fish(g, '#3a8a9a', false); return { height: 0.9 }; } },
  snake: { label: 'Snake / constrictor', group: 'Beasts', size: 'large', build: (g) => { serpent(g, { c: '#5a7a3a', c2: '#c8c090', r: 0.14, len: 1.8, rise: 0.5 }); return { height: 0.95 }; } },
  cobra: { label: 'Cobra / viper', group: 'Beasts', size: 'medium', build: (g) => { serpent(g, { c: '#8a6a2a', c2: '#e8d4a6', r: 0.11, len: 1.4, rise: 0.75, hood: true }); return { height: 1.15 }; } },
  spider: { label: 'Giant spider', group: 'Beasts', size: 'large', build: (g) => { arthropod(g, { c: '#2a2622', c2: '#1a1614', kind: 'spider' }); return { height: 0.9 }; } },
  scorpion: { label: 'Giant scorpion', group: 'Beasts', size: 'large', build: (g) => { arthropod(g, { c: '#7a4a2a', c2: '#4a2a1a', kind: 'scorpion' }); return { height: 1.5 }; } },
  beetle: { label: 'Giant beetle', group: 'Beasts', size: 'medium', build: (g) => { arthropod(g, { c: '#2d4a5a', c2: '#1a2a32', kind: 'beetle' }); return { height: 0.85 }; } },
  crab: { label: 'Giant crab', group: 'Beasts', size: 'medium', build: (g) => { arthropod(g, { c: '#b3402a', c2: '#7a2a1a', kind: 'crab' }); return { height: 0.75 }; } },
  centipede: { label: 'Giant centipede', group: 'Beasts', size: 'small', build: (g) => { arthropod(g, { c: '#7a3a1a', c2: '#3a1a0a', kind: 'centipede' }); return { height: 0.4 }; } },
  eagle: { label: 'Eagle / hawk', group: 'Beasts', size: 'small', flies: true, build: (g) => ({ wings: bird(g, { c: '#5a3a22', c2: '#f2ecdc', beak: '#e8b030', size: 1 }), height: 1.15 }) },
  owl: { label: 'Owl', group: 'Beasts', size: 'small', flies: true, build: (g) => ({ wings: bird(g, { c: '#8a6a45', c2: '#d8c49a', beak: '#3a3632', size: 1, owl: true }), height: 1.15 }) },
  raven: { label: 'Raven / crow', group: 'Beasts', size: 'tiny', flies: true, build: (g) => ({ wings: bird(g, { c: '#1a1a22', c2: '#2a2a36', beak: '#2a2a2e', size: 1 }), height: 1.1 }) },
  vulture: { label: 'Vulture', group: 'Beasts', size: 'medium', flies: true, build: (g) => ({ wings: bird(g, { c: '#3a2a22', c2: '#5a4a3a', beak: '#d8c49a', size: 1.1, neckBare: true }), height: 1.25 }) },
  roc: { label: 'Roc / giant eagle', group: 'Mounts', size: 'large', flies: true, mount: true, build: (g) => ({ wings: bird(g, { c: '#6a4a2a', c2: '#d8c49a', beak: '#e8b030', size: 1.4, crest: true }), height: 1.6, seat: [0, 1.05, 0] }) },
  bat: { label: 'Bat', group: 'Beasts', size: 'small', flies: true, build: (g) => { const b = M('#3a2e2a'); blob(g, 0.25, b, [0, 0.9, 0], [0.9, 1.1, 1]); blob(g, 0.17, b, [0, 1.2, 0.08]); for (const s of [-1, 1]) spike(g, [s * 0.1, 1.33, 0.05], [s * 0.3, 1, 0], 0.18, 0.06, b, 3); eyes(g, [0, 1.24, 0.22], 0.07, 0.03, '#b3261e', 0.6); for (const s of [-1, 1]) spike(g, [s * 0.04, 1.12, 0.22], [0, -1, 0.2], 0.06, 0.015, M('#f2ecdc'), 3); return { wings: [wing([0.18, 0.95, 0], 1, 0.75, 'membrane', '#3a2e2a', '#4a3a36'), wing([-0.18, 0.95, 0], -1, 0.75, 'membrane', '#3a2e2a', '#4a3a36')], height: 1.4 }; } },
  // mounts
  horse: { label: 'Horse', group: 'Mounts', size: 'large', mount: true, build: quad(Q({ c: '#7a4a2a', len: 1.55, h: 0.66, girth: 0.27, leg: 0.06, neck: 0.5, neckUp: 1.0, head: 0.18, snout: 1.1, feet: 'hoof', tail: 'horse', mane: 'horse', accent: '#2a1a12', ears: 'point' }), 1.65, true) },
  warhorse: { label: 'Warhorse (barding)', group: 'Mounts', size: 'large', mount: true, build: quad(Q({ c: '#3a3632', len: 1.6, h: 0.66, girth: 0.29, leg: 0.07, neck: 0.5, neckUp: 1.0, head: 0.19, snout: 1.1, feet: 'hoof', tail: 'horse', mane: 'horse', accent: '#1a1612', barding: true, saddle: true }), 1.7, true) },
  pony: { label: 'Pony / mule', group: 'Mounts', size: 'medium', mount: true, ride: 1.45, build: quad(Q({ c: '#a0784a', len: 1.25, h: 0.45, girth: 0.25, leg: 0.06, neck: 0.32, neckUp: 0.95, head: 0.16, snout: 1.0, feet: 'hoof', tail: 'horse', mane: 'horse', accent: '#4a3a2a', saddle: true }), 1.15, true) },
  camel: { label: 'Camel', group: 'Mounts', size: 'large', mount: true, build: quad(Q({ c: '#c8a070', len: 1.45, h: 0.78, girth: 0.27, leg: 0.06, neck: 0.55, neckUp: 0.6, head: 0.16, snout: 0.9, hump: true, feet: 'hoof', tail: 'thin', ears: 'round', saddle: true }), 1.9, true) },
  wardog: { label: 'War wolf / worg', group: 'Mounts', size: 'large', mount: true, build: quad(Q({ c: '#4a4440', c2: '#7a746c', len: 1.6, h: 0.52, girth: 0.32, leg: 0.08, tail: 'bushy', saddle: true, eye: '#e8c030', eyeGlow: 0.6, fur: true }), 1.2, true) },
  pegasus: { label: 'Pegasus', group: 'Mounts', size: 'large', flies: true, mount: true, build: (g) => { const r = quadruped(g, Q({ c: '#f2ecdc', len: 1.55, h: 0.66, girth: 0.27, leg: 0.06, neck: 0.5, neckUp: 1.0, head: 0.18, snout: 1.1, feet: 'hoof', tail: 'horse', mane: 'horse', accent: '#d8c49a', dark: '#8a8580' })); return { wings: [wing([0.22, r.back[1] - 0.05, 0.25], 1, 1.2, 'feather', '#f2ecdc', '#e8dcc0'), wing([-0.22, r.back[1] - 0.05, 0.25], -1, 1.2, 'feather', '#f2ecdc', '#e8dcc0')], height: 1.65, seat: r.back }; } },
  unicorn: { label: 'Unicorn', group: 'Mounts', size: 'large', mount: true, build: quad(Q({ c: '#f8f4ec', len: 1.55, h: 0.66, girth: 0.27, leg: 0.06, neck: 0.5, neckUp: 1.0, head: 0.18, snout: 1.1, feet: 'hoof', tail: 'horse', mane: 'horse', accent: '#e8d4a6', horns: 'unicorn', dark: '#d8b25a' }), 1.9, true) },
  nightmare: { label: 'Nightmare', group: 'Mounts', size: 'large', mount: true, build: quad(Q({ c: '#1a1612', len: 1.6, h: 0.66, girth: 0.29, leg: 0.07, neck: 0.5, neckUp: 1.0, head: 0.19, snout: 1.1, feet: 'hoof', tail: 'horse', mane: 'flame', accent: '#ff6a2a', eye: '#ff6a2a', eyeGlow: 1.2 }), 1.7, true) },
  griffon: { label: 'Griffon', group: 'Mounts', size: 'large', flies: true, mount: true, build: (g) => { const r = quadruped(g, Q({ c: '#c8963a', len: 1.3, h: 0.45, girth: 0.3, leg: 0.08, neck: 0.35, neckUp: 0.9, head: 0.22, snout: 0, beak: true, accent: '#e8b030', ears: 'none', feet: 'claw', tail: 'thin' })); blob(g, 0.33, M('#f2ecdc'), [0, r.headAt[1] - 0.15, r.headAt[2] - 0.15], [1.1, 1.1, 0.9]); blob(g, 0.22, M('#f2ecdc'), r.headAt, [1, 1, 1.05]); return { wings: [wing([0.22, r.back[1] - 0.05, 0.25], 1, 1.2, 'feather', '#7a5a32', '#f2ecdc'), wing([-0.22, r.back[1] - 0.05, 0.25], -1, 1.2, 'feather', '#7a5a32', '#f2ecdc')], height: 1.5, seat: r.back }; } },
  hippogriff: { label: 'Hippogriff', group: 'Mounts', size: 'large', flies: true, mount: true, build: (g) => { const r = quadruped(g, Q({ c: '#8a6a45', len: 1.25, h: 0.55, girth: 0.28, leg: 0.06, neck: 0.45, neckUp: 1.0, head: 0.2, snout: 0, beak: true, accent: '#e8b030', ears: 'none', feet: 'hoof', tail: 'horse' })); return { wings: [wing([0.22, r.back[1] - 0.05, 0.25], 1, 1.15, 'feather', '#6a4a2a', '#d8c49a'), wing([-0.22, r.back[1] - 0.05, 0.25], -1, 1.15, 'feather', '#6a4a2a', '#d8c49a')], height: 1.6, seat: r.back }; } },
  // monstrosities
  owlbear: { label: 'Owlbear', group: 'Monstrosities', size: 'large', build: (g) => { const r = quadruped(g, Q({ c: '#6a4a2a', c2: '#8a6a45', len: 1.25, h: 0.42, girth: 0.46, leg: 0.12, neck: 0.15, head: 0.3, snout: 0, beak: true, accent: '#e8c030', ears: 'none', feet: 'claw', tail: 'stub', fur: true })); blob(g, 0.25, M('#d8c49a'), [0, r.headAt[1], r.headAt[2] + 0.12], [1.2, 1, 0.5]); return { height: 1.4 }; } },
  basilisk: { label: 'Basilisk', group: 'Monstrosities', size: 'medium', build: quad(Q({ c: '#4a6a3a', c2: '#a8a870', len: 1.4, h: 0.2, girth: 0.28, leg: 0.06, neck: 0.15, neckUp: 0.3, head: 0.2, snout: 0.6, low: true, legs: 8, tail: 'lizard', ears: 'none', spikes: 7, accent: '#2a3a1a', eye: '#7ad84a', eyeGlow: 1.2, feet: 'claw' }), 0.8) },
  manticore: { label: 'Manticore', group: 'Monstrosities', size: 'large', flies: true, build: (g) => { const r = quadruped(g, Q({ c: '#b3542a', len: 1.35, h: 0.45, girth: 0.32, leg: 0.08, neck: 0.25, head: 0.24, snout: 0.15, mane: 'lion', accent: '#5a2a1a', ears: 'round', tail: 'club', feet: 'claw', eye: '#e8c030' })); return { wings: [wing([0.22, r.back[1] - 0.05, 0.25], 1, 1.1, 'membrane', '#5a2a1a', '#7a3a2a'), wing([-0.22, r.back[1] - 0.05, 0.25], -1, 1.1, 'membrane', '#5a2a1a', '#7a3a2a')], height: 1.3 }; } },
  hydra: { label: 'Hydra', group: 'Monstrosities', size: 'huge', build: (g) => { hydra(g, '#3a6a4a', '#a8a870'); return { height: 1.85 }; } },
  worm: { label: 'Giant worm (purple worm)', group: 'Monstrosities', size: 'gargantuan', build: (g) => { serpent(g, { c: '#5a2a6e', c2: '#8a5aa0', r: 0.22, len: 1.5, rise: 1.2, worm: true }); return { height: 1.5 }; } },
  mimic: { label: 'Mimic', group: 'Monstrosities', size: 'medium', build: (g) => { mimic(g); return { height: 1.0 }; } },
  rustmonster: { label: 'Rust monster', group: 'Monstrosities', size: 'medium', build: quad(Q({ c: '#b87333', len: 1.2, h: 0.3, girth: 0.32, leg: 0.06, neck: 0.1, head: 0.2, snout: 0.3, ears: 'none', tail: 'spade', spikes: 6, accent: '#7a4a1a', feet: 'claw' }), 0.9) },
  // dragons
  dragon: { label: 'Dragon (wyrmling to ancient)', group: 'Dragons', size: 'huge', flies: true, build: (g, tint) => ({ wings: dragon(g, { ...dragonColours(tint), kind: 'dragon' }), height: 1.7 }) },
  wyvern: { label: 'Wyvern', group: 'Dragons', size: 'large', flies: true, mount: true, build: (g) => ({ wings: dragon(g, { c: '#5a5a3a', c2: '#8a8a5a', horn: '#2a2a1a', kind: 'wyvern' }), height: 1.6, seat: [0, 1.2, 0.05] }) },
  drake: { label: 'Drake (wingless)', group: 'Dragons', size: 'medium', mount: true, ride: 1.6, build: (g, tint) => ({ wings: dragon(g, { ...dragonColours(tint ?? 'green'), kind: 'drake' }), height: 1.5, seat: [0, 1.0, 0.05] }) },
  // aberrations
  beholder: { label: 'Beholder (eye tyrant)', group: 'Aberrations', size: 'large', flies: true, build: (g) => { beholder(g, '#7a3a5a'); return { height: 2.2 }; } },
  aboleth: { label: 'Aboleth', group: 'Aberrations', size: 'large', build: (g) => { tentacled(g, 'aboleth', '#5a7a8a'); return { height: 1.1 }; } },
  otyugh: { label: 'Otyugh', group: 'Aberrations', size: 'large', build: (g) => { tentacled(g, 'otyugh', '#7a6a4a'); return { height: 1.7 }; } },
  mouther: { label: 'Gibbering mouther', group: 'Aberrations', size: 'medium', build: (g) => { tentacled(g, 'mouther', '#9a6a7a'); return { height: 0.9 }; } },
  octopus: { label: 'Octopus / kraken spawn', group: 'Aberrations', size: 'large', build: (g) => { tentacled(g, 'octopus', '#b3542a'); return { height: 1.5 }; } },
  // elementals & oozes
  fire: { label: 'Fire elemental', group: 'Elementals & oozes', size: 'large', build: (g) => { elemental(g, 'fire'); return { height: 2.2 }; } },
  water: { label: 'Water elemental', group: 'Elementals & oozes', size: 'large', build: (g) => { elemental(g, 'water'); return { height: 2.1 }; } },
  air: { label: 'Air elemental', group: 'Elementals & oozes', size: 'large', flies: true, build: (g) => { elemental(g, 'air'); return { height: 2.3 }; } },
  earth: { label: 'Earth elemental', group: 'Elementals & oozes', size: 'large', build: (g) => { elemental(g, 'earth'); return { height: 1.9 }; } },
  ooze: { label: 'Ooze / slime / pudding', group: 'Elementals & oozes', size: 'large', build: (g, tint) => { ooze(g, tint ?? '#5aa040'); return { height: 0.7 }; } },
  cube: { label: 'Gelatinous cube', group: 'Elementals & oozes', size: 'large', build: (g) => { ooze(g, '#7ad8a0', true); return { height: 1.5 }; } },
  wisp: { label: 'Will-o’-wisp', group: 'Elementals & oozes', size: 'tiny', flies: true, build: (g) => { wisp(g); return { height: 1.6 }; } },
  // constructs & plants
  golem: { label: 'Golem (stone / iron / clay)', group: 'Constructs & plants', size: 'large', build: (g, tint) => ({ wings: golem(g, tint ?? '#8a847a'), height: 1.85 }) },
  gargoyle: { label: 'Gargoyle', group: 'Constructs & plants', size: 'medium', flies: true, build: (g) => ({ wings: golem(g, '#6a6660', '#e83a2a', true, true), height: 2.0 }) },
  treant: { label: 'Treant / awakened tree', group: 'Constructs & plants', size: 'huge', build: (g) => { treant(g); return { height: 3.3 }; } },
  shambling: { label: 'Shambling mound / blight', group: 'Constructs & plants', size: 'large', build: (g) => { treant(g, true); return { height: 1.9 }; } },
  // undead & spirits
  ghost: { label: 'Ghost / specter / wraith', group: 'Undead & spirits', size: 'medium', flies: true, build: (g, tint) => { ghost(g, tint ?? '#bfd8e8'); return { height: 2.2 }; } },
  // fiends
  demon: { label: 'Demon / devil (large)', group: 'Fiends', size: 'large', flies: true, build: (g) => { brute(g, { c: '#8a2a1a', c2: '#3a1010', horns: 'demon', tail: true, head: 'beast', eye: '#ffcf3a', eyeGlow: 1.2 }); return { wings: [wing([0.22, 1.4, -0.2], 1, 1.2, 'membrane', '#5a1a10', '#7a2a1a', 0.3), wing([-0.22, 1.4, -0.2], -1, 1.2, 'membrane', '#5a1a10', '#7a2a1a', 0.3)], height: 2.1 }; } },
  minotaur: { label: 'Minotaur', group: 'Monstrosities', size: 'large', build: (g) => { brute(g, { c: '#5a3a22', horns: 'bull', head: 'bull', fur: true, tail: true }); return { height: 2.0 }; } },
  yeti: { label: 'Yeti', group: 'Monstrosities', size: 'large', build: (g) => { brute(g, { c: '#e8e4dc', c2: '#a8b8c8', head: 'ape', fur: true }); return { height: 1.9 }; } },
  hellhound: { label: 'Hell hound', group: 'Fiends', size: 'medium', build: quad(Q({ c: '#3a1a12', c2: '#5a2a1a', mane: 'flame', tail: 'thin', eye: '#ffcf3a', eyeGlow: 1.4, feet: 'claw' }), 1.1) },
  // ---------------------------------------------------------------- APEX 2.3: farm, wild and small animals
  rabbit: { label: 'Rabbit / hare', group: 'Beasts', size: 'tiny', build: quad(Q({ c: '#a08868', c2: '#e8dcc8', len: 0.75, h: 0.22, girth: 0.22, leg: 0.045, neck: 0.08, neckUp: 0.9, head: 0.16, snout: 0.25, ears: 'bunny', tail: 'stub', accent: '#f2ecdc' }), 0.75) },
  squirrel: { label: 'Squirrel', group: 'Beasts', size: 'tiny', build: (g, t, v) => { quadruped(g, varyQuad(Q({ c: '#b0602a', c2: '#f2dcc0', len: 0.7, h: 0.2, girth: 0.18, leg: 0.04, neck: 0.08, neckUp: 0.9, head: 0.15, snout: 0.3, ears: 'point', tail: 'none' }), v)); chain(g, curve([0, 0.35, -0.3], [0, 0.85, -0.25], [0, 0.1, -0.35], 4), 0.13, 0.17, M('#b0602a'), 6); void t; return { height: 0.8 }; } },
  hedgehog: { label: 'Hedgehog', group: 'Beasts', size: 'tiny', build: (g) => { blob(g, 0.3, M('#e8d4b8'), [0, 0.22, 0.05], [0.9, 0.7, 1.2]); for (let i = 0; i < 26; i++) { const a = i * 2.4, yv = 0.25 + (i % 5) * 0.06; spike(g, [Math.cos(a) * 0.2, yv, Math.sin(a) * 0.25 - 0.05], [Math.cos(a), 0.9, Math.sin(a) - 0.4], 0.18, 0.035, M('#4a3a2a'), 3); } blob(g, 0.1, M('#e8d4b8'), [0, 0.2, 0.35], [1, 0.9, 1.3]); blob(g, 0.03, M('#141210'), [0, 0.2, 0.47], [1, 1, 1], 0); eyes(g, [0, 0.26, 0.4], 0.06, 0.02); return { height: 0.5 }; } },
  fox: { label: 'Fox', group: 'Beasts', size: 'small', build: quad(Q({ c: '#d0642a', c2: '#f2ecdc', len: 1.15, h: 0.36, girth: 0.2, leg: 0.045, neck: 0.25, head: 0.17, snout: 1.0, ears: 'point', tail: 'bushy', dark: '#2a1a12', accent: '#f2ecdc' }), 0.85) },
  badger: { label: 'Badger', group: 'Beasts', size: 'small', build: quad(Q({ c: '#5a5a5a', c2: '#2a2a2a', len: 1.0, h: 0.2, girth: 0.25, leg: 0.06, neck: 0.08, head: 0.17, snout: 0.6, ears: 'round', tail: 'stub', headC: '#e8e4dc', feet: 'claw', stripes: '#e8e4dc' }), 0.65) },
  housecat: { label: 'Cat', group: 'Beasts', size: 'tiny', build: quad(Q({ c: '#8a8580', c2: '#d8d0c0', stripes: '#4a4540', len: 0.9, h: 0.28, girth: 0.17, leg: 0.04, neck: 0.15, head: 0.16, snout: 0.25, ears: 'point', tail: 'thin', eye: '#e8c030' }), 0.7) },
  sheep: { label: 'Sheep / ram / lamb', group: 'Beasts', size: 'medium', build: quad(Q({ c: '#f2ecdc', len: 1.1, h: 0.4, girth: 0.32, leg: 0.05, neck: 0.18, neckUp: 0.6, head: 0.15, snout: 0.5, ears: 'long', tail: 'stub', wool: true, headC: '#2a2622', feet: 'hoof', horns: 'ram', accent: '#c8b890' }), 1.0) },
  cow: { label: 'Cow / bull / calf', group: 'Beasts', size: 'large', build: quad(Q({ c: '#f2ecdc', spots: '#2a2622', len: 1.6, h: 0.48, girth: 0.37, leg: 0.09, neck: 0.18, head: 0.23, snout: 0.6, horns: 'bull', ears: 'round', feet: 'hoof', tail: 'thin', dark: '#e8a0a0' }), 1.25) },
  pig: { label: 'Pig / sow / piglet', group: 'Beasts', size: 'medium', build: quad(Q({ c: '#e8a8a0', len: 1.2, h: 0.28, girth: 0.32, leg: 0.06, neck: 0.05, head: 0.22, snout: 0.35, ears: 'round', tail: 'thin', feet: 'hoof', dark: '#c87870' }), 0.85) },
  chicken: { label: 'Chicken / rooster', group: 'Beasts', size: 'tiny', flies: true, build: (g) => ({ wings: fowl(g, { c: '#f2ecdc', c2: '#e8d4b8', beak: '#e8b030', neck: 0.08, comb: true }), height: 0.95 }) },
  duck: { label: 'Duck / goose', group: 'Beasts', size: 'tiny', flies: true, build: (g) => ({ wings: fowl(g, { c: '#7a6a52', c2: '#c8b890', beak: '#e8a030', neck: 0.18 }), height: 1.0 }) },
  swan: { label: 'Swan', group: 'Beasts', size: 'small', flies: true, build: (g) => ({ wings: fowl(g, { c: '#f8f4ec', c2: '#e8e4dc', beak: '#e87830', neck: 0.45, size: 1.1 }), height: 1.4 }) },
  billygoat: { label: 'Billy goat', group: 'Beasts', size: 'medium', build: (g, t, v) => { const r = quadruped(g, varyQuad(Q({ c: '#8a6a45', c2: '#d8c49a', len: 1.15, h: 0.46, girth: 0.22, leg: 0.05, neck: 0.3, neckUp: 0.8, head: 0.17, snout: 0.7, horns: 'goat', feet: 'hoof', tail: 'stub', accent: '#5a4a3a' }), v)); spike(g, [0, r.headAt[1] - 0.15, r.headAt[2] + 0.12], [0, -1, 0.2], 0.16, 0.05, M('#d8c49a'), 3); void t; return { height: 1.15 }; } },
  donkey: { label: 'Donkey', group: 'Mounts', size: 'medium', mount: true, ride: 1.45, build: quad(Q({ c: '#8a8580', c2: '#e8e4dc', len: 1.25, h: 0.45, girth: 0.25, leg: 0.06, neck: 0.32, neckUp: 0.9, head: 0.17, snout: 1.0, feet: 'hoof', tail: 'thin', ears: 'long', mane: 'horse', accent: '#3a3632', saddle: true }), 1.2, true) },
  zebra: { label: 'Zebra', group: 'Beasts', size: 'large', build: quad(Q({ c: '#f2ecdc', stripes: '#1a1612', len: 1.5, h: 0.62, girth: 0.27, leg: 0.06, neck: 0.5, neckUp: 1.0, head: 0.18, snout: 1.1, feet: 'hoof', tail: 'horse', mane: 'horse', accent: '#1a1612' }), 1.6) },
  llama: { label: 'Llama / alpaca', group: 'Mounts', size: 'medium', mount: true, ride: 1.45, build: quad(Q({ c: '#e8dcc0', len: 1.1, h: 0.55, girth: 0.25, leg: 0.05, neck: 0.6, neckUp: 1.25, head: 0.15, snout: 0.6, ears: 'long', wool: true, feet: 'hoof', tail: 'stub' }), 1.7, true) },
  bison: { label: 'Bison / buffalo / yak', group: 'Beasts', size: 'large', build: quad(Q({ c: '#4a3222', len: 1.6, h: 0.45, girth: 0.42, leg: 0.1, neck: 0.1, head: 0.27, snout: 0.45, horns: 'bull', hump: true, fur: true, feet: 'hoof', tail: 'thin', ears: 'round', accent: '#2a1a12' }), 1.35) },
  rhino: { label: 'Rhinoceros', group: 'Beasts', size: 'large', build: quad(Q({ c: '#8a8580', len: 1.7, h: 0.4, girth: 0.45, leg: 0.12, neck: 0.08, head: 0.27, snout: 0.7, horns: 'rhino', ears: 'round', feet: 'hoof', tail: 'thin' }), 1.2) },
  hippo: { label: 'Hippopotamus', group: 'Beasts', size: 'large', build: quad(Q({ c: '#8a6a7a', c2: '#d8a8b0', len: 1.7, h: 0.28, girth: 0.5, leg: 0.12, neck: 0.05, head: 0.36, snout: 0.55, ears: 'round', feet: 'hoof', tail: 'stub', tusks: true }), 1.05) },
  giraffe: { label: 'Giraffe', group: 'Beasts', size: 'huge', build: quad(Q({ c: '#e8b060', spots: '#8a4a1a', len: 1.25, h: 0.95, girth: 0.25, leg: 0.05, neck: 1.35, neckUp: 1.25, head: 0.15, snout: 0.8, ears: 'point', horns: 'goat', feet: 'hoof', tail: 'thin', mane: 'horse', accent: '#8a4a1a' }), 2.9) },
  turtle: { label: 'Turtle / tortoise', group: 'Beasts', size: 'medium', build: (g) => { turtle(g, { c: '#7a8a5a', shell: '#5a6a3a' }); return { height: 0.75 }; } },
  snail: { label: 'Giant snail', group: 'Beasts', size: 'medium', build: (g) => { snail(g, '#b8a888', '#a0603a'); return { height: 0.95 }; } },
  butterfly: { label: 'Butterfly / moth', group: 'Beasts', size: 'tiny', flies: true, build: (g, tint) => { blob(g, 0.06, M('#2a2622'), [0, 1.1, 0], [1, 1, 4]); const c = tint ?? '#e070a0'; return { wings: [wing([0.04, 1.1, 0], 1, 0.6, 'insect', c, c, 0.9), wing([-0.04, 1.1, 0], -1, 0.6, 'insect', c, c, 0.9)], height: 1.3 }; } },
  // ---------------------------------------------------------------- magical beasts
  displacer: { label: 'Displacer beast', group: 'Monstrosities', size: 'large', build: (g) => { const r = quadruped(g, Q({ c: '#2a2e4a', c2: '#3a3e5a', len: 1.6, h: 0.45, girth: 0.27, leg: 0.06, neck: 0.25, head: 0.21, snout: 0.45, ears: 'point', legs: 6, tail: 'thin', eye: '#7fd6ff', eyeGlow: 1.2 })); for (const x of [-1, 1]) { const tip: V3 = [x * 0.7, r.back[1] + 0.9, 0.3]; chain(g, curve([x * 0.15, r.back[1], 0.25], tip, [x * 0.2, 0.3, -0.3], 5), 0.06, 0.03, M('#2a2e4a'), 5); blob(g, 0.12, M('#2a2e4a'), tip, [1, 0.6, 1.4], 0); for (let k = 0; k < 4; k++) spike(g, tip, [Math.cos(k * 1.57), Math.sin(k * 1.57), 0.3], 0.14, 0.03, M('#e8dcc0'), 3); } return { height: 1.4 }; } },
  blinkdog: { label: 'Blink dog', group: 'Monstrosities', size: 'medium', build: quad(Q({ c: '#e8c870', c2: '#f2ecdc', len: 1.3, h: 0.45, girth: 0.23, leg: 0.055, ears: 'point', tail: 'thin', eye: '#7fd6ff', eyeGlow: 1.4, glow: 0.12 }), 1.05) },
  winterwolf: { label: 'Winter wolf / frost wolf', group: 'Monstrosities', size: 'large', build: (g) => { quadruped(g, Q({ c: '#d8e8f0', c2: '#f8fcff', len: 1.6, h: 0.52, girth: 0.3, leg: 0.075, tail: 'bushy', eye: '#7fd6ff', eyeGlow: 1.5, fur: true })); for (let i = 0; i < 6; i++) spike(g, [0, 0.95, 0.4 - i * 0.18], [0, 1, -0.3], 0.35, 0.06, M('#a8e0ff', { glow: 0.6, opacity: 0.85 }), 4); return { height: 1.3 }; } },
  ghostwolf: { label: 'Spectral wolf / ghost beast', group: 'Undead & spirits', size: 'medium', build: quad(Q({ c: '#a8d8ff', len: 1.45, h: 0.5, girth: 0.26, tail: 'bushy', ghost: true, eye: '#ffffff', eyeGlow: 2 }), 1.1) },
  spectralstag: { label: 'Spectral / silver stag', group: 'Undead & spirits', size: 'large', build: quad(Q({ c: '#c8e8ff', len: 1.35, h: 0.66, girth: 0.22, leg: 0.05, neck: 0.45, neckUp: 0.95, head: 0.17, snout: 0.8, horns: 'antler', feet: 'hoof', tail: 'stub', ghost: true, accent: '#e8f8ff', eye: '#ffffff', eyeGlow: 2 }), 1.9) },
  jackalope: { label: 'Jackalope', group: 'Monstrosities', size: 'tiny', build: quad(Q({ c: '#a08868', c2: '#e8dcc8', len: 0.75, h: 0.22, girth: 0.22, leg: 0.045, neck: 0.08, neckUp: 0.9, head: 0.16, snout: 0.25, ears: 'bunny', tail: 'stub', horns: 'antler', accent: '#d8c49a' }), 0.95) },
  moonhare: { label: 'Moon hare', group: 'Monstrosities', size: 'tiny', build: quad(Q({ c: '#d8e8ff', c2: '#ffffff', len: 0.75, h: 0.22, girth: 0.22, leg: 0.045, neck: 0.08, neckUp: 0.9, head: 0.16, snout: 0.25, ears: 'bunny', tail: 'stub', glow: 0.5, eye: '#7fd6ff', eyeGlow: 1.5 }), 0.75) },
  kitsune: { label: 'Kitsune (many-tailed fox)', group: 'Monstrosities', size: 'small', build: quad(Q({ c: '#f2ecdc', c2: '#ffffff', len: 1.15, h: 0.36, girth: 0.2, leg: 0.045, neck: 0.25, head: 0.17, snout: 1.0, ears: 'point', tail: 'bushy', tails: 7, glow: 0.15, accent: '#ffb347', eye: '#ffb347', eyeGlow: 1.2 }), 1.0) },
  firefox: { label: 'Fire fox / flame beast', group: 'Monstrosities', size: 'small', build: quad(Q({ c: '#d8542a', c2: '#ffb347', len: 1.15, h: 0.36, girth: 0.2, leg: 0.045, neck: 0.25, head: 0.17, snout: 1.0, ears: 'point', tail: 'bushy', tails: 2, glow: 0.4, accent: '#ffd36b', mane: 'flame', eye: '#ffd36b', eyeGlow: 1.5 }), 0.95) },
  cockatrice: { label: 'Cockatrice', group: 'Monstrosities', size: 'small', flies: true, build: (g) => { fowl(g, { c: '#c8a050', c2: '#e8d4a6', beak: '#e8b030', neck: 0.12, comb: true }); chain(g, curve([0, 0.45, -0.3], [0, 0.15, -0.9], [0, 0.15, 0], 4), 0.07, 0.02, M('#5a7a3a'), 5); return { wings: [wing([0.24, 0.5, 0], 1, 0.6, 'membrane', '#5a7a3a', '#7a9a5a', 0.3), wing([-0.24, 0.5, 0], -1, 0.6, 'membrane', '#5a7a3a', '#7a9a5a', 0.3)], height: 1.0 }; } },
  phoenix: { label: 'Phoenix', group: 'Monstrosities', size: 'large', flies: true, build: (g) => { const w = bird(g, { c: '#ff6a2a', c2: '#ffd36b', beak: '#ffd36b', size: 1.3, crest: true }); g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = M('#ff8a2a', { glow: 0.9 }); }); for (let i = 0; i < 5; i++) spike(g, [(i - 2) * 0.08, 0.65, -0.6], [(i - 2) * 0.2, -0.2, -1], 0.9, 0.08, M('#ffd36b', { glow: 1.4 }), 4); return { wings: w, height: 1.6 }; } },
  thunderbird: { label: 'Thunderbird / storm eagle', group: 'Monstrosities', size: 'huge', flies: true, build: (g) => { const w = bird(g, { c: '#2d4f8f', c2: '#e8e070', beak: '#e8e070', size: 1.3, crest: true }); for (let i = 0; i < 3; i++) put(g, box(0.05, 0.6, 0.05), M('#fff8a0', { glow: 2 }), [Math.sin(i * 2) * 0.5, 1.4 + i * 0.2, -0.2], [0.4, i, 0.6]); return { wings: w, height: 1.6 }; } },
  cerberus: { label: 'Three-headed hound (cerberus)', group: 'Fiends', size: 'large', build: (g) => { const r = quadruped(g, Q({ c: '#3a1a12', c2: '#5a2a1a', len: 1.55, h: 0.5, girth: 0.32, leg: 0.08, tail: 'thin', eye: '#ffcf3a', eyeGlow: 1.4, feet: 'claw', mane: 'flame', accent: '#ff6a2a' })); for (const x of [-1, 1]) { const at: V3 = [x * 0.38, r.headAt[1] - 0.05, r.headAt[2] - 0.12]; limb(g, [x * 0.15, r.back[1] - 0.15, 0.55], at, 0.15, 0.13, M('#3a1a12'), 6); blob(g, 0.2, M('#3a1a12'), at, [0.9, 0.85, 1.05]); limb(g, at, [at[0], at[1] - 0.05, at[2] + 0.35], 0.13, 0.08, M('#3a1a12'), 6); eyes(g, [at[0], at[1] + 0.07, at[2] + 0.14], 0.08, 0.03, '#ffcf3a', 1.4); } return { height: 1.4 }; } },
  chimera: { label: 'Chimera', group: 'Monstrosities', size: 'large', flies: true, build: (g) => { const r = quadruped(g, Q({ c: '#b3742a', len: 1.5, h: 0.45, girth: 0.32, leg: 0.08, neck: 0.25, head: 0.24, snout: 0.45, mane: 'lion', accent: '#6a3a1a', ears: 'round', tail: 'lizard', feet: 'claw' })); const goat: V3 = [0.32, r.back[1] + 0.35, 0.35]; limb(g, [0.15, r.back[1], 0.3], goat, 0.1, 0.09, M('#8a8580')); blob(g, 0.17, M('#8a8580'), goat, [0.9, 0.9, 1.1]); spike(g, [0.35, goat[1] + 0.1, goat[2]], [0.3, 0.7, -0.8], 0.35, 0.05, M('#e8dcc0')); spike(g, [0.25, goat[1] + 0.1, goat[2]], [-0.1, 0.7, -0.8], 0.35, 0.05, M('#e8dcc0')); const dr: V3 = [-0.38, r.back[1] + 0.4, 0.4]; limb(g, [-0.15, r.back[1], 0.3], dr, 0.1, 0.09, M('#a8281e')); blob(g, 0.16, M('#a8281e'), dr, [0.8, 0.8, 1.4]); limb(g, dr, [dr[0], dr[1] - 0.05, dr[2] + 0.3], 0.1, 0.06, M('#a8281e')); eyes(g, [dr[0], dr[1] + 0.06, dr[2] + 0.12], 0.07, 0.025, '#ffcf3a', 1); return { wings: [wing([0.22, r.back[1] - 0.05, 0.05], 1, 1.0, 'membrane', '#7a2a1a', '#a8281e'), wing([-0.22, r.back[1] - 0.05, 0.05], -1, 1.0, 'membrane', '#7a2a1a', '#a8281e')], height: 1.5 }; } },
  // ---------------------------------------------------------------- monsters
  bulette: { label: 'Bulette (land shark)', group: 'Monstrosities', size: 'large', build: (g) => { const r = quadruped(g, Q({ c: '#5a6a7a', c2: '#a8a890', len: 1.5, h: 0.32, girth: 0.45, leg: 0.12, neck: 0.05, head: 0.33, snout: 0.5, ears: 'none', tail: 'stub', feet: 'claw', spikes: 6, accent: '#3a4a5a' })); put(g, cone(0.4, 0.6, 3), M('#3a4a5a'), [0, r.back[1] + 0.25, 0.45], [0, 0, 0], [0.25, 1, 1.2]); for (let i = 0; i < 6; i++) spike(g, [-0.15 + i * 0.06, r.headAt[1] - 0.2, r.headAt[2] + 0.4], [0, -1, 0.3], 0.1, 0.025, M('#f2ecdc'), 3); return { height: 1.2 }; } },
  ankheg: { label: 'Ankheg', group: 'Monstrosities', size: 'large', build: (g) => { arthropod(g, { c: '#8a6a2a', c2: '#4a3a1a', kind: 'beetle', eye: '#141210' }); for (const x of [-1, 1]) spike(g, [x * 0.12, 0.45, 0.8], [-x * 0.6, 0, 1], 0.4, 0.06, M('#2a1a0a'), 4); return { height: 0.95 }; } },
  carrioncrawler: { label: 'Carrion crawler', group: 'Monstrosities', size: 'large', build: (g) => { arthropod(g, { c: '#6a8a5a', c2: '#3a4a2a', kind: 'centipede' }); for (let i = 0; i < 6; i++) chain(g, curve([(i - 2.5) * 0.04, 0.3, 0.9], [(i - 2.5) * 0.18, 0.15, 1.35], [0, 0.15, 0], 3), 0.025, 0.01, M('#c8d0a0'), 4); return { height: 0.5 }; } },
  umberhulk: { label: 'Umber hulk', group: 'Monstrosities', size: 'large', build: (g) => { brute(g, { c: '#3a2a1a', c2: '#5a4a2a', head: 'beast', eye: '#e8e070', eyeGlow: 1 }); for (const x of [-1, 1]) spike(g, [x * 0.1, 1.5, 0.4], [-x * 0.6, -0.3, 1], 0.3, 0.06, M('#1a1210'), 4); return { height: 2.0 }; } },
  roper: { label: 'Roper / piercer', group: 'Monstrosities', size: 'large', build: (g) => { put(g, cone(0.55, 2.0, 7), M('#6a6458'), [0, 1.0, 0]); blob(g, 0.15, M('#e8e070', { glow: 0.8 }), [0, 1.3, 0.38], [1, 1, 0.5], 0); put(g, box(0.35, 0.1, 0.1), M('#3a1010'), [0, 0.9, 0.42]); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; chain(g, curve([Math.cos(a) * 0.3, 1.0, Math.sin(a) * 0.3], [Math.cos(a) * 1.2, 0.2, Math.sin(a) * 1.2], [0, 0.4, 0], 4), 0.04, 0.015, M('#8a847a'), 4); } return { height: 2.0 }; } },
  darkmantle: { label: 'Darkmantle', group: 'Monstrosities', size: 'small', flies: true, build: (g) => { cloaker(g, '#2a2638', true); return { height: 1.6 }; } },
  seaserpent: { label: 'Sea serpent', group: 'Monstrosities', size: 'gargantuan', build: (g) => { serpent(g, { c: '#1f5a7a', c2: '#a8d0d8', r: 0.2, len: 2.0, rise: 1.0 }); for (let i = 0; i < 6; i++) spike(g, [0, 0.95 - i * 0.05, 0.6 - i * 0.18], [0, 1, -0.4], 0.25, 0.06, M('#2d8a8a'), 3); return { height: 1.3 }; } },
  jellyfish: { label: 'Giant jellyfish', group: 'Aberrations', size: 'large', flies: true, build: (g) => { put(g, new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M('#c8a0ff', { opacity: 0.6, glow: 0.5 }), [0, 1.4, 0]); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; chain(g, curve([Math.cos(a) * 0.4, 1.4, Math.sin(a) * 0.4], [Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5], [Math.sin(i) * 0.1, 0, 0], 4), 0.03, 0.01, M('#e0c8ff', { opacity: 0.7, glow: 0.4 }), 4); } return { height: 2.0 }; } },
  kraken: { label: 'Kraken', group: 'Aberrations', size: 'gargantuan', build: (g) => { tentacled(g, 'octopus', '#5a2a3a'); return { height: 1.5 }; } },
  // ---------------------------------------------------------------- aberrations and horrors
  grell: { label: 'Grell', group: 'Aberrations', size: 'medium', flies: true, build: (g) => { brainy(g, 'grell'); return { height: 1.8 }; } },
  devourer: { label: 'Intellect devourer', group: 'Aberrations', size: 'tiny', build: (g) => { brainy(g, 'devourer'); return { height: 0.95 }; } },
  flumph: { label: 'Flumph', group: 'Aberrations', size: 'small', flies: true, build: (g) => { brainy(g, 'flumph'); return { height: 1.8 }; } },
  gazer: { label: 'Gazer / spectator', group: 'Aberrations', size: 'tiny', flies: true, build: (g) => { beholder(g, '#5a3a6a', '#e83a2a'); return { height: 2.2 }; } },
  nothic: { label: 'Nothic', group: 'Aberrations', size: 'medium', build: (g) => { brute(g, { c: '#6a7a6a', c2: '#3a4a3a', head: 'ape' }); blob(g, 0.13, M('#e8e070', { glow: 1.2 }), [0, 1.66, 0.35], [1, 1, 0.5], 0); return { height: 1.8 }; } },
  cloaker: { label: 'Cloaker', group: 'Aberrations', size: 'large', flies: true, build: (g) => { cloaker(g, '#1e1e24'); return { height: 2.0 }; } },
  slaad: { label: 'Slaad (frog fiend)', group: 'Aberrations', size: 'large', build: (g) => { brute(g, { c: '#b3402a', c2: '#e8a050', head: 'beast', eye: '#e8e070' }); put(g, box(0.45, 0.08, 0.2), M('#3a1010'), [0, 1.52, 0.33]); return { height: 2.0 }; } },
  // ---------------------------------------------------------------- plants and fungi
  myconid: { label: 'Myconid / walking mushroom', group: 'Constructs & plants', size: 'medium', build: (g, tint) => { mushroom(g, tint ?? '#b3402a'); return { height: 1.3 }; } },
  glowshroom: { label: 'Glowing mushroom giant', group: 'Constructs & plants', size: 'large', build: (g) => { mushroom(g, '#7ae0d0', 0.9); return { height: 1.3 }; } },
  flytrap: { label: 'Carnivorous plant', group: 'Constructs & plants', size: 'large', build: (g) => { flytrap(g); return { height: 1.9 }; } },
  // ---------------------------------------------------------------- undead beasts and dragons
  bonedragon: { label: 'Bone dragon (dracolich)', group: 'Dragons', size: 'huge', flies: true, build: (g) => ({ wings: dragon(g, { c: '#e8e2cc', c2: '#3a3a4a', horn: '#2a2a2a', kind: 'dragon', eye: '#7ad8ff' }), height: 1.7 }) },
  skelhorse: { label: 'Skeletal steed', group: 'Undead & spirits', size: 'large', mount: true, build: quad(Q({ c: '#e8e2cc', len: 1.55, h: 0.66, girth: 0.2, leg: 0.045, neck: 0.5, neckUp: 1.0, head: 0.17, snout: 1.1, feet: 'hoof', tail: 'thin', ears: 'point', eye: '#7ad8ff', eyeGlow: 1.6, dark: '#3a3632' }), 1.6, true) },
  // ---------------------------------------------------------------- bosses
  worldturtle: { label: 'World turtle (boss)', group: 'Monstrosities', size: 'gargantuan', build: (g) => { turtle(g, { c: '#6a7a5a', shell: '#4a5a3a', world: true }); return { height: 1.1 }; } },
  skywhale: { label: 'Sky whale (boss)', group: 'Monstrosities', size: 'gargantuan', flies: true, build: (g) => { whale(g, '#3a5a8a', true); return { height: 3.4 }; } },
  colossus: { label: 'Obsidian colossus (boss)', group: 'Constructs & plants', size: 'gargantuan', build: (g) => { golem(g, '#1e1c22', '#ff6a2a', true); g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.position.y > 0.8 && m.position.y < 1.4) m.material = M('#ff6a2a', { glow: 0.6 }); }); return { height: 1.9 }; } },

};

const DRAGON: Record<string, { c: string; c2: string; horn: string }> = {
  red: { c: '#a8281e', c2: '#e8a050', horn: '#2a1a14' }, blue: { c: '#2d5a9a', c2: '#a8c8e8', horn: '#e8e4dc' }, green: { c: '#2f6b3a', c2: '#a8c070', horn: '#2a2a1a' },
  black: { c: '#1e1e24', c2: '#4a4a3a', horn: '#d8d0c0' }, white: { c: '#e8eef2', c2: '#b8c8d8', horn: '#7a8a9a' }, gold: { c: '#d8a830', c2: '#f2dc94', horn: '#7a5a1a' },
  silver: { c: '#b8c0c8', c2: '#e8eef2', horn: '#5a6470' }, bronze: { c: '#a06a2a', c2: '#d8b070', horn: '#3a2a1a' }, copper: { c: '#b8642a', c2: '#e8a070', horn: '#2f6b5a' },
  brass: { c: '#c8a050', c2: '#e8d090', horn: '#6a4a2a' }, shadow: { c: '#2a2638', c2: '#4a4458', horn: '#141210' }, fairy: { c: '#a07ad8', c2: '#e0c8ff', horn: '#e8d4a6' },
};
const dragonColours = (tint?: string) => DRAGON[tint ?? 'red'] ?? DRAGON.red;
export const DRAGON_COLOURS = Object.keys(DRAGON);

/**
 * Name / type → model id, tint and variant (null: not a creature model – humanoid figure or the old miniature).
 * APEX 2.3: English and German names and synonyms; young / female words pick a variant; exceptions first (a wolf
 * spider is a spider, a werewolf stays a humanoid figure).
 */
export function creatureFor(text: string): { kind: string; tint?: string; variant?: CreatureVariant } | null {
  const t = ` ${text.toLowerCase().replace(/[-_]/g, ' ')} `;
  if (/\bwere ?(wolf|rat|bear|boar|tiger|wölf)|\bwerwolf|lykanthrop/.test(t)) return null;
  const variant: CreatureVariant | undefined = /\b(cub|pup|puppy|kitten|calf|lamb|foal|fawn|piglet|kid|chick|duckling|hatchling|wyrmling|young|baby|juvenile|welpe|junges|kalb|lamm|fohlen|kitz|ferkel|küken|jung)\b/.test(t) ? 'young'
    : /\b(female|she|lioness|doe|hind|cow|ewe|sow|mare|vixen|hen|weibchen|löwin|hirschkuh|bärin|wölfin|stute|sau|henne|kuh|ricke|fähe)\b/.test(t) ? 'female' : undefined;
  const dragonTint = () => { for (const c of DRAGON_COLOURS) if (t.includes(c)) return c; const de: Record<string, string> = { rot: 'red', blau: 'blue', grün: 'green', schwarz: 'black', weiß: 'white', weiss: 'white', gold: 'gold', silber: 'silver', bronze: 'bronze', kupfer: 'copper', messing: 'brass', schatten: 'shadow', fee: 'fairy' }; for (const [k, v] of Object.entries(de)) if (t.includes(k)) return v; return undefined; };
  const rules: Array<[RegExp, string, (() => string | undefined)?]> = [
    // exceptions and compound names first
    [/wolf spider|phase spider|wolfsspinne|phasenspinne/, 'spider', () => (/phase|phasen/.test(t) ? '#8a6ad8' : undefined)],
    [/dracolich|bone dragon|skeletal dragon|knochendrache|skelettdrache/, 'bonedragon'], [/winter wolf|frost wolf|frostwolf|eiswolf/, 'winterwolf'], [/spectral wolf|ghost wolf|geisterwolf|shadow wolf|schattenwolf/, 'ghostwolf'],
    [/spectral stag|silver stag|ghost stag|geisterhirsch|silberhirsch/, 'spectralstag'], [/displacer/, 'displacer'], [/blink dog|blinkhund/, 'blinkdog'], [/jackalope|wolpertinger/, 'jackalope'], [/moon ?hare|mondhase/, 'moonhare'],
    [/kitsune|nine.?tailed|neunschwänzig/, 'kitsune'], [/fire fox|feuerfuchs|flame fox/, 'firefox'], [/cockatrice/, 'cockatrice'], [/phoenix|phönix/, 'phoenix'], [/thunderbird|donnervogel|storm eagle/, 'thunderbird'],
    [/cerberus|kerberos|three headed (dog|hound)|dreiköpfig/, 'cerberus'], [/chimera|chimäre/, 'chimera'], [/bulette/, 'bulette'], [/ankheg/, 'ankheg'], [/carrion crawler|aaskriecher/, 'carrioncrawler'], [/umber hulk/, 'umberhulk'],
    [/roper|piercer/, 'roper'], [/darkmantle/, 'darkmantle'], [/sea serpent|seeschlange|meeresschlange/, 'seaserpent'], [/jellyfish|qualle/, 'jellyfish'], [/kraken|krake/, 'kraken'],
    [/grell/, 'grell'], [/intellect devourer/, 'devourer'], [/flumph/, 'flumph'], [/gazer|spectator/, 'gazer'], [/nothic/, 'nothic'], [/cloaker/, 'cloaker'], [/slaad/, 'slaad'],
    [/myconid|walking mushroom|wandelnder pilz|pilzwesen/, 'myconid'], [/glowing mushroom|leuchtpilz|pilzkoloss/, 'glowshroom'], [/carnivorous|man ?eating plant|fleischfressend|flytrap/, 'flytrap'],
    [/world turtle|weltenschildkröte|dragon turtle/, 'worldturtle'], [/sky whale|himmelswal|leviathan|\bwhale\b|\bwal\b/, 'skywhale'], [/colossus|koloss|titan/, 'colossus'],
    [/skeletal (horse|steed)|skelettpferd|knochenpferd/, 'skelhorse'],
    [/wyvern|lindwurm/, 'wyvern'], [/\bdrake\b|drache ohne flügel/, 'drake'],
    [/dragon|wyrm|drache|drachen/, 'dragon', dragonTint],
    [/beholder|eye tyrant|betrachter|gauth/, 'beholder'], [/aboleth/, 'aboleth'], [/otyugh|neogi/, 'otyugh'], [/gibbering|mouther/, 'mouther'], [/octopus|squid|oktopus|tintenfisch/, 'octopus'],
    [/owlbear|eulenbär/, 'owlbear'], [/hippogriff|hippogreif/, 'hippogriff'], [/griff|greif/, 'griffon'], [/pegasus/, 'pegasus'], [/unicorn|einhorn/, 'unicorn'], [/nightmare|nachtmahr/, 'nightmare'],
    [/manticore|mantikor/, 'manticore'], [/hydra/, 'hydra'], [/basilisk/, 'basilisk'], [/purple worm|remorhaz|purpurwurm|\bworm\b|sandwurm|wurm\b/, 'worm'], [/mimic|mimik/, 'mimic'], [/rust monster|rostmonster/, 'rustmonster'],
    [/minotaur/, 'minotaur'], [/yeti|abominable/, 'yeti'], [/hell ?hound|barghest|höllenhund/, 'hellhound'],
    [/gelatinous cube|gallertwürfel/, 'cube'], [/ooze|slime|pudding|jelly|schleim/, 'ooze', () => (/black|schwarz/.test(t) ? '#1e1e24' : /ochre|yellow|gelb/.test(t) ? '#c8a030' : /gray|grey|grau/.test(t) ? '#7a7a70' : /red|rot/.test(t) ? '#b3261e' : /blue|blau/.test(t) ? '#2d6fb0' : undefined)],
    [/fire elemental|salamander|magmin|feuerelementar/, 'fire'], [/water elemental|water weird|wasserelementar/, 'water'], [/air elemental|invisible stalker|luftelementar/, 'air'], [/earth elemental|galeb|xorn|erdelementar/, 'earth'], [/will ?o|wisp|irrlicht/, 'wisp'],
    [/gargoyle|gargyl/, 'gargoyle'], [/golem|construct|animated statue|shield guardian|konstrukt/, 'golem', () => (/iron|eisen/.test(t) ? '#5a5f68' : /clay|lehm|ton/.test(t) ? '#a0704a' : /flesh|fleisch/.test(t) ? '#b88a7a' : /crystal|kristall/.test(t) ? '#8ad8ff' : undefined)],
    [/treant|awakened tree|baumhirte|baumwächter/, 'treant'], [/shambling|blight|sumpfhügel/, 'shambling'],
    [/ghost|specter|spectre|wraith|banshee|poltergeist|phantom|\bshade\b|geist|gespenst/, 'ghost', () => (/wraith|specter|spectre|shade|schatten/.test(t) ? '#4a4a5a' : undefined)],
    [/demon|devil|balor|vrock|hezrou|glabrezu|pit fiend|barbed|horned devil|fiend|dämon|teufel/, 'demon'],
    [/warhorse|destrier|charger|schlachtross|kriegspferd/, 'warhorse'], [/donkey|esel/, 'donkey'], [/pony|mule|maultier/, 'pony'], [/horse|stallion|mare|steed|pferd|hengst|stute/, 'horse'], [/camel|kamel|dromedar/, 'camel'], [/llama|alpaca|lama|alpaka/, 'llama'], [/worg|warg|dire wolf|schreckenswolf/, 'wardog'],
    [/\broc\b|giant eagle|riesenadler/, 'roc'], [/wolf|wölf/, 'wolf'], [/hyena|hyäne|gnoll pack/, 'hyena'], [/fox|fuchs/, 'fox'], [/jackal|\bdog\b|hound|mastiff|hund|schakal/, 'dog'],
    [/polar bear|eisbär/, 'polarbear'], [/bear|bär/, 'bear'], [/boar|keiler|wildschwein/, 'boar'], [/\bpig|piglet|sow|schwein|ferkel|\bsau\b/, 'pig'],
    [/elk|deer|stag|moose|antelope|hirsch|reh\b|elch|rentier/, 'deer'], [/billy goat|ziegenbock/, 'billygoat'], [/goat|ziege/, 'goat'], [/sheep|\bram\b|lamb|ewe|schaf|widder|lamm/, 'sheep'],
    [/bison|buffalo|yak|wisent|büffel/, 'bison'], [/\bcow\b|\bcalf\b|cattle|kuh|rind|kalb/, 'cow'], [/\box\b|bull\b|aurochs|ochse|stier/, 'ox'],
    [/rhino|nashorn/, 'rhino'], [/hippo|nilpferd|flusspferd/, 'hippo'], [/giraffe/, 'giraffe'], [/zebra/, 'zebra'],
    [/tiger/, 'tiger'], [/panther|leopard|jaguar|puma|lynx|luchs/, 'panther'], [/lion|sabre|saber|big cat|löwe|lowe\b/, 'cat'], [/house ?cat|kitten|hauskatze|kätzchen|\bkatze\b|\bcat\b/, 'housecat'],
    [/rabbit|hare|bunny|hase|kaninchen/, 'rabbit'], [/squirrel|eichhörnchen/, 'squirrel'], [/hedgehog|igel/, 'hedgehog'], [/badger|dachs|wolverine|vielfraß/, 'badger'],
    [/\brat\b|weasel|ratte|wiesel/, 'rat'], [/crocodile|alligator|krokodil/, 'crocodile'], [/lizard|iguana|echse|waran/, 'lizard'], [/turtle|tortoise|schildkröte/, 'turtle'], [/snail|schnecke/, 'snail'],
    [/mammoth|mammut/, 'mammoth'], [/elephant|elefant/, 'elephant'], [/\bape\b|gorilla|baboon|affe/, 'ape'], [/frog|toad|frosch|kröte/, 'frog'], [/shark|\bhai\b/, 'shark'], [/fish|eel|fisch|\baal\b/, 'fish'],
    [/cobra|viper|asp\b|kobra/, 'cobra'], [/snake|serpent|constrictor|python|naga|schlange/, 'snake'],
    [/spider|ettercap|spinne/, 'spider'], [/scorpion|skorpion/, 'scorpion'], [/centipede|tausendfüß|hundertfüß/, 'centipede'], [/beetle|käfer/, 'beetle'], [/crab|krabbe|hummer/, 'crab'],
    [/butterfly|moth|schmetterling|falter|motte/, 'butterfly'],
    [/chicken|rooster|\bhen\b|huhn|hahn|henne|küken/, 'chicken'], [/duck|goose|ente|gans/, 'duck'], [/swan|schwan/, 'swan'],
    [/eagle|hawk|falcon|bird|blood hawk|adler|falke|habicht|vogel/, 'eagle'], [/owl\b|eule|uhu/, 'owl'], [/raven|crow|rabe|krähe/, 'raven'], [/vulture|buzzard|geier/, 'vulture'], [/\bbat\b|bats\b|fledermaus/, 'bat'],
    // type fallbacks (stat block type)
    [/\bdragon\b/, 'dragon'], [/aberration/, 'mouther'], [/\booze\b/, 'ooze'], [/elemental/, 'earth'], [/construct/, 'golem'], [/\bplant\b/, 'shambling'],
  ];
  for (const [re, kind, tintFn] of rules) if (re.test(t)) { const ti = tintFn?.(); return { kind, ...(ti ? { tint: ti } : {}), ...(variant ? { variant } : {}) }; }
  return null;
}

/** Builds a creature model (merged, wings as separate flapping pivots). */
export function buildCreature(kind: string, tint?: string, airborne = false, variant?: CreatureVariant): CreatureModel | null {
  const spec = CREATURES[kind];
  if (!spec) return null;
  const raw = new THREE.Group();
  const r = spec.build(raw, tint, variant) ?? { height: 1 };
  // young ones are smaller, females a little smaller (the stat block's size class still sets the overall scale)
  const vs = variant === 'young' ? 0.58 : variant === 'female' ? 0.93 : 1;
  if (vs !== 1) { raw.scale.setScalar(vs); r.height *= vs; for (const w of r.wings ?? []) { w.position.multiplyScalar(vs); w.scale.setScalar(vs); } }
  const wingsList = r.wings ?? [];
  for (const w of wingsList) raw.remove(w);
  const group = mergeByMaterial(raw);
  for (const w of wingsList) {
    const merged = mergeByMaterial(w.children[0] ?? w);
    const pivot = new THREE.Group(); pivot.position.copy(w.position); pivot.scale.copy(w.scale); pivot.userData = { ...w.userData, amp: airborne ? (w.userData.amp ?? 0.55) : Math.min(0.15, w.userData.amp ?? 0.15) };
    pivot.add(merged); group.add(pivot);
  }
  const wings = group.children.filter((c) => c.userData.flapZ);
  return { group, height: r.height, wings, size: spec.size, ...(spec.ride ? { ride: spec.ride } : {}), flies: !!spec.flies, ...(r.seat ? { seat: r.seat } : {}) };
}
export const MOUNT_KINDS = Object.entries(CREATURES).filter(([, v]) => v.mount).map(([k]) => k);
