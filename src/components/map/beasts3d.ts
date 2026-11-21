/**
 * APEX 2.10 – creature archetypes assembled from the kit (kit3d.ts). Each archetype is a parametric recipe; a species
 * is a parameter set (a cat, a dog, a three-headed hound, a horse, a dragon …). Facing +z, standing on y = 0, sized
 * as a MEDIUM creature (the battle map scales by the stat block's size class).
 */
import * as THREE from 'three';
import { blob, claw, ear, eye, featherWing, hand, hoof, horn, limb, membraneWing, mixHex, paw, profile2, skin, spikeRow, tail, talonFoot, teeth, tone, tube, tuftRing, tusk, type V3 } from './kit3d';
import { patterned } from './coat3d';
import type { Marking } from './coat3d';

export type Variant = 'male' | 'female' | 'young';
const v3 = (p: THREE.Vector3): V3 => [p.x, p.y, p.z];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** A species-fixed pattern (tiger stripes, zebra, giraffe, cow patches) painted onto the main body material. */
export function withPattern(g: THREE.Object3D, body: THREE.Material, pattern: Marking, mark: string): void {
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3());
  const base = body as THREE.MeshStandardMaterial;
  const m = patterned(base, base.color.clone(), new THREE.Color(mark), pattern, size, box.min.y, false);
  g.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && mesh.material === body) mesh.material = m; });
}

/**
 * Folds a wing pivot's wing along the body (on the ground): the span turns backwards, the trailing edge hangs down,
 * so the wing lies flat against the flank; bat and dragon wings are folded tighter and rise towards the back.
 */
export function foldWing(pivot: THREE.Group, kind: 'feather' | 'membrane', span = 1): void {
  const inner = pivot.children[0], sd = pivot.userData.side as number;
  if (!inner) return;
  // local x (span) → backwards, local −z (trailing edge) → down, local y (top) → sideways
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -sd), new THREE.Vector3(-sd, 0, 0), new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), kind === 'feather' ? -0.12 : 0.45);
  const splay = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sd * (kind === 'feather' ? -0.08 : -0.12));
  inner.quaternion.copy(splay.multiply(tilt).multiply(q));
  if (kind === 'feather') { inner.scale.set(0.56, 1, 0.62); inner.position.set(sd * span * 0.08, span * 0.04, span * 0.1); }
  else { inner.scale.set(0.58, 1, 0.62); inner.position.set(sd * span * 0.06, span * 0.08, span * 0.05); }
}

// ---------------------------------------------------------------- quadrupeds
export interface Beast {
  /** Coat, belly / muzzle, nose and hooves, claws, mane / tail hair, head (when it differs), lower legs. */
  c: string; belly?: string; nose?: string; claws?: string; hair?: string; face?: string; socks?: string;
  eye?: string; eyeGlow?: number; iris?: string; pupil?: 'round' | 'slit' | 'goat';
  /** Body length (hips → shoulders), leg length, body radius. A wolf: 0.95, 0.5, 0.2. */
  len: number; leg: number; girth: number;
  chest?: number; width?: number; legR?: number;
  neck: number; neckUp: number; head: number; snout: number; snoutR?: number; brow?: number;
  /** How far the head tips down (0 = level, 1 = steeply down like a grazing horse); neck thickness factor. */
  headDown?: number; neckR?: number;
  /** A bird's head instead of a muzzle (griffon, hippogriff, owlbear). */
  beak?: 'eagle' | 'owl';
  feet: 'paw' | 'hoof' | 'cloven' | 'pad' | 'talon';
  /** Different back feet (a griffon: eagle talons in front, lion paws behind). */
  rearFeet?: 'paw' | 'hoof' | 'cloven' | 'pad' | 'talon';
  ears?: 'pointed' | 'round' | 'floppy' | 'long' | 'small' | 'fin' | 'none'; earSize?: number;
  tail?: 'thin' | 'bushy' | 'tuft' | 'stub' | 'horse' | 'curl' | 'thick' | 'club' | 'sting' | 'spade' | 'none'; tailLen?: number; tailUp?: number; tails?: number;
  horns?: 'bull' | 'ram' | 'goat' | 'antler' | 'unicorn' | 'rhino' | 'dragon' | 'ossicone' | 'none';
  tusks?: boolean; mane?: 'lion' | 'horse' | 'ruff' | 'flame' | 'none'; hump?: boolean; trunk?: boolean; wool?: boolean; spines?: boolean;
  /** Spikes or plates along the back; a fin on the back (bulette). */
  ridge?: string; ridgeLen?: number; plates?: boolean; fin?: string; beard?: boolean; antennae?: string;
  /** More than one head (a three-headed hound). */
  heads?: number;
  /** Bear-like: walks on the soles, big shoulders. Reptile-like: legs splay sideways, belly low. */
  plantigrade?: boolean; sprawl?: boolean; legPairs?: 2 | 3;
  /** Thin front legs (a wyvern walks on its wing-arms). Long sabre fangs. */
  thinFront?: boolean; sabre?: boolean;
  pattern?: { kind: Marking; mark: string };
  saddle?: boolean; barding?: string; fangs?: boolean; whiskers?: boolean; ghost?: boolean; glow?: number;
}
export const varyBeast = (s: Beast, v?: Variant): Beast => {
  if (v === 'female') return { ...s, mane: s.mane === 'lion' ? 'none' : s.mane, horns: s.horns === 'antler' ? 'none' : s.horns === 'bull' || s.horns === 'ram' ? 'goat' : s.horns, tusks: s.trunk ? s.tusks : false, beard: false, girth: s.girth * 0.93, len: s.len * 0.96 };
  if (v === 'young') return { ...s, len: s.len * 0.8, girth: s.girth * 0.9, leg: s.leg * 0.82, head: s.head * 1.28, snout: s.snout * 0.7, horns: s.horns === 'unicorn' ? 'unicorn' : 'none', tusks: false, beard: false, mane: s.mane === 'flame' ? 'flame' : 'none', spines: false, saddle: false, barding: undefined, hump: false, ridge: undefined, earSize: (s.earSize ?? 1) * 1.15 };
  return s;
};
interface Mats { coat: THREE.Material; face: THREE.Material; belly: THREE.Material; noseM: THREE.Material; clawM: THREE.Material; hairM: THREE.Material }
const look = (s: Beast) => s.ghost ? { opacity: 0.55, glow: 0.45 } : s.glow ? { glow: s.glow, rough: 0.7 } : { rough: 0.78 };
export function beastMats(s: Beast): Mats {
  const coat = skin(s.c, look(s));
  return { coat, face: s.face ? skin(s.face, look(s)) : coat, belly: skin(s.belly ?? mixHex(s.c, '#f2e6d0', 0.35), look(s)), noseM: skin(s.nose ?? '#2a201a', { rough: 0.35 }), clawM: skin(s.claws ?? '#e8dcc0', { rough: 0.4 }), hairM: skin(s.hair ?? tone(s.c, 0.6), s.mane === 'flame' ? { glow: 1.2 } : { rough: 0.9 }) };
}

