/**
 * APEX 2.11 – a sculpted head: one smooth mesh instead of a cluster of balls. A sphere with its pole pointing
 * forward (so the face gets the densest vertices) is pushed and pulled like clay – cranium, temples, brow ridge,
 * eye sockets, the bridge and tip of the nose, cheekbones, lips, the chin, a tapering jaw. Light and shadow then do
 * what painted cheeks and drawn smiles never could: eyes sit in shadow under the brow, the nose casts a shade, the
 * jaw has an edge. `faceAt` returns a point on the same surface, so eyes, brows and the mouth sit exactly on it.
 */
import * as THREE from 'three';

export interface FaceShape {
  /** cranium width / height / depth (head radii) */
  w: number; h: number; d: number;
  /** jaw width at the chin (fraction of the cranium width) */
  jaw: number;
  brow: number; cheek: number;
  /** nose: how far it stands out, how wide, how long, a hook in the bridge, a crooked tip */
  nose: number; noseW: number; noseLen: number; hook: number; crook: number;
  lips: number; chin: number; gaunt: number; chubby: number;
}

const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const g = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));

/** The head surface: a unit direction (x right, y up, z forward) → a point in head radii. */
export function faceAt(f: FaceShape, x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const face = ss(0.12, 0.72, z);
  const low = ss(-0.08, -0.95, y);
  let px = x * f.w * lerp(1, f.jaw, low * (0.55 + 0.45 * ss(-0.3, 0.6, z)));
  let py = y * f.h * (y > 0 ? 1.03 : 1);
  let pz = z * f.d * (z < 0 ? 1.05 : 1);
  // the lower back of the head runs into the neck; the temples are a little flatter
  if (z < 0.25) pz *= lerp(1, 0.8, low * ss(0.25, -0.6, z));
  px *= 1 - 0.06 * g(x, y, Math.sign(x) * 0.85, 0.35, 0.25, 0.3) * ss(-0.2, 0.4, z);
  let d = 0;
  d += f.brow * g(x, y, 0, 0.2, 0.52, 0.075) * face;
  d -= 0.07 * (g(x, y, 0.31, 0.035, 0.13, 0.085) + g(x, y, -0.31, 0.035, 0.13, 0.085)) * face;
  const nx = x - f.crook * ss(-0.05, -0.3, y);
  d += f.nose * (0.75 * g(nx, y, 0, -0.05 - f.noseLen * 0.05, 0.065 * f.noseW, 0.15 * f.noseLen) + g(nx, y, 0, -0.24 - f.noseLen * 0.03, 0.08 * f.noseW, 0.065)) * face;
  d += f.hook * g(nx, y, 0, -0.08, 0.06, 0.06) * face;
  d += 0.03 * f.noseW * (g(nx, y, 0.085 * f.noseW, -0.28, 0.045, 0.04) + g(nx, y, -0.085 * f.noseW, -0.28, 0.045, 0.04)) * face;
  d += f.cheek * (g(x, y, 0.47, -0.08, 0.16, 0.11) + g(x, y, -0.47, -0.08, 0.16, 0.11)) * face;
  d -= f.gaunt * (g(x, y, 0.42, -0.4, 0.12, 0.12) + g(x, y, -0.42, -0.4, 0.12, 0.12)) * face;
  d += f.chubby * (g(x, y, 0.42, -0.32, 0.2, 0.16) + g(x, y, -0.42, -0.32, 0.2, 0.16)) * face;
  // the mouth: a groove between the lips, a fuller lower lip, the dip above the chin
  d -= 0.016 * g(x, y, 0, -0.44, 0.17, 0.016) * face;
  d += f.lips * (0.8 * g(x, y, 0, -0.405, 0.14, 0.03) + g(x, y, 0, -0.475, 0.12, 0.033)) * face;
  d -= 0.018 * g(x, y, 0, -0.6, 0.14, 0.045) * face;
  d += f.chin * g(x, y, 0, -0.78, 0.16, 0.09) * face;
  // the philtrum
  d += 0.012 * g(x, y, 0, -0.36, 0.03, 0.035) * face;
  return out.set(px * (1 + d), py * (1 + d), pz * (1 + d));
}

/** The head mesh (radius `hr`). */
export function headGeometry(f: FaceShape, hr: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 56, 40);
  geo.rotateX(Math.PI / 2); // the pole looks forward: the face gets the densest vertices
  const pos = geo.attributes.position;
  const v = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    faceAt(f, v.x, v.y, v.z, p).multiplyScalar(hr);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A point on the face for a direction given by its x and y (the front hemisphere), pushed `out` head radii outward. */
export function onFace(f: FaceShape, hr: number, x: number, y: number, out = 0): THREE.Vector3 {
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  const p = faceAt(f, x, y, z);
  const n = p.clone().normalize();
  return p.multiplyScalar(hr).add(n.multiplyScalar(out * hr));
}
