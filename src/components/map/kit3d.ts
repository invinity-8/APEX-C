/**
 * APEX 2.10 – the 3D building kit: smooth, composable, scalable parts every creature (and the humanoid figures) is
 * assembled from. One consistent look – soft shading, rounded forms, tapered limbs – instead of boxes and sticks.
 *
 *  - `loft`: the workhorse – a smooth tube along a curve with an elliptical cross-section whose radii follow a profile.
 *    Bodies, necks, tails, limbs, horns, claws, tentacles, snakes and feathers are all lofts.
 *  - `ellipsoid`, `part`: rounded volumes (heads, muscles, pads, eyes, bellies).
 *  - Limbs and ends: `limb` (jointed, with muscle swell), `hand` (palm, fingers, thumb, claws), `paw`, `hoof`,
 *    `talonFoot`, `claw`, `horn` (curved, spiral), `tusk`.
 *  - Heads: `ear` (pointed, round, floppy, long, fin), `eye` (sclera, iris, slit or round pupil, highlight, glow),
 *    `tuftRing` (manes, ruffs, crests), `teeth`.
 *  - Appendages: `tail`, `tentacle`, `spikeRow`, wings `featherWing`, `membraneWing`, `insectWing` (flapping pivots).
 *  - Materials: `skin(colour, options)` – cached; colours, stripes, spots and scale sheen come on top through the coat
 *    shader (coat3d.ts), which reads the model-space position, so every kit part takes patterns.
 *
 * Conventions: metres-ish units, +y up, +z forward, x to the creature's left/right; parts are added to a parent group.
 */
import * as THREE from 'three';
import { withSurface, type Surface } from './surface3d';

export type V3 = [number, number, number];
const vec = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

// ---------------------------------------------------------------- materials
export interface SkinOpts { rough?: number; metal?: number; glow?: number; glowColor?: string; opacity?: number; side?: boolean; flat?: boolean;
  /** APEX 2.11 – a procedural material on top (cloth, leather, metal, scales, fur …), see surface3d.ts. */
  surface?: Surface; surfaceScale?: number }
const mats = new Map<string, THREE.MeshStandardMaterial>();
/** A cached material: soft by default, `flat` for rock and crystal, `glow` for eyes, fire and magic. */
export function skin(color: THREE.ColorRepresentation, o: SkinOpts = {}): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}|${JSON.stringify(o)}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: c, roughness: o.rough ?? 0.72, metalness: o.metal ?? 0, flatShading: !!o.flat,
      ...(o.glow ? { emissive: new THREE.Color(o.glowColor ?? color), emissiveIntensity: o.glow } : {}),
      ...(o.side ? { side: THREE.DoubleSide } : {}),
      ...(o.opacity !== undefined ? { transparent: true, opacity: o.opacity, depthWrite: o.opacity > 0.6 } : {}),
    });
    if (o.surface && o.surface !== 'smooth') withSurface(m, o.surface, o.surfaceScale ?? 1);
    mats.set(key, m);
  }
  return m;
}
export const tone = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
export const mixHex = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

// ---------------------------------------------------------------- placing
export function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], sc: V3 | number = 1): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...pos); o.rotation.set(...rot);
  if (typeof sc === 'number') o.scale.setScalar(sc); else o.scale.set(...sc);
  o.castShadow = true; o.receiveShadow = true;
  parent.add(o);
  return o;
}
/** A smooth ellipsoid geometry. */
export const ellipsoid = (rx: number, ry: number, rz: number, w = 18, h = 12) => { const g = new THREE.SphereGeometry(1, w, h); g.scale(rx, ry, rz); return g; };
/** Adds an ellipsoid at `pos`, optionally turned to point its z axis along `dir`. */
export function blob(parent: THREE.Object3D, r: V3, m: THREE.Material, pos: V3, dir?: V3, detail = 1): THREE.Mesh {
  const o = part(parent, ellipsoid(r[0], r[1], r[2], Math.round(13 * detail), Math.round(9 * detail)), m, pos);
  if (dir) o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vec(dir).normalize());
  return o;
}