export function beast(g: THREE.Group, s: Beast): { back: V3; headAt: V3; neckBase: V3; tailRoot: V3 } {
  const m = beastMats(s), { coat, belly, noseM, clawM, hairM } = m;
  const G = s.girth, L = s.len, W = s.width ?? 1, chest = s.chest ?? 1.12;
  const cy = s.leg + G * (s.sprawl ? 0.55 : 1);
  const zF = L / 2, zB = -L / 2;
  // ---- body: hips → waist → chest → shoulders, an elliptical section that is deeper at the chest
  const spine: V3[] = [[0, cy + G * 0.15, zB - G * 0.55], [0, cy + G * 0.05, zB + G * 0.15], [0, cy - G * 0.05, 0], [0, cy + G * (s.plantigrade ? 0.25 : 0.08), zF - G * 0.25], [0, cy + G * (s.plantigrade ? 0.45 : 0.3), zF + G * 0.35]];
  if (!s.wool) tube(g, spine, profile2([[G * 0.42 * W, G * 0.4], [G * 0.95 * W, G * 0.95], [G * 0.84 * W, G * 0.82], [G * 1.02 * W * chest, G * 1.1 * chest], [G * 0.74 * W, G * 0.8]]), coat, { sides: 18, steps: 30 });
  else {
    tube(g, spine, profile2([[G * 0.5 * W, G * 0.5], [G * 0.95 * W, G * 0.95], [G * 0.9 * W, G * 0.9], [G * 1.0 * W, G * 1.05], [G * 0.7 * W, G * 0.75]]), coat, { sides: 14, steps: 20 });
    for (let i = 0; i < 46; i++) { const a = i * 2.39996, t = (i / 46) * 2 - 1; const r = G * (0.32 + (i % 3) * 0.04); blob(g, [r, r, r], coat, [Math.cos(a) * G * 0.85 * W, cy + Math.sin(a) * G * 0.8 + G * 0.05, t * L * 0.55], undefined, 0.6); }
  }
  // belly / chest patch in the lighter colour
  if (!s.wool && !s.ghost && s.belly !== s.c) blob(g, [G * 0.72 * W, G * 0.55, L * 0.42], belly, [0, cy - G * 0.42, zF * 0.25]);
  if (s.hump) blob(g, [G * 0.6, G * 0.65, G * 0.9], s.mane === 'ruff' ? hairM : coat, [0, cy + G * 0.95, zF * 0.3]);
  if (s.plantigrade && !s.ghost) blob(g, [G * 0.8, G * 0.7, G * 0.8], coat, [0, cy + G * 0.55, zF - G * 0.2]);
  if (s.spines) for (let i = 0; i < 70; i++) { const a = i * 2.39996, t = ((i / 70) * 2 - 1) * 0.9; const out: V3 = [Math.cos(a) * 0.9, Math.abs(Math.sin(a)) * 0.9 + 0.3, t * 0.35]; const base: V3 = [out[0] * G * 0.9, cy + out[1] * G * 0.7, t * L * 0.5]; claw(g, base, [out[0], out[1], -0.6], G * 0.55, G * 0.06, skin('#3a2a1a'), 0); }
  if (s.ridge) spikeRow(g, [[0, cy + G * 1.05, zF + G * 0.1], [0, cy + G * 0.95, 0], [0, cy + G * 0.75, zB - G * 0.2]], s.plates ? 7 : 11, G * (s.ridgeLen ?? 0.45), skin(s.ridge, { rough: 0.5 }), { plates: s.plates, lean: 0.5 });
  if (s.fin) spikeRow(g, [[0, cy + G * 0.95, zF * 0.6], [0, cy + G * 1.0, 0]], 1, G * 1.6, skin(s.fin, { rough: 0.5 }), { plates: true, lean: 0.9 });
  // ---- legs: shoulder → elbow → wrist → foot (front), hip → knee → hock → foot (back)
  const pairs = s.legPairs ?? 2;
  const legR = s.legR ?? G * 0.32;
  const spread = s.sprawl ? 1.6 : 1;
  const sockM = s.socks ? skin(s.socks, look(s)) : coat;
  for (let pi = 0; pi < pairs; pi++) {
    const front = pi === 0, last = pi === pairs - 1, z0 = pairs === 3 ? [zF - G * 0.2, 0, zB + G * 0.3][pi] : front ? zF - G * 0.2 : zB + G * 0.3;
    const feet = !front && s.rearFeet ? s.rearFeet : s.feet;
    const hind = last && !front;
    for (const x of [-1, 1]) {
      const xs = x * G * 0.6 * W;
      const top: V3 = [xs, cy + G * 0.2, z0];
      const knee: V3 = s.sprawl ? [x * G * 1.25 * spread, s.leg * 0.85, z0 + (front ? 0.05 : -0.05)] : !hind ? [xs * 1.02, s.leg * 0.6, z0 - G * 0.12] : [xs * 1.02, s.leg * 0.66, z0 + G * 0.32];
      const ankle: V3 = s.sprawl ? [x * G * 1.45 * spread, s.leg * 0.2, z0 + (front ? 0.12 : -0.02)] : !hind ? [xs, s.leg * 0.17, z0 - G * 0.06] : s.plantigrade ? [xs, s.leg * 0.12, z0 - G * 0.1] : [xs, s.leg * 0.3, z0 - G * 0.28];
      const foot: V3 = [ankle[0], 0, ankle[2] + (feet === 'paw' || feet === 'talon' ? G * 0.08 : 0)];
      const fr = front && s.thinFront ? 0.6 : 1;
      const radii = !hind ? [legR * 1.6 * fr, legR * 0.95 * fr, legR * 0.6 * fr, legR * 0.55 * fr] : [legR * 2.1, legR * 1.15, legR * 0.62, legR * 0.55];
      // shoulder blade / thigh mass blending the leg into the body
      if (!s.sprawl && !s.ghost) blob(g, !hind ? [legR * 1.35, G * 0.5, G * 0.45] : [legR * 1.7, G * 0.55, G * 0.55], coat, [xs * 0.95, cy - G * 0.05, z0 + (hind ? G * 0.05 : 0)]);
      const footTop: V3 = [foot[0], foot[1] + legR * 0.5, foot[2]];
      if (s.socks) {
        const mid: V3 = [(knee[0] + ankle[0]) / 2, (knee[1] + ankle[1]) / 2, (knee[2] + ankle[2]) / 2];
        limb(g, [top, knee, mid], [radii[0], radii[1], (radii[1] + radii[2]) / 2], coat, hind ? 0.3 : 0.2, 10);
        limb(g, [mid, ankle, footTop], [(radii[1] + radii[2]) / 2 * 1.02, radii[2], radii[3]], sockM, 0.05, 10);
      } else limb(g, [top, knee, ankle, footTop], radii, coat, hind ? 0.3 : 0.2, 10);
      if (feet === 'paw') paw(g, foot, legR * 1.2 * (s.plantigrade ? 1.5 : 1), sockM, { claws: clawM, long: s.plantigrade ? 1.3 : 1 });
      else if (feet === 'talon') talonFoot(g, [foot[0], 0, foot[2]], legR * 1.6, skin('#d8a830'), clawM);
      else if (feet === 'pad') blob(g, [legR * 1.15, legR * 0.55, legR * 1.15], skin(tone(s.socks ?? s.c, 0.8)), [foot[0], legR * 0.45, foot[2]]);
      else hoof(g, foot, legR * 1.25, noseM, feet === 'cloven');
    }
  }
  // ---- neck(s) and head(s)
  const heads = s.heads ?? 1;
  const neckBase: V3 = [0, cy + G * (s.plantigrade ? 0.45 : 0.35), zF + G * 0.25];
  let headAt: V3 = neckBase;
  for (let h = 0; h < heads; h++) {
    const fan = heads > 1 ? (h - (heads - 1) / 2) * Math.min(0.85, 2.2 / (heads - 1)) : 0;
    const up = s.neckUp + (heads > 1 ? (fan === 0 ? 0.15 : -0.05) : 0);
    const base = add(neckBase, [Math.sin(fan) * G * 0.55, 0, 0]);
    const dir = new THREE.Vector3(Math.sin(fan), Math.sin(up), Math.cos(up) * Math.cos(fan)).normalize();
    const hc = neckHead(g, base, v3(dir), s.neck * (heads > 1 && fan !== 0 ? 1.15 : 1), G, s, m, Math.sin(fan) * 0.7);
    if (h === Math.floor(heads / 2)) headAt = hc;
  }
  if (s.mane === 'horse') { const top = add(neckBase, [0, G * 0.25, -G * 0.2]); spikeRow(g, [top, add(top, [0, s.neck * 0.55, s.neck * 0.35]), add(headAt, [0, s.head * 0.7, -s.head * 0.4])], 10, G * 0.42, hairM, { lean: 1.2, plates: true }); }
  if (s.mane === 'ruff') tuftRing(g, add(neckBase, [0, 0, G * 0.1]), [0, 0.3, 1], G * 0.78, 16, G * 0.42, hairM, { back: 0.8, thick: 1.6 });
  if (s.mane === 'flame') spikeRow(g, [add(neckBase, [0, G * 0.3, -G * 0.6]), add(headAt, [0, s.head * 0.6, -s.head * 0.3])], 7, G * 0.6, hairM, { lean: 1.0 });
  // ---- tail(s)
  const root: V3 = [0, cy + G * 0.2, zB - G * 0.5];
  const tl = s.tailLen ?? L * 0.6, up = s.tailUp ?? 0.2;
  const tails = s.tails ?? 1;
  for (let k = 0; k < tails; k++) {
    const fan = tails > 1 ? (k - (tails - 1) / 2) * Math.min(0.5, 2.6 / tails) : 0;
    const P = (x: number, y: number, z: number): V3 => add(root, [x + Math.sin(fan) * -z, y + (tails > 1 ? (0.6 - Math.abs(fan)) * -z * 0.5 : 0), z * Math.cos(fan)]);
    switch (s.tail ?? 'thin') {
      case 'thin': tail(g, [root, P(0, -tl * 0.12 + up * tl * 0.2, -tl * 0.4), P(0, -tl * 0.3 + up * tl * 0.55, -tl * 0.72), P(0, -tl * 0.34 + up * tl * 0.95, -tl * 0.92)], G * 0.16, coat); break;
      case 'bushy': tail(g, up > 1 ? [root, P(0, tl * 0.35, -tl * 0.35), P(0, tl * 0.85, -tl * 0.3), P(0, tl * 1.05, -tl * 0.05)] : [root, P(0, -tl * 0.12 + up * tl * 0.2, -tl * 0.45), P(0, -tl * 0.3 + up * tl, -tl * 0.85)], G * (up > 1 ? 0.42 : 0.3), coat, { end: 'bushy', ...(s.socks && s.hair ? { endM: hairM } : {}) }); break;
      case 'tuft': tail(g, [root, P(0, -tl * 0.35, -tl * 0.3), P(0, -tl * 0.6, -tl * 0.45)], G * 0.1, coat, { end: 'tuft', endM: hairM }); break;
      case 'horse': tube(g, [root, P(0, -tl * 0.2, -tl * 0.28), P(0, -tl * 0.62, -tl * 0.38), P(0, -tl * 0.85, -tl * 0.34)], (t) => [G * 0.24 * (1 - t * 0.3) * Math.min(1, 0.6 + t * 2), G * 0.2 * (1 - t * 0.2) * Math.min(1, 0.6 + t * 2)], hairM, { sides: 10 }); break;
      case 'stub': blob(g, [G * 0.2, G * 0.22, G * 0.24], s.wool ? coat : s.belly === undefined ? coat : belly, add(root, [0, G * 0.05, -G * 0.05])); break;
      case 'curl': tube(g, [root, add(root, [G * 0.15, G * 0.1, -G * 0.2]), add(root, [0, G * 0.25, -G * 0.25]), add(root, [-G * 0.1, G * 0.15, -G * 0.15])], () => G * 0.07, coat, { sides: 8 }); break;
      case 'thick': tail(g, [root, P(0, -G * 0.4, -tl * 0.4), P(G * 0.15, -cy + G * 0.25, -tl * 0.8), P(-G * 0.1, -cy + G * 0.2, -tl * 1.15)], G * 0.55, coat); break;
      case 'club': tail(g, [root, P(0, -G * 0.3, -tl * 0.5), P(0, -G * 0.2, -tl)], G * 0.4, coat, { end: 'club', endM: skin('#5a5a4a') }); break;
      case 'sting': tail(g, [root, P(0, tl * 0.5, -tl * 0.4), P(0, tl * 0.95, -tl * 0.1), P(0, tl * 0.9, tl * 0.2)], G * 0.22, coat, { end: 'sting', endM: clawM }); break;
      case 'spade': tail(g, [root, P(0, -tl * 0.1, -tl * 0.5), P(0, tl * 0.15, -tl * 0.9)], G * 0.12, coat, { end: 'spade' }); break;
      default: break;
    }
  }
  if (s.saddle || s.barding) {
    const sm = skin('#5a3a22', { rough: 0.6 });
    tube(g, [[0, cy + G * 0.98, -G * 0.4], [0, cy + G * 1.05, 0], [0, cy + G * 1.0, G * 0.4]], () => [G * 0.62, G * 0.12], sm, { sides: 10 });
    for (const x of [-1, 1]) tube(g, [[x * G * 0.62, cy + G * 0.9, 0], [x * G * 0.98 * W, cy, 0.02], [x * G * 0.75, cy - G * 0.75, 0.02]], () => G * 0.04, sm, { sides: 6, steps: 8 });
    if (s.barding) tube(g, [[0, cy + G * 0.2, zB + G * 0.1], [0, cy + G * 0.3, 0], [0, cy + G * 0.35, zF - G * 0.1]], () => [G * 1.08 * W, G * 1.0], skin(s.barding, { side: true, rough: 0.9 }), { sides: 14, capStart: false, capEnd: false });
  }
  if (s.pattern) withPattern(g, coat, s.pattern.kind, s.pattern.mark);
  g.userData.head = headAt;
  return { back: [0, cy + G * 1.05, 0], headAt, neckBase, tailRoot: root };
}

