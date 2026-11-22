/**
 * APEX 2.11 – heroic figures for "Rome meets magic": adult proportions (the head about a seventh of the body),
 * sculpted serious faces, and gear that reads Roman – tunica with pteruges, lorica segmentata (plate), hamata (chain)
 * and squamata (scale), the galea with cheek guards and a crest, the Corinthian helm, scutum, gladius, a general's
 * cloak with a fibula – next to robes, hoods and glowing staves for the casters. Built from the kit (kit3d.ts) with
 * procedural materials (surface3d.ts). Every option of the FigureLook still works, saved figures stay valid.
 *
 * Facing +z, standing on y = 0; a medium human is ≈ 2 units tall. Meshes are merged per material at the end; the
 * head is its own pivot (idle look-at).
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FigureLook } from '../../game/figure';
import { buildBeard, buildHair, type HeadShape } from './hair3d';
import { faceAt, headGeometry, onFace, type FaceShape } from './head3d';
import { mergeByMaterial } from './merge3d';
import { buildCreature, wing } from './creatures3d';
import { sizeScale } from './sizes';
import { blob, claw, ear, hand, horn, limb, mixHex, part, profile2, skin, tail, tone, tube, type V3 } from './kit3d';
import { offModel, weaponModel, type GearMats } from './gear3d';
import type { Surface } from './surface3d';

export interface LowPolyFigure { group: THREE.Group; height: number; /** flapping wings of a winged mount */ wings?: THREE.Object3D[]; /** the head pivot (turns towards what the figure looks at) */ head?: THREE.Object3D }

/** Ancestry: overall scale, head size, width, leg length, limb thickness, a snout, a stoop. */
interface Anc { s: number; head: number; w: number; leg: number; limb: number; snout?: boolean; bone?: boolean; hunch?: number }
const ANC: Record<FigureLook['body'], Anc> = {
  human: { s: 1, head: 1, w: 1, leg: 1, limb: 1 },
  dwarf: { s: 0.72, head: 1.3, w: 1.32, leg: 0.8, limb: 1.3 },
  elf: { s: 1.04, head: 0.95, w: 0.88, leg: 1.07, limb: 0.85 },
  halfling: { s: 0.58, head: 1.4, w: 1.0, leg: 0.92, limb: 1.0 },
  gnome: { s: 0.52, head: 1.5, w: 0.95, leg: 0.88, limb: 0.95 },
  orc: { s: 1.08, head: 1.04, w: 1.26, leg: 0.98, limb: 1.35, hunch: 0.12 },
  goblin: { s: 0.6, head: 1.55, w: 0.85, leg: 0.88, limb: 0.82, hunch: 0.25 },
  tiefling: { s: 1, head: 1, w: 0.98, leg: 1.02, limb: 0.95 },
  dragonborn: { s: 1.1, head: 1.05, w: 1.25, leg: 1, limb: 1.25, snout: true },
  lizardfolk: { s: 1.02, head: 1, w: 1.05, leg: 1, limb: 1.05, snout: true },
  skeleton: { s: 1, head: 1, w: 0.86, leg: 1, limb: 0.42, bone: true },
  zombie: { s: 0.98, head: 1, w: 1, leg: 0.98, limb: 0.95, hunch: 0.3 },
  ogre: { s: 1.22, head: 0.95, w: 1.6, leg: 0.88, limb: 1.75, hunch: 0.2 },
};
const BUILD: Record<FigureLook['build'], { w: number; arm: number; belly: number; leg: number; delt?: boolean }> = {
  average: { w: 1, arm: 1, belly: 0, leg: 1 }, slender: { w: 0.88, arm: 0.88, belly: 0, leg: 1.03 }, muscular: { w: 1.12, arm: 1.35, belly: 0, leg: 1, delt: true },
  heavy: { w: 1.2, arm: 1.2, belly: 0.06, leg: 0.97 }, slim: { w: 0.88, arm: 0.9, belly: 0, leg: 1.03 }, stocky: { w: 1.12, arm: 1.15, belly: 0.03, leg: 0.92 }, broad: { w: 1.2, arm: 1.22, belly: 0, leg: 1, delt: true },
};
/** The ancestry's own scale (a halfling is smaller than a human); stat-block sizes replace it for enemies. */
export const ancestryScale = (look: FigureLook) => (ANC[look.body] ?? ANC.human).s;

/** Cloth and leather colours a shade quieter: the setting is earnest, not candy. */
const quiet = (hex: string, k = 0.14) => mixHex(tone(hex, 0.9), '#6a6258', k);

/**
 * A draped garment around the body axis: rings from `y0` (top) to `y1` (bottom) with elliptical radii from r0 to r1,
 * folds that deepen towards the hem; `gap` leaves the front open (coats), `arc` < 2π drapes only the back (cloaks).
 */
function drape(g: THREE.Object3D, y0: number, y1: number, r0: [number, number], r1: [number, number], m: THREE.Material, o: { folds?: number; depth?: number; gap?: number; arc?: number; centre?: number; z?: number; flare?: number; hem?: number } = {}): void {
  const rings = 12, seg = 40, arc = o.arc ?? Math.PI * 2, gap = o.gap ?? 0;
  const pos: number[] = [], idx: number[] = [], uv: number[] = [];
  const centre = o.centre ?? Math.PI; // a partial arc hangs at the back (cloaks) unless centred in front (aprons)
  for (let i = 0; i <= rings; i++) {
    const v = i / rings, ease = v * v * (3 - 2 * v);
    const y = y0 + (y1 - y0) * v;
    const rx = r0[0] + (r1[0] - r0[0]) * (o.flare !== undefined ? Math.pow(v, o.flare) : ease), rz = r0[1] + (r1[1] - r0[1]) * (o.flare !== undefined ? Math.pow(v, o.flare) : ease);
    for (let j = 0; j <= seg; j++) {
      const u = j / seg;
      const a = arc < Math.PI * 2 ? centre + (u - 0.5) * arc : gap + u * (Math.PI * 2 - gap * 2);
      const fold = 1 + (o.depth ?? 0.06) * v * Math.sin(a * (o.folds ?? 9) + v * 1.7) + (o.hem ?? 0) * (i === rings ? Math.sin(a * 23) * 0.5 : 0);
      pos.push(Math.sin(a) * rx * fold, y, Math.cos(a) * rz * fold + (o.z ?? 0));
      uv.push(u, v);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  part(g, geo, m);
}
/** A band around the body (armour lame, belt): a short open cone, `w` tall, elliptical. */
function band(g: THREE.Object3D, y: number, rTop: [number, number], rBot: [number, number], w: number, m: THREE.Material, z = 0): void {
  const geo = new THREE.CylinderGeometry(1, rBot[0] / rTop[0], w, 36, 1, true);
  geo.scale(rTop[0], 1, rTop[1]);
  part(g, geo, m, [0, y, z]);
  // a rolled edge top and bottom
  part(g, new THREE.TorusGeometry(1, 0.012 / rTop[0], 5, 36), m, [0, y + w / 2, z], [Math.PI / 2, 0, 0], [rTop[0], rTop[1], 1]);
}

/** APEX 2.11 – a hood that frames the face: a cloth shell with an oval opening (forehead to chin), not an open wedge. */
function hoodGeometry(R: number): THREE.BufferGeometry {
  const src = new THREE.SphereGeometry(1, 44, 28, 0, Math.PI * 2, 0, Math.PI * 0.72).toNonIndexed();
  const pos = src.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  const open = (p: THREE.Vector3) => p.z > 0.2 && p.y < 0.42 - 0.55 * p.x * p.x && Math.abs(p.x) < 0.66;
  const out: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, i + k));
    if (open(c.divideScalar(3).normalize())) continue;
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, i + k); out.push(v.x * R, v.y * R, v.z * R); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  return m;
}

