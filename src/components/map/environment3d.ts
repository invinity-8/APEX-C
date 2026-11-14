/**
 * APEX 2.5 – the world around a 3D battle map: a sky that follows the time of day, a generated horizon that fits
 * the scene (mountains, forest hills, marsh, dunes, snowy peaks, town roofs, cave walls), ground that continues
 * beyond the map's edge, clouds, rain and snow, and season / snow colours for the map itself.
 */
import * as THREE from 'three';
import type { HexKey } from '../../game/hex';
import type { TileDef } from '../../campaign/hexScene';
import { weatherMix, type Season, type Weather, type WeatherMix } from '../../game/worldTime';

export type Biome = 'plains' | 'forest' | 'swamp' | 'desert' | 'snow' | 'cave' | 'town' | 'coast' | 'highland';

/** What kind of land surrounds the map, from its tiles. */
export function biomeOf(tiles: Map<HexKey, TileDef>): Biome {
  const n = Math.max(1, tiles.size);
  let tree = 0, water = 0, swamp = 0, sand = 0, snow = 0, cave = 0, floor = 0, rock = 0;
  for (const t of tiles.values()) {
    const id = t.id;
    if (/tree|forest|pine|birch|undergrowth|bush|hedge|fungi/.test(id)) tree++;
    if (/water|river|deep|shallow|lake/.test(id)) water++;
    if (/swamp|mud|bog|reed/.test(id)) swamp++;
    if (/sand|dune|desert/.test(id)) sand++;
    if (/snow|ice/.test(id)) snow++;
    if (/cave|cavewall|stalag/.test(id)) cave++;
    if (/floor|cobble|plank|marble|carpet|flag|wall|house|roof/.test(id)) floor++;
    if (/rock|boulder|cliff|crag/.test(id)) rock++;
  }
  const f = (x: number) => x / n;
  if (f(cave) > 0.12) return 'cave';
  if (f(snow) > 0.25) return 'snow';
  if (f(sand) > 0.25) return 'desert';
  if (f(swamp) + f(water) * 0.5 > 0.22) return 'swamp';
  if (f(water) > 0.3) return 'coast';
  if (f(floor) > 0.3) return 'town';
  if (f(tree) > 0.2) return 'forest';
  if (f(rock) > 0.15) return 'highland';
  return 'plains';
}

export interface Light { zenith: number; horizon: number; fog: number; fogNear: number; fogFar: number; hemiSky: number; hemiGround: number; hemi: number; sun: number; sunI: number; sunPos: [number, number, number]; exposure: number; stars: number; night: number }