/** A neck from `base` along `dir` with the species' head on it (also used for a chimera's extra heads). */
export function neckHead(g: THREE.Group, base: V3, dir: V3, len: number, G: number, s: Beast, m = beastMats(s), turn = 0): V3 {
  const d = new THREE.Vector3(...dir).normalize();
  const neckEnd = add(base, v3(d), len);
  const mid = add(add(base, v3(d), len * 0.5), [0, len * 0.08, 0]);
  const nr = s.neckR ?? 1;
  tube(g, [base, mid, neckEnd], (t) => { const r = (G * 0.62 * (1 - t) + s.head * 0.7 * t) * nr; return [r * 0.82, r * (1.05 + (1 - t) * 0.2)]; }, m.coat, { sides: 12, steps: 14 });
  const fwd = new THREE.Vector3(turn, -0.12 - (s.headDown ?? Math.max(0, s.neckUp - 0.6) * 0.35), 1).normalize();
  const hc = add(neckEnd, v3(fwd), s.head * 0.35);
  makeHead(g, hc, fwd, s, m);
  return hc;
}

export function makeHead(g: THREE.Group, hc: V3, fwd: THREE.Vector3, s: Beast, m: Mats): void {
  const H = s.head, f = v3(fwd);
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
  const upv = new THREE.Vector3().crossVectors(fwd, side).normalize();
  const at = (sx: number, uy: number, fz: number): V3 => add(add(add(hc, v3(side), sx), v3(upv), uy), f, fz);
  const F = m.face;
  if (s.beak) {
    // a feathered bird's head with a hooked beak (and an owl's facial disc)
    const owl = s.beak === 'owl', bm = skin(owl ? '#3a3226' : '#e8b030', { rough: 0.4 });
    blob(g, [H * (owl ? 1.05 : 0.9), H * (owl ? 0.95 : 0.85), H * 1.0], F, hc, f);
    if (owl) for (const x of [-1, 1]) blob(g, [H * 0.5, H * 0.55, H * 0.2], m.belly, at(x * H * 0.42, H * 0.05, H * 0.82), f);
    else blob(g, [H * 0.75, H * 0.22, H * 0.45], F, at(0, H * 0.42, H * 0.4), f);
    const b0 = at(0, owl ? -H * 0.15 : -H * 0.05, H * (owl ? 0.9 : 0.75));
    tube(g, [b0, at(0, owl ? -H * 0.3 : -H * 0.12, H * (owl ? 1.2 : 1.35)), at(0, owl ? -H * 0.6 : -H * 0.55, H * (owl ? 1.3 : 1.62))], (t) => [H * (owl ? 0.2 : 0.3) * (1 - t) + 0.004, H * (owl ? 0.26 : 0.38) * (1 - t) + 0.004], bm, { sides: 10, steps: 10, capEnd: false });
    for (const x of [-1, 1]) eye(g, at(x * H * (owl ? 0.42 : 0.55), H * (owl ? 0.08 : 0.2), H * (owl ? 0.92 : 0.6)), H * (owl ? 0.24 : 0.16), { iris: s.iris ?? s.eye ?? '#e8a020', ...(s.eyeGlow ? { glow: s.eyeGlow } : {}), look: v3(side.clone().multiplyScalar(x * (owl ? 0.15 : 0.6)).add(fwd).normalize()) });
    if (owl) for (const x of [-1, 1]) ear(g, at(x * H * 0.62, H * 0.75, 0), v3(upv.clone().addScaledVector(side, x * 0.35)), H * 0.5, F, 'pointed');
    return;
  }
  // skull, cheeks and a muzzle that narrows to the nose
  const long = s.snout > 1 ? Math.min(1, (s.snout - 1) * 2) : 0;
  blob(g, [H * (0.84 - long * 0.12), H * (0.8 - long * 0.08), H * 0.9], F, add(hc, f, -H * 0.08), f);
  if (s.snout > 0.05) blob(g, [H * 0.7 * Math.min(1.2, s.snoutR ?? 1), H * 0.55, H * 0.62], F, at(0, -H * 0.25, H * 0.22), f);
  if (s.brow) blob(g, [H * 0.8, H * 0.25, H * 0.4], F, at(0, H * 0.45, H * 0.35), f);
  const sr = s.snoutR ?? 1;
  const tip = at(0, -H * (0.2 + s.snout * 0.04), H * (0.5 + s.snout * 1.05));
  if (s.snout > 0.05) tube(g, [at(0, -H * 0.1, H * 0.3), at(0, -H * 0.15, H * (0.45 + s.snout * 0.5)), tip], (t) => [H * 0.6 * sr * (1 - t * (0.42 - long * 0.12)), H * (0.5 + long * 0.08) * sr * (1 - t * (0.36 - long * 0.1))], F, { sides: 14, steps: 12 });
  if (long > 0) blob(g, [H * 0.4 * sr, H * 0.36 * sr, H * 0.34], F, add(tip, f, -H * 0.12), f);
  // light muzzle and lower jaw, nose
  if (s.snout > 0.05) blob(g, [H * 0.38 * sr, H * 0.24 * sr, H * (0.38 * s.snout + 0.12)], m.belly, at(0, -H * 0.38 * sr, H * (0.4 + s.snout * 0.72)), f);
  if (long > 0) for (const x of [-1, 1]) blob(g, [H * 0.08, H * 0.07, H * 0.05], m.noseM, add(add(tip, v3(side), x * H * 0.17 * sr), f, H * 0.14));
  else blob(g, [H * 0.22 * sr, H * 0.15 * sr, H * 0.12], m.noseM, add(tip, f, H * 0.1 * sr));
  if (s.fangs || s.sabre) for (const x of [-1, 1]) claw(g, at(x * H * 0.24 * sr, -H * 0.42 * sr, H * (0.35 + s.snout)), [0, -1, 0.15], H * (s.sabre ? 0.95 : 0.3), H * (s.sabre ? 0.09 : 0.06), s.sabre ? skin('#efe6cf', { rough: 0.35 }) : m.clawM, 0.2);
  if (s.trunk) tube(g, [tip, add(tip, [0, -H * 0.6, H * 0.4]), add(tip, [0, -H * 1.6, H * 0.5]), add(tip, [0, -H * 2.4, H * 0.75])], (t) => H * 0.3 * (1 - t * 0.55), F, { sides: 10 });
  if (s.tusks) for (const x of [-1, 1]) tusk(g, at(x * H * 0.35, -H * 0.4, H * (0.5 + s.snout * 0.6)), [x * 0.25, -0.4, 1], H * (s.trunk ? 1.8 : 0.55), H * (s.trunk ? 0.12 : 0.07), skin('#efe6cf', { rough: 0.35 }));
  if (s.beard) tube(g, [at(0, -H * 0.55, H * (0.25 + s.snout * 0.5)), at(0, -H * 1.1, H * (0.2 + s.snout * 0.45))], (t) => [H * 0.16 * (1 - t * 0.7), H * 0.12 * (1 - t * 0.7)], m.hairM, { sides: 8 });
  // eyes
  for (const x of [-1, 1]) eye(g, at(x * H * 0.5, H * 0.22, H * 0.5), H * (s.iris ? 0.17 : 0.13), { ...(s.iris ? { iris: s.iris, pupil: s.pupil ?? 'round' } : {}), ...(s.eyeGlow ? { glow: s.eyeGlow, iris: s.eye ?? '#ffcf3a', pupil: 'slit' } : {}), look: v3(side.clone().multiplyScalar(x * 0.55).add(fwd).normalize()) });
  // ears
  const ek = s.ears ?? 'pointed', es = (s.earSize ?? 1) * H * 0.55;
  if (ek !== 'none') for (const x of [-1, 1]) {
    const dir = ek === 'floppy' ? v3(side.clone().multiplyScalar(x).add(new THREE.Vector3(0, 0.2, 0)).normalize()) : v3(side.clone().multiplyScalar(x * (ek === 'long' ? 0.25 : 0.55)).add(upv.clone().multiplyScalar(1)).addScaledVector(fwd, -0.2).normalize());
    ear(g, at(x * H * (ek === 'floppy' ? 0.7 : 0.48), H * (ek === 'floppy' ? 0.45 : 0.62), -H * 0.1), dir, es, F, ek, ek === 'pointed' || ek === 'long' || ek === 'round' ? skin(mixHex(s.face ?? s.c, '#e8a8a0', 0.55)) : undefined);
  }
  if (s.antennae) for (const x of [-1, 1]) { const b = at(x * H * 0.3, H * 0.7, H * 0.3); tube(g, [b, add(b, v3(upv.clone().addScaledVector(fwd, 0.8).addScaledVector(side, x * 0.4).normalize()), H * 1.2), add(b, v3(upv.clone().addScaledVector(fwd, 1.6).addScaledVector(side, x * 0.6).normalize()), H * 2.2)], (t) => H * 0.06 * (1 - t * 0.5), skin(s.antennae), { sides: 6 }); }
  // horns
  const hm = skin('#e2d6bc', { rough: 0.45 }), dark = skin('#3a2e24', { rough: 0.5 });
  if (s.horns && s.horns !== 'none') for (const x of [-1, 1]) {
    const base = at(x * H * 0.45, H * 0.6, H * 0.05);
    switch (s.horns) {
      case 'bull': horn(g, base, v3(side.clone().multiplyScalar(x).addScaledVector(upv, 0.2)), H * 1.0, H * 0.14, hm, { curl: x * -1.0, axis: v3(fwd) }); break;
      case 'ram': horn(g, at(x * H * 0.4, H * 0.55, -H * 0.05), v3(upv.clone().addScaledVector(fwd, -0.6).normalize()), H * 1.9, H * 0.18, hm, { curl: 4.2, axis: v3(side.clone().multiplyScalar(x)), spiral: x * 0.9, ridges: true }); break;
      case 'goat': horn(g, base, v3(upv.clone().addScaledVector(fwd, -0.7).normalize()), H * 0.95, H * 0.1, dark, { curl: -0.8, axis: v3(side), ridges: true }); break;
      case 'ossicone': { const b = at(x * H * 0.3, H * 0.65, -H * 0.1); tube(g, [b, add(b, v3(upv.clone().addScaledVector(fwd, -0.3).normalize()), H * 0.55)], () => H * 0.07, F, { sides: 8 }); blob(g, [H * 0.11, H * 0.11, H * 0.11], dark, add(b, v3(upv.clone().addScaledVector(fwd, -0.3).normalize()), H * 0.58)); break; }
      case 'antler': {
        const b2 = base, d1 = upv.clone().addScaledVector(side, x * 0.6).addScaledVector(fwd, -0.2).normalize();
        horn(g, b2, v3(d1), H * 2.1, H * 0.08, hm, { curl: 0.3, axis: v3(fwd) });
        for (let k = 1; k <= 3; k++) { const p = add(b2, v3(d1), H * 0.55 * k); horn(g, p, v3(upv.clone().addScaledVector(fwd, 0.6).normalize()), H * 0.6, H * 0.05, hm, { curl: 0.3, axis: v3(side) }); }
        break;
      }
      case 'dragon': horn(g, at(x * H * 0.38, H * 0.55, -H * 0.2), v3(fwd.clone().multiplyScalar(-1).addScaledVector(upv, 0.5).addScaledVector(side, x * 0.2).normalize()), H * 1.4, H * 0.14, hm, { curl: 0.5, axis: v3(side.clone().multiplyScalar(-x)) }); break;
      case 'unicorn': if (x === 1) horn(g, at(0, H * 0.75, H * 0.45), v3(upv.clone().addScaledVector(fwd, 0.8).normalize()), H * 1.6, H * 0.12, skin('#f2e2b0', { glow: 0.35 }), { spiral: 6, ridges: true }); break;
      case 'rhino': if (x === 1) { horn(g, add(add(hc, f, H * (0.45 + s.snout)), v3(upv), H * 0.15), v3(upv.clone().addScaledVector(fwd, 0.35).normalize()), H * 1.1, H * 0.22, hm, { curl: -0.5, axis: v3(side) }); horn(g, add(add(hc, f, H * 0.55), v3(upv), H * 0.45), v3(upv), H * 0.5, H * 0.14, hm); } break;
      default: break;
    }
  }
  if (s.mane === 'lion') { tuftRing(g, add(hc, f, -H * 0.25), v3(fwd), H * 0.95, 18, H * 0.75, m.hairM, { back: 0.9, rows: 3, thick: 1.4 }); blob(g, [H * 1.15, H * 1.15, H * 0.8], m.hairM, add(hc, f, -H * 0.55)); }
  if (s.whiskers) for (const x of [-1, 1]) for (const k of [0, 1]) tube(g, [at(x * H * 0.3, -H * 0.25 - k * H * 0.08, H * (0.45 + s.snout)), at(x * H * 1.1, -H * 0.18 - k * H * 0.15, H * (0.35 + s.snout))], () => H * 0.012, skin('#f2ece0'), { sides: 4, steps: 2 });
}