// ---------------------------------------------------------------- loft
export type Radius = number | [number, number];
export interface LoftOpts {
  /** Points around the cross-section. */
  sides?: number;
  /** Rings along the curve. */
  steps?: number;
  /** Close the ends with a rounded cap (default: when the radius there is not ~0). */
  capStart?: boolean;
  capEnd?: boolean;
  /** Hint for which way is "up" for the cross-section's second radius (default world up, or +z on vertical curves). */
  up?: V3;
  /** Straight segments instead of a smooth curve through the points. */
  linear?: boolean;
}
/**
 * A smooth tube along the points; `radius(t)` (t = 0 … 1 along the curve) gives the cross-section radius, a pair is
 * [side, up] for flattened sections. Parallel-transported frames (no twisting), smooth normals, rounded caps.
 */
export function loft(points: V3[], radius: (t: number) => Radius, o: LoftOpts = {}): THREE.BufferGeometry {
  const sides = o.sides ?? 12, steps = o.steps ?? Math.max(8, points.length * 6);
  const curve: THREE.Curve<THREE.Vector3> = o.linear || points.length === 2 ? new THREE.CurvePath<THREE.Vector3>() : new THREE.CatmullRomCurve3(points.map(vec), false, 'centripetal', 0.5);
  if (o.linear || points.length === 2) for (let i = 0; i < points.length - 1; i++) (curve as THREE.CurvePath<THREE.Vector3>).add(new THREE.LineCurve3(vec(points[i]), vec(points[i + 1])));
  const P: THREE.Vector3[] = [], T: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps; P.push(curve.getPointAt(t)); T.push(curve.getTangentAt(t).normalize()); }
  // initial frame from the up hint, then parallel transport
  const hint = o.up ? vec(o.up) : Math.abs(T[0].y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  let N = hint.clone().sub(T[0].clone().multiplyScalar(hint.dot(T[0]))).normalize();
  const frames: Array<{ n: THREE.Vector3; b: THREE.Vector3 }> = [];
  for (let i = 0; i <= steps; i++) {
    if (i > 0) { const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]); N = N.clone().applyQuaternion(q).normalize(); }
    frames.push({ n: N.clone(), b: new THREE.Vector3().crossVectors(T[i], N).normalize() });
  }
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const rad = (t: number): [number, number] => { const r = radius(t); return typeof r === 'number' ? [r, r] : r; };
  for (let i = 0; i <= steps; i++) {
    const [rs, ru] = rad(i / steps);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const p = P[i].clone().addScaledVector(frames[i].b, Math.cos(a) * rs).addScaledVector(frames[i].n, Math.sin(a) * ru);
      pos.push(p.x, p.y, p.z); uv.push(j / sides, i / steps);
    }
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + ((j + 1) % sides), c = (i + 1) * sides + j, d = (i + 1) * sides + ((j + 1) % sides);
    idx.push(a, c, b, b, c, d);
  }
  // rounded caps: a small dome of rings shrinking to a point
  const cap = (end: boolean) => {
    const i = end ? steps : 0, dir = T[i].clone().multiplyScalar(end ? 1 : -1);
    const [rs, ru] = rad(end ? 1 : 0);
    if (Math.max(rs, ru) < 1e-4) return;
    const rings = 3, base = end ? steps * sides : 0;
    let prev = Array.from({ length: sides }, (_, j) => base + j);
    for (let k = 1; k <= rings; k++) {
      const f = Math.cos((k / (rings + 1)) * Math.PI / 2), out = Math.sin((k / (rings + 1)) * Math.PI / 2) * Math.min(rs, ru) * 0.8;
      const ringStart = pos.length / 3;
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const p = P[i].clone().addScaledVector(dir, out).addScaledVector(frames[i].b, Math.cos(a) * rs * f).addScaledVector(frames[i].n, Math.sin(a) * ru * f);
        pos.push(p.x, p.y, p.z); uv.push(j / sides, end ? 1 : 0);
      }
      const ring = Array.from({ length: sides }, (_, j) => ringStart + j);
      for (let j = 0; j < sides; j++) { const a = prev[j], b = prev[(j + 1) % sides], c = ring[j], d = ring[(j + 1) % sides]; if (end) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
      prev = ring;
    }
    const tip = pos.length / 3; const p = P[i].clone().addScaledVector(dir, Math.min(rs, ru) * 0.8);
    pos.push(p.x, p.y, p.z); uv.push(0.5, end ? 1 : 0);
    for (let j = 0; j < sides; j++) { const a = prev[j], b = prev[(j + 1) % sides]; if (end) idx.push(a, tip, b); else idx.push(a, b, tip); }
  };
  if (o.capStart ?? true) cap(false);
  if (o.capEnd ?? true) cap(true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Linear interpolation through a list of radii (t = 0 … 1). */
export const profile = (rs: number[]) => (t: number) => { const x = t * (rs.length - 1), i = Math.min(rs.length - 2, Math.floor(x)); return rs[i] + (rs[i + 1] - rs[i]) * (x - i); };
/** A smooth profile through radii pairs (elliptical sections). */
export const profile2 = (rs: Array<[number, number]>) => (t: number): [number, number] => { const x = t * (rs.length - 1), i = Math.min(rs.length - 2, Math.floor(x)), f = x - i, s = f * f * (3 - 2 * f); return [rs[i][0] + (rs[i + 1][0] - rs[i][0]) * s, rs[i][1] + (rs[i + 1][1] - rs[i][1]) * s]; };
export function tube(parent: THREE.Object3D, points: V3[], radius: (t: number) => Radius, m: THREE.Material, o: LoftOpts = {}): THREE.Mesh {
  return part(parent, loft(points, radius, o), m);
}

// ---------------------------------------------------------------- limbs and ends
/**
 * A jointed limb through `joints` (shoulder → elbow → wrist …) with radii at each joint and a muscle swell on the
 * upper segments (`swell` 0 … 0.4).
 */
export function limb(parent: THREE.Object3D, joints: V3[], radii: number[], m: THREE.Material, swell = 0.18, sides = 10): THREE.Mesh {
  const n = joints.length - 1;
  const r = (t: number) => { const x = t * n, i = Math.min(n - 1, Math.floor(x)), f = x - i; const base = radii[i] + (radii[i + 1] - radii[i]) * f; return base * (1 + (i < n - 1 ? swell : swell * 0.4) * Math.sin(Math.PI * f) ** 1.5); };
  return tube(parent, joints, r, m, { sides, steps: n * 6 });
}
/** A curved, tapering claw / talon / nail from `base` along `dir`, bending down by `bend`. */
export function claw(parent: THREE.Object3D, base: V3, dir: V3, len: number, r: number, m: THREE.Material, bend = 0.45): THREE.Mesh {
  const d = vec(dir).normalize(), b = vec(base);
  const down = new THREE.Vector3(0, -1, 0).sub(d.clone().multiplyScalar(-d.y)).normalize();
  const mid = b.clone().addScaledVector(d, len * 0.55).addScaledVector(down, len * bend * 0.15);
  const tip = b.clone().addScaledVector(d, len * 0.95).addScaledVector(down, len * bend * 0.55);
  return tube(parent, [base, mid.toArray() as V3, tip.toArray() as V3], (t) => r * (1 - t) ** 0.8 + 0.002, m, { sides: 5, steps: 5, capEnd: false });
}
/** A horn: an arc from `base` along `dir`, curling by `curl` radians around `axis`; `spiral` adds a twist outwards. */
export function horn(parent: THREE.Object3D, base: V3, dir: V3, len: number, r: number, m: THREE.Material, o: { curl?: number; axis?: V3; spiral?: number; ridges?: boolean } = {}): THREE.Mesh {
  const b = vec(base); let d = vec(dir).normalize();
  const axis = vec(o.axis ?? [1, 0, 0]).normalize(), n = 10, seg = len / n, pts: V3[] = [base];
  let p = b.clone();
  for (let i = 1; i <= n; i++) {
    d = d.applyAxisAngle(axis, (o.curl ?? 0) / n);
    if (o.spiral) d = d.applyAxisAngle(new THREE.Vector3(0, 1, 0), o.spiral / n);
    p = p.clone().addScaledVector(d, seg); pts.push(p.toArray() as V3);
  }
  return tube(parent, pts, (t) => r * (1 - t * 0.92) * (o.ridges ? 1 + 0.08 * Math.sin(t * 40) : 1), m, { sides: 9, steps: 30, capEnd: false });
}
export const tusk = (parent: THREE.Object3D, base: V3, dir: V3, len: number, r: number, m: THREE.Material) => horn(parent, base, dir, len, r, m, { curl: -0.9, axis: [1, 0, 0] });

/** A paw: a soft pad with toe beans in front and short claws. `x` mirrors left/right. */
export function paw(parent: THREE.Object3D, at: V3, size: number, m: THREE.Material, o: { claws?: THREE.Material; toes?: number; pad?: THREE.Material; long?: number } = {}): void {
  const [x, y, z] = at, toes = o.toes ?? 4, L = o.long ?? 1;
  blob(parent, [size * 0.62, size * 0.36, size * 0.75 * L], m, [x, y + size * 0.3, z + size * 0.1]);
  for (let i = 0; i < toes; i++) {
    const a = (i - (toes - 1) / 2) * 0.42;
    const tx = x + Math.sin(a) * size * 0.45, tz = z + size * (0.55 * L + Math.cos(a) * 0.18);
    blob(parent, [size * 0.2, size * 0.2, size * 0.26], m, [tx, y + size * 0.2, tz]);
    if (o.claws) claw(parent, [tx, y + size * 0.26, tz + size * 0.18], [Math.sin(a) * 0.3, -0.2, 1], size * 0.32, size * 0.07, o.claws, 0.6);
  }
}
/** A hoof: a rounded, slightly flared cup. */
export function hoof(parent: THREE.Object3D, at: V3, size: number, m: THREE.Material, split = false): void {
  const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(size * 0.52, 0), new THREE.Vector2(size * 0.5, size * 0.12), new THREE.Vector2(size * 0.42, size * 0.42), new THREE.Vector2(size * 0.36, size * 0.5), new THREE.Vector2(0, size * 0.5)];
  const g = new THREE.LatheGeometry(prof, 14); g.scale(1, 1, 1.15);
  part(parent, g, m, [at[0], at[1], at[2] + size * 0.05]);
  if (split) part(parent, new THREE.BoxGeometry(size * 0.06, size * 0.4, size * 0.5), skin('#1a1612'), [at[0], at[1] + size * 0.2, at[2] + size * 0.32]);
}
/** A bird's / lizard's foot: three toes forward, one back, each with a talon. */
export function talonFoot(parent: THREE.Object3D, at: V3, size: number, m: THREE.Material, talon: THREE.Material, spread = 0.55): void {
  const [x, y, z] = at;
  for (const a of [-spread, 0, spread, Math.PI]) {
    const dx = Math.sin(a), dz = Math.cos(a), l = a === Math.PI ? 0.55 : 1;
    const tip: V3 = [x + dx * size * l, y + size * 0.05, z + dz * size * l];
    tube(parent, [[x, y + size * 0.12, z], [x + dx * size * l * 0.5, y + size * 0.1, z + dz * size * l * 0.5], tip], (t) => size * 0.12 * (1 - t * 0.5), m, { sides: 5, steps: 4 });
    claw(parent, tip, [dx, -0.3, dz], size * 0.35, size * 0.06, talon, 0.8);
  }
}
/**
 * A hand at `wrist`, pointing along `dir` with the palm facing `palm`: a soft palm, `fingers` jointed fingers that
 * curl by `curl` (0 open … 1 fist), a thumb, optional claws.
 */
