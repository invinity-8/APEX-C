/**
 * APEX 2.2 – sculpted low-poly hair and beards for the figure kit.
 *
 * Hair is built like a hand-carved miniature: a SHELL that follows the head (cut along a real hairline – forehead,
 * temples, over the ears, nape) plus faceted LOCKS: flattened, tapered wedges laid along the surface for fringes,
 * side locks, partings, manes and tails. Every style is a recipe of shell coverage + locks, so they read clearly
 * from the battle-map camera and stay cheap (merged per material afterwards).
 *
 * Head space: centre of the head at the origin, +y up, +z the face, radius `hr`.
 */
import * as THREE from 'three';

export type HeadShape = 'round' | 'square' | 'oval' | 'long' | 'wide' | 'pointed';
/** Scale of the hair shell per head shape, so it hugs the skull. */
const SHAPE: Record<HeadShape, [number, number, number]> = {
  round: [1, 1, 1], square: [1.12, 1.08, 1.06], oval: [0.94, 1.14, 0.98], long: [0.92, 1.14, 0.92], wide: [1.2, 0.94, 1.03], pointed: [0.98, 1.05, 1.02],
};

interface Ctx { head: THREE.Group; hr: number; shape: HeadShape; hair: THREE.Material; dark: THREE.Material; shaved: THREE.Material; tie: THREE.Material; cover: 'none' | 'brim' | 'full' }

/** Where the hair grows on the scalp: a hairline height per direction around the head (y of the unit sphere). */
interface Line { front: number; side: number; back: number; /** only within |x| < strip (mohawk) */ strip?: number; /** only on one side (x > -cut) */ cut?: number; /** bald above this height (tonsure) */ cap?: number }