// ---------------------------------------------------------------- birds
export interface Avian { c: string; c2: string; beak: string; legs?: string; size: number; neck?: number; legLen?: number; owl?: boolean; crest?: boolean; hooked?: boolean; tailLen?: number; comb?: boolean; longNeck?: boolean; glow?: number; eyeColour?: string; duck?: boolean;
  /** Head and neck colour (a bald eagle's white head, a mallard's green one); bat wings instead of feathers; a lizard's tail (cockatrice). */
  headC?: string; membrane?: [string, string]; lizardTail?: string }
export function avian(g: THREE.Group, s: Avian, airborne = false): THREE.Group[] {
  const S = s.size, body = skin(s.c, s.glow ? { glow: s.glow } : { rough: 0.85 }), chest = skin(s.c2, s.glow ? { glow: s.glow } : { rough: 0.85 }), beakM = skin(s.beak, { rough: 0.4 }), legM = skin(s.legs ?? s.beak, { rough: 0.5 });
  const legLen = s.legLen ?? 0.32, cy = (legLen + 0.25) * S;
  // body: an egg tipped forward
  tube(g, [[0, cy - 0.02 * S, -0.34 * S], [0, cy + 0.02 * S, -0.1 * S], [0, cy + 0.08 * S, 0.12 * S], [0, cy + 0.18 * S, 0.24 * S]], profile2([[0.1 * S, 0.08 * S], [0.25 * S, 0.24 * S], [0.25 * S, 0.27 * S], [0.14 * S, 0.15 * S]]), body, { sides: 14 });
  blob(g, [0.2 * S, 0.22 * S, 0.2 * S], chest, [0, cy, 0.12 * S]);
  // neck and head
  const nl = (s.neck ?? 0.12) * S;
  const neckTop: V3 = s.longNeck ? [0, cy + 0.65 * S, 0.3 * S] : [0, cy + 0.22 * S + nl, 0.28 * S + nl * 0.3];
  const headM = s.headC ? skin(s.headC, s.glow ? { glow: s.glow } : { rough: 0.85 }) : body;
  tube(g, s.longNeck ? [[0, cy + 0.15 * S, 0.22 * S], [0, cy + 0.3 * S, 0.42 * S], [0, cy + 0.55 * S, 0.22 * S], neckTop] : [[0, cy + 0.12 * S, 0.22 * S], neckTop], (t) => (0.12 - t * 0.04) * S, s.headC && !s.longNeck ? headM : body, { sides: 10 });
  const hr = (s.owl ? 0.2 : 0.13) * S, hc: V3 = add(neckTop, [0, hr * 0.3, hr * 0.2]);
  g.userData.head = hc;
  blob(g, [hr, hr * 0.95, hr * 1.05], s.owl ? chest : headM, hc);
  if (s.owl) for (const x of [-1, 1]) blob(g, [hr * 0.5, hr * 0.5, hr * 0.15], skin(mixHex(s.c2, '#ffffff', 0.3)), add(hc, [x * hr * 0.42, hr * 0.05, hr * 0.82]));
  // beak
  const bl = (s.owl ? 0.09 : s.duck ? 0.2 : 0.16) * S, bb: V3 = add(hc, [0, -hr * 0.1, hr * 0.85]);
  if (s.duck) tube(g, [bb, add(bb, [0, -bl * 0.1, bl])], (t) => [hr * 0.38 * (1 - t * 0.2), hr * 0.12], beakM, { sides: 10 });
  else tube(g, [bb, add(bb, [0, -bl * (s.hooked || s.owl ? 0.25 : 0.1), bl * 0.7]), add(bb, [0, -bl * (s.hooked || s.owl ? 0.6 : 0.18), bl])], (t) => [hr * 0.26 * (1 - t) + 0.004, hr * 0.3 * (1 - t) + 0.004], beakM, { sides: 8, capEnd: false });
  for (const x of [-1, 1]) eye(g, add(hc, [x * hr * (s.owl ? 0.42 : 0.62), hr * 0.15, hr * (s.owl ? 0.85 : 0.55)]), hr * (s.owl ? 0.3 : 0.2), s.owl || s.eyeColour ? { iris: s.eyeColour ?? '#ffb81a', look: [x * (s.owl ? 0.15 : 0.8), 0, 1] } : { look: [x, 0, 0.5] });
  if (s.crest) for (let i = 0; i < 4; i++) claw(g, add(hc, [0, hr * 0.8, -hr * 0.2 - i * hr * 0.25]), [0, 0.7, -1], hr * (0.9 - i * 0.12), hr * 0.12, body, -0.4);
  if (s.owl) for (const x of [-1, 1]) ear(g, add(hc, [x * hr * 0.6, hr * 0.85, 0]), [x * 0.3, 1, -0.2], hr * 0.5, body, 'pointed');
  if (s.comb) { for (let i = 0; i < 4; i++) blob(g, [hr * 0.12, hr * 0.28, hr * 0.15], skin('#c0392b'), add(hc, [0, hr * 0.95, hr * (0.35 - i * 0.28)])); blob(g, [hr * 0.15, hr * 0.32, hr * 0.12], skin('#c0392b'), add(bb, [0, -hr * 0.45, -hr * 0.1])); }
  // tail fan
  const tlen = (s.tailLen ?? 0.3) * S;
  for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.22; tube(g, [[0, cy + 0.02 * S, -0.3 * S], [Math.sin(a) * tlen * 0.6, cy + 0.04 * S, -0.3 * S - Math.cos(a) * tlen * 0.6], [Math.sin(a) * tlen, cy + 0.02 * S, -0.3 * S - Math.cos(a) * tlen]], (t) => [0.045 * S * Math.sin(Math.PI * Math.min(1, t + 0.1)) + 0.01 * S, 0.01 * S], i % 2 ? chest : body, { sides: 8 }); }
  // legs and feet
  for (const x of [-1, 1]) {
    const hip: V3 = [x * 0.1 * S, cy - 0.12 * S, 0], ankle: V3 = [x * 0.1 * S, 0.06 * S, 0.02 * S];
    blob(g, [0.08 * S, 0.1 * S, 0.09 * S], body, hip);
    limb(g, [hip, [x * 0.1 * S, legLen * S * 0.55, -0.04 * S], ankle], [0.045 * S, 0.03 * S, 0.025 * S], legM, 0.1, 7);
    if (s.duck) blob(g, [0.08 * S, 0.015 * S, 0.12 * S], legM, [ankle[0], 0.015 * S, ankle[2] + 0.06 * S]);
    else talonFoot(g, [ankle[0], 0, ankle[2]], 0.1 * S, legM, skin('#2a2622'));
  }
  // wings: folded along the body on the ground, spread in the air
  if (s.lizardTail) tail(g, [[0, cy, -0.3 * S], [0, cy - 0.1 * S, -0.6 * S], [0.05 * S, 0.12 * S, -0.9 * S], [-0.05 * S, 0.06 * S, -1.15 * S]], 0.07 * S, skin(s.lizardTail, { rough: 0.6 }));
  const span = 0.75 * S, mem = s.membrane;
  const wings = [-1, 1].map((x) => mem ? membraneWing([x * 0.18 * S, cy + 0.12 * S, 0.08 * S], x, span * 0.85, mem[0], mem[1], airborne ? 0.55 : 0.06) : featherWing([x * 0.18 * S, cy + 0.12 * S, 0.08 * S], x, span, s.c, s.c2, airborne ? 0.6 : 0.08));
  if (!airborne) for (const w of wings) foldWing(w, mem ? 'membrane' : 'feather', mem ? span * 0.85 : span);
  for (const w of wings) g.add(w);
  return wings;
}

