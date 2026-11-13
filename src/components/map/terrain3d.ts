/**
 * APEX 2.5 – smooth hex terrain for the 3D map (inspired by hex strategy games): instead of flat-topped columns
 * with 90° steps, the ground is one continuous surface. Every hex keeps its own height at its centre (figures and
 * props stand there), but its corners take the average height of the walkable neighbours sharing them, so slopes
 * flow from hex to hex. Where neighbours are not connected – cliffs (more than one 5-ft level), walls, the map's
 * outer edge – the surface breaks and a rock wall drops to the lower side. Meadows get a gentle wave.
 *
 * Purely visual: the rules keep using each hex's height (see hexScene.ts stepCost / heightLookup).
 */
import * as THREE from 'three';
import { parseKey, type HexKey } from '../../game/hex';
import { HEX_SIZE, center } from './geometry';

export interface TerrainCell {
  /** World y of the hex's surface at its centre. */
  top: number;
  /** Surface family (texture / material group). */
  family: string;
  color: THREE.Color;
  /** Not blended with any neighbour (walls, pits): straight sides all round. */
  apart?: boolean;
  /** Gentle waves on the surface (meadows, earth). */
  wavy?: boolean;
}

const cornerOffset = (i: number) => { const a = (Math.PI / 180) * (60 * i - 30); return { x: Math.cos(a), z: Math.sin(a) }; };
const worldOf = (k: HexKey) => { const c = center(parseKey(k)); return { x: c.x / HEX_SIZE, z: c.y / HEX_SIZE }; };
const posKey = (x: number, z: number) => `${Math.round(x * 100)},${Math.round(z * 100)}`;

export interface Terrain {
  /** Surface meshes per family, plus `walls`. */
  meshes: Map<string, THREE.Mesh>;
  /** World y of the surface at a point inside hex `k` (dx, dz relative to its centre). */
  surfaceY: (k: HexKey, dx: number, dz: number) => number;
}

/**
 * Builds the surfaces. `connectStep`: the largest height difference (world units) still blended (one level).
 * `materials(family)` gives the material per family; `wallMaterial` the cliff sides.
 */