export function hand(parent: THREE.Object3D, wrist: V3, dir: V3, palm: V3, size: number, m: THREE.Material, o: { fingers?: number; curl?: number; claws?: THREE.Material; thick?: number; long?: number } = {}): THREE.Group {
  const g = new THREE.Group(); g.position.set(...wrist); parent.add(g);
  const d = vec(dir).normalize(), pn = vec(palm).normalize();
  // local frame: z along the fingers, y out of the back of the hand, x across the knuckles
  const zx = d, yx = pn.clone().multiplyScalar(-1).sub(zx.clone().multiplyScalar(-pn.dot(zx))).normalize(), xx = new THREE.Vector3().crossVectors(yx, zx).normalize();
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, yx, zx));
  const n = o.fingers ?? 4, curl = o.curl ?? 0.35, th = o.thick ?? 1, L = o.long ?? 1;
  blob(g, [size * 0.42, size * 0.16 * th, size * 0.42], m, [0, 0, size * 0.32]);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * size * (0.7 / Math.max(1, n - 1)) * (n > 1 ? 1 : 0);
    const fl = size * (0.36 + (i === 0 || i === n - 1 ? -0.05 : 0.04)) * L;
    const k: V3 = [x, 0, size * 0.66];
    const a1 = curl * 0.9, a2 = curl * 1.6;
    const j1: V3 = [x, -Math.sin(a1) * fl * 0.5, k[2] + Math.cos(a1) * fl * 0.5];
    const j2: V3 = [x, j1[1] - Math.sin(a2) * fl * 0.5, j1[2] + Math.cos(a2) * fl * 0.5];
    tube(g, [k, j1, j2], (t) => size * 0.1 * th * (1 - t * 0.35), m, { sides: 6, steps: 5 });
    if (o.claws) claw(g, j2, [0, -Math.sin(a2), Math.cos(a2)], size * 0.28, size * 0.055, o.claws, 0.7);
  }
  // the thumb, from the side of the palm across towards the fingers
  const tb: V3 = [size * 0.36, -size * 0.04, size * 0.18];
  tube(g, [tb, [size * 0.5, -size * 0.1, size * 0.38], [size * 0.42, -size * 0.18 - curl * size * 0.1, size * 0.58]], (t) => size * 0.11 * th * (1 - t * 0.3), m, { sides: 7, steps: 8 });
  return g;
}