// ---------------------------------------------------------------- serpents
export interface Serpent { c: string; belly?: string; len: number; r: number; hood?: boolean; worm?: boolean; sea?: boolean; eye?: string; glow?: boolean; pattern?: { kind: Marking; mark: string }; rise?: number }
export function serpent(g: THREE.Group, s: Serpent): void {
  const m = skin(s.c, { rough: 0.55 }), belly = skin(s.belly ?? mixHex(s.c, '#e8dcb0', 0.5), { rough: 0.6 });
  const L = s.len, R = s.r, rise = s.rise ?? (s.worm ? 1.4 : 0.45);
  const pts: V3[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const raised = Math.max(0, (t - 0.7) / 0.3);
    pts.push([Math.sin(t * Math.PI * 2.2) * L * 0.18 * (1 - raised), R * 0.9 + raised * raised * rise, (t - 0.65) * L]);
  }
  tube(g, pts, (t) => { const r = R * (t < 0.15 ? 0.25 + t * 5 : t > 0.9 ? 1 - (t - 0.9) * 2 : 1); return [r * 1.05, r * 0.92]; }, m, { sides: 14, steps: 70 });
  const head = pts[n], prev = pts[n - 1];
  const fwd = new THREE.Vector3(head[0] - prev[0], head[1] - prev[1], head[2] - prev[2]).normalize().lerp(new THREE.Vector3(0, -0.1, 1), 0.5).normalize();
  const f = v3(fwd);
  g.userData.head = head;
  if (s.worm) {
    // a round maw of teeth
    const ring = add(head, f, R * 0.2);
    teeth(g, add(ring, [-R * 0.7, 0, 0]), add(ring, [R * 0.7, 0, 0]), 6, R * 0.35, skin('#efe6cf'));
    teeth(g, add(ring, [-R * 0.7, R * 0.4, 0]), add(ring, [R * 0.7, R * 0.4, 0]), 6, R * 0.3, skin('#efe6cf'), false);
    blob(g, [R * 0.8, R * 0.8, R * 0.2], skin('#3a0e12'), add(head, f, R * 0.1));
  } else {
    blob(g, [R * 1.25, R * 0.85, R * 1.6], m, add(head, f, R * 0.6), f);
    for (const x of [-1, 1]) eye(g, add(add(head, f, R * 1.1), [x * R * 0.85, R * 0.4, 0]), R * 0.3, { iris: s.eye ?? '#e8c030', pupil: 'slit', look: [x, 0.2, 0.6], ...(s.glow ? { glow: 1 } : {}) });
    const tip = add(head, f, R * 2.2);
    for (const x of [-1, 1]) tube(g, [tip, add(tip, [x * R * 0.18, -R * 0.1, R * 0.7])], () => R * 0.05, skin('#b3261e'), { sides: 4, steps: 2 });
  }
  if (s.hood) { const hp = pts[n - 1], hd = new THREE.Vector3(head[0] - pts[n - 2][0], head[1] - pts[n - 2][1], head[2] - pts[n - 2][2]).normalize(); const hoodM = blob(g, [R * 2.3, R * 2.7, R * 0.35], m, add(hp, [0, R * 0.2, -R * 0.3])); hoodM.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -hd.z * 0.25, 1).normalize()); blob(g, [R * 1.6, R * 1.9, R * 0.2], belly, add(hp, [0, R * 0.1, R * 0.05])); }
  if (s.sea) spikeRow(g, pts.slice(2, n), 10, R * 1.4, skin(tone(s.c, 0.8), { side: true }), { plates: true, lean: 0.8 });
  if (!s.worm) tube(g, pts.slice(1).map((p) => [p[0], p[1] - R * 0.35, p[2]] as V3), () => [R * 0.75, R * 0.6], belly, { sides: 10, steps: 60 });
  if (s.pattern) withPattern(g, m, s.pattern.kind, s.pattern.mark);
}