function shell(c: Ctx, r: number, line: Line, mat = c.hair, puff = 1) {
  const s = SHAPE[c.shape];
  const geo = new THREE.SphereGeometry(c.hr * r, 18, 12).toNonIndexed();
  const pos = geo.attributes.position;
  const keep: number[] = [];
  const v = new THREE.Vector3();
  const covered = (i: number) => {
    v.fromBufferAttribute(pos, i).normalize();
    if (line.strip !== undefined && Math.abs(v.x) > line.strip) return false;
    if (line.cut !== undefined && v.x < -line.cut) return false;
    if (line.cap !== undefined && v.y > line.cap) return false;
    if (c.cover === 'brim' && v.y > 0.28) return false;
    // hairline: forehead in front, over the ears at the sides, the nape at the back
    const ang = Math.atan2(v.x, v.z); // 0 front, ±π back
    const a = Math.abs(ang) / Math.PI; // 0 front … 1 back
    const h = a < 0.5 ? line.front + (line.side - line.front) * (a / 0.5) ** 1.4 : line.side + (line.back - line.side) * ((a - 0.5) / 0.5) ** 0.8;
    return v.y >= h;
  };
  for (let i = 0; i < pos.count; i += 3) if (covered(i) && covered(i + 1) && covered(i + 2)) keep.push(i);
  const out = new Float32Array(keep.length * 9);
  keep.forEach((i, n) => { for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, i + k); out.set([v.x * s[0], (v.y > 0 ? v.y * puff : v.y) * s[1], v.z * s[2]], n * 9 + k * 3); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  c.head.add(m);
  return m;
}

/**
 * A faceted lock: a flattened, tapered wedge from `at` (head space, in head radii) along `dir`, `len` and `w` in head
 * radii; it lies flat against the head (its broad side faces away from the centre).
 */
function lock(c: Ctx, at: [number, number, number], dir: [number, number, number], len: number, w: number, flat = 0.45, mat = c.hair, sides = 4) {
  const hr = c.hr, s = SHAPE[c.shape];
  const geo = new THREE.ConeGeometry(w * hr, len * hr, sides);
  const y = new THREE.Vector3(...dir).normalize();
  const p = new THREE.Vector3(at[0] * hr * s[0], at[1] * hr * s[1], at[2] * hr * s[2]);
  const out = p.clone().normalize();
  let z = out.clone().sub(y.clone().multiplyScalar(out.dot(y)));
  if (z.lengthSq() < 1e-4) z = new THREE.Vector3(0, 0, 1).sub(y.clone().multiplyScalar(y.z));
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const m = new THREE.Mesh(geo, mat);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  m.scale.set(1, 1, flat);
  m.position.copy(p).add(y.clone().multiplyScalar((len * hr) / 2));
  c.head.add(m);
  return m;
}
/** A fringe: locks along the forehead hairline, swept towards `sweep` (−1 left … +1 right). */
function fringe(c: Ctx, n: number, len: number, y = 0.42, sweep = 0.4, w = 0.2) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5; // −0.5 … 0.5
    const a = t * 1.9;
    lock(c, [Math.sin(a) * 1.0, y + 0.3 - Math.abs(t) * 0.15, Math.cos(a) * 0.95], [sweep * 1.1 + Math.sin(a) * 0.5, -0.8, 0.45], len * 0.72 * (1 - Math.abs(t) * 0.3), w);
  }
}
/** Locks hanging down at the sides over the ears / temples. */
function sides(c: Ctx, len: number, w = 0.24, z = 0.1, n = 2) {
  for (const sx of [-1, 1]) for (let i = 0; i < n; i++) lock(c, [sx * 0.98, 0.15, z - i * 0.35], [sx * 0.12, -1, -0.05], len - i * 0.1, w);
}
/** A curtain of long locks down the back. */
function curtain(c: Ctx, len: number, n = 7, spread = 1.6, w = 0.26) {
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    const a = Math.PI + t * spread;
    lock(c, [Math.sin(a) * 1.0, 0.0, Math.cos(a) * 0.95], [Math.sin(a) * 0.15, -1, Math.cos(a) * 0.12], len * (1 - Math.abs(t) * 0.25), w, 0.5);
  }
}
/** Spikes radiating from the crown. */
function spikes(c: Ctx, n: number, len: number, w = 0.2, lift = 0.6, salt = 1) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + salt;
    const r = 0.45 + ((i * 37) % 7) / 20;
    const base: [number, number, number] = [Math.sin(a) * r, Math.sqrt(Math.max(0.05, 1 - r * r)), Math.cos(a) * r];
    lock(c, base, [Math.sin(a) * (1 - lift), lift + 0.2, Math.cos(a) * (1 - lift) - 0.15], len * (0.8 + ((i * 13) % 5) / 10), w, 0.6);
  }
}
/** A ridge of standing locks from the forehead over the crown to the nape (mohawk, crest). */
function ridge(c: Ctx, n: number, len: number, w: number, back = 0.35) {
  for (let i = 0; i < n; i++) {
    const phi = 0.75 - (i / (n - 1)) * 2.3; // front-top … nape
    lock(c, [0, Math.cos(phi) * 0.98, Math.sin(phi) * 0.98], [0, Math.cos(phi) + 0.25, Math.sin(phi) - back], len * (1 - Math.abs(i / (n - 1) - 0.35) * 0.6), w, 0.3);
  }
}
const lump = (c: Ctx, at: [number, number, number], r: number, mat = c.hair) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * c.hr, 0), mat); m.position.set(at[0] * c.hr, at[1] * c.hr, at[2] * c.hr); c.head.add(m); return m; };
const band = (c: Ctx, at: [number, number, number], r: number) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r * c.hr, 0.05 * c.hr, 4, 8), c.tie); m.position.set(at[0] * c.hr, at[1] * c.hr, at[2] * c.hr); m.rotation.x = Math.PI / 2; c.head.add(m); return m; };
/** A tail of segments (ponytail, braid) from `at`, hanging down and slightly back; `beads` adds braid knots. */
function tail(c: Ctx, at: [number, number, number], segs: number, len: number, w: number, beads = false, outward: [number, number] = [0, -0.35]) {
  let p = new THREE.Vector3(...at);
  for (let i = 0; i < segs; i++) {
    const dir = new THREE.Vector3(outward[0] * (1 - i * 0.3), -1, outward[1] * (1 - i * 0.35)).normalize();
    if (beads) lump(c, [p.x, p.y, p.z], w * (1 - i * 0.12));
    else lock(c, [p.x / SHAPE[c.shape][0], p.y / SHAPE[c.shape][1], p.z / SHAPE[c.shape][2]], [dir.x, dir.y, dir.z], len, w * (1 - i * 0.18), 0.85, c.hair, 5);
    p = p.add(dir.multiplyScalar(beads ? w * 1.5 : len * 0.85));
  }
  return p;
}