const C = (h: number) => new THREE.Color(h);
const mixHex = (a: number, b: number, t: number) => C(a).lerp(C(b), Math.max(0, Math.min(1, t))).getHex();
/** Key frames of the day: [hour, zenith, horizon, sun colour, sun intensity, hemi intensity, exposure]. */
const KEYS: Array<[number, number, number, number, number, number, number]> = [
  [0, 0x05070f, 0x141a2c, 0x8fa8ff, 0.28, 0.32, 1.0],
  [4.5, 0x080b18, 0x1d2238, 0x8fa8ff, 0.3, 0.34, 1.0],
  [5.6, 0x2a2850, 0xd98a5a, 0xff9a5a, 0.7, 0.55, 1.05],
  [7, 0x5a8ac8, 0xf3c890, 0xffd2a0, 1.3, 0.85, 1.08],
  [9, 0x3f7fd0, 0xbcd8f0, 0xfff0d0, 1.6, 0.9, 1.05],
  [15, 0x3f7fd0, 0xbcd8f0, 0xfff0d0, 1.6, 0.9, 1.05],
  [17.5, 0x5a7ac0, 0xf0c890, 0xffc080, 1.6, 0.9, 1.1],
  [19, 0x3a2a5a, 0xe0784a, 0xff8a5a, 0.85, 0.6, 1.05],
  [20.3, 0x0e1228, 0x2a2440, 0x8fa8ff, 0.35, 0.38, 1.0],
  [24, 0x05070f, 0x141a2c, 0x8fa8ff, 0.28, 0.32, 1.0],
];
/** Sky, sun and fog for an hour of the day and the weather. */
export function lightFor(hour: number, weatherIn: Weather | WeatherMix = 'clear'): Light {
  const mix = typeof weatherIn === 'string' ? weatherMix(weatherIn) : weatherIn;
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = (h - a[0]) / Math.max(0.001, b[0] - a[0]);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  let zenith = mixHex(a[1], b[1], t), horizon = mixHex(a[2], b[2], t);
  let sunI = lerp(a[4], b[4]), hemi = lerp(a[5], b[5]);
  const sunC = mixHex(a[3], b[3], t);
  const night = h < 5 || h > 20.3 ? 1 : h < 6.2 ? (6.2 - h) / 1.2 : h > 19 ? (h - 19) / 1.3 : 0;
  // the sun travels east → south → west; at night the moon lights from the other side
  const sunAng = ((h - 6) / 12) * Math.PI;
  const day = h >= 5.5 && h <= 19.5;
  const sunPos: [number, number, number] = day ? [Math.cos(sunAng) * -60, Math.max(12, Math.sin(sunAng) * 70), 25] : [40, 55, -25];
  let fogNear = 70, fogFar = 220;
  // weather: clouds swallow the sun, rain darkens, fog closes in
  const grey = (amount: number, to = 0x9aa2aa) => { const g = mixHex(to, 0x1a1e24, night * 0.85); zenith = mixHex(zenith, g, amount); horizon = mixHex(horizon, g, amount * 0.9); };
  // APEX 2.6 – a sky plus any rain / fog / snow, applied one after the other
  if (mix.sky === 'fleecy') { sunI *= 0.92; }
  if (mix.sky === 'cloudy') { grey(0.55); sunI *= 0.55; hemi *= 1.15; fogFar = 180; }
  if (mix.sky === 'dark') { grey(0.75, 0x4a5058); sunI *= 0.3; hemi *= 0.85; fogNear = 50; fogFar = 160; }
  if (mix.rain) { grey(0.5, 0x5a6068); sunI *= 0.6; hemi *= 0.95; fogNear = Math.min(fogNear, 30); fogFar = Math.min(fogFar, 120); }
  if (mix.snow) { grey(0.45, 0xc8ced6); sunI *= 0.7; hemi *= 1.1; fogNear = Math.min(fogNear, 25); fogFar = Math.min(fogFar, 110); }
  if (mix.fog) { grey(0.8, 0xb8c0c4); sunI *= 0.5; hemi *= 1.08; fogNear = 6; fogFar = 48; }
  const fog = mix.fog || mix.snow ? mixHex(horizon, 0xc8ced2, 0.4 * (1 - night)) : horizon;
  const clearSky = mix.sky === 'clear' || mix.sky === 'fleecy';
  return { zenith, horizon, fog, fogNear, fogFar, hemiSky: mixHex(0xfff4dd, zenith, 0.35 + night * 0.4), hemiGround: mixHex(0x2a2f2a, 0x0a0c12, night), hemi, sun: sunC, sunI, sunPos, exposure: lerp(a[6], b[6]), stars: clearSky && !mix.fog ? night : night * 0.15, night };
}

/** Season and snow applied to a colour (ground tiles, plant materials): greens shift, snow whitens. */
export function seasonTint(c: THREE.Color, season: Season | undefined, snow = 0): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const green = hsl.h > 0.17 && hsl.h < 0.47 && hsl.s > 0.12;
  if (green && season === 'autumn') { const k = Math.min(1, (hsl.s - 0.12) * 3); c.setHSL(hsl.h + (0.07 - hsl.h) * 0.75 * k, Math.min(1, hsl.s * 1.15), hsl.l * 1.02); }
  if (green && season === 'spring') c.setHSL(hsl.h + 0.015, Math.min(1, hsl.s * 1.25), Math.min(0.75, hsl.l * 1.1));
  if (green && season === 'winter') c.setHSL(hsl.h - 0.04, hsl.s * 0.45, hsl.l * 0.92);
  const s = Math.min(1, snow + (season === 'winter' ? 0.12 : 0));
  if (s > 0) c.lerp(new THREE.Color(0xeef3f8), s * 0.78);
  return c;
}