// ---------------------------------------------------------------- arthropods
export interface Bug { kind: 'spider' | 'scorpion' | 'crab' | 'beetle' | 'centipede' | 'ant'; c: string; c2?: string; eye?: string; glow?: number; size?: number; pattern?: { kind: Marking; mark: string } }
export function arthropod(g: THREE.Group, s: Bug): void {
  const S = s.size ?? 1, m = skin(s.c, { rough: 0.5 }), m2 = skin(s.c2 ?? tone(s.c, 0.7), { rough: 0.5 });
  const leg = (x: number, base: V3, reach: number, up: number, z: number, r: number) => {
    const knee: V3 = [base[0] + x * reach * 0.45, base[1] + up, base[2] + z * 0.5];
    const foot: V3 = [base[0] + x * reach, 0.02, base[2] + z];
    limb(g, [base, knee, add(knee, [x * reach * 0.25, -up * 0.4, z * 0.2]), foot], [r, r * 0.8, r * 0.6, r * 0.3], m2, 0.12, 7);
  };
  if (s.kind === 'spider') {
    const y = 0.42 * S;
    blob(g, [0.24 * S, 0.17 * S, 0.26 * S], m, [0, y, 0.12 * S]);
    blob(g, [0.38 * S, 0.33 * S, 0.44 * S], m, [0, y + 0.1 * S, -0.48 * S]);
    for (let i = 0; i < 4; i++) for (const x of [-1, 1]) leg(x, [x * 0.16 * S, y, (0.24 - i * 0.11) * S], 0.95 * S, 0.38 * S, (0.55 - i * 0.42) * S, 0.035 * S);
    for (const x of [-1, 1]) claw(g, [x * 0.07 * S, y - 0.05 * S, 0.34 * S], [0, -1, 0.4], 0.16 * S, 0.035 * S, skin('#1a1412'), 0.5);
    for (const [ex, ey, er] of [[0.06, 0.1, 0.045], [-0.06, 0.1, 0.045], [0.11, 0.07, 0.03], [-0.11, 0.07, 0.03], [0.03, 0.14, 0.025], [-0.03, 0.14, 0.025]]) eye(g, [ex * S, y + ey * S, 0.33 * S], er * S, s.glow ? { iris: s.eye ?? '#ff3a2a', glow: s.glow } : {});
    blob(g, [0.05 * S, 0.05 * S, 0.05 * S], m2, [0, y + 0.02 * S, -0.92 * S]);
  } else if (s.kind === 'scorpion' || s.kind === 'crab') {
    const y = 0.25 * S, crab = s.kind === 'crab';
    blob(g, crab ? [0.42 * S, 0.16 * S, 0.32 * S] : [0.22 * S, 0.12 * S, 0.42 * S], m, [0, y, 0]);
    for (let i = 0; i < 4; i++) for (const x of [-1, 1]) leg(x, [x * (crab ? 0.3 : 0.16) * S, y, (0.12 - i * 0.12) * S], (crab ? 0.7 : 0.6) * S, 0.2 * S, (crab ? -0.1 : -0.15 + i * 0.05) * S, 0.03 * S);
    for (const x of [-1, 1]) {
      const sh: V3 = [x * 0.15 * S, y, 0.3 * S], el: V3 = [x * 0.38 * S, y + 0.1 * S, 0.45 * S], wr: V3 = [x * 0.3 * S, y + 0.05 * S, 0.68 * S];
      limb(g, [sh, el, wr], [0.05 * S, 0.06 * S, 0.07 * S], m, 0.2, 8);
      blob(g, [0.1 * S, 0.07 * S, 0.16 * S], m, add(wr, [0, 0, 0.1 * S]));
      claw(g, add(wr, [x * 0.04 * S, 0.02 * S, 0.2 * S]), [x * -0.2, 0, 1], 0.14 * S, 0.035 * S, m, -0.4);
      claw(g, add(wr, [x * -0.03 * S, -0.01 * S, 0.2 * S]), [x * 0.2, 0, 1], 0.12 * S, 0.03 * S, m, 0.4);
    }
    if (!crab) { const pts: V3[] = []; for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 0.95; pts.push([0, y + Math.sin(a) * 0.55 * S, -0.35 * S - (1 - Math.cos(a)) * 0.28 * S]); } tail(g, pts, 0.08 * S, m, { end: 'sting', endM: skin('#2a1a12') }); }
    for (const x of [-1, 1]) eye(g, [x * 0.07 * S, y + (crab ? 0.16 : 0.1) * S, (crab ? 0.25 : 0.36) * S], 0.03 * S, s.glow ? { iris: '#ff3a2a', glow: s.glow } : {});
  } else if (s.kind === 'beetle' || s.kind === 'ant') {
    const y = 0.3 * S, ant = s.kind === 'ant';
    blob(g, ant ? [0.2 * S, 0.17 * S, 0.3 * S] : [0.34 * S, 0.22 * S, 0.45 * S], m, [0, y + 0.05 * S, -0.15 * S]);
    blob(g, [0.16 * S, 0.12 * S, 0.16 * S], m2, [0, y, 0.22 * S]);
    blob(g, [0.14 * S, 0.12 * S, 0.13 * S], m, [0, y + 0.02 * S, 0.42 * S]);
    for (let i = 0; i < 3; i++) for (const x of [-1, 1]) leg(x, [x * 0.12 * S, y - 0.02 * S, (0.25 - i * 0.14) * S], 0.65 * S, 0.22 * S, (0.3 - i * 0.3) * S, 0.03 * S);
    for (const x of [-1, 1]) { tube(g, [[x * 0.05 * S, y + 0.1 * S, 0.5 * S], [x * 0.15 * S, y + 0.3 * S, 0.65 * S], [x * 0.18 * S, y + 0.35 * S, 0.85 * S]], () => 0.012 * S, m2, { sides: 5 }); eye(g, [x * 0.1 * S, y + 0.06 * S, 0.5 * S], 0.035 * S, s.glow ? { iris: s.eye ?? '#e8e070', glow: s.glow } : {}); }
    for (const x of [-1, 1]) claw(g, [x * 0.06 * S, y - 0.03 * S, 0.55 * S], [x * -0.4, 0, 1], 0.14 * S, 0.03 * S, m2, 0.3);
  } else {
    const y = 0.14 * S, n = 12;
    const pts: V3[] = Array.from({ length: n }, (_, i) => [Math.sin(i * 0.7) * 0.12 * S, y, (0.6 - i * 0.12) * S] as V3);
    for (let i = 0; i < n; i++) { blob(g, [0.1 * S, 0.08 * S, 0.08 * S], i % 2 ? m : m2, pts[i]); if (i > 0) for (const x of [-1, 1]) leg(x, add(pts[i], [x * 0.06 * S, 0, 0]), 0.22 * S, 0.06 * S, 0.02 * S, 0.015 * S); }
    for (const x of [-1, 1]) claw(g, add(pts[0], [x * 0.05 * S, 0, 0.06 * S]), [x * -0.5, 0, 1], 0.12 * S, 0.02 * S, m2, 0.4);
  }
  if (s.pattern) withPattern(g, m, s.pattern.kind, s.pattern.mark);
}

// ---------------------------------------------------------------- dragons
export interface Dragon { c: string; c2: string; horn: string; kind: 'dragon' | 'wyvern' | 'drake'; eye?: string; size?: number; tail?: 'thick' | 'sting' | 'spade' }
export function dragon(g: THREE.Group, s: Dragon, airborne = false): THREE.Group[] {
  const S = s.size ?? 1;
  const wyvern = s.kind === 'wyvern';
  const spec: Beast = {
    c: s.c, belly: s.c2, nose: tone(s.c, 0.5), claws: s.horn, eye: s.eye ?? '#ffcf3a', eyeGlow: 0.9,
    len: 1.0 * S, leg: (wyvern ? 0.5 : 0.42) * S, girth: 0.26 * S, chest: 1.15, legR: 0.075 * S,
    neck: 0.7 * S, neckUp: 0.85, head: 0.2 * S, snout: 1.1, snoutR: 0.85, brow: 1, headDown: 0.15,
    feet: 'talon', ears: 'fin', earSize: 0.8, tail: s.tail === 'sting' || wyvern ? 'sting' : s.tail === 'spade' ? 'spade' : 'thick', tailLen: (wyvern ? 0.7 : 1.5) * S, horns: 'dragon', fangs: true,
    ...(wyvern ? { thinFront: true } : {}),
  };
  const r = beast(g, spec);
  // belly plates and the ridge of spikes from the head down the tail
  for (let i = 0; i < 7; i++) blob(g, [0.2 * S, 0.035 * S, 0.075 * S], skin(tone(s.c2, 0.92)), [0, r.back[1] - 0.52 * S + Math.abs(i - 3) * 0.012 * S, 0.42 * S - i * 0.13 * S]);
  spikeRow(g, [[0, r.back[1] + 0.02 * S, 0.5 * S], [0, r.back[1], -0.2 * S], [0, r.back[1] - 0.15 * S, -0.9 * S], [0, 0.35 * S, -1.6 * S]], wyvern ? 8 : 12, 0.16 * S, skin(s.horn), { lean: 0.6 });
  if (s.kind === 'drake') return [];
  const span = (wyvern ? 1.6 : 1.5) * S;
  const wings = [-1, 1].map((x) => membraneWing([x * 0.2 * S, r.back[1] - 0.02 * S, 0.3 * S], x, span, s.c, s.c2, airborne ? 0.55 : 0.06, s.horn));
  if (!airborne) for (const w of wings) foldWing(w, 'membrane', span);
  for (const w of wings) g.add(w);
  return wings;
}