export function buildHero(look: FigureLook, opts: { mountScale?: number } = {}): LowPolyFigure {
  const root = new THREE.Group();
  const g = new THREE.Group(); root.add(g);
  const a = ANC[look.body] ?? ANC.human;
  const b = BUILD[look.build] ?? BUILD.average;
  const fem = look.sex === 'female' && !a.bone;
  const bone = !!a.bone, zombie = look.body === 'zombie';
  const W = a.w * b.w, hunch = a.hunch ?? 0;
  // ---- materials
  const S = (c: string, surface: Surface, o: { rough?: number; metal?: number; glow?: number; side?: boolean } = {}) => skin(c, { surface, rough: o.rough ?? 0.8, ...(o.metal ? { metal: o.metal } : {}), ...(o.glow ? { glow: o.glow } : {}), ...(o.side ? { side: true } : {}) });
  const skinC = zombie ? mixHex(look.skin, '#7a8a6a', 0.5) : look.skin;
  const skinM = bone ? S('#d8d0b8', 'bone', { rough: 0.7 }) : S(skinC, a.snout ? 'scales' : 'skin', { rough: a.snout ? 0.75 : 0.62 });
  const skinD = S(tone(skinC, 0.72), 'skin', { rough: 0.7 });
  const prim = S(quiet(look.primary), 'cloth', { rough: 0.92 }), primD = S(tone(quiet(look.primary), 0.66), 'cloth', { rough: 0.92 });
  const sec = S(quiet(look.secondary), 'cloth', { rough: 0.9 });
  const leather = S(quiet(look.leather, 0.08), 'leather', { rough: 0.72 }), leatherD = S(tone(quiet(look.leather, 0.08), 0.62), 'leather', { rough: 0.75 });
  const metal = S(look.metal, 'metal', { metal: 0.8, rough: 0.36 }), metalD = S(tone(look.metal, 0.62), 'metal', { metal: 0.75, rough: 0.45 });
  const chain = S(tone(look.metal, 0.7), 'chain', { metal: 0.55, rough: 0.6 });
  const scaleM = S(tone(look.metal, 0.85), 'scales', { metal: 0.6, rough: 0.5 });
  const gold = S('#c9a24a', 'metal', { metal: 0.9, rough: 0.3 });
  const hairM = S(look.hairColor, 'hair', { rough: 0.7 });
  const fur = S(mixHex(look.hairColor, '#cdbb98', 0.65), 'fur', { rough: 0.95 });
  const dark = skin('#0c0a09', { rough: 0.6 });
  const boneM = S('#d8d0b8', 'bone', { rough: 0.7 });
  const glowC = look.eyeColor === '#141210' ? '#7fd6ff' : look.eyeColor;
  const gear: GearMats = { metal, metalD, leather, leatherD, prim: S(look.primary, 'leather', { rough: 0.7 }), sec: S(look.secondary, 'cloth'), gold, wood: S('#5a3e26', 'wood', { rough: 0.8 }), glow: skin(glowC, { glow: 1.6 }), flame: skin('#ffb347', { glow: 1.8 }), bone: boneM, dark };
  // ---- skeleton of the figure (canonical human, scaled by the ancestry at the end)
  const L = a.leg * b.leg * (fem ? 0.97 : 1);
  const ankleY = 0.085, kneeY = 0.08 + 0.45 * L, hipY = 0.085 + 0.89 * L;
  const T = 0.66 * (fem ? 0.96 : 1);
  const waistY = hipY + T * 0.3, chestY = hipY + T * 0.66, shY = hipY + T * 0.93, neckY = hipY + T;
  const lean = (y: number) => Math.max(0, (y - hipY) / T) ** 1.5 * hunch * 0.35; // forward stoop
  const hr = 0.105 * a.head * (a.snout ? 1.05 : 1);
  const headY = neckY + 0.045 + hr * 1.02;
  const shX = 0.19 * W * (fem ? 0.87 : 1) * (b.delt ? 1.05 : 1);
  const armR = 0.048 * a.limb * b.arm * (fem ? 0.85 : 1), legR = 0.08 * Math.sqrt(W) * a.limb ** 0.5 * (fem ? 0.95 : 1);
  // torso section [half width, half depth] along the spine: hips → waist → chest → shoulders
  const tp = fem
    ? profile2([[0.158 * W, 0.112 * W], [0.118 * W, 0.092 * W], [0.15 * W, 0.11 * W], [0.15 * W, 0.095 * W]])
    : profile2([[0.142 * W, 0.105 * W], [0.13 * W + b.belly, 0.1 * W + b.belly], [0.172 * W * (b.delt ? 1.06 : 1), 0.118 * W], [0.17 * W * (b.delt ? 1.08 : 1), 0.1 * W]]);
  const torsoAt = (y: number) => tp(Math.max(0, Math.min(1, (y - hipY) / T)));
  const armoured = ['chain', 'scale', 'plate'].includes(look.torso);
  const robeLike = ['robe', 'cultrobe', 'dress'].includes(look.torso) || look.legs === 'robe';

  // ---------------------------------------------------------------- legs and feet
  const riding = look.mount !== 'none' && !!look.mount;
  const legM = bone ? boneM : look.legs === 'greaves' ? leatherD : look.legs === 'trousers' ? S(quiet(tone(look.leather, 0.85), 0.1), 'cloth') : look.legs === 'rags' ? S(tone(quiet(look.primary), 0.5), 'cloth') : look.legs === 'shorts' || look.legs === 'kilt' || look.legs === 'skirt' ? skinM : primD;
  const bootM = look.boots === 'armored' ? metal : look.boots === 'bare' ? skinM : look.boots === 'sandals' ? skinM : look.boots === 'wraps' ? S(mixHex(look.secondary, '#cdbf9f', 0.6), 'cloth') : leatherD;
  const footAt = (sx: number): V3 => riding ? [sx * (0.11 * W + 0.26), hipY - L * 0.85, 0.24] : [sx * 0.12 * W, 0, sx > 0 ? -0.05 : 0.06];
  for (const sx of [-1, 1]) {
    const hipP: V3 = [sx * 0.092 * W, hipY, 0];
    const f = footAt(sx);
    const knee: V3 = riding ? [sx * (0.11 * W + 0.2), hipY - 0.06, 0.32] : [sx * 0.105 * W, kneeY, (f[2] + 0.03) * 0.8 + 0.02];
    const ankle: V3 = riding ? [f[0], f[1] + 0.06, f[2]] : [f[0], ankleY, f[2] - 0.01];
    limb(g, [hipP, knee, ankle], [legR * 1.15, legR * 0.7, legR * 0.46], legM, bone ? 0.05 : 0.22, 12);
    // knee and calf mass
    if (!bone) blob(g, [legR * 0.6, legR * 0.72, legR * 0.62], legM, [knee[0], knee[1] - (riding ? 0 : L * 0.12), knee[2] - 0.025]);
    // feet: boots, caligae (sandals with straps), wraps, greaves
    const toe: V3 = [ankle[0] * 1.02, 0.03 + (riding ? f[1] : 0), ankle[2] + 0.16];
    tube(g, [[ankle[0], ankle[1] - 0.02, ankle[2] - 0.05], [ankle[0], (ankle[1] + toe[1]) / 2, ankle[2] + 0.06], toe], (t) => [0.052 - t * 0.012, 0.045 - t * 0.022], bootM, { sides: 12 });
    if (look.boots === 'sandals') { for (let i = 0; i < 4; i++) part(g, new THREE.TorusGeometry(legR * 0.52, 0.007, 4, 14), leatherD, [ankle[0], ankle[1] + 0.02 + i * 0.04, ankle[2]], [Math.PI / 2, 0, 0]); tube(g, [[ankle[0], 0.012 + (riding ? f[1] : 0), ankle[2] - 0.06], [toe[0], 0.012 + (riding ? f[1] : 0), toe[2] + 0.02]], () => [0.055, 0.01], leatherD, { sides: 8 }); }
    if (look.boots === 'tall' || look.boots === 'armored' || look.boots === 'boots') tube(g, [[ankle[0], ankle[1] - 0.03, ankle[2]], [knee[0] * 0.99, (ankle[1] + knee[1]) / 2, (ankle[2] + knee[2]) / 2], [knee[0], knee[1] - (look.boots === 'boots' ? L * 0.26 : 0.03), knee[2]]], (t) => legR * (0.62 + t * 0.12) + (look.boots === 'armored' ? 0.008 : 0.004), bootM, { sides: 12 });
    if (look.boots === 'wraps') for (let i = 0; i < 5; i++) part(g, new THREE.TorusGeometry(legR * 0.55, 0.012, 4, 14), bootM, [ankle[0], ankle[1] + 0.03 + i * 0.05, ankle[2] + i * 0.005], [Math.PI / 2 + 0.15, 0, 0]);
    if (look.legs === 'greaves' || look.boots === 'armored') { tube(g, [[ankle[0], ankle[1] + 0.06, ankle[2] + 0.025], [knee[0], knee[1] - 0.02, knee[2] + 0.035]], (t) => [legR * 0.6, legR * (0.5 + t * 0.15)], metal, { sides: 10 }); blob(g, [legR * 0.62, legR * 0.6, legR * 0.45], metalD, [knee[0], knee[1], knee[2] + legR * 0.4]); }
  }
  // the pelvis and what is worn over the hips
  blob(g, [torsoAt(hipY)[0] * 0.98, 0.1, torsoAt(hipY)[1] * 0.98], robeLike ? prim : legM === skinM ? primD : legM, [0, hipY + 0.02, 0]);
  const hipR = torsoAt(hipY);
  if (!riding) {
    if (look.legs === 'kilt' || look.legs === 'skirt' || look.torso === 'tunic' || look.torso === 'shirt') drape(g, hipY + 0.06, hipY - (look.legs === 'skirt' ? L * 0.55 : L * 0.32), [hipR[0] * 1.06, hipR[1] * 1.08], [hipR[0] * 1.32, hipR[1] * 1.35], look.legs === 'kilt' ? sec : prim, { folds: 11, depth: 0.05 });
    if (robeLike) drape(g, waistY, 0.04, [torsoAt(waistY)[0] * 1.05, torsoAt(waistY)[1] * 1.06], [hipR[0] * 1.75, hipR[1] * 1.6], prim, { folds: 9, depth: 0.08, flare: 1.4 });
    if (look.torso === 'coat') drape(g, waistY, kneeY - 0.05, [torsoAt(waistY)[0] * 1.08, torsoAt(waistY)[1] * 1.1], [hipR[0] * 1.5, hipR[1] * 1.45], prim, { folds: 7, depth: 0.05, gap: 0.35 });
    if (look.legs === 'rags' || look.torso === 'rags') drape(g, hipY + 0.04, hipY - L * 0.4, [hipR[0] * 1.06, hipR[1] * 1.08], [hipR[0] * 1.3, hipR[1] * 1.3], S(tone(quiet(look.primary), 0.5), 'cloth'), { folds: 7, depth: 0.1, hem: 0.18 });
  } else if (robeLike || look.legs === 'kilt' || look.torso === 'tunic') drape(g, hipY + 0.06, hipY - 0.25, [hipR[0] * 1.1, hipR[1] * 1.1], [hipR[0] * 1.7, hipR[1] * 1.55], prim, { folds: 9, depth: 0.06 });
  // pteruges: leather strips over the hips of soldiers
  if (armoured || look.torso === 'leather' || look.torso === 'studded') for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2; if (Math.abs(Math.sin(ang)) > 0.97) continue;
    const r = torsoAt(hipY), x = Math.sin(ang) * r[0] * 1.12, z = Math.cos(ang) * r[1] * 1.14;
    const strip = part(g, new THREE.BoxGeometry(0.045, 0.2, 0.012), leatherD, [x, hipY - 0.06, z]);
    strip.rotation.set(Math.cos(ang) * 0.12, ang, -Math.sin(ang) * 0.12);
    blob(g, [0.008, 0.008, 0.006], gold, [x * 1.02, hipY - 0.15, z * 1.02]);
  }

  // ---------------------------------------------------------------- torso
  const torsoM = bone ? boneM : look.torso === 'vest' ? sec : look.torso === 'bare' ? skinM : look.torso === 'leather' || look.torso === 'studded' ? leather : look.torso === 'furs' ? leather : look.torso === 'shirt' || look.torso === 'apron' ? sec : armoured ? prim : prim;
  const spine: V3[] = [[0, hipY - 0.02, 0], [0, waistY, lean(waistY)], [0, chestY, lean(chestY) + 0.01], [0, neckY + 0.01, lean(neckY)]];
  if (bone) {
    tube(g, spine, () => 0.022, boneM, { sides: 8 });
    for (let i = 0; i < 6; i++) { const y = chestY + 0.1 - i * 0.055, r = torsoAt(y); tube(g, [[-r[0] * 0.9, y - 0.03, -0.02], [-r[0], y, r[1] * 0.4], [0, y + 0.02, r[1] * 0.95], [r[0], y, r[1] * 0.4], [r[0] * 0.9, y - 0.03, -0.02]], () => 0.011, boneM, { sides: 6 }); }
    blob(g, [hipR[0] * 0.9, 0.07, hipR[1] * 0.8], boneM, [0, hipY + 0.02, 0]);
  } else {
    tube(g, spine, (t) => { const y = hipY + t * T; return torsoAt(y); }, torsoM, { sides: 20, steps: 28 });
    if (fem && look.torso === 'bare') drape(g, chestY + 0.07, chestY - 0.08, [torsoAt(chestY)[0] * 1.04, torsoAt(chestY)[1] * 1.12], [torsoAt(chestY)[0] * 1.03, torsoAt(chestY)[1] * 1.1], sec, { folds: 3, depth: 0.01 });
    if (fem) blob(g, [0.118 * W, 0.058, 0.04], torsoM === skinM ? sec : torsoM, [0, chestY - 0.02, torsoAt(chestY)[1] * 0.74 + lean(chestY)], [0, -0.25, 1]);
    // pectorals / the back of the shoulders
    if (!fem && (look.torso === 'bare' || look.torso === 'vest' || b.delt)) for (const sx of [-1, 1]) blob(g, [0.075 * W, 0.05, 0.035], torsoM, [sx * 0.07 * W, chestY + 0.02, torsoAt(chestY)[1] * 0.85 + lean(chestY)]);
  }
  const front = (y: number) => torsoAt(y)[1] + lean(y) + 0.008;
  // armour and garments on the torso
  switch (look.torso) {
    case 'plate': {
      // lorica segmentata: overlapping bands round the body, shoulder lames, brass fittings
      for (let i = 0; i < 6; i++) { const y = waistY - 0.02 + i * ((chestY + 0.05 - waistY) / 5); const r = torsoAt(y); band(g, y, [r[0] * 1.08, r[1] * 1.12], [r[0] * 1.1, r[1] * 1.15], 0.055, metal, lean(y)); }
      for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) { const ang = 0.25 + k * 0.32; tube(g, [[sx * 0.04, shY + 0.04 - k * 0.012, -torsoAt(shY)[1] * 0.9], [sx * (shX * 0.8 + Math.sin(ang) * 0.05), shY + 0.06 - k * 0.02, 0], [sx * 0.05, shY + 0.03 - k * 0.012, torsoAt(shY)[1] * 0.95]], () => [0.03, 0.008], metal, { sides: 6, steps: 10 }); }
      for (let i = 0; i < 3; i++) blob(g, [0.012, 0.012, 0.006], gold, [0.03, chestY - 0.02 - i * 0.07, front(chestY) + 0.01]);
      tube(g, [[-0.07, neckY - 0.01, torsoAt(neckY)[1] * 0.8], [0, neckY - 0.03, torsoAt(neckY)[1] * 1.05], [0.07, neckY - 0.01, torsoAt(neckY)[1] * 0.8]], () => [0.012, 0.03], metalD, { sides: 6 });
      break;
    }
    case 'chain': { // lorica hamata with a doubled shoulder cape
      const r0 = torsoAt(chestY);
      drape(g, neckY - 0.01, hipY - 0.12, [r0[0] * 1.02, r0[1] * 1.08], [hipR[0] * 1.15, hipR[1] * 1.2], chain, { folds: 6, depth: 0.03 });
      drape(g, neckY + 0.01, chestY - 0.03, [torsoAt(neckY)[0] * 1.05, torsoAt(neckY)[1] * 1.15], [shX * 1.15, r0[1] * 1.25], chain, { folds: 5, depth: 0.02 });
      break;
    }
    case 'scale': { // lorica squamata
      const r0 = torsoAt(chestY);
      drape(g, neckY - 0.01, hipY - 0.1, [r0[0] * 1.03, r0[1] * 1.08], [hipR[0] * 1.14, hipR[1] * 1.18], scaleM, { folds: 4, depth: 0.02 });
      break;
    }
    case 'leather': case 'studded': {
      // a moulded cuirass: a breast plate and a back plate
      for (const z of [1, -1]) blob(g, [torsoAt(chestY)[0] * 1.02, T * 0.32, torsoAt(chestY)[1] * 0.6], leather, [0, chestY - 0.04, z * torsoAt(chestY)[1] * 0.55 + lean(chestY)]);
      if (look.torso === 'studded') for (let i = 0; i < 12; i++) blob(g, [0.01, 0.01, 0.006], metal, [((i % 4) - 1.5) * 0.06, chestY + 0.06 - Math.floor(i / 4) * 0.07, front(chestY) + 0.012]);
      break;
    }
    case 'robe': case 'cultrobe': {
      const r0 = torsoAt(chestY);
      drape(g, neckY, waistY, [torsoAt(neckY)[0] * 1.08, torsoAt(neckY)[1] * 1.12], [r0[0] * 1.08, r0[1] * 1.15], prim, { folds: 7, depth: 0.04 });
      tube(g, [[0, neckY, front(neckY) + 0.01], [0, waistY - 0.02, front(waistY) + 0.012]], () => [0.035, 0.006], sec, { sides: 6 });
      if (look.torso === 'cultrobe') { blob(g, [0.035, 0.035, 0.01], skin(glowC, { glow: 1.2 }), [0, chestY, front(chestY) + 0.02]); drape(g, neckY + 0.03, chestY + 0.02, [torsoAt(neckY)[0] * 1.15, torsoAt(neckY)[1] * 1.3], [shX * 1.2, r0[1] * 1.35], primD, { folds: 6, depth: 0.05 }); }
      break;
    }
    case 'coat': drape(g, neckY, waistY, [torsoAt(neckY)[0] * 1.08, torsoAt(neckY)[1] * 1.12], [torsoAt(waistY)[0] * 1.1, torsoAt(waistY)[1] * 1.15], prim, { folds: 5, depth: 0.03, gap: 0.28 }); for (let i = 0; i < 4; i++) blob(g, [0.01, 0.01, 0.006], gold, [0.04, chestY + 0.06 - i * 0.07, front(chestY) + 0.01]); break;
    case 'vest': drape(g, neckY - 0.02, hipY + 0.02, [torsoAt(chestY)[0] * 1.05, torsoAt(chestY)[1] * 1.08], [hipR[0] * 1.06, hipR[1] * 1.08], prim, { gap: 0.45, folds: 3, depth: 0.02 }); break;
    case 'dress': drape(g, neckY - 0.02, waistY, [torsoAt(neckY)[0] * 1.04, torsoAt(neckY)[1] * 1.08], [torsoAt(waistY)[0] * 1.04, torsoAt(waistY)[1] * 1.06], prim, { folds: 4, depth: 0.02 }); break;
    case 'furs': drape(g, neckY + 0.02, chestY - 0.04, [torsoAt(neckY)[0] * 1.2, torsoAt(neckY)[1] * 1.4], [shX * 1.25, torsoAt(chestY)[1] * 1.4], fur, { folds: 13, depth: 0.12, hem: 0.2 }); break;
    case 'apron': drape(g, chestY + 0.05, kneeY, [torsoAt(chestY)[0] * 1.03, torsoAt(chestY)[1] * 1.08], [hipR[0] * 1.15, hipR[1] * 1.25], leather, { arc: 1.9, centre: 0, folds: 3, depth: 0.02 }); break;
    default: break;
  }
  // belts: cingulum, sash, pouches, rope
  const beltY = waistY - 0.035, br = torsoAt(beltY);
  if (look.belt !== 'none' || armoured) {
    const bm = look.belt === 'sash' ? sec : look.belt === 'rope' ? S('#b8a37a', 'cloth') : leatherD;
    band(g, beltY, [br[0] * (armoured ? 1.16 : 1.06), br[1] * (armoured ? 1.2 : 1.08)], [br[0] * (armoured ? 1.16 : 1.06), br[1] * (armoured ? 1.2 : 1.08)], look.belt === 'rope' ? 0.025 : 0.045, bm, lean(beltY));
    if (look.belt === 'belt' || armoured) { blob(g, [0.028, 0.022, 0.01], gold, [0, beltY, br[1] * (armoured ? 1.2 : 1.08) + lean(beltY) + 0.005]); if (armoured) for (let i = 0; i < 5; i++) part(g, new THREE.BoxGeometry(0.022, 0.18, 0.008), leatherD, [(i - 2) * 0.03, beltY - 0.11, br[1] * 1.22 + lean(beltY)]); }
    if (look.belt === 'pouches') for (const sx of [-1, 1]) blob(g, [0.045, 0.05, 0.03], leather, [sx * br[0] * 0.8, beltY - 0.04, br[1] * 0.75]);
    if (look.belt === 'sash') tube(g, [[br[0] * 0.5, beltY, br[1]], [br[0] * 0.6, beltY - 0.15, br[1] * 1.1], [br[0] * 0.55, beltY - 0.3, br[1] * 1.05]], () => [0.035, 0.006], sec, { sides: 6 });
  }

  // ---------------------------------------------------------------- shoulders and arms
  for (const sx of [-1, 1]) {
    const p: V3 = [sx * (shX + 0.01), shY + 0.02, lean(shY)];
    if (look.shoulders === 'plate' || look.shoulders === 'spiked') for (let k = 0; k < 3; k++) blob(g, [0.09 - k * 0.006, 0.05, 0.085 - k * 0.006], k ? metalD : metal, [p[0] + sx * k * 0.012, p[1] - k * 0.03, p[2]], [sx * 0.6, 1, 0]);
    if (look.shoulders === 'spiked') claw(g, [p[0] + sx * 0.03, p[1] + 0.04, p[2]], [sx * 0.6, 1, 0], 0.12, 0.022, metalD, 0);
    if (look.shoulders === 'pads') blob(g, [0.08, 0.04, 0.075], leather, p, [sx * 0.5, 1, 0]);
    if (look.shoulders === 'fur') blob(g, [0.1, 0.065, 0.1], fur, p);
  }
  const sleeve = bone ? boneM : ['bare', 'vest'].includes(look.torso) ? skinM : look.torso === 'plate' ? prim : look.torso === 'chain' ? chain : look.torso === 'scale' ? scaleM : torsoM === skinM ? skinM : torsoM;
  const foreM = ['robe', 'cultrobe', 'coat', 'dress'].includes(look.torso) ? sleeve : bone ? boneM : look.torso === 'plate' || look.torso === 'leather' || look.torso === 'studded' || look.torso === 'chain' ? skinM : sleeve;
  const hands: THREE.Group[] = [];
  const holds = (sx: number) => (sx > 0 ? look.main !== 'none' : look.off !== 'none');
  const shieldOff = ['towershield', 'roundshield', 'kiteshield', 'buckler'].includes(look.off);
  const twoHanded = ['greatsword', 'greataxe', 'warhammer', 'halberd', 'staff', 'spear', 'bow', 'crossbow', 'scythe', 'trident'].includes(look.main);
  for (const sx of [1, -1]) {
    const sh: V3 = [sx * shX, shY - 0.02, lean(shY)];
    let elbow: V3, wrist: V3;
    if (zombie) { elbow = [sx * (shX - 0.01), shY - 0.08, 0.24]; wrist = [sx * (shX - 0.03), shY - 0.12, 0.48]; }
    else if (sx > 0 && holds(1)) { elbow = [sx * (shX + 0.07), shY - 0.27, -0.03 + lean(shY)]; wrist = [sx * (shX + 0.05), shY - 0.45, 0.16 + lean(shY)]; }
    else if (sx < 0 && shieldOff) { elbow = [sx * (shX + 0.06), shY - 0.25, 0.05 + lean(shY)]; wrist = [sx * (shX - 0.01), shY - 0.36, 0.22 + lean(shY)]; }
    else if (sx < 0 && twoHanded) { elbow = [sx * (shX + 0.03), shY - 0.26, 0.08 + lean(shY)]; wrist = [sx * (shX - 0.08), shY - 0.42, 0.24 + lean(shY)]; }
    else if (sx < 0 && holds(-1)) { elbow = [sx * (shX + 0.06), shY - 0.27, 0.0 + lean(shY)]; wrist = [sx * (shX + 0.03), shY - 0.44, 0.18 + lean(shY)]; }
    else { elbow = [sx * (shX + 0.05), shY - 0.28, -0.04 + lean(shY)]; wrist = [sx * (shX + 0.06), shY - 0.53, 0.03 + lean(shY)]; }
    if (look.body === 'goblin' || look.body === 'ogre') { wrist = [wrist[0], wrist[1] - 0.06, wrist[2]]; }
    // upper arm in the sleeve, forearm bare (soldiers) or sleeved (robes)
    limb(g, [sh, elbow], [armR * 1.2, armR * 0.86], sleeve, bone ? 0.03 : b.arm > 1.15 ? 0.35 : 0.2, 12);
    limb(g, [elbow, wrist], [armR * 0.88, armR * 0.62], foreM, bone ? 0.03 : 0.25, 12);
    if (!bone) blob(g, [armR * 1.45, armR * 1.25, armR * 1.4], sleeve, [sh[0] + sx * 0.008, sh[1] + 0.005, sh[2]]);
    if (['plate', 'leather', 'studded'].includes(look.torso) && !bone) tube(g, [[wrist[0], wrist[1] + 0.02, wrist[2] - 0.01], [(wrist[0] + elbow[0]) / 2, (wrist[1] + elbow[1]) / 2, (wrist[2] + elbow[2]) / 2]], () => armR * 0.82, leatherD, { sides: 10 }); // bracers
    if (look.extra === 'tattoos' && foreM === skinM) part(g, new THREE.TorusGeometry(armR * 0.9, 0.006, 4, 12), S(tone(look.skin, 0.45), 'skin'), [(sh[0] + elbow[0]) / 2, (sh[1] + elbow[1]) / 2, (sh[2] + elbow[2]) / 2], [Math.PI / 2, 0, 0]);
    // the hand: a group at the fist, so gear held there keeps its old frame
    const hg = new THREE.Group(); hg.position.set(wrist[0], wrist[1] - 0.055, wrist[2] + 0.02); g.add(hg);
    const handM = look.torso === 'plate' && look.boots === 'armored' ? metal : bone ? boneM : skinM;
    hand(hg, [0, 0.055, -0.02], [0, -0.85, 0.5], [-sx, 0, 0.1], 0.16 * Math.sqrt(a.limb), handM, { curl: holds(sx) || (sx < 0 && twoHanded) ? 0.92 : zombie ? 0.2 : 0.45, thick: bone ? 0.45 : look.body === 'ogre' || look.body === 'orc' ? 1.3 : 1 });
    hands.push(hg);
  }

  // ---------------------------------------------------------------- neck and head
  if (!bone) tube(g, [[0, neckY - 0.05, lean(neckY) - 0.01], [0, neckY + 0.06, lean(neckY) + 0.012]], (t) => [0.052 * W ** 0.5 * (b.delt ? 1.2 : 1) * (fem ? 0.85 : 1) - t * 0.006, 0.05 * (fem ? 0.85 : 1)], skinM, { sides: 12 });
  else tube(g, [[0, neckY - 0.04, lean(neckY)], [0, neckY + 0.06, lean(neckY)]], () => 0.018, boneM, { sides: 6 });
  const head = new THREE.Group(); head.position.set(0, headY, lean(neckY) * 1.3 + hunch * 0.06); g.add(head);
  const shape = (bone ? 'round' : look.head) as HeadShape;
  const hs: V3 = shape === 'square' ? [1.06, 1, 1.02] : shape === 'oval' ? [0.92, 1.08, 0.98] : shape === 'long' ? [0.88, 1.12, 0.96] : shape === 'wide' ? [1.12, 0.94, 1] : shape === 'pointed' ? [0.94, 1.04, 1] : [1, 1, 1];
  const jawW = look.face === 'strongjaw' ? 0.82 : look.face === 'softjaw' || fem ? 0.66 : look.face === 'gaunt' ? 0.6 : 0.72;
  const fz = hr * 0.9 * hs[2];
  // APEX 2.11 – a sculpted head (head3d.ts) for every face; skulls and snouts keep their own build
  const kind = look.body, brute = kind === 'orc' || kind === 'ogre';
  const F: FaceShape | null = a.snout || bone ? null : {
    w: 0.8 * hs[0] * (brute ? 1.08 : kind === 'dwarf' ? 1.05 : 1), h: hs[1], d: 0.95 * hs[2],
    jaw: (look.face === 'strongjaw' ? 0.88 : look.face === 'softjaw' ? 0.7 : look.face === 'gaunt' ? 0.66 : fem ? 0.68 : 0.78) * (brute ? 1.12 : kind === 'elf' ? 0.92 : kind === 'dwarf' ? 1.06 : 1),
    brow: (fem ? 0.025 : 0.055) + (brute ? 0.06 : kind === 'dwarf' || kind === 'goblin' ? 0.03 : 0) + (look.brows === 'bushy' ? 0.01 : 0),
    cheek: kind === 'elf' || look.face === 'gaunt' ? 0.05 : 0.03,
    nose: look.nose === 'none' ? 0.02 : (fem ? 0.12 : 0.16) * (look.nose === 'broad' ? 1.1 : look.nose === 'long' ? 1.3 : ['small', 'button', 'snub'].includes(look.nose) ? 0.7 : 1) * (kind === 'goblin' ? 1.6 : kind === 'dwarf' ? 1.25 : brute ? 0.7 : 1),
    noseW: (look.nose === 'broad' ? 1.45 : 1) * (brute ? 1.6 : kind === 'dwarf' ? 1.25 : kind === 'elf' ? 0.85 : 1) * (fem ? 0.88 : 1),
    noseLen: (look.nose === 'long' ? 1.2 : 1) * (kind === 'goblin' ? 1.3 : 1),
    hook: look.nose === 'hooked' || look.nose === 'aquiline' ? 0.06 : 0,
    crook: look.nose === 'crooked' ? 0.05 : 0,
    lips: fem || look.mouth === 'lips' || look.mouth === 'pout' ? 0.035 : 0.018,
    chin: look.face === 'strongjaw' ? 0.075 : fem ? 0.03 : 0.05,
    gaunt: look.face === 'gaunt' || zombie ? 0.06 : 0,
    chubby: look.face === 'chubby' ? 0.06 : 0,
  };
  if (F) part(head, headGeometry(F, hr), skinM);
  else {
    blob(head, [hr * 0.9 * hs[0], hr * 1.02 * hs[1], hr * 1.0 * hs[2]], skinM, [0, hr * 0.06, -hr * 0.04], undefined, 1.4);
    if (!a.snout) {
      blob(head, [hr * jawW * hs[0], hr * 0.52, hr * 0.7], skinM, [0, -hr * 0.5, hr * 0.12]);
      blob(head, [hr * 0.78 * hs[0], hr * 0.16, hr * 0.3], boneM, [0, hr * 0.2, fz - hr * 0.2]);
    } else {
      // dragonborn and lizardfolk: a long snout, a jaw and brow plates
      tube(head, [[0, -hr * 0.1, hr * 0.3], [0, -hr * 0.22, hr * 1.0], [0, -hr * 0.3, hr * 1.5]], (t) => [hr * 0.55 * (1 - t * 0.35), hr * 0.42 * (1 - t * 0.3)], skinM, { sides: 14 });
      tube(head, [[0, -hr * 0.55, hr * 0.35], [0, -hr * 0.6, hr * 1.35]], (t) => [hr * 0.45 * (1 - t * 0.35), hr * 0.13], skinD, { sides: 12 });
      blob(head, [hr * 0.75, hr * 0.18, hr * 0.5], skinM, [0, hr * 0.3, hr * 0.35]);
      for (const sx of [-1, 1]) blob(head, [hr * 0.05, hr * 0.04, hr * 0.04], dark, [sx * hr * 0.14, -hr * 0.22, hr * 1.55]);
      if (look.body === 'lizardfolk') for (let i = 0; i < 4; i++) claw(head, [0, hr * (0.9 - i * 0.05), -hr * i * 0.35], [0, 1, -0.6], hr * (0.5 - i * 0.06), hr * 0.12, sec, -0.3);
      for (const sx of [-1, 1]) horn(head, [sx * hr * 0.5, hr * 0.55, -hr * 0.3], [sx * 0.3, 0.4, -1], hr * 1.3, hr * 0.14, S('#d8ccb0', 'bone'), { curl: 0.5, axis: [sx, 0, 0] });
    }
  }
  const on = (x: number, y: number, out = 0): V3 => { const p = F ? onFace(F, hr, x, y, out) : new THREE.Vector3(x * hr * 0.9, y * hr, fz + out * hr); return [p.x, p.y, p.z]; };
  // eyes: an eyeball deep in the socket under a heavy upper lid; glowing or hollow for the eerie
  const ey = hr * 0.06, ex = hr * 0.33, ez = fz - hr * 0.06;
  const re = hr * (fem ? 0.1 : 0.094) * (kind === 'goblin' ? 1.25 : 1);
  const lidDrop = look.eyes === 'angry' || look.eyes === 'narrow' ? 0.12 : look.eyes === 'wide' ? -0.3 : look.eyes === 'closed' || look.eyes === 'sleepy' ? 0.9 : -0.06; // the upper lid's edge sits at 1.3 + drop rad from straight up
  for (const sx of [-1, 1]) {
    const surf = F ? onFace(F, hr, sx * 0.31, 0.035) : null;
    const p: V3 = a.snout ? [sx * hr * 0.46, hr * 0.12, hr * 0.62] : surf ? (() => { const n = surf.clone().normalize(); const c = surf.clone().sub(n.multiplyScalar(re * 0.42)); return [c.x, c.y, c.z] as V3; })() : [sx * ex, ey, ez];
    if (bone || look.eyes === 'hollow') {
      blob(head, [hr * 0.13, hr * 0.1, hr * 0.06], dark, [p[0], p[1] + hr * 0.01, p[2] + (F ? re * 0.2 : -hr * 0.04)]);
      if (look.eyes === 'glowing' || bone) blob(head, [hr * 0.05, hr * 0.05, hr * 0.03], skin(glowC, { glow: 2.2 }), [p[0], p[1], p[2] + (F ? re * 0.5 : 0)]);
      continue;
    }
    if (look.eyes === 'glowing') { blob(head, [re * 1.05, re * 0.8, re * 0.7], skin(glowC, { glow: 2.4 }), p); continue; }
    if (look.eyes === 'patch' && sx < 0) { blob(head, [hr * 0.15, hr * 0.13, hr * 0.05], leatherD, [p[0], p[1], p[2] + re * 0.6]); tube(head, [[-hr * 0.95, hr * 0.25, 0], [0, hr * 0.34, hr * 0.98], [hr * 0.95, hr * 0.25, 0]], () => hr * 0.025, leatherD, { sides: 5 }); continue; }
    const look3 = new THREE.Vector3(sx * 0.1, -0.04, 1).normalize();
    const at = (k: number, dx = 0, dy = 0): V3 => [p[0] + look3.x * re * k + dx, p[1] + look3.y * re * k + dy, p[2] + look3.z * re * k];
    blob(head, [re, re * 0.86, re * 0.92], skin('#b9b0a2', { rough: 0.35 }), p);
    if (!(look.eyes === 'closed' || look.eyes === 'sleepy')) {
      blob(head, [re * 0.62, re * 0.62, re * 0.3], skin(tone(look.eyeColor, 0.8), { rough: 0.25 }), at(0.78, 0, -re * 0.05));
      blob(head, [re * 0.3, re * 0.3, re * 0.14], dark, at(0.97, 0, -re * 0.05));
      blob(head, [re * 0.1, re * 0.1, re * 0.05], skin('#ffffff', { glow: 0.4 }), at(1.02, re * 0.16, re * 0.12));
    }
    // the lids: skin caps over the ball – the upper one heavy, the lower one a rim
    const lid = new THREE.Mesh(new THREE.SphereGeometry(re * 1.12, 16, 8, 0, Math.PI * 2, 0, 1.3), skinM);
    lid.position.set(...p); lid.rotation.set(lidDrop, sx * 0.12, -sx * (look.eyes === 'angry' ? 0.18 : 0.05)); head.add(lid);
    const low = new THREE.Mesh(new THREE.SphereGeometry(re * 1.06, 16, 5, 0, Math.PI * 2, Math.PI - 1.0, 1.0), skinM);
    low.position.set(...p); low.rotation.set(-0.45, 0, 0); head.add(low);
    if (look.eyes === 'scarred' && sx > 0) tube(head, [[p[0] + hr * 0.05, p[1] + hr * 0.25, p[2] + re * 0.6], [p[0] - hr * 0.05, p[1] - hr * 0.25, p[2] + re * 0.7]], () => hr * 0.02, skin('#8e4a52'), { sides: 5 });
  }
  // brows: hair on the brow ridge
  if (!bone && !a.snout && look.brows !== 'none') for (const sx of [-1, 1]) {
    const tilt = look.brows === 'angry' ? -0.06 : look.brows === 'worried' ? 0.06 : look.brows === 'raised' || look.brows === 'arched' ? 0.03 : look.eyes === 'angry' || look.eyes === 'narrow' ? -0.035 : -0.01;
    const lift = look.brows === 'raised' ? 0.04 : 0;
    const thick = look.brows === 'bushy' ? 0.04 : look.brows === 'thick' || look.brows === 'unibrow' ? 0.032 : 0.022;
    tube(head, [on(sx * 0.15, 0.19 + lift + tilt * 0.6, 0.012), on(sx * 0.3, 0.215 + lift, 0.018), on(sx * 0.45, 0.19 + lift - tilt * 0.4, 0.008)], (t) => hr * thick * (1 - Math.abs(t - 0.35) * 0.6), hairM, { sides: 6 });
    if (look.brows === 'unibrow' && sx > 0) tube(head, [on(-0.15, 0.19, 0.012), on(0, 0.18, 0.015), on(0.15, 0.19, 0.012)], () => hr * thick * 0.8, hairM, { sides: 6 });
  }
  // nose (only the old build needs a separate one)
  if (!F && !bone && !a.snout && look.nose !== 'none') tube(head, [[0, ey + hr * 0.02, fz - hr * 0.08], [0, -hr * 0.12, fz + hr * 0.1], [0, -hr * 0.27, fz + hr * 0.14]], (t) => [hr * (0.06 + t * 0.07), hr * (0.07 + t * 0.03)], skinM, { sides: 8 });
  // mouth: the line between the lips, a touch of colour; fangs and tusks
  if (!bone && !a.snout) {
    const curve = look.mouth === 'smile' ? 0.012 : look.mouth === 'smirk' ? 0.01 : look.mouth === 'frown' ? -0.018 : -0.004;
    const lineM = S(mixHex(skinC, '#2a1210', 0.55), 'skin', { rough: 0.6 });
    const xs = [-0.15, -0.075, 0, 0.075, 0.15];
    tube(head, xs.map((x) => on(x, -0.44 + curve * (Math.abs(x) / 0.15) ** 1.5 * (look.mouth === 'smirk' ? (x > 0 ? 2 : 0) : 1), 0.004)), () => hr * 0.01, lineM, { sides: 5 });
    const lipM = look.face === 'lipstick' ? skin('#7a1a2a', { rough: 0.4 }) : S(mixHex(skinC, '#8a3a3a', fem ? 0.38 : 0.2), 'skin');
    if (fem || look.mouth === 'lips' || look.mouth === 'pout' || look.face === 'lipstick') blob(head, [hr * 0.12, hr * 0.03, hr * 0.03], lipM, on(0, -0.475, -0.012));
    if (look.mouth === 'open' || look.mouth === 'snarl' || look.mouth === 'teeth' || look.mouth === 'grin') blob(head, [hr * 0.11, hr * 0.05, hr * 0.03], dark, on(0, -0.45, -0.01));
    if (look.mouth === 'tusks' || brute) for (const sx of [-1, 1]) claw(head, on(sx * 0.17, -0.5, -0.02), [sx * 0.15, 1, 0.25], hr * 0.32, hr * 0.06, boneM, -0.3);
    if (look.mouth === 'fangs' || look.mouth === 'snarl') for (const sx of [-1, 1]) claw(head, on(sx * 0.07, -0.43, 0), [0, -1, 0.2], hr * 0.14, hr * 0.03, boneM, 0);
  }
  if (bone) { blob(head, [hr * 0.62, hr * 0.3, hr * 0.6], boneM, [0, -hr * 0.62, hr * 0.15]); for (let i = 0; i < 6; i++) part(head, new THREE.BoxGeometry(hr * 0.07, hr * 0.1, hr * 0.05), boneM, [(i - 2.5) * hr * 0.09, -hr * 0.5, hr * 0.68]); blob(head, [hr * 0.06, hr * 0.08, hr * 0.04], dark, [0, -hr * 0.22, fz]); }
  // ears
  const ears = look.ears === 'normal' && ['elf', 'tiefling'].includes(look.body) ? 'pointed' : look.ears === 'normal' && (look.body === 'goblin' || look.body === 'orc') ? 'big' : look.ears;
  if (!a.snout && !bone && ears !== 'none') for (const sx of [-1, 1]) {
    const ep: V3 = F ? (() => { const q = faceAt(F, sx * 0.99, -0.05, -0.12).multiplyScalar(hr * 0.97); return [q.x, q.y, q.z] as V3; })() : [sx * hr * 0.86 * hs[0], -hr * 0.05, -hr * 0.05];
    if (ears === 'normal') blob(head, [hr * 0.07, hr * 0.19, hr * 0.12], skinM, ep, [sx, 0, 0.4]);
    else ear(head, ep, [sx * 0.9, ears === 'big' ? 0.2 : 0.55, -0.35], hr * (ears === 'long' ? 0.42 : ears === 'big' ? 0.55 : 0.3), skinM, ears === 'long' ? 'long' : 'pointed', skinD);
  }
  // face marks
  const mark = (pts: V3[], c: string, r = 0.02) => tube(head, pts, () => hr * r, skin(c, { rough: 0.7 }), { sides: 5 });
  if (look.extra === 'warpaint') for (const sx of [-1, 1]) mark([[sx * hr * 0.25, hr * 0.12, fz - hr * 0.05], [sx * hr * 0.5, -hr * 0.3, fz - hr * 0.2]], '#7a1a14', 0.035);
  if (look.extra === 'scar' || look.face === 'cheekscar') mark([[-hr * 0.55, hr * 0.15, fz - hr * 0.2], [-hr * 0.35, -hr * 0.35, fz - hr * 0.1]], '#8e4a52');
  if (look.extra === 'tattoos' || look.face === 'facetattoo') for (let i = 0; i < 3; i++) mark([[hr * (0.3 + i * 0.08), hr * 0.1, fz - hr * (0.12 + i * 0.05)], [hr * (0.35 + i * 0.08), -hr * 0.35, fz - hr * (0.18 + i * 0.05)]], '#23304a', 0.015);
  if (look.face === 'wrinkles') for (let i = 0; i < 2; i++) mark([[-hr * 0.3, hr * (0.4 + i * 0.1), fz - hr * 0.16], [hr * 0.3, hr * (0.4 + i * 0.1), fz - hr * 0.16]], tone(skinC, 0.7), 0.012);
  if (look.face === 'eyeliner') for (const sx of [-1, 1]) mark([[sx * (ex + hr * 0.06), ey - hr * 0.01, ez], [sx * (ex + hr * 0.16), ey + hr * 0.03, ez - hr * 0.04]], '#141010', 0.014);
  if (look.face === 'nosering') part(head, new THREE.TorusGeometry(hr * 0.05, hr * 0.008, 4, 10), gold, [hr * 0.08, -hr * 0.3, fz + hr * 0.08], [0, Math.PI / 2, 0]);
  if (look.extra === 'earring') part(head, new THREE.TorusGeometry(hr * 0.06, hr * 0.01, 4, 10), gold, [hr * 0.88, -hr * 0.28, 0], [0, Math.PI / 2, 0]);
  if (look.extra === 'monocle') part(head, new THREE.TorusGeometry(hr * 0.12, hr * 0.012, 4, 14), gold, [ex, ey, ez + hr * 0.05]);
  if (look.extra === 'pipe') tube(head, [[hr * 0.1, -hr * 0.5, fz], [hr * 0.25, -hr * 0.62, fz + hr * 0.35], [hr * 0.32, -hr * 0.5, fz + hr * 0.55]], () => hr * 0.03, leatherD, { sides: 6 });
  // beard, hair, horns
  const hatCover = ['hood', 'cowl', 'greathelm', 'turban'].includes(look.hat) ? 'full' : ['helmet', 'horned', 'cap', 'tricorn', 'feathercap', 'strawhat', 'wizard', 'skullcap', 'bandana'].includes(look.hat) ? 'brim' : 'none';
  const surf = F ? (x: number, y: number, z: number) => faceAt(F, x, y, z) : undefined;
  if (!bone && !a.snout) buildBeard(head, look.beard, hr * (F ? 1.005 : 0.96), shape, fz * 0.98, { hair: hairM, skinMix: S(mixHex(skinC, look.hairColor, F ? 0.28 : 0.45), 'skin'), gold }, surf);
  if (!bone && !a.snout) buildHair(head, look.hair, hr * (F ? 0.985 : 0.97), shape, { hair: hairM, dark: S(tone(look.hairColor, 0.7), 'hair'), shaved: S(mixHex(skinC, look.hairColor, 0.5), 'skin'), tie: sec }, hatCover, surf);
  const hornM = S('#2e2420', 'bone', { rough: 0.55 }), ivory = S('#d8ccb0', 'bone');
  const horns = look.horns === 'none' && look.body === 'tiefling' ? 'curled' : look.horns;
  for (const sx of [-1, 1]) {
    if (horns === 'small') horn(head, [sx * hr * 0.35, hr * 0.8, hr * 0.15], [sx * 0.3, 1, -0.3], hr * 0.5, hr * 0.1, hornM, { curl: 0.4, axis: [sx, 0, 0] });
    if (horns === 'curled') horn(head, [sx * hr * 0.42, hr * 0.72, hr * 0.1], [sx * 0.4, 1, -0.4], hr * 1.3, hr * 0.13, hornM, { curl: 2.6, axis: [sx, 0, 0], ridges: true });
    if (horns === 'ram') horn(head, [sx * hr * 0.6, hr * 0.55, -hr * 0.1], [sx, 0.6, -0.4], hr * 1.7, hr * 0.17, ivory, { curl: 4, axis: [sx, 0, 0], spiral: sx * 0.6, ridges: true });
    if (horns === 'long') horn(head, [sx * hr * 0.35, hr * 0.8, -hr * 0.2], [sx * 0.25, 0.7, -1], hr * 1.8, hr * 0.13, hornM, { curl: 0.6, axis: [sx, 0, 0], ridges: true });
  }
  // ---------------------------------------------------------------- headwear
  const hatM = look.hat === 'hood' || look.hat === 'cowl' ? S(tone(quiet(look.primary), 0.7), 'cloth', { side: true }) : prim;
  const R = hr * 1.12;
  switch (look.hat) {
    case 'helmet': {
      // galea: a bowl, a brow ridge, a flared neck guard, cheek guards and a crest of horsehair
      part(head, new THREE.SphereGeometry(R, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), metal, [0, hr * 0.12, -hr * 0.04], [0, 0, 0], [0.95 * hs[0], 1, 1.02]);
      tube(head, [[-R * 0.95, hr * 0.12, 0], [0, hr * 0.3, R * 1.05], [R * 0.95, hr * 0.12, 0]], () => [hr * 0.06, hr * 0.03], metalD, { sides: 8 });
      tube(head, [[-R * 0.9, hr * 0.05, -hr * 0.3], [0, -hr * 0.08, -R * 1.25], [R * 0.9, hr * 0.05, -hr * 0.3]], () => [hr * 0.03, hr * 0.2], metal, { sides: 8 });
      for (const sx of [-1, 1]) tube(head, [[sx * R * 0.9, hr * 0.1, hr * 0.15], [sx * R * 0.92, -hr * 0.35, hr * 0.35], [sx * R * 0.75, -hr * 0.72, hr * 0.45]], (t) => [hr * 0.04, hr * (0.22 - t * 0.06)], metal, { sides: 8 });
      const crest = S(look.secondary === '#d8b25a' ? '#8a1a14' : look.secondary, 'fur', { rough: 1 });
      tube(head, [[0, R * 1.0 + hr * 0.1, R * 0.7], [0, R * 1.35 + hr * 0.1, 0], [0, R * 1.05 + hr * 0.1, -R * 0.9]], (t) => [hr * 0.1, hr * (0.28 - Math.abs(t - 0.45) * 0.2)], crest, { sides: 10, steps: 18 });
      break;
    }
    case 'greathelm': {
      // Corinthian helm: a closed face with eye openings and a T-slit, a tall crest
      blob(head, [R * 1.0 * hs[0], R * 1.12, R * 1.05], metal, [0, hr * 0.02, 0], undefined, 1.3);
      for (const sx of [-1, 1]) blob(head, [hr * 0.18, hr * 0.07, hr * 0.06], dark, [sx * hr * 0.3, hr * 0.06, R * 0.98]);
      blob(head, [hr * 0.06, hr * 0.35, hr * 0.05], dark, [0, -hr * 0.4, R * 0.98]);
      tube(head, [[0, R * 1.05, R * 0.6], [0, R * 1.5, 0], [0, R * 1.1, -R * 1.0]], (t) => [hr * 0.09, hr * (0.32 - Math.abs(t - 0.4) * 0.22)], S(look.secondary, 'fur', { rough: 1 }), { sides: 10, steps: 18 });
      break;
    }
    case 'horned': part(head, new THREE.SphereGeometry(R, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), metal, [0, hr * 0.12, -hr * 0.04]); tube(head, [[0, R, R * 0.4], [0, hr * -0.1, R * 1.05]], () => [hr * 0.05, hr * 0.03], metalD, { sides: 6 }); for (const sx of [-1, 1]) horn(head, [sx * R * 0.85, hr * 0.45, 0], [sx, 0.5, 0], hr * 1.5, hr * 0.15, ivory, { curl: -1.4, axis: [0, 0, sx] }); break;
    case 'hood': case 'cowl': {
      part(head, hoodGeometry(R * 1.12), hatM, [0, hr * 0.05, -hr * 0.08]);
      if (look.hat === 'cowl') horn(head, [0, R * 0.9, -R * 0.6], [0, 0.4, -1], hr * 1.4, hr * 0.4, hatM, { curl: 1, axis: [1, 0, 0] });
      drape(g, neckY + 0.05, chestY + 0.04, [torsoAt(neckY)[0] * 0.95, torsoAt(neckY)[1] * 1.15], [shX * 1.08, torsoAt(chestY)[1] * 1.25], hatM, { folds: 7, depth: 0.04 });
      break;
    }
    case 'wizard': drape(head, hr * 0.62, hr * 0.6, [R * 1.9, R * 1.9], [R * 1.95, R * 1.95], prim, { folds: 5, depth: 0.03 }); horn(head, [0, hr * 0.55, -hr * 0.05], [0, 1, -0.15], hr * 2.6, R * 0.98, prim, { curl: -0.7, axis: [1, 0, 0] }); part(head, new THREE.TorusGeometry(R * 1.0, hr * 0.05, 5, 24), sec, [0, hr * 0.7, -hr * 0.05], [Math.PI / 2, 0, 0]); break;
    case 'crown': for (let i = 0; i < 16; i++) { const ang = (i / 16) * Math.PI * 2; if (Math.abs(Math.sin(ang)) < 0.12 && Math.cos(ang) > 0) continue; blob(head, [hr * 0.12, hr * 0.05, hr * 0.03], gold, [Math.sin(ang) * R * 0.98, hr * 0.52 + Math.cos(ang * 2) * hr * 0.03, Math.cos(ang) * R * 0.98], [Math.cos(ang), 0.6, -Math.sin(ang)]); } break; // laurel wreath
    case 'circlet': part(head, new THREE.TorusGeometry(R * 0.98, hr * 0.03, 5, 28), gold, [0, hr * 0.38, 0], [Math.PI / 2 - 0.1, 0, 0]); blob(head, [hr * 0.06, hr * 0.06, hr * 0.03], skin(glowC, { glow: 1.6 }), [0, hr * 0.35, R * 1.0]); break;
    case 'cap': part(head, new THREE.SphereGeometry(R * 1.02, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), prim, [0, hr * 0.15, -hr * 0.02], [0.1, 0, 0]); break; // pileus
    case 'bandana': part(head, new THREE.SphereGeometry(R * 1.0, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), sec, [0, hr * 0.12, 0]); tube(head, [[0, hr * 0.3, -R * 0.95], [hr * 0.05, -hr * 0.1, -R * 1.15]], () => [hr * 0.1, hr * 0.02], sec, { sides: 6 }); break;
    case 'headband': part(head, new THREE.TorusGeometry(R * 0.95, hr * 0.06, 5, 28), sec, [0, hr * 0.4, 0], [Math.PI / 2, 0, 0]); break;
    case 'tricorn': drape(head, hr * 0.62, hr * 0.7, [R * 1.55, R * 1.55], [R * 1.45, R * 1.45], S('#1d1612', 'leather'), { folds: 3, depth: 0.2 }); part(head, new THREE.SphereGeometry(R * 0.95, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), S('#1d1612', 'leather'), [0, hr * 0.62, 0]); break;
    case 'feathercap': part(head, new THREE.SphereGeometry(R * 1.02, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), prim, [0, hr * 0.15, 0], [0, 0, -0.15]); tube(head, [[hr * 0.5, hr * 0.9, -hr * 0.3], [hr * 0.8, hr * 1.5, -hr * 0.9], [hr * 0.6, hr * 1.9, -hr * 1.6]], (t) => [hr * 0.12 * Math.sin(Math.PI * Math.min(1, t + 0.1)), hr * 0.02], sec, { sides: 6 }); break;
    case 'strawhat': drape(head, hr * 0.7, hr * 0.5, [R * 1.0, R * 1.0], [R * 2.1, R * 2.1], S('#bfa56a', 'wood'), { folds: 1, depth: 0 }); part(head, new THREE.CylinderGeometry(R * 0.85, R * 0.95, hr * 0.5, 20), S('#bfa56a', 'wood'), [0, hr * 0.9, 0]); break;
    case 'turban': for (let i = 0; i < 4; i++) part(head, new THREE.TorusGeometry(R * (0.95 - i * 0.12), hr * 0.18, 8, 24), prim, [0, hr * (0.4 + i * 0.18), 0], [Math.PI / 2 + (i % 2 ? 0.15 : -0.15), 0, 0]); blob(head, [hr * 0.08, hr * 0.08, hr * 0.04], skin(glowC, { glow: 1.5 }), [0, hr * 0.5, R * 1.12]); break;
    case 'skullcap': part(head, new THREE.SphereGeometry(R * 0.98, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), leather, [0, hr * 0.15, 0]); break;
    case 'antlers': for (const sx of [-1, 1]) { horn(head, [sx * hr * 0.5, hr * 0.8, 0], [sx * 0.6, 1, -0.1], hr * 2.2, hr * 0.06, S('#6b4a2b', 'wood'), { curl: 0.3, axis: [0, 0, 1] }); for (let k = 1; k <= 2; k++) horn(head, [sx * hr * (0.5 + k * 0.35), hr * (0.8 + k * 0.6), 0], [sx * 0.2, 1, 0.4], hr * 0.7, hr * 0.04, S('#6b4a2b', 'wood'), { curl: 0.3, axis: [1, 0, 0] }); } break;
    case 'mask': blob(head, [hr * 0.85, hr * 0.42, hr * 0.3], S(tone(look.primary, 0.5), 'leather'), [0, -hr * 0.45, fz - hr * 0.1]); break;
    default: break;
  }
  // neck jewellery and scarf
  if (look.extra === 'necklace' || look.extra === 'amulet') { part(g, new THREE.TorusGeometry(0.075, 0.006, 4, 20), gold, [0, neckY - 0.03, 0.03 + lean(neckY)], [Math.PI / 2 - 0.5, 0, 0]); if (look.extra === 'amulet') blob(g, [0.025, 0.03, 0.012], skin(glowC, { glow: 1.6 }), [0, chestY + 0.04, front(chestY) + 0.01]); }
  if (look.extra === 'scarf') { part(g, new THREE.TorusGeometry(0.085, 0.03, 8, 20), sec, [0, neckY, lean(neckY)], [Math.PI / 2, 0, 0]); tube(g, [[0.04, neckY - 0.02, front(neckY)], [0.07, chestY, front(chestY) + 0.03], [0.06, waistY, front(waistY) + 0.02]], () => [0.035, 0.008], sec, { sides: 6 }); }

  // ---------------------------------------------------------------- cloak and back
  if (look.cloak !== 'none') {
    const cm = look.cloak === 'cape' ? S(quiet(look.secondary), 'cloth', { side: true }) : look.cloak === 'fur' ? S(quiet(look.leather), 'fur', { side: true }) : S(tone(quiet(look.primary), 0.62), 'cloth', { side: true });
    const len = look.cloak === 'short' || look.cloak === 'mantle' ? T * 0.75 : shY - 0.12;
    drape(g, shY + 0.03, shY + 0.03 - len, [shX * 1.05, torsoAt(shY)[1] * 1.45], [shX * 1.55, torsoAt(shY)[1] * 2.6], cm, { arc: Math.PI * (look.cloak === 'mantle' ? 1.7 : 1.15), folds: 11, depth: 0.09, z: -0.02 + lean(shY), hem: look.cloak === 'tattered' ? 0.25 : 0 });
    if (look.cloak === 'fur' || look.cloak === 'mantle') part(g, new THREE.TorusGeometry(torsoAt(shY)[0] * 1.1, 0.05, 8, 22), look.cloak === 'fur' ? fur : cm, [0, shY + 0.03, lean(shY)], [Math.PI / 2, 0, 0], [1, torsoAt(shY)[1] / torsoAt(shY)[0] * 1.3, 1]);
    // the fibula on the right shoulder
    part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.012, 16), gold, [shX * 0.7, shY + 0.02, torsoAt(shY)[1] * 0.9 + lean(shY)], [Math.PI / 2, 0, 0]);
  }
  const backZ = -torsoAt(chestY)[1] - 0.04;
  switch (look.back) {
    case 'backpack': blob(g, [0.16 * W, 0.18, 0.09], leather, [0, chestY - 0.05, backZ - 0.05]); tube(g, [[-0.14, chestY + 0.1, backZ - 0.08], [0.14, chestY + 0.1, backZ - 0.08]], () => 0.05, S(quiet(look.secondary), 'cloth'), { sides: 10 }); break;
    case 'quiver': tube(g, [[0.08, waistY - 0.05, backZ - 0.03], [-0.08, shY + 0.12, backZ - 0.05]], () => 0.045, leather, { sides: 10 }); for (let i = 0; i < 4; i++) tube(g, [[-0.07 + i * 0.012, shY + 0.1, backZ - 0.05], [-0.11 + i * 0.012, shY + 0.22, backZ - 0.06]], () => 0.007, S('#d8ccb0', 'cloth'), { sides: 4 }); break;
    case 'bedroll': tube(g, [[-0.18, shY + 0.02, backZ - 0.05], [0.18, shY + 0.02, backZ - 0.05]], () => 0.06, S('#4a5a32', 'cloth'), { sides: 12 }); break;
    case 'banner': { tube(g, [[0.12, waistY, backZ - 0.03], [0.12, shY + 0.75, backZ - 0.05]], () => 0.012, gear.wood, { sides: 6 }); part(g, new THREE.PlaneGeometry(0.34, 0.46, 1, 1), S(look.primary, 'cloth', { side: true }), [0.12, shY + 0.48, backZ - 0.05]); tube(g, [[-0.05, shY + 0.71, backZ - 0.05], [0.29, shY + 0.71, backZ - 0.05]], () => 0.01, gold, { sides: 5 }); blob(g, [0.06, 0.06, 0.01], gold, [0.12, shY + 0.5, backZ - 0.04]); break; } // vexillum
    case 'scabbard': tube(g, [[-0.16, waistY - 0.05, backZ - 0.01], [0.12, shY + 0.1, backZ - 0.03]], () => [0.03, 0.015], leatherD, { sides: 8 }); break;
    case 'wings': case 'batwings': case 'fairywings': case 'dragonwings': {
      const kind = look.back === 'wings' ? 'feather' : look.back === 'fairywings' ? 'insect' : 'membrane';
      const c1 = look.back === 'wings' ? '#e8e2d4' : look.back === 'dragonwings' ? look.primary : tone(look.primary, 0.5);
      const c2 = look.back === 'wings' ? '#d8ccb4' : look.back === 'fairywings' ? '#c8e8ff' : look.back === 'dragonwings' ? look.secondary : tone(look.primary, 0.7);
      for (const sx of [-1, 1]) { const w = wing([sx * 0.08, shY - 0.04, backZ], sx, look.back === 'fairywings' ? 0.8 : 1.15, kind, c1, c2); w.rotation.y = sx * 0.55; w.rotation.z = sx * 0.35; g.add(w); }
      break;
    }
    default: break;
  }
  if (look.tail || look.body === 'tiefling' || look.body === 'dragonborn' || look.body === 'lizardfolk') {
    const thick = look.body !== 'tiefling';
    if (thick) tail(g, [[0, hipY - 0.02, -hipR[1] * 0.7], [0, hipY - 0.25, -hipR[1] - 0.25], [0.05, 0.1, -hipR[1] - 0.6], [-0.04, 0.04, -hipR[1] - 0.95]], 0.1, skinM);
    else tail(g, [[0, hipY - 0.02, -hipR[1] * 0.8], [0, hipY - 0.3, -hipR[1] - 0.2], [0.06, hipY - 0.5, -hipR[1] - 0.45], [0, hipY - 0.38, -hipR[1] - 0.72]], 0.025, skinM, { end: 'spade' });
  }

  // ---------------------------------------------------------------- gear in the hands
  const [mainHand, offHand] = hands;
  const weapon = weaponModel(look.main, gear);
  if (weapon) { weapon.obj.rotation.x = weapon.tilt; weapon.obj.position.y = -weapon.grip * Math.cos(weapon.tilt); weapon.obj.position.z = -weapon.grip * Math.sin(weapon.tilt); mainHand.add(weapon.obj); }
  const offItem = offModel(look.off, gear);
  if (offItem) offHand.add(offItem);

  // the whole figure on the ancestry's scale, merged for speed
  g.scale.setScalar(a.s);
  const hatH = ({ wizard: hr * 3.0, helmet: hr * 1.8, greathelm: hr * 2.0, crown: hr * 1.2, antlers: hr * 2.6, horned: hr * 1.6, cowl: hr * 1.6, strawhat: hr * 1.3, feathercap: hr * 2.0, turban: hr * 1.4 } as Record<string, number>)[look.hat] ?? hr * 1.15;
  let height = (headY + hatH) * a.s;
  root.updateMatrixWorld(true);
  const headMatrix = head.matrixWorld.clone();
  head.parent?.remove(head);
  head.position.set(0, 0, 0); head.updateMatrixWorld(true);
  const headMerged = mergeByMaterial(head);
  const merged = mergeByMaterial(root);
  const headPivot = new THREE.Group(); headPivot.applyMatrix4(headMatrix); headPivot.add(headMerged); headPivot.userData.head = true;
  merged.add(headPivot);
  if (!riding) return { group: merged, height, head: headPivot };
  const mount = buildCreature(look.mount, undefined, false);
  if (!mount) return { group: merged, height, head: headPivot };
  const ms = (mount.ride ?? sizeScale(mount.size)) * (opts.mountScale ?? 1);
  mount.group.scale.setScalar(ms);
  const seat = mount.seat ?? [0, mount.height * 0.6, 0];
  merged.position.set(seat[0] * ms, seat[1] * ms - hipY * a.s + 0.04, seat[2] * ms);
  const out = new THREE.Group(); out.add(mount.group, merged);
  height = merged.position.y + height;
  return { group: out, height, wings: mount.wings, head: headPivot };
}