// ---------------------------------------------------------------- heads
/** An ear from `base`, pointing along `dir` (outwards / up), flat facing `face`; `inner` colours the inside. */
export function ear(parent: THREE.Object3D, base: V3, dir: V3, size: number, m: THREE.Material, kind: 'pointed' | 'round' | 'floppy' | 'long' | 'fin' | 'small' = 'pointed', inner?: THREE.Material): void {
  const b = vec(base), d = vec(dir).normalize();
  const droop = kind === 'floppy' ? new THREE.Vector3(0, -1, 0.2) : d;
  const len = size * (kind === 'long' ? 2.6 : kind === 'small' ? 0.6 : kind === 'round' ? 0.85 : 1.15);
  const mid = b.clone().addScaledVector(d, len * 0.5), tip = kind === 'floppy' ? mid.clone().addScaledVector(droop.normalize(), len * 0.7) : b.clone().addScaledVector(d, len);
  const w = (t: number) => size * (kind === 'round' ? 0.5 * Math.sqrt(Math.max(0, 1 - (t * 1.1 - 0.15) ** 2)) + 0.05 : kind === 'fin' ? 0.55 * (1 - t) : 0.42 * (1 - t) ** (kind === 'long' ? 0.5 : 0.9) + 0.02);
  const pts: V3[] = [b.toArray() as V3, mid.toArray() as V3, tip.toArray() as V3];
  tube(parent, pts, (t) => [w(t), w(t) * 0.22], m, { sides: 10, steps: 10, capEnd: kind === 'round' });
  if (inner) tube(parent, pts.map((p) => [p[0], p[1], p[2] + size * 0.05] as V3), (t) => [w(t) * 0.62, w(t) * 0.1], inner, { sides: 8, steps: 10, capEnd: false });
}
/** An eye: dark glossy bead (beasts) or sclera + iris + pupil (round or slit), a highlight; `glow` for monsters. */
export function eye(parent: THREE.Object3D, at: V3, r: number, o: { iris?: string; pupil?: 'round' | 'slit' | 'goat'; sclera?: string; glow?: number; look?: V3 } = {}): void {
  const g = new THREE.Group(); g.position.set(...at); parent.add(g);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vec(o.look ?? [0, 0, 1]).normalize());
  if (!o.iris) { part(g, ellipsoid(r, r, r, 10, 7), skin(o.glow ? '#ffcf5a' : '#0e0b09', o.glow ? { glow: o.glow, rough: 0.2 } : { rough: 0.12, metal: 0.1 })); }
  else {
    part(g, ellipsoid(r, r, r, 11, 8), skin(o.sclera ?? '#f2ece0', { rough: 0.3 }));
    part(g, ellipsoid(r * 0.72, r * 0.72, r * 0.3, 10, 6), skin(o.iris, o.glow ? { glow: o.glow, rough: 0.25 } : { rough: 0.25 }), [0, 0, r * 0.78]);
    const pupil = o.pupil === 'slit' ? [r * 0.12, r * 0.6] : o.pupil === 'goat' ? [r * 0.55, r * 0.14] : [r * 0.34, r * 0.34];
    part(g, ellipsoid(pupil[0], pupil[1], r * 0.1, 8, 5), skin('#080606', { rough: 0.1 }), [0, 0, r * 0.98]);
  }
  part(g, ellipsoid(r * 0.2, r * 0.2, r * 0.1, 6, 4), skin('#ffffff', { glow: 0.6, rough: 0.1 }), [r * 0.3, r * 0.32, r * 0.92]);
}
/** A ring of tufts (lion's mane, ruff, crest): cones on a ring around `centre` facing `dir`, pointing outwards. */
export function tuftRing(parent: THREE.Object3D, centre: V3, dir: V3, radius: number, count: number, len: number, m: THREE.Material, o: { back?: number; thick?: number; rows?: number } = {}): void {
  const c = vec(centre), d = vec(dir).normalize();
  const u = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3().crossVectors(d, u).normalize(), b = new THREE.Vector3().crossVectors(a, d).normalize();
  for (let row = 0; row < (o.rows ?? 2); row++) for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + row * 0.4;
    const out = a.clone().multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
    const base = c.clone().addScaledVector(out, radius * (0.85 - row * 0.15)).addScaledVector(d, -row * len * 0.35);
    const tip = base.clone().addScaledVector(out, len * (1 - row * 0.15)).addScaledVector(d, -(o.back ?? 0.5) * len);
    tube(parent, [base.toArray() as V3, base.clone().lerp(tip, 0.5).addScaledVector(out, len * 0.1).toArray() as V3, tip.toArray() as V3], (t) => len * 0.28 * (o.thick ?? 1) * (1 - t) + 0.003, m, { sides: 5, steps: 4, capEnd: false });
  }
}
/** A row of small teeth along a line. */
export function teeth(parent: THREE.Object3D, from: V3, to: V3, count: number, size: number, m: THREE.Material, down = true): void {
  const a = vec(from), b = vec(to);
  for (let i = 0; i < count; i++) { const p = a.clone().lerp(b, count > 1 ? i / (count - 1) : 0.5); part(parent, new THREE.ConeGeometry(size * 0.35, size, 5), m, p.toArray() as V3, [down ? Math.PI : 0, 0, 0]); }
}