// ---------------------------------------------------------------- big two-legged monsters
export interface Brute {
  c: string; c2?: string; height?: number; bulk?: number; armLen?: number; hunch?: number;
  head: 'ape' | 'bull' | 'troll' | 'ogre' | 'beast' | 'giant' | 'imp' | 'vulture' | 'frog' | 'helm';
  /** Two heads (ettin). */
  heads?: number; fur?: boolean; hair?: string; horns?: 'bull' | 'demon' | 'curl' | 'none'; tail?: 'tuft' | 'spade' | 'thin' | 'none';
  claws?: boolean; tusks?: boolean; eye?: string; eyeGlow?: number; hooves?: boolean; loincloth?: string; ears?: 'pointed' | 'small' | 'none'; nose?: number;
  /** A pot belly (ogre), chiselled stone (flat shading), metal, barbs along the limbs, a club in the right hand, one big eye, mandibles. */
  belly?: boolean; flat?: boolean; metal?: number; spikes?: string; club?: boolean; oneEye?: boolean; mandibles?: boolean;
}
export function brute(g: THREE.Group, s: Brute): { shoulderY: number; hipY: number; hc: V3 } {
  const Hgt = s.height ?? 2, B = s.bulk ?? 1, hunch = s.hunch ?? 0.2, A = s.armLen ?? 1, U = Hgt / 2;
  const mo = { rough: s.metal ? 0.35 : 0.75, ...(s.flat ? { flat: true } : {}), ...(s.metal ? { metal: s.metal } : {}) };
  const m = skin(s.c, mo), m2 = skin(s.c2 ?? mixHex(s.c, '#d8c8a8', 0.3), { ...mo, rough: 0.8 });
  const ivory = skin('#efe6cf', { rough: 0.35 }), clawM = skin('#e8dcc0', { rough: 0.4 });
  const legH = Hgt * 0.42, hipY = legH, chestY = Hgt * 0.72, neckY = Hgt * 0.82;
  const sh = 0.36 * B * U;
  // torso: pelvis → belly → chest → shoulders, leaning forward with the hunch
  tube(g, [[0, hipY, -0.02], [0, hipY + (chestY - hipY) * 0.4, 0.02 + hunch * 0.05], [0, chestY, 0.05 + hunch * 0.15], [0, neckY, hunch * 0.3]], profile2([[0.26 * B, 0.2 * B], [0.3 * B, 0.24 * B], [0.42 * B, 0.3 * B], [0.3 * B, 0.22 * B]].map(([a, b]) => [a * U, b * U] as [number, number])), m, { sides: s.flat ? 8 : 16 });
  // chest and belly muscles in the second colour
  for (const x of [-1, 1]) blob(g, [0.16 * B * U, 0.13 * B * U, 0.1 * B * U], m2, [x * 0.14 * B * U, chestY - 0.02 * Hgt, 0.18 * B * U + hunch * 0.12]);
  blob(g, s.belly ? [0.34 * B * U, 0.3 * B * U, 0.3 * B * U] : [0.24 * B * U, 0.2 * B * U, 0.2 * B * U], m2, [0, hipY + (chestY - hipY) * 0.35, (s.belly ? 0.16 : 0.1) * B * U]);
  if (s.loincloth) tube(g, [[0, hipY + 0.05 * Hgt, 0], [0, hipY - 0.12 * Hgt, 0.01]], (t) => [0.3 * B * U * (1 + t * 0.15), 0.25 * B * U * (1 + t * 0.15)], skin(s.loincloth, { side: true, rough: 0.95 }), { sides: 12, capStart: false, capEnd: false });
  // legs
  for (const x of [-1, 1]) {
    const hip: V3 = [x * 0.15 * B * U, hipY, 0], knee: V3 = [x * 0.17 * B * U, legH * 0.5, s.hooves ? 0.08 * Hgt : 0.04 * Hgt], ankle: V3 = [x * 0.16 * B * U, legH * 0.1, s.hooves ? -0.06 * Hgt : 0];
    limb(g, [hip, knee, ankle], [0.12 * B * U, 0.085 * B * U, 0.06 * B * U], m, 0.3, s.flat ? 7 : 12);
    if (s.hooves) hoof(g, [ankle[0], 0, ankle[2] + 0.03 * Hgt], 0.1 * B * U, skin('#2a2018'), true);
    else {
      blob(g, [0.08 * B * U, 0.05 * B * U, 0.15 * B * U], m, [ankle[0], 0.04 * Hgt, ankle[2] + 0.06 * Hgt]);
      if (s.claws) for (let i = -1; i <= 1; i++) claw(g, [ankle[0] + i * 0.03 * Hgt, 0.04 * Hgt, ankle[2] + 0.13 * Hgt], [0, -0.3, 1], 0.05 * Hgt, 0.012 * Hgt, clawM, 0.7);
    }
    if (s.spikes) for (const k of [0.3, 0.55]) claw(g, [x * 0.2 * B * U, legH * k, -0.06 * Hgt], [x * 0.3, 0.2, -1], 0.08 * Hgt, 0.015 * Hgt, skin(s.spikes), -0.2);
  }
  // arms with hands
  for (const x of [-1, 1]) {
    const shoulder: V3 = [x * sh, neckY - 0.06 * Hgt, hunch * 0.25];
    blob(g, [0.13 * B * U, 0.12 * B * U, 0.13 * B * U], m, shoulder);
    const elbow: V3 = [x * (sh + 0.06 * Hgt), neckY - 0.26 * Hgt * A, hunch * 0.3 + 0.03 * Hgt];
    const wrist: V3 = [x * (sh + 0.05 * Hgt), neckY - 0.5 * Hgt * A, hunch * 0.3 + 0.12 * Hgt];
    limb(g, [shoulder, elbow, wrist], [0.1 * B * U, 0.08 * B * U, 0.06 * B * U], m, 0.3, s.flat ? 7 : 12);
    const club = s.club && x === 1;
    hand(g, wrist, [0, -1, 0.25], [-x, 0, 0], 0.13 * B * U * 1.4, m, { fingers: 4, curl: club ? 0.95 : 0.5, claws: s.claws ? clawM : undefined, thick: 1.3 });
    if (club) { const grip = add(wrist, [0, -0.06 * Hgt, 0.04 * Hgt]); tube(g, [add(grip, [0, 0.05 * Hgt, -0.08 * Hgt]), add(grip, [0, -0.1 * Hgt, 0.2 * Hgt]), add(grip, [0, -0.2 * Hgt, 0.45 * Hgt])], (t) => 0.025 * Hgt + t * t * 0.045 * Hgt, skin('#6a4a2a', { rough: 0.95 }), { sides: 9 }); }
    if (s.spikes) for (const k of [0.3, 0.7]) claw(g, [x * (sh + 0.06 * Hgt), neckY - 0.26 * Hgt * A * k * 2, hunch * 0.3 - 0.04 * Hgt], [x * 0.5, 0.3, -1], 0.08 * Hgt, 0.015 * Hgt, skin(s.spikes), -0.2);
  }
  if (s.spikes) spikeRow(g, [[0, neckY, hunch * 0.2 - 0.12 * Hgt], [0, chestY, -0.18 * B * U], [0, hipY + 0.05 * Hgt, -0.16 * B * U]], 7, 0.12 * Hgt, skin(s.spikes), { lean: 0.5, dir: [0, 0.3, -1] });
  if (s.fur) tuftRing(g, [0, neckY - 0.02 * Hgt, hunch * 0.2], [0, 0.6, -0.4], sh * 0.9, 16, 0.1 * Hgt, s.hair ? skin(s.hair) : m, { back: 0.3, rows: 2, thick: 1.5 });
  // head(s)
  const heads = s.heads ?? 1;
  let hcMain: V3 = [0, neckY + 0.08 * Hgt, hunch * 0.42 + 0.03 * Hgt];
  for (let h = 0; h < heads; h++) {
    const off = heads > 1 ? (h - (heads - 1) / 2) * 0.22 * B * Hgt : 0;
    const hc: V3 = [off, neckY + 0.08 * Hgt, hunch * 0.42 + 0.03 * Hgt];
    const H = 0.1 * Hgt * (s.head === 'giant' ? 0.9 : s.head === 'imp' ? 1.35 : 1);
    tube(g, [[off * 0.6, neckY - 0.03 * Hgt, hunch * 0.3], hc], () => 0.07 * B * U, m, { sides: 10 });
    bruteHead(g, hc, H, s, m, m2, ivory, heads > 1 ? Math.sign(off) * 0.35 : 0);
    if (h === 0) hcMain = hc;
  }
  // tail
  const tm = m;
  if (s.tail === 'tuft') tail(g, [[0, hipY + 0.05 * Hgt, -0.12 * Hgt], [0, hipY - 0.1 * Hgt, -0.3 * Hgt], [0, hipY - 0.25 * Hgt, -0.36 * Hgt]], 0.025 * Hgt, tm, { end: 'tuft', endM: skin(tone(s.c, 0.6)) });
  if (s.tail === 'spade') tail(g, [[0, hipY + 0.05 * Hgt, -0.12 * Hgt], [0, hipY - 0.15 * Hgt, -0.4 * Hgt], [0.05 * Hgt, hipY - 0.3 * Hgt, -0.55 * Hgt], [0, hipY - 0.2 * Hgt, -0.7 * Hgt]], 0.025 * Hgt, tm, { end: 'spade' });
  if (s.tail === 'thin') tail(g, [[0, hipY + 0.05 * Hgt, -0.12 * Hgt], [0, hipY - 0.2 * Hgt, -0.35 * Hgt], [0, 0.05 * Hgt, -0.6 * Hgt]], 0.05 * Hgt, tm);
  g.userData.head = hcMain;
  return { shoulderY: neckY - 0.06 * Hgt, hipY, hc: hcMain };
}