export const HAIR_STYLES = ['none', 'buzz', 'short', 'messy', 'spiky', 'mohawk', 'bob', 'long', 'ponytail', 'bun', 'topknot', 'braids', 'curly', 'wild', 'sidecut', 'pigtails',
  'slicked', 'undercut', 'afro', 'dreads', 'mullet', 'shaggy', 'flowing', 'tonsure', 'braid', 'crest', 'pageboy', 'swept'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** Builds the hair of a figure into its head group. `cover`: 'brim' under caps/helmets, 'full' under hoods. */
export function buildHair(head: THREE.Group, style: string, hr: number, shape: HeadShape, mats: { hair: THREE.Material; dark: THREE.Material; shaved: THREE.Material; tie: THREE.Material }, cover: 'none' | 'brim' | 'full') {
  const c: Ctx = { head, hr, shape, ...mats, cover };
  const top = cover === 'none';
  const scalp = (r = 1.08, line: Line = { front: 0.42, side: 0.02, back: -0.42 }, puff = 1.04) => { if (cover !== 'full') shell(c, r, line, c.hair, puff); };
  switch (style) {
    case 'none': return;
    case 'buzz': if (cover !== 'full') shell(c, 1.03, { front: 0.5, side: 0.05, back: -0.38 }, c.shaved); return;
    case 'short':
      scalp(1.08, { front: 0.45, side: 0.05, back: -0.4 });
      if (top) { fringe(c, 5, 0.42, 0.42, 0.6); spikes(c, 5, 0.32, 0.2, 0.3, 0.4); }
      sides(c, 0.35, 0.2, 0.25, 1);
      return;
    case 'messy':
      scalp(1.09, { front: 0.4, side: 0.0, back: -0.45 }, 1.06);
      if (top) { spikes(c, 11, 0.45, 0.2, 0.35, 0.9); fringe(c, 4, 0.5, 0.42, -0.3); }
      sides(c, 0.42, 0.2, 0.2);
      return;
    case 'spiky':
      scalp(1.06, { front: 0.48, side: 0.1, back: -0.35 });
      if (top) { spikes(c, 9, 0.75, 0.22, 0.75, 0.2); fringe(c, 3, 0.45, 0.48, 0.2, 0.18); }
      return;
    case 'mohawk':
      if (cover !== 'full') shell(c, 1.02, { front: 0.4, side: 0.05, back: -0.4 }, c.shaved);
      if (top) { shell(c, 1.1, { front: 0.35, side: -0.2, back: -0.5, strip: 0.22 }); ridge(c, 7, 0.85, 0.24); }
      return;
    case 'bob':
      scalp(1.12, { front: 0.38, side: -0.62, back: -0.62 }, 1.04);
      if (top) fringe(c, 7, 0.45, 0.4, 0, 0.2);
      sides(c, 0.75, 0.3, 0.3, 2);
      return;
    case 'pageboy':
      scalp(1.12, { front: 0.3, side: -0.5, back: -0.55 }, 1.02);
      if (top) fringe(c, 8, 0.38, 0.32, 0, 0.17);
      for (let i = 0; i < 9; i++) { const a = Math.PI * 0.48 + (i / 8) * Math.PI * 1.04; lock(c, [Math.sin(a) * 1.05, -0.2, Math.cos(a) * 1.0], [Math.sin(a) * 0.3, -1, Math.cos(a) * 0.3], 0.5, 0.28, 0.5); }
      return;
    case 'long': case 'flowing':
      scalp(1.1, { front: 0.4, side: -0.1, back: -0.5 }, 1.04);
      if (top) style === 'long' ? fringe(c, 5, 0.5, 0.4, 0.5) : (lock(c, [0.15, 0.85, 0.55], [-0.9, -0.5, 0.3], 0.9, 0.3), lock(c, [-0.25, 0.85, 0.5], [0.9, -0.5, 0.3], 0.7, 0.26));
      curtain(c, style === 'flowing' ? 3.0 : 2.4, 8, 2.0);
      for (const sx of [-1, 1]) { lock(c, [sx * 0.95, 0.2, 0.25], [sx * 0.1, -1, 0.15], style === 'flowing' ? 2.4 : 1.9, 0.28, 0.5); lock(c, [sx * 1.0, 0.1, -0.15], [sx * 0.15, -1, 0], 2.1, 0.3, 0.5); }
      return;
    case 'mullet':
      scalp(1.07, { front: 0.45, side: 0.1, back: -0.45 });
      if (top) { spikes(c, 6, 0.35, 0.2, 0.4, 0.3); fringe(c, 4, 0.3, 0.45, 0.2); }
      curtain(c, 1.5, 5, 1.2);
      return;
    case 'shaggy':
      scalp(1.11, { front: 0.32, side: -0.3, back: -0.55 }, 1.06);
      if (top) { fringe(c, 6, 0.6, 0.36, -0.4, 0.22); spikes(c, 8, 0.4, 0.22, 0.25, 1.4); }
      for (let i = 0; i < 9; i++) { const a = Math.PI * 0.4 + (i / 8) * Math.PI * 1.2; lock(c, [Math.sin(a), -0.15, Math.cos(a) * 0.95], [Math.sin(a) * 0.4, -1, Math.cos(a) * 0.35], 0.7 + (i % 3) * 0.15, 0.24, 0.5); }
      return;
    case 'ponytail': {
      scalp(1.06, { front: 0.5, side: 0.05, back: -0.35 });
      if (top) for (let i = 0; i < 4; i++) lock(c, [(i - 1.5) * 0.28, 0.9, 0.4], [0, 0.2, -1], 0.9, 0.2, 0.3);
      band(c, [0, 0.35, -1.05], 0.14);
      tail(c, [0, 0.3, -1.12], 4, 0.55, 0.22);
      return;
    }
    case 'bun':
      scalp(1.06, { front: 0.5, side: 0.05, back: -0.35 });
      if (top) for (let i = 0; i < 4; i++) lock(c, [(i - 1.5) * 0.28, 0.9, 0.4], [0, 0.4, -1], 0.8, 0.2, 0.3);
      lump(c, [0, 0.62, -0.92], 0.38); lump(c, [0.12, 0.7, -1.05], 0.24); band(c, [0, 0.55, -0.82], 0.2);
      return;
    case 'topknot':
      if (cover !== 'full') shell(c, 1.02, { front: 0.45, side: 0.0, back: -0.4 }, c.shaved);
      if (top) { shell(c, 1.06, { front: 0.6, side: 0.55, back: 0.5 }); band(c, [0, 1.12, -0.1], 0.12); lump(c, [0, 1.3, -0.12], 0.25); lock(c, [0, 1.35, -0.15], [0, 0.3, -1], 0.6, 0.18, 0.6); }
      return;
    case 'tonsure':
      if (cover !== 'full') shell(c, 1.06, { front: 0.2, side: -0.1, back: -0.5, cap: 0.62 });
      return;
    case 'crest':
      if (top) { shell(c, 1.08, { front: 0.3, side: -0.1, back: -0.55, strip: 0.35 }); ridge(c, 8, 1.25, 0.32, 0.9); }
      return;
    case 'slicked':
      scalp(1.06, { front: 0.5, side: 0.05, back: -0.4 }, 1.02);
      if (top) for (let i = 0; i < 6; i++) lock(c, [(i - 2.5) * 0.24, 0.85, 0.48], [0, 0.15, -1], 1.15, 0.2, 0.25);
      return;
    case 'swept':
      scalp(1.08, { front: 0.44, side: 0.0, back: -0.42 });
      if (top) { for (let i = 0; i < 5; i++) lock(c, [-0.55 + i * 0.25, 0.85 - i * 0.04, 0.5], [1, -0.25, 0.2], 0.95 - i * 0.08, 0.22, 0.35); lock(c, [0.5, 0.5, 0.85], [0.4, -1, 0.3], 0.7, 0.24); }
      sides(c, 0.35, 0.2, 0.2, 1);
      return;
    case 'undercut':
      if (cover !== 'full') shell(c, 1.02, { front: 0.4, side: 0.0, back: -0.4 }, c.shaved);
      if (top) { shell(c, 1.1, { front: 0.35, side: 0.4, back: 0.3 }, c.hair, 1.08); for (let i = 0; i < 5; i++) lock(c, [-0.5 + i * 0.25, 0.9, 0.4], [-0.7, 0.1, -0.6], 0.9, 0.22, 0.3); lock(c, [0.3, 0.6, 0.85], [-0.6, -0.8, 0.3], 0.7, 0.25); }
      return;
    case 'sidecut':
      if (cover !== 'full') shell(c, 1.02, { front: 0.4, side: 0.0, back: -0.4 }, c.shaved);
      if (top) { shell(c, 1.1, { front: 0.38, side: -0.35, back: -0.5, cut: 0.15 }); for (let i = 0; i < 4; i++) lock(c, [0.1 + i * 0.2, 0.75, 0.62], [0.55, -1, 0.35], 1.0 - i * 0.1, 0.24); }
      for (let i = 0; i < 3; i++) lock(c, [1.0, -0.05, 0.2 - i * 0.4], [0.1, -1, 0], 0.9, 0.28);
      return;
    case 'curly': case 'afro': {
      const big = style === 'afro';
      scalp(big ? 1.25 : 1.12, { front: 0.38, side: -0.1, back: -0.48 }, big ? 1.15 : 1.05);
      if (cover === 'full') return;
      const n = big ? 26 : 16, rad = big ? 1.3 : 1.12;
      for (let i = 0; i < n; i++) {
        const y = 1 - (i + 0.5) / n * (big ? 1.25 : 1.05), r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996;
        const p: [number, number, number] = [Math.sin(a) * r * rad, y * rad * (big ? 1.12 : 1.04), Math.cos(a) * r * rad];
        if (p[2] > 0.55 * rad && p[1] < 0.35 * rad) continue; // keep the face free
        if (c.cover === 'brim' && p[1] > 0.3 * rad) continue;
        lump(c, p, big ? 0.34 : 0.26);
      }
      return;
    }
    case 'dreads':
      scalp(1.08, { front: 0.42, side: 0.0, back: -0.45 });
      if (cover === 'full') return;
      for (let i = 0; i < 12; i++) { const a = Math.PI * 0.45 + (i / 11) * Math.PI * 1.1; tail(c, [Math.sin(a) * 1.0, 0.3 - (i % 2) * 0.15, Math.cos(a) * 0.98], 3, 0.55, 0.13, false, [Math.sin(a) * 0.2, Math.cos(a) * 0.2]); }
      return;
    case 'wild':
      scalp(1.12, { front: 0.36, side: -0.3, back: -0.6 }, 1.08);
      if (top) spikes(c, 12, 0.7, 0.26, 0.1, 0.5);
      for (let i = 0; i < 12; i++) { const a = Math.PI * 0.35 + (i / 11) * Math.PI * 1.3; lock(c, [Math.sin(a) * 1.05, 0.1 - (i % 3) * 0.12, Math.cos(a)], [Math.sin(a) * 0.9, -0.7, Math.cos(a) * 0.7], 0.95 + (i % 4) * 0.15, 0.3, 0.5); }
      return;
    case 'braids': case 'braid': case 'pigtails':
      scalp(1.07, { front: 0.48, side: 0.0, back: -0.4 });
      if (top) { fringe(c, 3, 0.25, 0.48, 0, 0.18); for (let i = 0; i < 4; i++) lock(c, [(i - 1.5) * 0.25, 0.92, 0.35], [0, 0.2, -1], 0.8, 0.18, 0.3); }
      if (style === 'braid') { band(c, [0, -0.15, -1.0], 0.13); tail(c, [0, -0.2, -1.02], 6, 0, 0.16, true, [0, -0.2]); }
      else if (style === 'braids') for (const sx of [-1, 1]) { const end = tail(c, [sx * 0.9, -0.1, -0.25], 6, 0, 0.15, true, [sx * 0.05, 0.25]); band(c, [end.x, end.y + 0.1, end.z], 0.1); lock(c, [end.x, end.y, end.z], [0, -1, 0], 0.3, 0.13, 0.7); }
      else for (const sx of [-1, 1]) { band(c, [sx * 0.95, 0.45, -0.35], 0.12); lock(c, [sx * 1.0, 0.45, -0.38], [sx * 0.8, -0.6, -0.2], 0.95, 0.3, 0.6); lock(c, [sx * 1.0, 0.45, -0.38], [sx * 0.5, -0.9, 0.0], 0.8, 0.25, 0.6); }
      return;
  }
}

export interface BeardMats { hair: THREE.Material; skinMix: THREE.Material; gold: THREE.Material }
/** Beards: a jaw shell for full beards, sculpted locks for long/forked/braided, moustaches as curved locks. */
export function buildBeard(head: THREE.Group, style: string, hr: number, shape: HeadShape, faceZ: number, m: BeardMats) {
  const c: Ctx = { head, hr, shape, hair: m.hair, dark: m.hair, shaved: m.skinMix, tie: m.gold, cover: 'none' };
  const jaw = (r: number, mat = m.hair) => {
    // the lower face from ear to ear: the hairline inverted (grows BELOW a line that rises at the sides)
    const s = SHAPE[shape];
    const geo = new THREE.SphereGeometry(hr * r, 16, 12).toNonIndexed();
    const pos = geo.attributes.position, v = new THREE.Vector3(), keep: number[] = [];
    const ok = (i: number) => { v.fromBufferAttribute(pos, i).normalize(); return v.z > -0.35 && v.y < -0.12 && !(v.z > 0.75 && v.y > -0.42 && Math.abs(v.x) < 0.25); };
    for (let i = 0; i < pos.count; i += 3) if (ok(i) && ok(i + 1) && ok(i + 2)) keep.push(i);
    const out = new Float32Array(keep.length * 9);
    keep.forEach((i, n) => { for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, i + k); out.set([v.x * s[0], v.y * s[1] * 1.08, v.z * s[2] * 1.05], n * 9 + k * 3); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(out, 3)); g.computeVertexNormals();
    head.add(new THREE.Mesh(g, mat));
  };
  const moustache = (curl = false) => { for (const sx of [-1, 1]) { lock(c, [sx * 0.06, -0.28, faceZ / hr + 0.04], [sx * 1, -0.35, 0], curl ? 0.45 : 0.38, 0.12, 0.5); if (curl) lock(c, [sx * 0.42, -0.42, faceZ / hr - 0.05], [sx * 0.2, 1, -0.2], 0.22, 0.07, 0.6); } };
  switch (style) {
    case 'none': return;
    case 'stubble': jaw(1.01, m.skinMix); return;
    case 'moustache': moustache(); return;
    case 'handlebar': moustache(true); return;
    case 'goatee': moustache(); lock(c, [0, -0.72, faceZ / hr - 0.15], [0, -1, 0.2], 0.45, 0.17, 0.7); return;
    case 'chin': lock(c, [0, -0.7, faceZ / hr - 0.2], [0, -1, 0.35], 0.35, 0.28, 0.6); return;
    case 'mutton': for (const sx of [-1, 1]) lock(c, [sx * 0.88, 0.0, 0.35], [sx * 0.1, -1, 0.3], 0.75, 0.26, 0.4); return;
    case 'full': case 'long': case 'forked': case 'braided':
      jaw(1.06); moustache();
      if (style === 'full') for (let i = 0; i < 5; i++) { const a = (i / 4 - 0.5) * 1.6; lock(c, [Math.sin(a) * 0.75, -0.78, Math.cos(a) * 0.62], [Math.sin(a) * 0.3, -1, 0.35], 0.4, 0.2, 0.55); }
      if (style === 'long') for (let i = 0; i < 5; i++) { const a = (i / 4 - 0.5) * 1.4; lock(c, [Math.sin(a) * 0.72, -0.55, Math.cos(a) * 0.72], [Math.sin(a) * 0.12, -1, 0.15], 1.55 - Math.abs(i - 2) * 0.22, 0.26, 0.6); }
      if (style === 'forked') for (const sx of [-1, 1]) lock(c, [sx * 0.24, -0.6, 0.72], [sx * 0.3, -1, 0.15], 1.25, 0.26, 0.6);
      if (style === 'braided') { const end = tail(c, [0, -0.88, 0.65], 4, 0, 0.17, true, [0, 0.3]); band(c, [end.x, end.y + 0.12, end.z], 0.14); }
      return;
  }
}
