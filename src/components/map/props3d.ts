/**
 * APEX 2.1 – 3D asset library for the battle tiles added in 2.1: farm & village, town & city, interiors, crypts.
 * Low-poly, flat-shaded, true scale (1 ft ≈ 0.346 units, a hex is 5 ft across; one 5-ft level = 1.73 units).
 *
 * Buildings are painted hex by hex: every building hex is a wall block with a six-sided roof cap, so a cluster of
 * painted hexes reads as one house with a lively roofscape (thatch, red tiles, slate …).
 */
import * as THREE from 'three';

const cache = new Map<string, THREE.Material>();
function M(color: THREE.ColorRepresentation, o: { glow?: boolean; metal?: boolean; rough?: number; side?: boolean; opacity?: number } = {}): THREE.Material {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}|${JSON.stringify(o)}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: o.rough ?? (o.metal ? 0.35 : 0.9), metalness: o.metal ? 0.6 : 0, ...(o.glow ? { emissive: c, emissiveIntensity: 1 } : {}), ...(o.side ? { side: THREE.DoubleSide } : {}), ...(o.opacity ? { transparent: true, opacity: o.opacity } : {}) });
    cache.set(key, m);
  }
  return m;
}
function put(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz);
  o.castShadow = true; o.receiveShadow = true;
  g.add(o);
  return o;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 7, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const cone = (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg);
const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);
const dodec = (r: number) => new THREE.DodecahedronGeometry(r, 0);

const WOOD = '#8a5f36', DARKWOOD = '#5a3d22', STONE = '#8a847a', DARKSTONE = '#5e5a54', WHITEWASH = '#e8e0cc', THATCH = '#c9a85a', REDTILE = '#9a3a2a', SLATE = '#4a5058', IRON = '#3a3632', GOLD = '#d8b25a';

/** A building hex: wall prism (radius ≈ the hex) with beams, windows and a six-sided roof cap. */
function building(g: THREE.Group, rnd: (i: number) => number, o: { wall: string; roof: string; h: number; roofH: number; beams?: string; base?: string; chimney?: boolean; windows?: number; awning?: string }) {
  const r = 0.98;
  if (o.base) { put(g, cyl(r, r, o.h * 0.35, 6), M(o.base), 0, o.h * 0.175, 0, 0, Math.PI / 6); put(g, cyl(r * 0.97, r * 0.97, o.h * 0.65, 6), M(o.wall), 0, o.h * 0.35 + o.h * 0.325, 0, 0, Math.PI / 6); }
  else put(g, cyl(r, r, o.h, 6), M(o.wall), 0, o.h / 2, 0, 0, Math.PI / 6);
  // corner posts / timber
  if (o.beams) {
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; put(g, box(0.09, o.h, 0.09), M(o.beams), Math.cos(a) * r, o.h / 2, Math.sin(a) * r, 0, -a); }
    put(g, cyl(r + 0.03, r + 0.03, 0.09, 6, true), M(o.beams), 0, o.h * 0.55, 0, 0, Math.PI / 6);
  }
  // windows on some faces (dark glass with a sill)
  const win = M('#2a3440', { rough: 0.3 }), lit = M('#ffcf6b', { glow: true });
  const n = o.windows ?? 3;
  for (let i = 0; i < n; i++) {
    const face = Math.floor(rnd(30 + i) * 6), a = (face / 6) * Math.PI * 2 + Math.PI / 6, d = r * 0.87;
    const y = o.h * (0.45 + (i % 2) * 0.28);
    put(g, box(0.28, 0.34, 0.06), rnd(40 + i) > 0.75 ? lit : win, Math.cos(a) * d, y, Math.sin(a) * d, 0, -a + Math.PI / 2);
    put(g, box(0.36, 0.05, 0.1), M(o.beams ?? DARKWOOD), Math.cos(a) * (d + 0.02), y - 0.2, Math.sin(a) * (d + 0.02), 0, -a + Math.PI / 2);
  }
  // roof cap: an overhanging hex pyramid
  put(g, cone(r * 1.18, o.roofH, 6), M(o.roof), 0, o.h + o.roofH / 2, 0, 0, Math.PI / 6 + (rnd(5) > 0.5 ? 0 : Math.PI / 6));
  if (o.chimney && rnd(6) > 0.45) { put(g, box(0.25, 0.9, 0.25), M(DARKSTONE), 0.35, o.h + o.roofH * 0.55, 0.2); put(g, box(0.3, 0.08, 0.3), M(STONE), 0.35, o.h + o.roofH * 0.55 + 0.47, 0.2); }
  if (o.awning) { const a = (Math.floor(rnd(31) * 6) / 6) * Math.PI * 2 + Math.PI / 6; put(g, box(0.9, 0.05, 0.45), M(o.awning), Math.cos(a) * (r + 0.15), o.h * 0.48, Math.sin(a) * (r + 0.15), 0.35, -a + Math.PI / 2); }
}