export function buildTerrain(cells: Map<HexKey, TerrainCell>, connectStep: number, materials: (family: string) => THREE.Material, wallMaterial: THREE.Material, floorY = 0): Terrain {
  // which hexes share each corner position
  const share = new Map<string, HexKey[]>();
  const cornerKeys = new Map<HexKey, string[]>();
  for (const [k] of cells) {
    const w = worldOf(k);
    const keys: string[] = [];
    for (let i = 0; i < 6; i++) { const o = cornerOffset(i); const pk = posKey(w.x + o.x, w.z + o.z); keys.push(pk); const l = share.get(pk); if (l) l.push(k); else share.set(pk, [k]); }
    cornerKeys.set(k, keys);
  }
  const connected = (a: TerrainCell, b: TerrainCell) => !a.apart && !b.apart && Math.abs(a.top - b.top) <= connectStep + 1e-6;
  /** Height of hex k's corner i: the mean of k and the connected hexes sharing that corner. */
  const cornerH = new Map<HexKey, number[]>();
  const cornerCol = new Map<HexKey, THREE.Color[]>();
  for (const [k, c] of cells) {
    const hs: number[] = [], cs: THREE.Color[] = [];
    for (const pk of cornerKeys.get(k)!) {
      let sum = 0, n = 0;
      const col = new THREE.Color(0, 0, 0); let cn = 0;
      for (const o of share.get(pk)!) {
        const oc = cells.get(o)!;
        if (o !== k && !connected(c, oc)) continue;
        sum += oc.top; n++;
        if (oc.family === c.family) { col.add(oc.color); cn++; }
      }
      hs.push(sum / n); cs.push(col.multiplyScalar(1 / Math.max(1, cn)));
    }
    cornerH.set(k, hs); cornerCol.set(k, cs);
  }
  const wave = (x: number, z: number) => Math.sin(x * 1.7 + z * 0.6) * 0.045 + Math.sin(x * 0.55 - z * 1.9 + 1.3) * 0.04 + Math.sin((x + z) * 3.1) * 0.015;

  // ---- surfaces per family: centre, an inner ring and the 6 shared corners (smooth normals across hexes)
  type Buf = { pos: number[]; col: number[]; idx: number[]; shared: Map<string, number> };
  const bufs = new Map<string, Buf>();
  const buf = (f: string) => { let b = bufs.get(f); if (!b) { b = { pos: [], col: [], idx: [], shared: new Map() }; bufs.set(f, b); } return b; };
  const vert = (b: Buf, x: number, y: number, z: number, c: THREE.Color, key?: string) => {
    if (key) { const hit = b.shared.get(key); if (hit !== undefined) return hit; }
    const i = b.pos.length / 3;
    b.pos.push(x, y, z); b.col.push(c.r, c.g, c.b);
    if (key) b.shared.set(key, i);
    return i;
  };
  for (const [k, c] of cells) {
    const b = buf(c.family);
    const w = worldOf(k);
    const hs = cornerH.get(k)!, cs = cornerCol.get(k)!;
    const wv = c.wavy ? wave : () => 0;
    const ci = vert(b, w.x, c.top + wv(w.x, w.z) * 0.6, w.z, c.color);
    const inner: number[] = [], outer: number[] = [];
    for (let i = 0; i < 6; i++) {
      const o = cornerOffset(i);
      // corners are shared within a family only when their heights agree (cliffs keep separate vertices)
      const ck = `${cornerKeys.get(k)![i]}@${hs[i].toFixed(3)}`;
      outer.push(vert(b, w.x + o.x, hs[i], w.z + o.z, cs[i], ck));
      const ix = w.x + o.x * 0.55, iz = w.z + o.z * 0.55;
      inner.push(vert(b, ix, c.top + (hs[i] - c.top) * 0.42 + wv(ix, iz), iz, c.color.clone().lerp(cs[i], 0.35)));
    }
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      b.idx.push(ci, inner[j], inner[i]);
      b.idx.push(inner[i], inner[j], outer[i]);
      b.idx.push(inner[j], outer[j], outer[i]);
    }
  }
  const meshes = new Map<string, THREE.Mesh>();
  for (const [f, b] of bufs) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, materials(f));
    m.receiveShadow = true;
    meshes.set(f, m);
  }

  // ---- walls: where a hex is not connected to the lower neighbour across an edge (or the edge of the land)
  const wp: number[] = [], wuv: number[] = [], widx: number[] = [];
  const edgeOwner = new Map<string, HexKey[]>();
  for (const [k] of cells) { const ck = cornerKeys.get(k)!; for (let i = 0; i < 6; i++) { const e = [ck[i], ck[(i + 1) % 6]].sort().join('|'); const l = edgeOwner.get(e); if (l) l.push(k); else edgeOwner.set(e, [k]); } }
  const quad = (ax: number, az: number, ay1: number, ay0: number, bx: number, bz: number, by1: number, by0: number) => {
    if (ay1 - ay0 < 0.01 && by1 - by0 < 0.01) return;
    const i = wp.length / 3;
    wp.push(ax, ay1, az, bx, by1, bz, bx, by0, bz, ax, ay0, az);
    const len = Math.hypot(bx - ax, bz - az);
    wuv.push(0, ay1 * 0.6, len, by1 * 0.6, len, by0 * 0.6, 0, ay0 * 0.6);
    widx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  for (const [k, c] of cells) {
    const ck = cornerKeys.get(k)!, hs = cornerH.get(k)!, w = worldOf(k);
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      const e = [ck[i], ck[j]].sort().join('|');
      const other = edgeOwner.get(e)!.find((o) => o !== k);
      const oa = cornerOffset(i), ob = cornerOffset(j);
      const ax = w.x + oa.x, az = w.z + oa.z, bx = w.x + ob.x, bz = w.z + ob.z;
      if (!other) { quad(ax, az, hs[i], floorY, bx, bz, hs[j], floorY); continue; }
      const oc = cells.get(other)!;
      if (connected(c, oc)) continue;
      // only the higher side builds the wall, down to the lower side's corners at the same places
      if (oc.top > c.top) continue;
      const ohs = cornerH.get(other)!, ock = cornerKeys.get(other)!;
      const lo = (pk: string) => ohs[ock.indexOf(pk)];
      quad(ax, az, hs[i], Math.min(hs[i], lo(ck[i])), bx, bz, hs[j], Math.min(hs[j], lo(ck[j])));
    }
  }
  if (wp.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
    g.setIndex(widx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, wallMaterial);
    m.castShadow = true; m.receiveShadow = true;
    meshes.set('walls', m);
  }

  const surfaceY = (k: HexKey, dx: number, dz: number) => {
    const c = cells.get(k);
    if (!c) return 0;
    const hs = cornerH.get(k)!;
    const r = Math.min(1, Math.hypot(dx, dz) / 0.866);
    let a = (Math.atan2(dz, dx) * 180) / Math.PI + 30; a = ((a % 360) + 360) % 360;
    const i = Math.floor(a / 60) % 6, t = (a - i * 60) / 60;
    const edge = hs[i] + (hs[(i + 1) % 6] - hs[i]) * t;
    return c.top + (edge - c.top) * r;
  };
  return { meshes, surfaceY };
}