// ---------------------------------------------------------------- sky
export function buildSky(): { mesh: THREE.Mesh; stars: THREE.Points; set: (l: Light) => void } {
  const uniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, below: { value: new THREE.Color() } };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 below; varying vec3 vDir; void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(horizon, top, pow(clamp(y * 1.6, 0.0, 1.0), 0.7)) : mix(horizon, below, clamp(-y * 6.0, 0.0, 1.0)); gl_FragColor = vec4(c, 1.0); }',
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  mesh.renderOrder = -10; mesh.frustumCulled = false;
  const pts: number[] = []; let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 700; i++) { const u = rnd(), v = rnd() * 0.85 + 0.1; const th = u * Math.PI * 2, y = v; const r = Math.sqrt(1 - y * y); pts.push(Math.cos(th) * r * 850, y * 850, Math.sin(th) * r * 850); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff8e8, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  stars.renderOrder = -9; stars.frustumCulled = false;
  return { mesh, stars, set: (l) => { uniforms.top.value.setHex(l.zenith); uniforms.horizon.value.setHex(l.horizon); uniforms.below.value.setHex(l.fog); (stars.material as THREE.PointsMaterial).opacity = l.stars * 0.9; stars.visible = l.stars > 0.02; } };
}

// ---------------------------------------------------------------- horizon and ground beyond the map
const BIOME: Record<Biome, { ground: number; far: number; near: number; farH: number; nearH: number; rough: number; trees: number; tree: number; sky: boolean }> = {
  plains: { ground: 0x6a8040, far: 0x6a7a8a, near: 0x5a7040, farH: 26, nearH: 7, rough: 0.5, trees: 60, tree: 0x3a5a2a, sky: true },
  forest: { ground: 0x3f5a2a, far: 0x4a6070, near: 0x2f4a24, farH: 22, nearH: 11, rough: 0.7, trees: 260, tree: 0x2a4a22, sky: true },
  swamp: { ground: 0x4a5236, far: 0x5a6660, near: 0x3a4a30, farH: 8, nearH: 4, rough: 0.35, trees: 90, tree: 0x34402a, sky: true },
  desert: { ground: 0xc8a868, far: 0xb89a70, near: 0xc0a060, farH: 14, nearH: 6, rough: 0.3, trees: 0, tree: 0x8a7a40, sky: true },
  snow: { ground: 0xdfe6ec, far: 0xb8c6d8, near: 0xd8e0e8, farH: 48, nearH: 10, rough: 1.0, trees: 80, tree: 0x2a4034, sky: true },
  cave: { ground: 0x2a2622, far: 0x1a1816, near: 0x2a2622, farH: 40, nearH: 18, rough: 1.0, trees: 0, tree: 0x000000, sky: false },
  town: { ground: 0x6a7044, far: 0x6a7a88, near: 0x5a5a48, farH: 20, nearH: 6, rough: 0.5, trees: 50, tree: 0x3a5a2a, sky: true },
  coast: { ground: 0x7a8a58, far: 0x7090a8, near: 0x4a7a98, farH: 12, nearH: 2, rough: 0.3, trees: 30, tree: 0x3a5a2a, sky: true },
  highland: { ground: 0x6a7048, far: 0x6a7480, near: 0x5a6048, farH: 60, nearH: 14, rough: 1.1, trees: 40, tree: 0x2f4a2a, sky: true },
};
export const biomeHasSky = (b: Biome) => BIOME[b].sky;

/** A jagged ring of silhouettes (mountains, hills) at a distance; heights from layered noise, seeded. */
function ring(radius: number, height: number, rough: number, seed: number, segments = 160): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const n = (x: number) => Math.sin(x * 1.0 + seed) * 0.5 + Math.sin(x * 2.3 + seed * 1.7) * 0.3 * rough + Math.sin(x * 5.1 + seed * 0.3) * 0.2 * rough + Math.sin(x * 11.7 + seed * 2.1) * 0.08 * rough;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const h = Math.max(0.15, 0.55 + n(a * 3)) * height;
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    pos.push(x, -2, z, x, h, z);
    col.push(1, 1, 1, 0.82, 0.82, 0.86); // tops a little lighter in the shader via colour
  }
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface Backdrop { group: THREE.Group; set: (l: Light, season?: Season, snow?: number) => void; dispose: () => void }
/**
 * Ground beyond the map (a large plain under the map, slightly below its lowest level), scattered trees just past
 * the edge, and two rings of silhouettes on the horizon, tinted by the sky (aerial perspective).
 */