// ---------------------------------------------------------------- appendages
/** A tail along points, tapering; `tuft` (lion), `bushy` (fox), `club`, `sting`, `fluke` at the end. */
export function tail(parent: THREE.Object3D, points: V3[], r0: number, m: THREE.Material, o: { end?: 'tuft' | 'bushy' | 'club' | 'sting' | 'fluke' | 'spade'; endM?: THREE.Material; r1?: number } = {}): void {
  const bushy = o.end === 'bushy';
  tube(parent, points, (t) => (bushy ? r0 * (0.8 + Math.sin(t * Math.PI) * 1.4) * (1 - t * 0.6) : r0 * (1 - t) + (o.r1 ?? r0 * 0.15) * t), m, { sides: 10, capEnd: bushy || !o.end });
  const tip = vec(points[points.length - 1]), prev = vec(points[points.length - 2]), d = tip.clone().sub(prev).normalize();
  const em = o.endM ?? m;
  if (o.end === 'tuft') blob(parent, [r0 * 1.5, r0 * 1.5, r0 * 2.6], em, tip.toArray() as V3, d.toArray() as V3);
  if (o.end === 'club') blob(parent, [r0 * 2.2, r0 * 1.8, r0 * 2.6], em, tip.toArray() as V3, d.toArray() as V3);
  if (o.end === 'sting') claw(parent, tip.toArray() as V3, d.toArray() as V3, r0 * 5, r0 * 0.8, em, -0.6);
  if (o.end === 'spade') part(parent, new THREE.ConeGeometry(r0 * 2.2, r0 * 3.5, 4), em, tip.clone().addScaledVector(d, r0 * 1.5).toArray() as V3).quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  if (o.end === 'fluke') for (const s of [-1, 1]) tube(parent, [tip.toArray() as V3, tip.clone().add(new THREE.Vector3(s * r0 * 4, 0, -r0 * 1.5)).toArray() as V3], (t) => [r0 * 1.2 * (1 - t * 0.7), r0 * 0.25], em, { sides: 8, steps: 6 });
}
/** A tentacle along points, tapering to a fine tip; `suckers` dots its underside. */
export function tentacle(parent: THREE.Object3D, points: V3[], r0: number, m: THREE.Material, suckers?: THREE.Material): void {
  tube(parent, points, (t) => r0 * (1 - t) ** 1.2 + r0 * 0.04, m, { sides: 9, capEnd: false });
  if (!suckers) return;
  const curve = new THREE.CatmullRomCurve3(points.map(vec));
  for (let i = 1; i < 8; i++) { const t = i / 9, p = curve.getPointAt(t); part(parent, ellipsoid(r0 * 0.28 * (1 - t), r0 * 0.12, r0 * 0.28 * (1 - t), 8, 5), suckers, [p.x, p.y - r0 * (1 - t) * 0.85, p.z]); }
}
/** Spikes / plates along a curve (dragon ridge, stegosaur plates). */
export function spikeRow(parent: THREE.Object3D, points: V3[], count: number, len: number, m: THREE.Material, o: { plates?: boolean; lean?: number; dir?: V3 } = {}): void {
  const curve = new THREE.CatmullRomCurve3(points.map(vec));
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const up = vec(o.dir ?? [0, 1, 0]).normalize().addScaledVector(tan, -(o.lean ?? 0.45)).normalize();
    const l = len * (0.55 + Math.sin(t * Math.PI) * 0.6);
    const geo = o.plates ? new THREE.ConeGeometry(l * 0.45, l, 4) : new THREE.ConeGeometry(l * 0.22, l, 7);
    if (o.plates) geo.scale(0.25, 1, 1);
    const s = part(parent, geo, m, p.clone().addScaledVector(up, l * 0.4).toArray() as V3);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  }
}