function bruteHead(g: THREE.Group, hc: V3, H: number, s: Brute, m: THREE.Material, m2: THREE.Material, ivory: THREE.Material, turn: number): void {
  const fwd = new THREE.Vector3(turn, -0.05, 1).normalize(), f = v3(fwd);
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
  const at = (x: number, y: number, z: number): V3 => add(add(add(hc, v3(side), x), [0, y, 0]), f, z);
  const eyeO = s.eyeGlow ? { glow: s.eyeGlow, iris: s.eye ?? '#ffcf3a', pupil: 'slit' as const } : s.eye ? { iris: s.eye } : {};
  const eyes = (y: number, z: number, dx: number, r: number) => { if (s.oneEye) eye(g, at(0, y, z), r * 1.7, { ...eyeO, iris: s.eye ?? '#e8e070', glow: s.eyeGlow ?? 0.8, look: f }); else for (const x of [-1, 1]) eye(g, at(x * dx, y, z), r, { ...eyeO, look: v3(side.clone().multiplyScalar(x * 0.2).add(fwd).normalize()) }); };
  const earsOn = (y: number, dx: number) => { if (s.ears && s.ears !== 'none') for (const x of [-1, 1]) ear(g, at(x * dx, y, -H * 0.05), v3(side.clone().multiplyScalar(x).add(new THREE.Vector3(0, s.ears === 'pointed' ? 0.45 : 0.2, 0)).addScaledVector(fwd, -0.3).normalize()), H * (s.ears === 'pointed' ? (s.head === 'imp' ? 1.1 : 0.8) : 0.45), m, s.ears === 'pointed' ? 'pointed' : 'round'); };
  switch (s.head) {
    case 'bull': {
      const spec: Beast = { c: s.c, len: 0, leg: 0, girth: 0, neck: 0, neckUp: 0, head: H * 1.1, snout: 0.7, snoutR: 1.1, feet: 'hoof', ears: 'small', horns: 'bull', nose: '#3a2a22', iris: '#3a2210' };
      makeHead(g, hc, fwd, spec, { coat: m, face: m, belly: skin(mixHex(s.c, '#e8d4b8', 0.3)), noseM: skin('#3a2a22'), clawM: skin('#e8dcc0'), hairM: skin(tone(s.c, 0.6)) });
      return;
    }
    case 'vulture': {
      // a long bare neck, a feather ruff and a hooked beak
      tube(g, [at(0, -H * 0.6, -H * 0.5), at(0, 0, -H * 0.1), at(0, H * 0.35, H * 0.25)], (t) => H * (0.32 - t * 0.12), skin('#c88a7a', { rough: 0.7 }), { sides: 10 });
      tuftRing(g, at(0, -H * 0.55, -H * 0.5), [0, 0.6, 0.6], H * 0.75, 14, H * 0.7, m, { back: 0.4, rows: 2, thick: 1.3 });
      const hd = at(0, H * 0.45, H * 0.4);
      blob(g, [H * 0.5, H * 0.45, H * 0.6], skin('#c88a7a', { rough: 0.7 }), hd, f);
      tube(g, [add(hd, f, H * 0.4), add(add(hd, f, H * 0.85), [0, -H * 0.05, 0]), add(add(hd, f, H * 1.05), [0, -H * 0.35, 0])], (t) => [H * 0.2 * (1 - t) + 0.004, H * 0.26 * (1 - t) + 0.004], skin('#3a3026', { rough: 0.4 }), { sides: 8, capEnd: false });
      for (const x of [-1, 1]) eye(g, add(add(hd, v3(side), x * H * 0.35), [0, H * 0.12, 0]), H * 0.12, { glow: s.eyeGlow ?? 1, iris: s.eye ?? '#ff4a2a', look: v3(side.clone().multiplyScalar(x * 0.6).add(fwd).normalize()) });
      return;
    }
    case 'frog': {
      blob(g, [H * 1.15, H * 0.75, H * 1.0], m, hc, f);
      blob(g, [H * 0.95, H * 0.3, H * 0.75], m2, at(0, -H * 0.42, H * 0.2), f);
      tube(g, [at(-H * 0.9, -H * 0.2, H * 0.55), at(0, -H * 0.3, H * 0.98), at(H * 0.9, -H * 0.2, H * 0.55)], () => H * 0.04, skin('#3a1010'), { sides: 6 });
      for (const x of [-1, 1]) { blob(g, [H * 0.32, H * 0.32, H * 0.32], m, at(x * H * 0.6, H * 0.55, H * 0.25)); eye(g, at(x * H * 0.6, H * 0.6, H * 0.45), H * 0.22, { iris: s.eye ?? '#e8e070', pupil: 'goat', ...(s.eyeGlow ? { glow: s.eyeGlow } : {}), look: v3(side.clone().multiplyScalar(x * 0.4).add(fwd).normalize()) }); }
      return;
    }
    case 'helm': {
      // an empty helmet: a rounded dome, a cheek guard and a dark visor slit with the light inside
      blob(g, [H * 0.82, H * 0.95, H * 0.88], m, hc, f);
      tube(g, [at(-H * 0.8, -H * 0.1, H * 0.1), at(0, -H * 0.05, H * 0.88), at(H * 0.8, -H * 0.1, H * 0.1)], () => [H * 0.12, H * 0.16], m2, { sides: 8 });
      blob(g, [H * 0.55, H * 0.08, H * 0.2], skin('#0a0a0c'), at(0, H * 0.12, H * 0.72), f);
      for (const x of [-1, 1]) blob(g, [H * 0.08, H * 0.05, H * 0.05], skin(s.eye ?? '#7ad8ff', { glow: 2 }), at(x * H * 0.22, H * 0.12, H * 0.8));
      spikeRow(g, [at(0, H * 0.9, H * 0.4), at(0, H * 1.0, -H * 0.2), at(0, H * 0.7, -H * 0.8)], 5, H * 0.4, m2, { plates: true, lean: 0.3 });
      return;
    }
    default: break;
  }
  const imp = s.head === 'imp';
  blob(g, imp ? [H * 0.9, H * 0.85, H * 0.85] : [H * 0.95, H, H * 0.95], m, hc, f);
  const face = at(0, 0, H * 0.75);
  if (s.head === 'ape' || s.head === 'troll' || s.head === 'ogre' || s.head === 'giant') blob(g, [H * 0.9, H * 0.25, H * 0.35], m, at(0, H * 0.4, H * 0.55), f);
  if (s.head === 'ape') { blob(g, [H * 0.6, H * 0.48, H * 0.42], m2, at(0, -H * 0.35, H * 0.7), f); for (const x of [-1, 1]) blob(g, [H * 0.07, H * 0.05, H * 0.05], skin('#1a1412'), at(x * H * 0.12, -H * 0.2, H * 1.08)); }
  if (s.head === 'troll' || s.head === 'giant' || s.head === 'ogre') tube(g, [at(0, H * 0.15, H * 0.65), at(0, -H * 0.1, H * (0.85 + (s.nose ?? (s.head === 'troll' ? 0.55 : 0.2)) * 0.6)), at(0, -H * (s.head === 'troll' ? 0.35 : 0.15), H * (0.75 + (s.nose ?? (s.head === 'troll' ? 0.55 : 0.2))))], (t) => H * 0.2 * (1 - t * 0.25), m, { sides: 10 });
  if (s.head === 'ogre' || s.head === 'giant' || s.head === 'troll') { blob(g, [H * 0.8, H * 0.4, H * 0.55], m, at(0, -H * 0.55, H * 0.25), f); tube(g, [at(-H * 0.45, -H * 0.42, H * 0.7), at(0, -H * 0.48, H * 0.82), at(H * 0.45, -H * 0.42, H * 0.7)], () => H * 0.035, skin('#3a1010'), { sides: 6 }); }
  if (s.head === 'troll') for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.4; tube(g, [at(Math.sin(a) * H * 0.7, H * 0.7, -H * 0.2 + Math.cos(a) * H * 0.2), at(Math.sin(a) * H * 1.0, H * 0.1, -H * 0.55)], (t) => H * 0.08 * (1 - t), skin(s.hair ?? '#2a3a22'), { sides: 5 }); }
  if (s.head === 'beast') { blob(g, [H * 0.6, H * 0.4, H * 0.5], m2, add(face, [0, -H * 0.4, 0])); teeth(g, add(face, [-H * 0.35, -H * 0.55, H * 0.35]), add(face, [H * 0.35, -H * 0.55, H * 0.35]), 6, H * 0.18, ivory); }
  if (imp) { tube(g, [at(-H * 0.5, -H * 0.35, H * 0.6), at(0, -H * 0.5, H * 0.82), at(H * 0.5, -H * 0.35, H * 0.6)], () => H * 0.05, skin('#2a0a0a'), { sides: 6 }); teeth(g, at(-H * 0.3, -H * 0.4, H * 0.76), at(H * 0.3, -H * 0.4, H * 0.76), 5, H * 0.12, ivory); blob(g, [H * 0.14, H * 0.12, H * 0.16], m, at(0, -H * 0.05, H * 0.85), f); }
  if (s.mandibles) for (const x of [-1, 1]) horn(g, at(x * H * 0.4, -H * 0.5, H * 0.6), v3(side.clone().multiplyScalar(x * 0.3).add(fwd).add(new THREE.Vector3(0, -0.3, 0)).normalize()), H * 0.9, H * 0.12, skin('#1a1210'), { curl: x * 1.2, axis: [0, 1, 0] });
  if (s.tusks) for (const x of [-1, 1]) horn(g, at(x * H * 0.35, -H * 0.55, H * 0.65), [x * 0.2, 1, 0.3], H * 0.45, H * 0.08, ivory, { curl: -0.4, axis: [1, 0, 0] });
  eyes(H * 0.18, H * (imp ? 0.7 : 0.75), H * (imp ? 0.36 : 0.38), H * (imp ? 0.2 : 0.15));
  earsOn(H * (imp ? 0.25 : 0.2), H * (imp ? 0.8 : 0.85));
  if (s.horns === 'demon') for (const x of [-1, 1]) horn(g, at(x * H * 0.5, H * 0.75, 0), [x * 0.4, 1, -0.3], H * 1.4, H * 0.18, skin('#2a1a1a'), { curl: 0.9, axis: [x, 0, 0] });
  if (s.horns === 'curl') for (const x of [-1, 1]) horn(g, at(x * H * 0.45, H * 0.7, -H * 0.1), [x * 0.5, 1, -0.4], H * 1.2, H * 0.15, skin('#2a1a1a'), { curl: 3.2, axis: [x, 0, 0], ridges: true });
  if (s.horns === 'bull') for (const x of [-1, 1]) horn(g, at(x * H * 0.7, H * 0.55, 0), [x, 0.2, 0], H * 1.2, H * 0.16, skin('#e2d6bc'), { curl: x * -1.1, axis: [0, 0, 1] });
}