/** 3D prop for a 2.1 tile (null = nothing extra). */
export function propV21(id: string, fill: string, rnd: (i: number) => number, anim: { crowns: THREE.Object3D[]; flames: THREE.Object3D[] }): THREE.Group | null {
  const g = new THREE.Group();
  const flame = (y: number, s = 1) => { const f = new THREE.Group(); f.position.y = y; f.add(new THREE.Mesh(cone(0.22 * s, 0.6 * s, 6), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85 })).translateY(0.3 * s)); f.add(new THREE.Mesh(cone(0.12 * s, 0.4 * s, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a })).translateY(0.22 * s)); g.add(f); anim.flames.push(f); };
  const crownTree = (trunk: string, leaves: string[], h: number, r: number, fruit?: string) => {
    put(g, cyl(0.13, 0.22, h, 7), M(trunk), 0, h / 2, 0);
    const crown = new THREE.Group(); crown.position.y = h * 0.9; crown.userData.phase = rnd(1) * 6.28;
    for (let i = 0; i < 5; i++) put(crown, ico(r * (0.7 + rnd(i + 10) * 0.4), 1), M(leaves[i % leaves.length]), (rnd(i + 20) - 0.5) * r * 1.4, 0.5 + rnd(i + 30) * r, (rnd(i + 40) - 0.5) * r * 1.4);
    if (fruit) for (let i = 0; i < 10; i++) put(crown, ico(0.09), M(fruit), (rnd(i + 50) - 0.5) * r * 2.1, 0.3 + rnd(i + 60) * r * 1.4, (rnd(i + 70) - 0.5) * r * 2.1);
    g.add(crown); anim.crowns.push(crown);
  };
  switch (id) {
    // ---------------------------------------------------------------- farm & village
    case 'wheat': {
      const stalk = M('#d8b860'), head = M('#e8cf7a');
      for (let i = 0; i < 26; i++) { const x = (rnd(i) - 0.5) * 1.5, z = (rnd(i + 30) - 0.5) * 1.5; if (x * x + z * z > 0.72) continue; const h = 0.75 + rnd(i + 60) * 0.35; put(g, box(0.035, h, 0.035), stalk, x, h / 2, z, (rnd(i + 90) - 0.5) * 0.2, 0, (rnd(i + 120) - 0.5) * 0.2); put(g, box(0.06, 0.16, 0.06), head, x, h + 0.06, z); }
      return g;
    }
    case 'veggies': {
      for (let row = -1; row <= 1; row++) { put(g, box(1.4, 0.1, 0.3), M('#4a3a26'), 0, 0.05, row * 0.45); for (let i = 0; i < 4; i++) put(g, ico(0.13 + rnd(row * 7 + i) * 0.05, 0), M(rnd(row + 9) > 0.5 ? '#5c8a3a' : '#7aa04a'), -0.5 + i * 0.33, 0.17, row * 0.45); }
      if (rnd(3) > 0.5) put(g, ico(0.16, 0), M('#d4602b'), 0.55, 0.15, 0.45);
      return g;
    }
    case 'flowers': {
      const cols = ['#e070a0', '#f2dc94', '#a78bfa', '#ffffff', '#e5484d', '#6fb1e0'];
      for (let i = 0; i < 18; i++) { const x = (rnd(i) - 0.5) * 1.5, z = (rnd(i + 30) - 0.5) * 1.5; if (x * x + z * z > 0.7) continue; put(g, box(0.02, 0.25, 0.02), M('#4f6e35'), x, 0.12, z); put(g, ico(0.06, 0), M(cols[Math.floor(rnd(i + 50) * cols.length)]), x, 0.27, z); }
      return g;
    }
    case 'haystack': put(g, new THREE.SphereGeometry(0.85, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), M('#d8b860'), 0, 0, 0, 0, rnd(1) * 3, 0, 1, 1.5, 1); put(g, cone(0.25, 0.4, 6), M('#c9a850'), 0, 1.35, 0); return g;
    case 'well': {
      put(g, cyl(0.6, 0.65, 0.75, 9), M(STONE), 0, 0.37, 0); put(g, cyl(0.45, 0.45, 0.04, 9), M('#1f3a4a', { rough: 0.2 }), 0, 0.7, 0);
      for (const x of [-0.55, 0.55]) put(g, box(0.1, 1.6, 0.1), M(DARKWOOD), x, 1.2, 0);
      put(g, cyl(0.06, 0.06, 1.2, 6), M(WOOD), 0, 1.65, 0, 0, 0, Math.PI / 2);
      put(g, cone(1.0, 0.6, 4), M(REDTILE), 0, 2.25, 0, 0, Math.PI / 4);
      put(g, cyl(0.12, 0.1, 0.2, 6), M(WOOD), 0.15, 1.25, 0);
      return g;
    }
    case 'cart': {
      put(g, box(1.5, 0.12, 0.85), M(WOOD), 0, 0.75, 0, 0, rnd(1) * 0.6);
      const bed = new THREE.Group(); bed.rotation.y = rnd(1) * 0.6; g.add(bed);
      for (const z of [-0.42, 0.42]) put(bed, box(1.5, 0.35, 0.06), M(DARKWOOD), 0, 0.97, z);
      for (const x of [-0.45, 0.45]) for (const z of [-0.5, 0.5]) { put(bed, cyl(0.35, 0.35, 0.08, 10), M(DARKWOOD), x, 0.35, z, Math.PI / 2); put(bed, cyl(0.07, 0.07, 0.1, 6), M(IRON, { metal: true }), x, 0.35, z, Math.PI / 2); }
      put(bed, box(1.0, 0.06, 0.06), M(WOOD), 1.2, 0.6, 0.15, 0, 0, -0.3); put(bed, box(1.0, 0.06, 0.06), M(WOOD), 1.2, 0.6, -0.15, 0, 0, -0.3);
      if (rnd(2) > 0.4) for (let i = 0; i < 3; i++) put(bed, box(0.35, 0.3, 0.35), M('#a87a46'), -0.4 + i * 0.4, 1.0, 0);
      return g;
    }
    case 'woodpile': for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) put(g, cyl(0.13, 0.13, 1.2, 7), M(i % 2 ? WOOD : '#9a6e3c'), -0.4 + i * 0.27 + row * 0.13, 0.13 + row * 0.24, 0, Math.PI / 2, 0, 0); put(g, box(0.1, 0.9, 0.1), M(DARKWOOD), -0.65, 0.45, 0.6); put(g, box(0.1, 0.9, 0.1), M(DARKWOOD), 0.65, 0.45, 0.6); return g;
    case 'scarecrow': put(g, box(0.08, 2.0, 0.08), M(DARKWOOD), 0, 1.0, 0); put(g, box(1.1, 0.07, 0.07), M(DARKWOOD), 0, 1.45, 0); put(g, cyl(0.24, 0.32, 0.7, 6), M('#8a6a3a'), 0, 1.3, 0); put(g, ico(0.2, 0), M('#d8c48a'), 0, 1.85, 0); put(g, cone(0.3, 0.32, 7), M('#a08048'), 0, 2.05, 0); put(g, cyl(0.38, 0.38, 0.03, 9), M('#a08048'), 0, 1.95, 0); for (const x of [-0.5, 0.5]) put(g, cone(0.08, 0.2, 4), M('#d8c48a'), x, 1.38, 0, Math.PI); return g;
    case 'trough': put(g, box(1.3, 0.45, 0.5), M(DARKWOOD), 0, 0.3, 0, 0, rnd(1)); put(g, box(1.2, 0.04, 0.4), M('#3a6a8a', { rough: 0.2 }), 0, 0.5, 0, 0, rnd(1)); for (const x of [-0.5, 0.5]) put(g, box(0.1, 0.1, 0.55), M(WOOD), x * Math.cos(rnd(1)), 0.05, -x * Math.sin(rnd(1)), 0, rnd(1)); return g;
    case 'beehives': for (let i = 0; i < 3; i++) { const a = i * 2.1 + rnd(1); const x = Math.cos(a) * 0.45, z = Math.sin(a) * 0.45; put(g, box(0.35, 0.3, 0.35), M(WOOD), x, 0.15, z); for (let k = 0; k < 3; k++) put(g, cyl(0.24 - k * 0.05, 0.27 - k * 0.05, 0.16, 8), M('#d8b860'), x, 0.38 + k * 0.15, z); } return g;
    case 'stonewall': for (let i = 0; i < 9; i++) put(g, dodec(0.2 + rnd(i) * 0.06), M(i % 2 ? STONE : '#9a948a'), -0.8 + (i % 5) * 0.4 + (i >= 5 ? 0.2 : 0), i >= 5 ? 0.45 : 0.2, (rnd(i + 9) - 0.5) * 0.1, rnd(i), rnd(i + 1), 0, 1.1, 0.85, 1); return g;
    case 'cottage': building(g, rnd, { wall: WHITEWASH, roof: THATCH, h: 2.3, roofH: 1.5, beams: DARKWOOD, chimney: true }); return g;
    case 'barn': building(g, rnd, { wall: '#9a3a2a', roof: '#5a4a3a', h: 3.0, roofH: 1.6, beams: '#e8e0cc', windows: 1 }); return g;
    case 'windmill': {
      put(g, cyl(0.62, 0.85, 4.2, 8), M(WHITEWASH), 0, 2.1, 0); put(g, cone(0.85, 1.2, 8), M('#5a4a3a'), 0, 4.8, 0);
      const hub = new THREE.Group(); hub.position.set(0, 3.9, 0.82); g.add(hub);
      put(hub, cyl(0.1, 0.1, 0.25, 6), M(DARKWOOD), 0, 0, 0, Math.PI / 2);
      for (let i = 0; i < 4; i++) { const blade = new THREE.Group(); blade.rotation.z = i * Math.PI / 2 + rnd(2); hub.add(blade); put(blade, box(0.08, 2.0, 0.05), M(DARKWOOD), 0, 1.05, 0.08); put(blade, box(0.42, 1.5, 0.02), M('#e8dcc0', { side: true }), 0.22, 1.25, 0.1); }
      put(g, box(0.4, 0.7, 0.05), M(DARKWOOD), 0, 0.35, 0.82);
      return g;
    }
    case 'tent': {
      const c = ['#c8b890', '#a8402a', '#2d4f8f', '#5c7a2a'][Math.floor(rnd(1) * 4)];
      put(g, cone(1.0, 1.9, 4), M(c), 0, 0.95, 0, 0, Math.PI / 4 + rnd(2));
      put(g, box(0.5, 0.9, 0.04), M('#2a241c'), 0, 0.45, 0.62, 0.3);
      put(g, box(0.05, 2.1, 0.05), M(DARKWOOD), 0, 1.05, 0);
      return g;
    }
    case 'signpost': put(g, box(0.1, 1.9, 0.1), M(DARKWOOD), 0, 0.95, 0); for (let i = 0; i < 3; i++) put(g, box(0.75, 0.16, 0.04), M(WOOD), 0.25, 1.45 - i * 0.25, 0, 0, rnd(i) * 3, 0); return g;
    case 'gravestone': for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.5, z = (rnd(i) - 0.5) * 0.5; const t = put(g, box(0.38, 0.6, 0.12), M(rnd(i + 5) > 0.5 ? '#9a948a' : '#7a766e'), x, 0.3, z, 0, 0, (rnd(i + 8) - 0.5) * 0.25); void t; put(g, cyl(0.19, 0.19, 0.12, 8, false), M('#9a948a'), x, 0.6, z, Math.PI / 2, 0, 0); put(g, box(0.4, 0.06, 0.7), M('#4f6e35'), x, 0.03, z + 0.4); } return g;
    // ---------------------------------------------------------------- nature extras
    case 'orchard': crownTree('#6a4a2a', ['#3a6a32', '#4a7a3a'], 2.0, 0.85, '#c0392b'); return g;
    case 'birch': {
      put(g, cyl(0.1, 0.14, 3.6, 7), M('#e8e4d8'), 0, 1.8, 0);
      for (let i = 0; i < 6; i++) put(g, box(0.16, 0.05, 0.03), M('#2a2622'), (rnd(i) - 0.5) * 0.05, 0.4 + i * 0.5, 0.12, 0, rnd(i) * 3, 0);
      const crown = new THREE.Group(); crown.position.y = 3.4; crown.userData.phase = rnd(1) * 6.28;
      for (let i = 0; i < 5; i++) put(crown, ico(0.55 + rnd(i + 10) * 0.3, 1), M(i % 2 ? '#8aa04a' : '#a0b860'), (rnd(i + 20) - 0.5) * 0.9, rnd(i + 30) * 1.4, (rnd(i + 40) - 0.5) * 0.9);
      g.add(crown); anim.crowns.push(crown);
      return g;
    }
    case 'deadtree': {
      put(g, cyl(0.1, 0.24, 2.6, 6), M('#4a3a2a'), 0, 1.3, 0, 0, 0, (rnd(1) - 0.5) * 0.2);
      for (let i = 0; i < 4; i++) put(g, cyl(0.03, 0.07, 1.1, 5), M('#4a3a2a'), Math.cos(i * 1.6) * 0.35, 1.8 + i * 0.25, Math.sin(i * 1.6) * 0.35, Math.sin(i * 1.6) * 0.8, 0, -Math.cos(i * 1.6) * 0.8);
      return g;
    }
    case 'log': put(g, cyl(0.28, 0.32, 1.7, 8), M('#6a4a2a'), 0, 0.3, 0, 0, rnd(1) * 3, Math.PI / 2); put(g, cyl(0.26, 0.26, 0.02, 8), M('#b08a5a'), 0.86 * Math.cos(rnd(1) * 3), 0.3, -0.86 * Math.sin(rnd(1) * 3), 0, rnd(1) * 3, Math.PI / 2); for (let i = 0; i < 3; i++) put(g, ico(0.1, 0), M('#4f6e35'), (rnd(i + 4) - 0.5) * 1.2, 0.55, (rnd(i + 7) - 0.5) * 0.3); return g;
    case 'rocks': for (let i = 0; i < 6; i++) put(g, dodec(0.1 + rnd(i) * 0.14), M(i % 2 ? STONE : '#9a948a'), (rnd(i + 10) - 0.5) * 1.4, 0.08, (rnd(i + 20) - 0.5) * 1.4, rnd(i), rnd(i + 1), 0, 1, 0.6, 1); return g;
    // ---------------------------------------------------------------- town & city
    case 'townhouse': building(g, rnd, { wall: '#c8bca8', base: STONE, roof: rnd(3) > 0.5 ? REDTILE : SLATE, h: 4.6, roofH: 1.35, chimney: true, windows: 4 }); return g;
    case 'timberhouse': building(g, rnd, { wall: '#e8dcc0', base: STONE, roof: rnd(3) > 0.4 ? REDTILE : '#7a4a2a', h: 4.0, roofH: 1.3, beams: '#4a321c', chimney: true, windows: 4 }); return g;
    case 'shop': building(g, rnd, { wall: '#d8ccb4', base: STONE, roof: REDTILE, h: 3.6, roofH: 1.4, beams: '#4a321c', windows: 3, awning: ['#2d4f8f', '#b3261e', '#5c7a2a', '#d8b25a'][Math.floor(rnd(9) * 4)] }); return g;
    case 'citywall': {
      put(g, cyl(0.99, 1.0, 4.6, 6), M(STONE), 0, 2.3, 0, 0, Math.PI / 6);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; put(g, box(0.5, 0.55, 0.35), M('#7a746c'), Math.cos(a) * 0.75, 4.85, Math.sin(a) * 0.75, 0, -a); }
      put(g, cyl(1.02, 1.02, 0.18, 6), M(DARKSTONE), 0, 4.55, 0, 0, Math.PI / 6);
      return g;
    }
    case 'tower': {
      put(g, cyl(0.85, 0.95, 6.5, 10), M(STONE), 0, 3.25, 0);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; put(g, box(0.3, 0.5, 0.3), M('#7a746c'), Math.cos(a) * 0.85, 6.75, Math.sin(a) * 0.85, 0, -a); }
      put(g, cone(1.05, 2.2, 10), M(SLATE), 0, 8.0, 0);
      put(g, box(0.06, 1.2, 0.06), M(DARKWOOD), 0, 9.6, 0); put(g, box(0.5, 0.32, 0.02), M('#b3261e', { side: true }), 0.27, 9.95, 0);
      for (let i = 0; i < 3; i++) { const a = rnd(i) * 6.28; put(g, box(0.12, 0.45, 0.06), M('#2a2622'), Math.cos(a) * 0.9, 2 + i * 1.5, Math.sin(a) * 0.9, 0, -a + Math.PI / 2); }
      return g;
    }
    case 'gate': {
      for (const s of [-1, 1]) put(g, box(0.45, 4.2, 1.5), M(STONE), s * 0.75, 2.1, 0);
      put(g, box(1.95, 1.1, 1.5), M(STONE), 0, 4.0, 0);
      put(g, new THREE.CylinderGeometry(0.55, 0.55, 1.52, 10, 1, false, 0, Math.PI), M(DARKSTONE), 0, 3.2, 0, Math.PI / 2, 0, Math.PI / 2);
      for (let i = 0; i < 4; i++) put(g, box(0.4, 0.4, 0.35), M('#7a746c'), -0.75 + i * 0.5, 4.75, 0.55);
      for (let i = 0; i < 5; i++) put(g, box(0.05, 0.9, 0.05), M(IRON, { metal: true }), -0.4 + i * 0.2, 3.1, 0.7);
      return g;
    }
    case 'stall': {
      const c = ['#b3261e', '#2d4f8f', '#5c7a2a', '#d4602b'][Math.floor(rnd(1) * 4)];
      put(g, box(1.3, 0.85, 0.6), M(WOOD), 0, 0.42, 0.2);
      for (const x of [-0.6, 0.6]) for (const z of [-0.3, 0.45]) put(g, box(0.07, 2.0, 0.07), M(DARKWOOD), x, 1.0, z);
      for (let i = 0; i < 4; i++) put(g, box(0.33, 0.05, 1.0), M(i % 2 ? c : '#f2ecdc'), -0.49 + i * 0.33, 2.05, 0.1, 0.25);
      for (let i = 0; i < 5; i++) put(g, ico(0.1, 0), M(['#c0392b', '#e0c060', '#5c8a3a', '#d4602b'][i % 4]), -0.45 + i * 0.22, 0.92, 0.3);
      return g;
    }
    case 'fountain': {
      put(g, cyl(0.95, 1.0, 0.5, 8), M(STONE), 0, 0.25, 0); put(g, cyl(0.82, 0.82, 0.05, 8), M('#3a7aa0', { rough: 0.15, opacity: 0.85 }), 0, 0.48, 0);
      put(g, cyl(0.15, 0.2, 1.2, 8), M('#b8b2a6'), 0, 1.0, 0); put(g, cyl(0.45, 0.3, 0.2, 8), M('#b8b2a6'), 0, 1.6, 0); put(g, cyl(0.38, 0.38, 0.04, 8), M('#3a7aa0', { rough: 0.15, opacity: 0.85 }), 0, 1.71, 0);
      put(g, ico(0.14, 0), M('#b8b2a6'), 0, 1.95, 0);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; put(g, cone(0.04, 0.6, 4), M('#a8d8f0', { opacity: 0.6 }), Math.cos(a) * 0.35, 1.3, Math.sin(a) * 0.35, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); }
      return g;
    }
    case 'lamppost': { put(g, cyl(0.05, 0.08, 2.6, 6), M(IRON, { metal: true }), 0, 1.3, 0); put(g, box(0.06, 0.06, 0.45), M(IRON, { metal: true }), 0, 2.55, 0.2); const lamp = put(g, cyl(0.14, 0.1, 0.3, 6), M('#ffcf6b', { glow: true }), 0, 2.35, 0.4); void lamp; put(g, cone(0.2, 0.15, 6), M(IRON, { metal: true }), 0, 2.58, 0.4); return g; }
    case 'bench': put(g, box(1.3, 0.08, 0.4), M(WOOD), 0, 0.5, 0, 0, rnd(1)); put(g, box(1.3, 0.35, 0.06), M(WOOD), -0.18 * Math.sin(rnd(1)), 0.75, -0.18 * Math.cos(rnd(1)), -0.15, rnd(1)); for (const x of [-0.5, 0.5]) put(g, box(0.08, 0.5, 0.35), M(IRON, { metal: true }), x * Math.cos(rnd(1)), 0.25, -x * Math.sin(rnd(1)), 0, rnd(1)); return g;
    case 'planter': put(g, box(1.2, 0.5, 0.6), M(STONE), 0, 0.25, 0, 0, rnd(1)); for (let i = 0; i < 6; i++) put(g, ico(0.16, 0), M(i % 3 === 0 ? '#e070a0' : i % 3 === 1 ? '#f2dc94' : '#4f6e35'), (rnd(i) - 0.5) * 0.9, 0.6, (rnd(i + 4) - 0.5) * 0.3); return g;
    case 'canalwater': for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; if (rnd(i) > 0.6) continue; put(g, box(1.0, 0.25, 0.18), M(STONE), Math.cos(a) * 0.86, 0.05, Math.sin(a) * 0.86, 0, -a + Math.PI / 2); } return g;
    case 'grate': for (let i = 0; i < 5; i++) put(g, box(0.06, 0.03, 0.8), M(IRON, { metal: true }), -0.3 + i * 0.15, 0.02, 0); put(g, box(0.8, 0.03, 0.06), M(IRON, { metal: true }), 0, 0.02, 0); return g;
    case 'banner': { put(g, cyl(0.05, 0.06, 3.6, 6), M(DARKWOOD), 0, 1.8, 0); put(g, ico(0.1, 0), M(GOLD, { metal: true }), 0, 3.65, 0); const c = ['#b3261e', '#2d4f8f', '#5c7a2a', '#5a2a6e'][Math.floor(rnd(1) * 4)]; put(g, box(0.75, 1.3, 0.02), M(c, { side: true }), 0.4, 2.85, 0); put(g, ico(0.15, 0), M(GOLD), 0.4, 2.9, 0.02); put(g, box(0.8, 0.05, 0.05), M(DARKWOOD), 0.4, 3.5, 0); return g; }
    case 'pier': for (let i = -3; i <= 3; i++) put(g, box(0.22, 0.08, 1.6), M(i % 2 ? WOOD : '#9a6a3c'), i * 0.25, 0.04, 0); for (const x of [-0.8, 0.8]) for (const z of [-0.7, 0.7]) put(g, cyl(0.08, 0.08, 1.4, 6), M(DARKWOOD), x, -0.3, z); return g;
    // ---------------------------------------------------------------- interiors & crypts
    case 'counter': put(g, box(1.5, 1.05, 0.55), M(DARKWOOD), 0, 0.52, 0); put(g, box(1.6, 0.08, 0.65), M(WOOD), 0, 1.08, 0); for (let i = 0; i < 3; i++) put(g, cyl(0.06, 0.05, 0.16, 7), M(i === 1 ? '#c8ccd2' : '#8a6a3a', { metal: i === 1 }), -0.4 + i * 0.4, 1.2, 0); return g;
    case 'bookshelf': {
      put(g, box(1.4, 2.4, 0.45), M(DARKWOOD), 0, 1.2, 0);
      const cols = ['#7a2a2a', '#2d4f8f', '#5c7a2a', '#d8b25a', '#5a2a6e', '#3a2a1a'];
      for (let row = 0; row < 4; row++) { put(g, box(1.3, 0.05, 0.42), M(WOOD), 0, 0.25 + row * 0.55, 0.02); let x = -0.6; while (x < 0.55) { const w = 0.07 + rnd(row * 10 + x * 10) * 0.07; put(g, box(w, 0.36 + rnd(row + x) * 0.1, 0.32), M(cols[Math.floor(rnd(row * 3 + x * 7) * cols.length)]), x + w / 2, 0.47 + row * 0.55, 0.05); x += w + 0.01; } }
      return g;
    }
    case 'chest': put(g, box(0.9, 0.5, 0.55), M(WOOD), 0, 0.25, 0, 0, rnd(1)); put(g, new THREE.CylinderGeometry(0.275, 0.275, 0.9, 8, 1, false, 0, Math.PI), M(WOOD), 0, 0.5, 0, 0, rnd(1), Math.PI / 2); for (const x of [-0.3, 0.3]) put(g, box(0.06, 0.8, 0.58), M(GOLD, { metal: true }), x * Math.cos(rnd(1)), 0.4, -x * Math.sin(rnd(1)), 0, rnd(1)); return g;
    case 'hearth': {
      put(g, box(1.6, 2.6, 0.7), M(STONE), 0, 1.3, -0.35); put(g, box(1.0, 0.9, 0.3), M('#1a1612'), 0, 0.45, 0.05); put(g, box(1.8, 0.15, 0.8), M(DARKWOOD), 0, 1.1, -0.25);
      for (let i = 0; i < 3; i++) put(g, cyl(0.06, 0.06, 0.6, 6), M(DARKWOOD), 0, 0.1, 0.05 + i * 0.04, 0, i * 1.0, Math.PI / 2);
      flame(0.12, 0.8);
      return g;
    }
    case 'forge': {
      put(g, box(1.1, 0.9, 0.8), M(DARKSTONE), -0.25, 0.45, -0.2); put(g, box(0.8, 0.06, 0.55), M('#ff6a2a', { glow: true }), -0.25, 0.92, -0.2); flame(0.9, 0.6);
      put(g, box(0.3, 0.45, 0.25), M(DARKWOOD), 0.55, 0.22, 0.4); put(g, box(0.55, 0.18, 0.22), M(IRON, { metal: true }), 0.55, 0.52, 0.4); put(g, cone(0.11, 0.25, 4), M(IRON, { metal: true }), 0.9, 0.55, 0.4, 0, 0, -Math.PI / 2);
      return g;
    }
    case 'weaponrack': {
      put(g, box(1.3, 0.08, 0.1), M(DARKWOOD), 0, 1.4, 0); put(g, box(1.3, 0.08, 0.3), M(DARKWOOD), 0, 0.2, 0); for (const x of [-0.6, 0.6]) put(g, box(0.08, 1.5, 0.08), M(DARKWOOD), x, 0.75, 0);
      for (let i = 0; i < 4; i++) { put(g, cyl(0.02, 0.02, 1.6, 4), M(WOOD), -0.4 + i * 0.27, 0.95, 0.05, 0.1); put(g, cone(0.05, 0.2, 4), M('#c8ccd2', { metal: true }), -0.4 + i * 0.27, 1.82, 0.13); }
      return g;
    }
    case 'throne': {
      put(g, box(1.2, 0.3, 1.0), M(STONE), 0, 0.15, 0); put(g, box(0.85, 0.45, 0.7), M('#7a2a2a'), 0, 0.55, 0.05);
      put(g, box(0.9, 1.9, 0.18), M(GOLD, { metal: true }), 0, 1.3, -0.35); put(g, box(0.7, 1.4, 0.05), M('#7a2a2a'), 0, 1.2, -0.25);
      for (const x of [-0.45, 0.45]) { put(g, box(0.15, 0.4, 0.7), M(GOLD, { metal: true }), x, 0.85, 0.05); put(g, ico(0.09, 0), M(GOLD, { metal: true }), x, 2.3, -0.35); }
      put(g, ico(0.12, 0), M('#b3261e', { glow: true }), 0, 2.1, -0.24);
      return g;
    }
    case 'sarcophagus': put(g, box(0.85, 0.75, 1.6), M('#7a766e'), 0, 0.38, 0, 0, rnd(1) * 0.3); put(g, box(0.95, 0.15, 1.7), M('#8a847a'), 0, 0.82, 0, 0, rnd(1) * 0.3); put(g, box(0.4, 0.1, 0.9), M('#9a948a'), 0, 0.94, 0, 0, rnd(1) * 0.3); put(g, ico(0.15, 0), M('#9a948a'), 0.5 * Math.sin(rnd(1) * 0.3), 0.98, 0.5 * Math.cos(rnd(1) * 0.3)); return g;
    case 'bones': for (let i = 0; i < 7; i++) put(g, cyl(0.03, 0.03, 0.35, 4), M('#e8dcc0'), (rnd(i) - 0.5) * 1.2, 0.04, (rnd(i + 9) - 0.5) * 1.2, Math.PI / 2, rnd(i + 3) * 3, 0); for (let i = 0; i < 2; i++) { const x = (rnd(i + 20) - 0.5) * 0.9, z = (rnd(i + 30) - 0.5) * 0.9; put(g, ico(0.13, 1), M('#e8dcc0'), x, 0.12, z); for (const s of [-1, 1]) put(g, ico(0.035, 0), M('#1a1612'), x + s * 0.05, 0.15, z + 0.11); } return g;
    case 'cage': { put(g, cyl(0.75, 0.75, 0.08, 8), M(IRON, { metal: true }), 0, 0.04, 0); put(g, cyl(0.75, 0.75, 0.08, 8), M(IRON, { metal: true }), 0, 2.1, 0); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; put(g, cyl(0.025, 0.025, 2.1, 4), M(IRON, { metal: true }), Math.cos(a) * 0.72, 1.05, Math.sin(a) * 0.72); } put(g, cone(0.75, 0.5, 8), M(IRON, { metal: true }), 0, 2.4, 0); return g; }
    case 'urns': for (let i = 0; i < 4; i++) { const x = (rnd(i) - 0.5) * 1.1, z = (rnd(i + 5) - 0.5) * 1.1, k = 0.7 + rnd(i + 9) * 0.6; put(g, new THREE.SphereGeometry(0.28 * k, 8, 6), M(i % 2 ? '#b87333' : '#a0603a'), x, 0.3 * k, z, 0, 0, 0, 1, 1.25, 1); put(g, cyl(0.12 * k, 0.16 * k, 0.18 * k, 8), M('#8a4a2a'), x, 0.68 * k, z); } return g;
    case 'crystals': for (let i = 0; i < 5; i++) put(g, new THREE.OctahedronGeometry(0.25 + rnd(i) * 0.25, 0), M(i % 2 ? '#a0d8ff' : '#c8a0ff', { glow: true }), (rnd(i + 3) - 0.5) * 0.9, 0.35 + rnd(i + 6) * 0.4, (rnd(i + 9) - 0.5) * 0.9, (rnd(i + 12) - 0.5) * 0.6, rnd(i) * 3, (rnd(i + 15) - 0.5) * 0.6, 0.7, 1.8, 0.7); return g;
    case 'boat': { const b = new THREE.Group(); b.rotation.y = rnd(1) * 3; g.add(b); put(b, new THREE.CylinderGeometry(0.5, 0.35, 1.8, 8, 1, false, Math.PI / 2, Math.PI), M(WOOD, { side: true }), 0, 0.15, 0, Math.PI / 2, 0, 0, 1, 1, 0.6); put(b, box(0.8, 0.05, 0.25), M(DARKWOOD), 0, 0.12, 0.2); put(b, box(0.05, 0.05, 1.6), M(DARKWOOD), 0.35, 0.25, 0, 0, 0, 0.5); return g; }
    case 'ruinwall': for (let i = 0; i < 6; i++) put(g, box(0.45, 0.4, 0.4), M(i % 2 ? STONE : '#9a948a'), -0.6 + (i % 3) * 0.45 + (rnd(i) - 0.5) * 0.1, 0.2 + Math.floor(i / 3) * 0.4, (rnd(i + 3) - 0.5) * 0.1, 0, (rnd(i + 6) - 0.5) * 0.3, 0); put(g, dodec(0.2), M(STONE), 0.6, 0.12, 0.5); return g;
    case 'bedroll': put(g, box(0.6, 0.12, 1.4), M(['#5c7a2a', '#7a2a2a', '#2d4f8f'][Math.floor(rnd(1) * 3)]), 0, 0.06, 0, 0, rnd(2) * 3); put(g, cyl(0.15, 0.15, 0.6, 7), M('#c8b890'), -0.6 * Math.sin(rnd(2) * 3), 0.15, -0.6 * Math.cos(rnd(2) * 3), 0, rnd(2) * 3, Math.PI / 2); return g;
    case 'lilies': for (let i = 0; i < 6; i++) { const x = (rnd(i) - 0.5) * 1.3, z = (rnd(i + 4) - 0.5) * 1.3; put(g, cyl(0.2, 0.2, 0.02, 7), M('#4f8a3a'), x, -0.05, z); if (i % 2) put(g, ico(0.07, 0), M('#f2b8d0'), x, 0.02, z); } return g;
    case 'shrine': put(g, box(0.8, 0.5, 0.8), M(STONE), 0, 0.25, 0); put(g, box(0.5, 1.0, 0.4), M('#b8b2a6'), 0, 1.0, 0); put(g, cone(0.5, 0.4, 4), M(REDTILE), 0, 1.7, 0, 0, Math.PI / 4); put(g, ico(0.12, 0), M(GOLD, { glow: true }), 0, 1.1, 0.22); put(g, ico(0.06, 0), M('#ffcf6b', { glow: true }), 0.3, 0.55, 0.3); return g;
    case 'totem': put(g, cyl(0.22, 0.28, 2.8, 6), M('#7a5a36'), 0, 1.4, 0); for (let i = 0; i < 3; i++) { put(g, box(0.5, 0.42, 0.5), M(['#b3261e', '#2d4f8f', '#d8b25a'][i]), 0, 0.7 + i * 0.75, 0, 0, i * 0.4, 0); put(g, box(0.3, 0.06, 0.05), M('#141210'), 0, 0.75 + i * 0.75, 0.26, 0, i * 0.4, 0); } put(g, box(1.2, 0.12, 0.2), M('#7a5a36'), 0, 2.6, 0); put(g, ico(0.18, 0), M('#e8dcc0'), 0, 2.95, 0); return g;
    case 'dummy': put(g, box(0.08, 1.9, 0.08), M(DARKWOOD), 0, 0.95, 0); put(g, cyl(0.28, 0.24, 0.8, 7), M('#c8b890'), 0, 1.25, 0); put(g, box(1.0, 0.12, 0.12), M('#c8b890'), 0, 1.45, 0); put(g, ico(0.2, 0), M('#c8b890'), 0, 1.85, 0); put(g, box(0.5, 0.1, 0.5), M(DARKWOOD), 0, 0.05, 0); put(g, box(0.06, 0.06, 0.5), M('#b3261e'), 0, 1.3, 0.3, 0.4); return g;
    case 'ladder': for (const x of [-0.25, 0.25]) put(g, box(0.06, 2.0, 0.06), M(WOOD), x, 1.0, 0.6, -0.25); for (let i = 0; i < 6; i++) put(g, box(0.5, 0.04, 0.05), M(WOOD), 0, 0.2 + i * 0.32, 0.6 - (0.2 + i * 0.32) * 0.25, -0.25); return g;
    default: void fill; return null;
  }
}