// ---------------------------------------------------------------- wings (flapping pivots: userData side / flapZ / amp)
function wingPivot(at: V3, side: number, amp: number): { pv: THREE.Group; g: THREE.Group } {
  const pv = new THREE.Group(); pv.position.set(...at); pv.userData = { side, flapZ: true, amp };
  const g = new THREE.Group(); pv.add(g);
  return { pv, g };
}
/** A bird's wing: arm bones, layered primaries, secondaries and coverts that taper to rounded tips. */
export function featherWing(at: V3, side: number, span: number, c1: string, c2: string, amp = 0.55): THREE.Group {
  const { pv, g } = wingPivot(at, side, amp);
  const m1 = skin(c1, { side: true }), m2 = skin(c2, { side: true });
  const s = side;
  const elbow: V3 = [s * span * 0.38, span * 0.06, -span * 0.04], wrist: V3 = [s * span * 0.72, span * 0.04, -span * 0.02], tip: V3 = [s * span * 0.98, -span * 0.02, -span * 0.08];
  limb(g, [[0, 0, 0], elbow, wrist, tip], [span * 0.07, span * 0.05, span * 0.035, span * 0.015], m1, 0.25, 8);
  const feather = (base: V3, len: number, ang: number, m: THREE.Material, w: number) => {
    const d = new THREE.Vector3(Math.sin(ang) * s, -0.04, -Math.cos(ang)).normalize();
    const b = vec(base), tipP = b.clone().addScaledVector(d, len);
    tube(g, [base, b.clone().lerp(tipP, 0.5).add(new THREE.Vector3(0, -len * 0.03, 0)).toArray() as V3, tipP.toArray() as V3], (t) => [w * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)) + w * 0.12, w * 0.12], m, { sides: 8, steps: 8, up: [0, 1, 0] });
  };
  // primaries from the hand, secondaries along the forearm, coverts on top
  for (let i = 0; i < 6; i++) { const t = i / 5; feather([s * span * (0.72 + t * 0.24), span * 0.03, -span * (0.02 + t * 0.06)], span * (0.5 - t * 0.12), 0.25 + t * 0.75, i < 3 ? m2 : m2, span * 0.075); }
  for (let i = 0; i < 6; i++) { const t = i / 5; feather([s * span * (0.12 + t * 0.58), span * 0.05, -span * 0.02], span * (0.38 + t * 0.05), 0.08 + t * 0.15, m2, span * 0.08); }
  for (let i = 0; i < 6; i++) { const t = i / 5; feather([s * span * (0.1 + t * 0.62), span * 0.08, span * 0.01], span * 0.22, 0.05 + t * 0.2, m1, span * 0.075); }
  return pv;
}
/** A bat / dragon wing: an arm, three or four long fingers and a scalloped membrane between them. */
export function membraneWing(at: V3, side: number, span: number, bone: string, membrane: string, amp = 0.5, claws?: string): THREE.Group {
  const { pv, g } = wingPivot(at, side, amp);
  const mb = skin(bone), mm = skin(membrane, { side: true, rough: 0.6 });
  const s = side;
  const elbow: V3 = [s * span * 0.32, span * 0.16, -span * 0.08], wrist: V3 = [s * span * 0.58, span * 0.28, -span * 0.02];
  limb(g, [[0, 0, 0], elbow, wrist], [span * 0.06, span * 0.045, span * 0.035], mb, 0.25, 8);
  const tips: V3[] = [[s * span * 1.02, span * 0.34, -span * 0.12], [s * span * 0.98, span * 0.04, -span * 0.45], [s * span * 0.74, -span * 0.12, -span * 0.72], [s * span * 0.44, -span * 0.1, -span * 0.82]];
  for (const t of tips) tube(g, [wrist, [wrist[0] + (t[0] - wrist[0]) * 0.5, wrist[1] + (t[1] - wrist[1]) * 0.5 + span * 0.03, wrist[2] + (t[2] - wrist[2]) * 0.5], t], (u) => span * 0.022 * (1 - u * 0.7), mb, { sides: 6, steps: 8 });
  if (claws) claw(g, wrist, [s * 0.3, 0.6, 0.6], span * 0.12, span * 0.025, skin(claws), 0.6);
  // membrane: fans between consecutive finger tips, with a scalloped (sagging) trailing edge
  const body: V3[] = [[0, 0, 0], [s * span * 0.05, -span * 0.02, -span * 0.55]];
  const pos: number[] = [];
  const tri = (a: V3, b: V3, c: V3) => pos.push(...a, ...b, ...c);
  const chain = [elbow, ...tips, body[1]];
  for (let i = 0; i < tips.length; i++) {
    const a = tips[i], b = i + 1 < tips.length ? tips[i + 1] : body[1];
    const sag: V3 = [(a[0] + b[0]) / 2 * 0.86, (a[1] + b[1]) / 2 - span * 0.04, (a[2] + b[2]) / 2 * 0.86];
    tri(wrist, a, sag); tri(wrist, sag, b);
  }
  tri([0, 0, 0], elbow, wrist); tri([0, 0, 0], wrist, body[1]); void chain;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  part(g, geo, mm);
  return pv;
}
/** Insect / fairy wings: two thin, see-through, veined leaves. */
export function insectWing(at: V3, side: number, span: number, color: string, amp = 0.9): THREE.Group {
  const { pv, g } = wingPivot(at, side, amp);
  const m = skin(color, { side: true, opacity: 0.55, rough: 0.2 });
  for (const [k, ang] of [[1, 0.25], [0.7, -0.35]] as const) {
    const tip: V3 = [side * span * k, span * 0.08 * k, -Math.sin(ang) * span * k];
    tube(g, [[0, 0, 0], [tip[0] * 0.5, tip[1] * 0.6, tip[2] * 0.5], tip], (t) => [span * 0.22 * k * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.08)), span * 0.01], m, { sides: 8, steps: 10, up: [0, 0, 1] });
  }
  return pv;
}