export function buildBackdrop(biome: Biome, mapRadiusWorld: number, groundY: number, seed = 1): Backdrop {
  const b = BIOME[biome];
  const group = new THREE.Group();
  const groundMat = new THREE.MeshStandardMaterial({ color: b.ground, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(mapRadiusWorld + 420, 64), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = groundY; ground.receiveShadow = true;
  group.add(ground);
  const farMat = new THREE.MeshBasicMaterial({ color: b.far, vertexColors: true, fog: false, side: THREE.DoubleSide });
  const nearMat = new THREE.MeshStandardMaterial({ color: b.near, vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  const far = new THREE.Mesh(ring(mapRadiusWorld + 330, b.farH * (biome === 'cave' ? 1.6 : 1), b.rough, seed), farMat);
  const near = new THREE.Mesh(ring(mapRadiusWorld + 120, b.nearH, b.rough, seed * 3.1 + 1), nearMat);
  far.renderOrder = -5;
  group.add(far, near);
  // a few low-poly trees (or rocks) scattered just past the edge, so the map does not end in a cliff of nothing
  const treeMat = new THREE.MeshStandardMaterial({ color: b.tree, roughness: 1, flatShading: true });
  let treeMesh: THREE.InstancedMesh | null = null;
  if (b.trees) {
    const geo = biome === 'swamp' ? new THREE.ConeGeometry(0.9, 3.5, 5) : new THREE.ConeGeometry(1.6, 5.5, 6);
    geo.translate(0, biome === 'swamp' ? 1.7 : 2.7, 0);
    treeMesh = new THREE.InstancedMesh(geo, treeMat, b.trees);
    let s = seed * 9973 + 11;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const m = new THREE.Matrix4();
    for (let i = 0; i < b.trees; i++) {
      const a = rnd() * Math.PI * 2, r = mapRadiusWorld + 6 + rnd() ** 1.6 * 110, k = 0.7 + rnd() * 0.9;
      m.compose(new THREE.Vector3(Math.cos(a) * r, groundY, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(k, k * (0.8 + rnd() * 0.6), k));
      treeMesh.setMatrixAt(i, m);
    }
    treeMesh.castShadow = false;
    group.add(treeMesh);
  }
  const groundBase = C(b.ground), treeBase = C(b.tree), nearBase = C(b.near), farBase = C(b.far);
  return {
    group,
    set: (l, season, snow = 0) => {
      // aerial perspective: the far ring fades into the horizon colour; at night everything darkens
      farMat.color.copy(seasonTint(farBase.clone(), season, snow * 0.6)).lerp(C(l.horizon), 0.55).multiplyScalar(1 - l.night * 0.55);
      nearMat.color.copy(seasonTint(nearBase.clone(), season, snow)).lerp(C(l.fog), 0.2);
      groundMat.color.copy(seasonTint(groundBase.clone(), season, snow));
      treeMat.color.copy(seasonTint(treeBase.clone(), season, snow * 0.5));
    },
    dispose: () => group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); }),
  };
}

// ---------------------------------------------------------------- clouds, rain, snow
function cloudTexture(): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  let s = 99; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 18; i++) {
    const x = 30 + rnd() * 68, y = 44 + rnd() * 40, r = 14 + rnd() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let cloudTex: THREE.Texture | null = null;

export interface WeatherFx { group: THREE.Group; step: (dt: number, centre: THREE.Vector3) => void; dispose: () => void; animated: boolean }
/**
 * Clouds, rain and snow. APEX 2.6: any combination at once, and the drops / flakes fall on the GPU (a time uniform
 * in the vertex shader, wrapped in a box around the camera target) – the CPU touches no particle per frame.
 */
export function buildWeather(weatherIn: Weather | WeatherMix, l: Light, extent: number, quality = 1): WeatherFx {
  const mix = typeof weatherIn === 'string' ? weatherMix(weatherIn) : weatherIn;
  const group = new THREE.Group();
  const disposers: Array<() => void> = [];
  let s = 31; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // clouds: soft sprites high above, drifting
  const clouds: THREE.Sprite[] = [];
  const nClouds = { clear: 0, fleecy: 26, cloudy: 40, dark: 46 }[mix.sky] + (mix.rain && mix.sky === 'clear' ? 30 : 0) + (mix.snow && mix.sky === 'clear' ? 24 : 0);
  if (nClouds) {
    cloudTex ??= cloudTexture();
    const tint = mix.sky === 'fleecy' ? 0xffffff : mix.sky === 'cloudy' ? 0xdfe3e8 : mix.snow ? 0xd8dde4 : 0x6a7078;
    const mat = new THREE.SpriteMaterial({ map: cloudTex, color: C(tint).lerp(C(0x1a1e28), l.night * 0.8), transparent: true, depthWrite: false, fog: false, opacity: mix.sky === 'fleecy' ? 0.85 : 0.95 });
    for (let i = 0; i < nClouds; i++) {
      const sp = new THREE.Sprite(mat);
      const big = mix.sky === 'fleecy' ? 14 + rnd() * 12 : 30 + rnd() * 30;
      sp.scale.set(big * 2, big, 1);
      const a = rnd() * Math.PI * 2, d = extent * (0.3 + rnd() * 2.4);
      sp.position.set(Math.cos(a) * d, 38 + rnd() * 26, Math.sin(a) * d);
      sp.renderOrder = -4;
      group.add(sp); clouds.push(sp);
    }
    disposers.push(() => mat.dispose());
  }
  const BOX = 60, H = 40;
  const time = { value: 0 }, centre = { value: new THREE.Vector3() };
  const particles = (kind: 'rain' | 'snow') => {
    const n = Math.round((kind === 'rain' ? 2400 : 1600) * quality);
    const rain = kind === 'rain';
    const verts = rain ? 2 : 1;
    const pos = new Float32Array(n * verts * 3), speed = new Float32Array(n * verts), tip = new Float32Array(n * verts);
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * BOX, y = rnd() * H, z = (rnd() - 0.5) * BOX, v = rain ? 34 + rnd() * 10 : 2.2 + rnd() * 1.6;
      for (let j = 0; j < verts; j++) { pos.set([x + j * 0.08, y, z], (i * verts + j) * 3); speed[i * verts + j] = v; tip[i * verts + j] = j; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    g.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: time, uCentre: centre, uColor: { value: C(rain ? 0xaec4d8 : 0xffffff) }, uAlpha: { value: rain ? 0.5 : 0.85 } },
      transparent: true, depthWrite: false,
      vertexShader: `uniform float uTime; uniform vec3 uCentre; attribute float aSpeed; attribute float aTip; varying float vA;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * aSpeed, ${H.toFixed(1)}) + aTip * 0.9;
          ${rain ? '' : 'p.x += sin(uTime * 0.8 + position.z) * 0.6; p.z += cos(uTime * 0.6 + position.x) * 0.6;'}
          // wrap the box around the camera target so it never runs out
          p.x = mod(p.x - uCentre.x + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + uCentre.x;
          p.z = mod(p.z - uCentre.z + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + uCentre.z;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          ${rain ? '' : 'gl_PointSize = clamp(90.0 / -mv.z, 1.5, 6.0);'}
          vA = smoothstep(0.0, 4.0, p.y);
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vA;
        void main() { ${rain ? '' : 'vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard;'} gl_FragColor = vec4(uColor, uAlpha * vA); }`,
    });
    const obj = rain ? new THREE.LineSegments(g, mat) : new THREE.Points(g, mat);
    obj.frustumCulled = false;
    group.add(obj);
    disposers.push(() => { g.dispose(); mat.dispose(); });
  };
  if (mix.rain) particles('rain');
  if (mix.snow) particles('snow');
  return {
    group, animated: mix.rain || mix.snow || clouds.length > 0,
    step: (dt, c) => {
      time.value += dt;
      centre.value.copy(c);
      for (const [i, cl] of clouds.entries()) { cl.position.x += dt * (0.8 + (i % 5) * 0.15); if (cl.position.x > extent * 1.6) cl.position.x -= extent * 3.2; }
    },
    dispose: () => disposers.forEach((d) => d()),
  };
}

/** Colour of hexes nobody sees and nobody saw: parchment by day, ash at dusk, deep blue-black at night. */
export function unknownColour(l: Light): THREE.Color {
  return C(0xb59a68).lerp(C(0x5a5660), Math.min(1, l.night * 1.4 + (l.sunI < 0.8 ? 0.3 : 0))).lerp(C(0x14161e), l.night * 0.7);
}
