/**
 * APEX 1.8 – 3D battle map (three.js, loaded on demand). The same scene as the 2D hex map, seen in perspective:
 * every hex is a column as high as its ground (5-ft levels), walls, trees and boulders stand on it, figures are
 * upright markers (portrait or icon, name, life bar). Hover, path preview, reach, area preview and right-click
 * work like on the 2D map – the callbacks are the same.
 *
 * Camera: hold the middle mouse button and drag to orbit (left/right) and tilt (up/down); drag with the left
 * button to pan; the mouse wheel zooms; arrow keys pan, Q/E orbit, R/F tilt, 0 recentres.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { MapNode, SceneMap } from '../../campaign/maps';
import { decodeTiles, heightLookup, hexAt, hexCentre, hexMovementCost, hexReach, type TileDef } from '../../campaign/hexScene';
import { MAX_ALTITUDE_FT } from '../../game/altitude';
import { ORIGIN, distance, hexKey, hexesInRange, parseKey, type HexKey } from '../../game/hex';
import { HEX_SIZE, center, corner } from './geometry';
import type { SceneToken } from './HexSceneMap';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gradientMap, paletteKey } from '../../campaign/palette';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildCreature } from './creatures3d';
import { faunaOf } from '../../game/fauna';
import { sizeScale } from './sizes';
import { LEVEL, buildFigure, surfaceOf, surfaceTexture, tileProp } from './world3d';
import { lineOfSight, sightRules } from '../../campaign/hexVision';
import type { SceneFx } from '../../game/sceneFx';
import { FX_COLOR } from './CombatFx';
import { bearingArrow, type AwarenessRing, type StealthMark } from '../../game/stealth';
import { fromPixel } from '../../game/hex';

/** World units: a hex has corner radius 1; one 5-ft level = one hex width high (true scale, LEVEL from world3d). */
const BASE = 0.35;
const toWorld = (px: { x: number; y: number }) => ({ x: px.x / HEX_SIZE, z: px.y / HEX_SIZE });

interface Props {
  map: Pick<SceneMap, 'width' | 'height' | 'hex' | 'unitsPerCell' | 'unit' | 'palette' | 'mood'> & { nodes: MapNode[] };
  label: string;
  tokens?: SceneToken[];
  gm?: boolean;
  fog?: string;
  phase?: 'day' | 'dusk' | 'night';
  selectedTokenId?: string | null;
  reach?: Map<HexKey, { cost: number }> | null;
  onTokenClick?: (tokenId: string) => void;
  onHexClick?: (key: HexKey, point: { x: number; y: number }) => void;
  onHexContext?: (key: HexKey, point: { x: number; y: number }) => void;
  onTokenContext?: (tokenId: string) => void;
  pathFrom?: { x: number; y: number } | null;
  pathBudget?: number | null;
  /** APEX 1.9 – flying / climbing for the path preview. */
  pathMode?: { fly?: boolean; climb?: boolean };
  areaAt?: ((point: { x: number; y: number }) => HexKey[]) | null;
  focus?: { key: string; x: number; y: number } | null;
  /** APEX 2.0 – sight preview like the 2D map: the acting figure, whose opponents, the readied range. */
  sightFrom?: { x: number; y: number } | null;
  sightSide?: 'hostile' | 'party' | null;
  lineRangeFt?: number | null;
  /** APEX 1.9 – aim height (Shift + wheel) and combat events to animate. */
  aimAlt?: number;
  fx?: SceneFx[];
  /** APEX 2.4 – the moving figure can fly: its current altitude (ft). Shows the reach as a 3D volume around it. */
  flyAlt?: number | null;
  /** APEX 2.4 – sneaking: awareness rings of the opponents and (GM) spotted / heard marks. */
  stealth?: { rings: AwarenessRing[]; marks?: StealthMark[] } | null;
}

/** APEX 2.1 – 3D quality (per device): resolution, shadows, grass and animation. 'auto' picks by the device. */
export type Quality3D = 'low' | 'medium' | 'high' | 'ultra';
const QUALITY_KEY = 'apex.3d.quality';
export function readQuality(): Quality3D {
  try { const v = localStorage.getItem(QUALITY_KEY); if (v === 'low' || v === 'medium' || v === 'high' || v === 'ultra') return v; } catch { /* private mode */ }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'medium';
}
const QUALITY: Record<Quality3D, { ratio: number; shadow: number; grass: number; fps: number; lights: number; bloom: boolean; ao: boolean; soft: boolean }> = {
  low: { ratio: 1, shadow: 0, grass: 0, fps: 0, lights: 0, bloom: false, ao: false, soft: false },
  medium: { ratio: 1.25, shadow: 2048, grass: 12, fps: 30, lights: 3, bloom: false, ao: false, soft: false },
  high: { ratio: 2, shadow: 4096, grass: 26, fps: 60, lights: 6, bloom: true, ao: false, soft: true },
  // APEX 2.3: ambient occlusion on top – deep corners, contact shadows under figures and props
  ultra: { ratio: 2, shadow: 4096, grass: 26, fps: 60, lights: 8, bloom: true, ao: true, soft: true },
};
/** Tiles that burn or glow: their light flickers (fire) or stays steady (magic, lamps). */
const FLICKER = new Set(['campfire', 'brazier', 'hearth', 'forge', 'lava', 'lamppost']);

type Cam = { tx: number; tz: number; yaw: number; pitch: number; dist: number };

export default function HexScene3D(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; ground: THREE.InstancedMesh[]; dynamic: THREE.Group; tokens: THREE.Group; overlay: THREE.Group; effects: THREE.Group; composer?: EffectComposer } | null>(null);
  /** Animated things: grass shader time, swaying crowns, water, running combat effects. */
  const anim = useRef<{ time: { value: number }; crowns: THREE.Object3D[]; flames: THREE.Object3D[]; cards: THREE.Object3D[]; wings: THREE.Object3D[]; water: THREE.MeshStandardMaterial[]; lights: THREE.PointLight[]; fauna: Critter[]; fx: Array<{ born: number; life: number; update: (age: number) => void; dispose: () => void }>; moves: Move[] }>({ time: { value: 0 }, crowns: [], flames: [], cards: [], wings: [], water: [], lights: [], fauna: [], fx: [], moves: [] });
  /** APEX 2.5 – where every figure stood last time (to walk it along its path when it moves). */
  const lastPos = useRef(new Map<string, { k: HexKey; alt: number; pos: THREE.Vector3 }>());
  const cam = useRef<Cam>({ tx: 0, tz: 0, yaw: 0.6, pitch: 0.95, dist: 26 });
  const [hover, setHover] = useState<HexKey | null>(null);
  const [quality, setQualityState] = useState<Quality3D>(readQuality);
  const qcfg = QUALITY[quality];
  const setQuality = (v: Quality3D) => { setQualityState(v); try { localStorage.setItem(QUALITY_KEY, v); } catch { /* private mode */ } };
  /** Render on demand: set when anything visible changed (the loop renders, then clears it). */
  const dirty = useRef(true);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  // any React update (camera move, hover, new tokens …) means: draw again; scene changes re-bake the shadows
  useEffect(() => { dirty.current = true; });
  const [tick, setTick] = useState(0);
  const ox = p.map.width / 2, oy = p.map.height / 2;
  const height = useMemo(() => heightLookup(p.map), [p.map.hex]); // eslint-disable-line react-hooks/exhaustive-deps
  const tiles = useMemo(() => (p.map.hex ? decodeTiles(p.map.hex) : new Map<HexKey, TileDef>()), [p.map.hex]);
  const fogOf = useMemo(() => {
    const out = new Map<HexKey, string>();
    if (p.map.hex) hexesInRange(ORIGIN, p.map.hex.radius).forEach((h, i) => out.set(hexKey(h), p.fog ? p.fog[i] ?? 'v' : 'v'));
    return out;
  }, [p.map.hex, p.fog]);
  const top = (k: HexKey) => BASE + height(k) * LEVEL;
  // APEX 2.1 – the map's colour scheme recolours ground, props and grass in 3D like on the 2D map
  const nodesKey = p.map.nodes.map((n) => `${n.id}:${Math.round(n.x)}:${Math.round(n.y)}:${n.kind}:${n.lightFt ?? ''}`).join('|');
  const pKey = paletteKey(p.map.palette);
  const recolor = useMemo(() => {
    if (!p.map.palette) return null;
    const fn = gradientMap(p.map.palette);
    const mats = new Map<THREE.Material, THREE.Material>();
    const color = (c: THREE.Color) => { const [r, g, b] = fn([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]); return c.setRGB(r / 255, g / 255, b / 255); };
    const material = (m: THREE.Material) => {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial || (std.emissiveIntensity > 0 && std.emissive.getHex() !== 0)) return m;
      let hit = mats.get(m);
      if (!hit) { const c = std.clone(); color(c.color); hit = c; mats.set(m, c); }
      return hit;
    };
    return { color, material };
  }, [pKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const scenePoint = (k: HexKey) => { const c = center(parseKey(k)); return { x: c.x + ox, y: c.y + oy }; };

  // --- renderer, lights, camera (once)
  useEffect(() => {
    const el = wrap.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    // APEX 1.9: sharper picture – at least 1.5× supersampling, filmic tone mapping, larger shadow map
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[readQuality()].ratio * Math.max(1, window.devicePixelRatio || 1)));
    renderer.shadowMap.autoUpdate = false; // shadows are re-baked only when the scene changes
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    const hemi = new THREE.HemisphereLight(0xfff4dd, 0x2a2f2a, 0.9);
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.6);
    sun.position.set(-30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
    scene.add(hemi, sun);
    const dynamic = new THREE.Group(), tokens = new THREE.Group(), overlay = new THREE.Group(), effects = new THREE.Group();
    scene.add(dynamic, tokens, overlay, effects);
    three.current = { renderer, scene, camera, ground: [], dynamic, tokens, overlay, effects };
    if (import.meta.env.DEV) (window as unknown as { __apex3d?: unknown }).__apex3d = three.current; // dev: inspect the scene from tests
    const resize = () => { const w = el.clientWidth || 600, h = el.clientHeight || 400; renderer.setSize(w, h, false); three.current?.composer?.setSize(w, h); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); setTick((t) => t + 1); };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => { ro.disconnect(); renderer.dispose(); el.removeChild(renderer.domElement); three.current = null; };
  }, []);

  // --- background and light by phase, or the map's 3D mood (APEX 2.1)
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const mood = p.map.mood ?? (p.phase === 'night' ? 'night' : p.phase === 'dusk' ? 'dusk' : 'day');
    const M: Record<string, { bg: number; sky: number; ground: number; hemi: number; sun: number; sunI: number; pos: [number, number, number]; fog?: [number, number]; exp?: number }> = {
      day: { bg: 0x1b2027, sky: 0xfff4dd, ground: 0x2a2f2a, hemi: 0.9, sun: 0xfff0d0, sunI: 1.6, pos: [-30, 60, 20] },
      golden: { bg: 0x3a2a22, sky: 0xffe0b0, ground: 0x4a3a2a, hemi: 1.0, sun: 0xffb46a, sunI: 1.9, pos: [-50, 28, 15], exp: 1.1 },
      overcast: { bg: 0x4a5058, sky: 0xd8e0e8, ground: 0x3a3e40, hemi: 1.25, sun: 0xdfe6ee, sunI: 0.7, pos: [-20, 70, 30], fog: [40, 130] },
      dusk: { bg: 0x2a2230, sky: 0x9a7ab0, ground: 0x2a1e2a, hemi: 0.6, sun: 0xff8a5a, sunI: 0.95, pos: [-55, 20, 10] },
      night: { bg: 0x0b0f17, sky: 0x3a4a7a, ground: 0x0a0c12, hemi: 0.35, sun: 0x8fa8ff, sunI: 0.3, pos: [30, 60, -20] },
      misty: { bg: 0x8a9298, sky: 0xe0e6ea, ground: 0x4a5048, hemi: 1.1, sun: 0xeef2f4, sunI: 0.75, pos: [-20, 60, 30], fog: [18, 75] },
      storybook: { bg: 0x2b3a4a, sky: 0xfff8e8, ground: 0x3a4a2a, hemi: 1.1, sun: 0xfff2d0, sunI: 1.95, pos: [-35, 55, 25], exp: 1.15 },
      gloom: { bg: 0x161c16, sky: 0x8a9a7a, ground: 0x10140e, hemi: 0.5, sun: 0x9ab08a, sunI: 0.55, pos: [-25, 50, 25], fog: [28, 110] },
    };
    const m = M[mood] ?? M.day;
    t.scene.background = new THREE.Color(m.bg);
    t.scene.fog = new THREE.Fog(m.bg, m.fog?.[0] ?? 60, m.fog?.[1] ?? 160);
    const [hemi, sun] = t.scene.children as [THREE.HemisphereLight, THREE.DirectionalLight];
    hemi.color.setHex(m.sky); hemi.groundColor.setHex(m.ground); hemi.intensity = m.hemi;
    sun.color.setHex(m.sun); sun.intensity = m.sunI; sun.position.set(...m.pos);
    t.renderer.toneMappingExposure = m.exp ?? 1.05;
    t.renderer.shadowMap.needsUpdate = true;
    setTick((x) => x + 1);
  }, [p.phase, p.map.mood]);

  // --- quality: resolution and shadows follow the setting
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const dpr = window.devicePixelRatio || 1;
    t.renderer.setPixelRatio(quality === 'high' ? Math.min(2.5, Math.max(1.5, dpr)) : quality === 'ultra' ? Math.min(2, Math.max(1.5, dpr)) : quality === 'medium' ? Math.min(dpr, 1.25) : 1);
    t.renderer.shadowMap.type = qcfg.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    // post-processing: bloom on glowing things (fire, magic, lit windows), ambient occlusion on ultra
    t.composer?.dispose(); t.composer = undefined;
    if (qcfg.bloom || qcfg.ao) {
      const el0 = wrap.current; const w = el0?.clientWidth || 600, h = el0?.clientHeight || 400;
      const composer = new EffectComposer(t.renderer);
      composer.addPass(new RenderPass(t.scene, t.camera));
      if (qcfg.ao) { const ao = new GTAOPass(t.scene, t.camera, w, h); ao.blendIntensity = 0.85; composer.addPass(ao); }
      if (qcfg.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.45, 0.82));
      composer.addPass(new OutputPass());
      composer.setSize(w, h);
      t.composer = composer;
    }
    t.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    t.renderer.shadowMap.enabled = qcfg.shadow > 0;
    const sun = t.scene.children[1] as THREE.DirectionalLight;
    sun.castShadow = qcfg.shadow > 0;
    if (qcfg.shadow && sun.shadow.mapSize.x !== qcfg.shadow) { sun.shadow.mapSize.set(qcfg.shadow, qcfg.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    t.renderer.shadowMap.needsUpdate = true;
    const el = wrap.current; if (el) { const w = el.clientWidth || 600, h = el.clientHeight || 400; t.renderer.setSize(w, h, false); }
    dirty.current = true;
  }, [quality]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- terrain columns (instanced) and props (walls, trees, boulders)
  useEffect(() => {
    const t = three.current;
    if (!t || !p.map.hex) return;
    t.dynamic.clear();
    anim.current.crowns = []; anim.current.flames = []; anim.current.water = []; anim.current.lights = []; anim.current.fauna = [];
    for (const g of t.ground) { t.scene.remove(g); g.geometry.dispose(); }
    t.ground = [];
    const keys = [...tiles.keys()].filter((k) => fogOf.get(k) !== '.');
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) { const c = corner(0, 0, 1.0, i); if (i === 0) shape.moveTo(c.x, c.y); else shape.lineTo(c.x, c.y); }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // extrude downwards along -y, shape lies in x/z
    geo.translate(0, 1, 0); // top face at y = 1, bottom at 0
    // APEX 2.0: one instanced mesh per surface family (grass, earth, flagstones, planks, cobbles, marble, carpet …);
    // tops textured and tinted by the tile colour, sides as layered rock
    const side = new THREE.MeshStandardMaterial({ color: 0x9a8a74, roughness: 1, flatShading: true, map: rockTexture() });
    // cliff sides keep their rock colour (no tile tint from the instance colour)
    side.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', ''); };
    const families = new Map<string, HexKey[]>();
    for (const k of keys) { const f = surfaceOf(tiles.get(k)!.id); families.set(f, [...(families.get(f) ?? []), k]); }
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (const [fam, list] of families) {
      const top0 = new THREE.MeshStandardMaterial({ roughness: fam === 'marble' ? 0.35 : fam === 'smooth' ? 0.6 : 0.92, metalness: 0.02, map: surfaceTexture(fam), ...(qcfg.shadow ? { bumpMap: surfaceTexture(fam), bumpScale: fam === 'marble' || fam === 'carpet' ? 0.6 : fam === 'cobbles' || fam === 'flag' ? 3.2 : 2.2 } : {}) });
      groundSurface(top0);
      const mesh = new THREE.InstancedMesh(geo, [top0, side], list.length);
      mesh.receiveShadow = true; mesh.castShadow = true;
      list.forEach((k, i) => {
        const tile = tiles.get(k)!;
        const w = toWorld(center(parseKey(k)));
        const water = /deep|shallow|water|river|swamp/.test(tile.id);
        const pit = tile.id === 'pit';
        const wallTall = tile.id === 'wall' || tile.id === 'cavewall' ? LEVEL * 2 : 0;
        const h = Math.max(0.12, top(k) - (water ? 0.25 : 0) - (pit ? 0.3 : 0) + wallTall);
        m4.compose(new THREE.Vector3(w.x, 0, w.z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
        mesh.setMatrixAt(i, m4);
        col.set(pit ? '#141210' : tile.fill);
        if (recolor && !pit) recolor.color(col);
        if (fogOf.get(k) === 'e') col.multiplyScalar(0.45); // remembered, not seen now
        else col.offsetHSL(0, 0, (((parseKey(k).q * 7 + parseKey(k).r * 13) % 5) - 2) * 0.008);
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.keys = list;
      t.scene.add(mesh);
      t.ground.push(mesh);
    }
    // props of every tile: trees, pines, bushes, rocks, furniture, fires, ruins … (merged below)
    const props = new THREE.Group();
    for (const k of keys) {
      const tile = tiles.get(k)!;
      if (fogOf.get(k) === 'e' && !tile.blocksSight && !['pillar', 'statue', 'well', 'fountain', 'tower'].includes(tile.id)) continue; // remembered hexes keep their buildings and trees
      const h = parseKey(k);
      const rnd = (i: number) => { const v = Math.sin((h.q * 73.1 + h.r * 19.7 + i * 12.9898)) * 43758.5453; return v - Math.floor(v); };
      const prop = tileProp(tile.id, tile.fill, rnd, anim.current);
      if (!prop) continue;
      const w = toWorld(center(h));
      prop.position.set(w.x, top(k), w.z);
      prop.rotation.y = rnd(77) * Math.PI * 2;
      props.add(prop);
    }
    // APEX 2.1 – performance: all static prop meshes are merged into one mesh per material (a few draw calls instead
    // of thousands); animated parts (crowns, flames, wings) stay separate objects
    props.updateMatrixWorld(true);
    const animated = new Set<THREE.Object3D>([...anim.current.crowns, ...anim.current.flames]);
    for (const o of animated) t.dynamic.attach(o);
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    props.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      buckets.set(m.material, [...(buckets.get(m.material) ?? []), g]);
    });
    for (const [material, list] of buckets) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, recolor ? recolor.material(material) : material);
      mesh.castShadow = mesh.receiveShadow = true;
      t.dynamic.add(mesh);
    }
    // APEX 1.9 – grass: swaying blades on grass and undergrowth (instanced, wind in the vertex shader)
    const grassKeys = keys.filter((k) => /grass|undergrowth|plains|forest|tallgrass/.test(tiles.get(k)!.id) && fogOf.get(k) !== 'e');
    if (grassKeys.length && qcfg.grass > 0) {
      const per = qcfg.grass;
      const blade = new THREE.BufferGeometry();
      blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.03, 0, 0, 0.03, 0, 0, 0, 0.32, 0], 3));
      blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      const gmat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
      const time = anim.current.time;
      gmat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = time;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(uTime * 1.7 + wp.x * 0.9 + wp.z * 0.6) * 0.09 + sin(uTime * 3.1 + wp.x * 2.3) * 0.03;
          transformed.x += sway * position.y * 2.2;
          transformed.z += sway * position.y * 1.1;`);
      };
      const grass = new THREE.InstancedMesh(blade, gmat, grassKeys.length * per);
      const gm = new THREE.Matrix4(), gc = new THREE.Color(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      let n = 0;
      for (const k of grassKeys) {
        const w = toWorld(center(parseKey(k))), y = top(k), seed = parseKey(k).q * 73856093 ^ parseKey(k).r * 19349663;
        const rnd = (i: number) => { const v = Math.sin(seed + i * 12.9898) * 43758.5453; return v - Math.floor(v); };
        for (let i = 0; i < per; i++) {
          const a = rnd(i) * Math.PI * 2, r = Math.sqrt(rnd(i + 99)) * 0.82;
          q.setFromAxisAngle(up, rnd(i + 7) * Math.PI);
          const tall = /tallgrass|undergrowth/.test(tiles.get(k)!.id) ? 2.6 : 1;
          const hgt = (0.55 + rnd(i + 3) * 0.8) * tall;
          gm.compose(new THREE.Vector3(w.x + Math.cos(a) * r, y, w.z + Math.sin(a) * r), q, new THREE.Vector3(1, hgt, 1));
          grass.setMatrixAt(n, gm);
          gc.set(tiles.get(k)!.fill); if (recolor) recolor.color(gc); gc.offsetHSL(0.01 * (rnd(i + 5) - 0.5), 0.08, (rnd(i + 11) - 0.35) * 0.16);
          grass.setColorAt(n, gc);
          n++;
        }
      }
      grass.count = n;
      grass.instanceMatrix.needsUpdate = true;
      if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
      t.dynamic.add(grass);
    }
    // water: a glossy surface that shimmers
    for (const k of keys) {
      const tile = tiles.get(k)!;
      if (!/deep|shallow|water|river/.test(tile.id)) continue;
      const pts = Array.from({ length: 6 }, (_, i) => corner(0, 0, 1, i));
      const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map((v) => new THREE.Vector2(v.x, v.y)))); g.rotateX(Math.PI / 2);
      const wm = waterMaterial(new THREE.Color(tile.fill).offsetHSL(0, 0.1, 0.08), anim.current.time);
      const m = new THREE.Mesh(g, wm); const w = toWorld(center(parseKey(k)));
      m.position.set(w.x, top(k) - 0.06, w.z); m.userData.phase = (parseKey(k).q + parseKey(k).r) * 0.7;
      wm.userData.phase = m.userData.phase;
      t.dynamic.add(m); anim.current.water.push(wm);
    }
    // APEX 2.3 – tiles that burn or glow light their surroundings (the nearest to the middle, as many as the quality allows)
    const glowing = keys.filter((k) => tiles.get(k)!.light && fogOf.get(k) !== 'e').sort((x, y) => distance(parseKey(x), ORIGIN) - distance(parseKey(y), ORIGIN)).slice(0, qcfg.lights);
    for (const k of glowing) {
      const tile = tiles.get(k)!, w = toWorld(center(parseKey(k)));
      const fire = FLICKER.has(tile.id);
      const l = new THREE.PointLight(new THREE.Color(fire ? '#ffa04a' : tile.accent ?? '#9fd8ff'), fire ? 3.2 : 2.0, ((tile.light ?? 15) / 5) * 1.73 * 1.6, 1.5);
      l.position.set(w.x, top(k) + (tile.id === 'lamppost' ? 2.4 : tile.id === 'lava' ? 0.4 : 1.1), w.z);
      l.userData = { base: l.intensity, flicker: fire, phase: (parseKey(k).q * 7 + parseKey(k).r * 3) % 10 };
      t.dynamic.add(l); anim.current.lights.push(l);
    }
    // markers (lights, locations) as small glowing pins
    for (const n of p.map.nodes) {
      // APEX 2.3 – living biomes: a group of ambient animals that graze, hop, peck or circle in the sky
      if (n.kind === 'fauna' && (p.gm || n.visible)) {
        const f = faunaOf(n.species);
        const home = hexAt(p.map, n);
        if (!f || !tiles.has(hexKey(home)) || fogOf.get(hexKey(home)) === '.') continue;
        const spots = hexesInRange(home, 2).map(hexKey).filter((k) => { const tl = tiles.get(k); return !!tl && tl.cost !== null && !/deep/.test(tl.id) && fogOf.get(k) !== '.'; }).map((k) => { const w = toWorld(center(parseKey(k))); return new THREE.Vector3(w.x, top(k), w.z); });
        if (!spots.length) continue;
        const scale = sizeScale(f.size) * (f.size === 'tiny' ? 1.2 : 1);
        for (let i = 0; i < Math.min(12, n.count ?? 3); i++) {
          const roll = ((i * 37 + n.id.length * 11) % 10) / 10;
          const model = buildCreature(n.species!, undefined, f.behaviour === 'fly', f.behaviour === 'fly' ? undefined : roll < 0.25 ? 'young' : roll < 0.6 ? 'female' : undefined);
          if (!model) break;
          model.group.scale.multiplyScalar(scale);
          const at = spots[(i * 7) % spots.length].clone().add(new THREE.Vector3((roll - 0.5) * 0.8, 0, (((i * 13) % 10) / 10 - 0.5) * 0.8));
          model.group.position.copy(at); model.group.rotation.y = roll * Math.PI * 2;
          t.dynamic.add(model.group);
          anim.current.fauna.push({ obj: model.group, behaviour: f.behaviour, spots, home: spots[0].clone(), target: null, wait: roll * 4, phase: roll * 10, wings: model.wings });
        }
        continue;
      }
      // APEX 2.1 – enemy spawn markers (GM only): a red banner on a dashed ring
      if (n.kind === 'enemies' && p.gm) {
        const k = hexKey(hexAt(p.map, n));
        if (!tiles.has(k)) continue;
        const w = toWorld(center(parseKey(k)));
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.12, 24), new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(w.x, top(k) + 0.05, w.z);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), new THREE.MeshBasicMaterial({ color: 0x3a2a1a }));
        pole.position.set(w.x, top(k) + 1.2, w.z);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ color: 0xb3261e, side: THREE.DoubleSide }));
        flag.position.set(w.x + 0.42, top(k) + 2.1, w.z);
        t.dynamic.add(ring, pole, flag);
        continue;
      }
      if ((n.kind === 'spawn' || n.kind === 'location') && p.gm) {
        const k = hexKey(hexAt(p.map, n));
        if (!tiles.has(k)) continue;
        const w = toWorld(center(parseKey(k)));
        const spawnNode = n.kind === 'spawn';
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.95, 6), new THREE.MeshBasicMaterial({ color: spawnNode ? 0x6fe0a0 : 0xd8b25a, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 6; ring.position.set(w.x, top(k) + 0.04, w.z);
        const pin = new THREE.Mesh(spawnNode ? new THREE.ConeGeometry(0.22, 0.5, 4) : new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: spawnNode ? 0x6fe0a0 : 0xd8b25a }));
        pin.position.set(w.x, top(k) + (spawnNode ? 1.0 : 1.2), w.z); if (spawnNode) pin.rotation.x = Math.PI;
        t.dynamic.add(ring, pin);
        continue;
      }
      if (n.kind !== 'light' || (!p.gm && !n.visible)) continue;
      const k = hexKey(hexAt(p.map, n));
      if (!tiles.has(k) || fogOf.get(k) === '.') continue;
      const w = toWorld(center(parseKey(k)));
      const glow = new THREE.PointLight(0xffb54a, p.phase === 'day' ? 0.5 : 2.2, ((n.lightFt ?? 30) / 5) * 2, 1.6);
      glow.position.set(w.x, top(k) + 1.4, w.z);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffcf6b }));
      flame.position.copy(glow.position);
      t.dynamic.add(glow, flame);
    }
    setTick((x) => x + 1);
  }, [tiles, fogOf, height, p.gm, p.phase, quality, recolor, nodesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- figures: upright markers with portrait / icon, name, life bar
  const tokenKey = JSON.stringify((p.tokens ?? []).map((tk) => [tk.tokenId, Math.round(tk.x), Math.round(tk.y), tk.name, tk.color, tk.enemy?.icon, tk.enemy?.condition, tk.enemy?.hp, tk.vitals?.hp, tk.vitals?.form, tk.target, tk.view?.portraitV, tk.alt, tk.sneaking, (tk.icons ?? []).map((i) => i.icon).join(''), tk.view?.figure ? JSON.stringify(tk.view.figure) : '', tk.enemy?.look ? JSON.stringify(tk.enemy.look) : '', tk.enemy?.breed, tk.enemy?.creature ? JSON.stringify(tk.enemy.creature) : ''])) + (p.selectedTokenId ?? '');
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.tokens.children.forEach((c) => c.traverse((o) => { const m = (o as THREE.Mesh).material as (THREE.Material & { map?: THREE.Texture | null }) | undefined; if (m && (o as THREE.Sprite).isSprite) { m.map?.dispose(); m.dispose(); } }));
    t.tokens.clear();
    anim.current.cards = []; anim.current.wings = [];
    const stacks = new Map<HexKey, SceneToken[]>();
    for (const tk of p.tokens ?? []) { const k = hexKey(hexAt(p.map, tk)); stacks.set(k, [...(stacks.get(k) ?? []), tk]); }
    for (const [k, group] of stacks) {
      group.forEach((tk, i) => {
        const w = toWorld(center(parseKey(k)));
        const off = group.length > 1 ? { x: Math.cos((i / group.length) * Math.PI * 2) * 0.45, z: Math.sin((i / group.length) * Math.PI * 2) * 0.45 } : { x: 0, z: 0 };
        const y = top(k), lift = ((tk.alt ?? 0) / 5) * LEVEL;
        const enemy = tk.enemy;
        const ringColor = tk.tokenId === p.selectedTokenId ? 0xf3dc9a : enemy ? (enemy.ally ? 0x7fb8ff : 0xb3261e) : 0xe8d4a6;
        // APEX 2.0: a true-scale standee (portrait) or miniature on a base
        const fig = buildFigure(tk, ringColor);
        const g = fig.group;
        g.position.set(w.x + off.x, y + lift, w.z + off.z);
        g.rotation.y = yawMemory.get(tk.tokenId) ?? (enemy ? Math.PI : 0); // keeps the direction it last turned to
        g.userData = { tokenId: tk.tokenId, idle: { kind: fig.animKind, body: fig.body, head: fig.head, baseY: fig.body.position.y, phase: (tk.tokenId.charCodeAt(0) * 13 + tk.tokenId.length * 7) % 100 / 10, hostile: !!enemy && !enemy.ally, yaw: g.rotation.y, rest: 0, height: fig.height, wings: fig.wings ?? [], crouch: tk.sneaking ? 1 : 0, crouchNow: tk.sneaking ? 1 : 0 } };
        // APEX 2.4 – sneaking figures crouch (also without the idle animation); a portrait standee ducks lower
        if (tk.sneaking) { if (fig.animKind === 'still') g.scale.y *= 0.74; else { fig.body.scale.y = 0.7; fig.body.scale.x = fig.body.scale.z = 1.08; if (fig.animKind === 'humanoid') fig.body.rotation.x = 0.2; } }
        if (fig.card) anim.current.cards.push(fig.card);
        if (fig.wings) anim.current.wings.push(...fig.wings);
        if (lift > 0) {
          // flying: a shadow on the ground and a faint line down to it
          const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
          shadow.rotation.x = -Math.PI / 2; shadow.position.y = -lift + 0.03;
          const line = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, lift, 4), new THREE.MeshBasicMaterial({ color: 0x7fd6ff, transparent: true, opacity: 0.5 }));
          line.position.y = -lift / 2;
          g.add(shadow, line);
        }
        t.tokens.add(g);
        // APEX 2.5 – movement animation: walk (or fly) the figure along its path from where it stood before
        const prev = lastPos.current.get(tk.tokenId);
        const final = g.position.clone();
        lastPos.current.set(tk.tokenId, { k, alt: tk.alt ?? 0, pos: final.clone() });
        if (prev && prev.k !== k && distance(parseKey(prev.k), parseKey(k)) <= 40) {
          const fly = (tk.alt ?? 0) > 0 || prev.alt > 0;
          const r = hexMovementCost(p.map, hexCentre(p.map, parseKey(prev.k)), tk, { fly, climb: true });
          const mid = r.ok ? r.steps.slice(0, -1).map((s, i, all) => { const sk = hexKey(hexAt(p.map, s)); const ww = toWorld(center(parseKey(sk))); const f = (i + 1) / (all.length + 1); return new THREE.Vector3(ww.x, top(sk) + (prev.alt + ((tk.alt ?? 0) - prev.alt) * f) / 5 * LEVEL, ww.z); }) : [];
          const pts = [prev.pos.clone(), ...mid, final];
          g.position.copy(pts[0]);
          g.userData.moving = true;
          anim.current.moves = anim.current.moves.filter((m) => m.id !== tk.tokenId);
          anim.current.moves.push({ id: tk.tokenId, obj: g, pts, born: performance.now(), dur: Math.min(4000, 260 * (pts.length - 1)) });
        }
      });
    }
  }, [tokenKey, height]); // eslint-disable-line react-hooks/exhaustive-deps
  // --- APEX 2.4 sneaking: awareness rings on the ground (following the relief) and “!” / “?” above the watchers
  const stealthGroup = useRef<THREE.Group | null>(null);
  const stealthKey = JSON.stringify(p.stealth ?? null);
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (!stealthGroup.current) { stealthGroup.current = new THREE.Group(); t.scene.add(stealthGroup.current); }
    const grp = stealthGroup.current;
    grp.children.forEach((o) => { o.traverse((c) => { const m = c as THREE.Mesh; m.geometry?.dispose(); const mat = m.material as THREE.Material & { map?: THREE.Texture | null }; mat?.map?.dispose(); mat?.dispose?.(); }); });
    grp.clear();
    const st = p.stealth;
    if (st) {
      const unit = p.map.unitsPerCell || 5;
      const groundAt = (x: number, z: number) => { const k = hexKey(fromPixel(x * HEX_SIZE, z * HEX_SIZE, HEX_SIZE)); return tiles.has(k) ? top(k) : BASE; };
      for (const r of st.rings) {
        const k = hexKey(hexAt(p.map, r)); const c = toWorld(center(parseKey(k)));
        const rad = (r.ft / unit) * Math.sqrt(3);
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; const x = c.x + Math.cos(a) * rad, z = c.z + Math.sin(a) * rad; pts.push(new THREE.Vector3(x, groundAt(x, z) + 0.12, z)); }
        const col = r.danger ? 0xff5a4a : 0xf3c86a;
        // a solid band (red) or a dashed band (gold): flat tube pieces following the ground
        const band = new THREE.MeshBasicMaterial({ color: col });
        const pieces: THREE.BufferGeometry[] = [];
        const step = r.danger ? 1 : 2;
        for (let i = 0; i + 1 < pts.length; i += step) {
          const seg = new THREE.TubeGeometry(new THREE.LineCurve3(pts[i], pts[i + 1]), 1, 0.07, 4, false);
          pieces.push(seg);
        }
        const ring = new THREE.Mesh(mergeGeometries(pieces), band); pieces.forEach((g) => g.dispose());
        ring.renderOrder = 6;
        grp.add(ring);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(`👁 ${r.passive} · ${r.ft} ft`, r.danger ? '#ff9a8a' : '#f3dc9a', false), transparent: true, depthTest: false }));
        sp.scale.set(2.4, 0.6, 1); sp.position.set(c.x + rad * 0.7, groundAt(c.x + rad * 0.7, c.z - rad * 0.7) + 0.6, c.z - rad * 0.7); sp.renderOrder = 8;
        grp.add(sp);
      }
      for (const m of st.marks ?? []) {
        const k = hexKey(hexAt(p.map, m)); const c = toWorld(center(parseKey(k)));
        const y = top(k) + ((m.alt ?? 0) / 5) * LEVEL + 3.1;
        const text = m.kind === 'spotted' ? '❗' : `❓${bearingArrow(m.bearing)}`;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text, m.kind === 'spotted' ? '#ff4a3a' : '#ffd36a', true), transparent: true, depthTest: false }));
        sp.scale.set(m.kind === 'spotted' ? 2.6 : 3, 0.7, 1); sp.position.set(c.x, y, c.z); sp.renderOrder = 9;
        sp.userData.pulse = m.kind;
        grp.add(sp);
        if (m.kind === 'heard') {
          // a short arrow on the ground towards the noise (bearing 0 = up on the map = −z)
          const a = (m.bearing * Math.PI) / 180, dx = Math.sin(a), dz = -Math.cos(a);
          const from = new THREE.Vector3(c.x + dx * 0.9, top(k) + 0.2, c.z + dz * 0.9), to = new THREE.Vector3(c.x + dx * 2.6, top(k) + 0.2, c.z + dz * 2.6);
          const arrow = new THREE.ArrowHelper(to.clone().sub(from).normalize(), from, 1.7, 0xffd36a, 0.6, 0.4);
          grp.add(arrow);
        }
      }
    }
    dirty.current = true;
  }, [stealthKey, tiles, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // shadows are baked, not drawn every frame: re-bake when terrain, figures, phase or quality change
  useEffect(() => { if (three.current) three.current.renderer.shadowMap.needsUpdate = true; }, [tokenKey, tiles, height, p.phase, quality]);

  // --- overlays: reach area, hover, path preview, area preview
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.overlay.children.forEach((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
    t.overlay.clear();
    const disc = (k: HexKey, color: number, opacity: number, lift = 0.02, scale = 0.92) => {
      const pts = Array.from({ length: 6 }, (_, i) => corner(0, 0, scale, i));
      const s = new THREE.Shape(pts.map((q) => new THREE.Vector2(q.x, q.y)));
      // with post-processing (bloom / AO) translucent fills wash out the dark ground (tone mapping after blending), so
      // the overlay becomes an opaque hex rim instead – crisp and readable in every light
      if (t.composer) { const inner = Array.from({ length: 6 }, (_, i) => corner(0, 0, scale * (opacity >= 0.4 ? 0.78 : 0.9), i)); s.holes.push(new THREE.Path(inner.map((q) => new THREE.Vector2(q.x, q.y)).reverse())); }
      const g = new THREE.ShapeGeometry(s); g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, t.composer ? new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.18 + opacity * 0.9), side: THREE.DoubleSide }) : new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
      const w = toWorld(center(parseKey(k)));
      m.position.set(w.x, top(k) + lift, w.z);
      t.overlay.add(m);
    };
    if (p.reach) for (const k of p.reach.keys()) if (tiles.has(k)) disc(k, 0xf3dc9a, 0.22);
    // APEX 2.4 – flying reach: every point with horizontal path cost + climb/descent ≤ the movement left – a
    // glassy volume (a lens, widest at the current height) to aim into with Shift + wheel
    const flyAlt = p.flyAlt ?? null;
    if (flyAlt !== null && p.pathFrom && p.pathBudget && p.pathBudget > 0) {
      const unit = p.map.unitsPerCell || 5;
      const air = hexReach(p.map, p.pathFrom, p.pathBudget, { fly: true });
      const startK = hexKey(hexAt(p.map, p.pathFrom));
      air.set(startK, { cost: 0, prev: null });
      const z0 = height(startK) * unit + flyAlt;
      // a stepped dome: one glassy lid per hex at the highest reachable point, its outline, and a lower lid where the
      // reach does not go down to the ground – reads like a sphere around the figure without fogging the map
      const caps: THREE.BufferGeometry[] = [], edges: number[] = [];
      const lid = (x: number, y: number, z: number) => {
        const cap = new THREE.CircleGeometry(0.9, 6); cap.rotateX(-Math.PI / 2); cap.rotateY(Math.PI / 6); cap.translate(x, y, z); caps.push(cap);
        for (let i = 0; i < 6; i++) { const a0 = (Math.PI / 3) * i + Math.PI / 6, a1 = a0 + Math.PI / 3; edges.push(x + Math.cos(a0) * 0.9, y, z - Math.sin(a0) * 0.9, x + Math.cos(a1) * 0.9, y, z - Math.sin(a1) * 0.9); }
      };
      for (const [k, { cost }] of air) {
        if (!tiles.has(k)) continue;
        const left = p.pathBudget - cost * unit;
        if (left < 0) continue;
        const g = height(k) * unit;
        const lo = Math.max(g, z0 - left), hi = Math.min(g + MAX_ALTITUDE_FT, z0 + left);
        if (hi - lo < 1) continue;
        const w = toWorld(center(parseKey(k)));
        lid(w.x, top(k) + ((hi - g) / 5) * LEVEL, w.z);
        if (lo > g + 1) lid(w.x, top(k) + ((lo - g) / 5) * LEVEL, w.z);
      }
      if (caps.length) {
        const glass = new THREE.MeshBasicMaterial({ color: 0x7fd6ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
        const m1 = new THREE.Mesh(mergeGeometries(caps), glass);
        const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
        const m2 = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.55 }));
        m1.renderOrder = 3; m2.renderOrder = 4;
        caps.forEach((g) => g.dispose());
        t.overlay.add(m1, m2);
      }
    }
    // APEX 2.0 – sight preview: from the hovered hex (where the figure could stand) to every opponent in sight –
    // white within the readied range, gold beyond it; hovering an opponent shows the line from the figure to it
    if (hover && p.sightSide && (p.sightFrom ?? null)) {
      const rules = sightRules(p.map);
      const opp = (p.tokens ?? []).filter((tk) => (p.sightSide === 'hostile' ? !!tk.enemy && !tk.enemy.ally : !tk.enemy || !!tk.enemy.ally) && tk.enemy?.condition !== 'down');
      const eyeOf = (k: HexKey, altFt = 0) => { const w = toWorld(center(parseKey(k))); return new THREE.Vector3(w.x, top(k) + (altFt / 5) * LEVEL + 1.7, w.z); };
      const label = (text: string, at: THREE.Vector3, color: string) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text, color, false), transparent: true, depthTest: false })); sp.scale.set(2.2, 0.55, 1); sp.position.copy(at); sp.renderOrder = 8; t.overlay.add(sp); };
      const segment = (a: THREE.Vector3, b: THREE.Vector3, color: number, dashed: boolean) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.35, gapSize: 0.25, depthTest: false, transparent: true }) : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true })); if (dashed) l.computeLineDistances(); l.renderOrder = 7; t.overlay.add(l); };
      const self = hexKey(hexAt(p.map, p.sightFrom!));
      // APEX 2.4 – a flyer looks from its altitude (at the hovered hex: the aim height while it can fly)
      const myAlt = p.flyAlt ?? 0, hoverAlt = p.flyAlt !== null && p.flyAlt !== undefined ? (p.aimAlt ?? 0) || myAlt : 0;
      const onOpp = opp.find((tk) => hexKey(hexAt(p.map, tk)) === hover);
      const unit = p.map.unitsPerCell || 5;
      if (onOpp && p.lineRangeFt) {
        const ft = Math.max(distance(parseKey(self), parseKey(hover)) * unit, Math.abs((height(hover) * 5 + (onOpp.alt ?? 0)) - height(self) * 5));
        const ok = ft <= p.lineRangeFt && lineOfSight(parseKey(self), parseKey(hover), rules.blocks, rules.height, { a: myAlt / 5, b: (onOpp.alt ?? 0) / 5 });
        const a = eyeOf(self, myAlt), b = eyeOf(hover, onOpp.alt);
        segment(a, b, ok ? 0xffffff : 0xff6b5a, !ok);
        label(`${ft} ft${ok ? '' : ' ✕'}`, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.5, 0)), ok ? '#ffffff' : '#ff9a8a');
      } else if (hover !== self) {
        let seen = 0;
        for (const tk of opp) {
          const k = hexKey(hexAt(p.map, tk));
          const ft = Math.max(distance(parseKey(hover), parseKey(k)) * unit, Math.abs((height(k) * 5 + (tk.alt ?? 0)) - height(hover) * 5));
          if (ft > 40 * unit || !lineOfSight(parseKey(hover), parseKey(k), rules.blocks, rules.height, { a: hoverAlt / 5, b: (tk.alt ?? 0) / 5 })) continue;
          seen++;
          const ok = !p.lineRangeFt || ft <= p.lineRangeFt;
          const a = eyeOf(hover, hoverAlt), b = eyeOf(k, tk.alt);
          segment(a, b, ok ? 0xffffff : 0xf3c86a, !ok);
          label(`${ft} ft`, a.clone().lerp(b, 0.55).add(new THREE.Vector3(0, 0.4, 0)), ok ? '#ffffff' : '#f3dc9a');
        }
        label(`👁 ${seen} in sight`, eyeOf(hover).add(new THREE.Vector3(0, 0.9, 0)), '#ffffff');
      }
    }
    if (hover) {
      disc(hover, 0xffffff, 0.28, 0.04, 0.98);
      const aim = p.aimAlt ?? 0;
      if (aim > 0) {
        // the aim height: a glowing hex in the air and a dashed line down to the ground
        const lift = (aim / 5) * LEVEL;
        disc(hover, 0x7fd6ff, 0.45, lift, 0.9);
        const w = toWorld(center(parseKey(hover)));
        const pts = [new THREE.Vector3(w.x, top(hover), w.z), new THREE.Vector3(w.x, top(hover) + lift, w.z)];
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x7fd6ff, dashSize: 0.25, gapSize: 0.18 }));
        line.computeLineDistances();
        t.overlay.add(line);
      }
      const area = p.areaAt ? p.areaAt(scenePoint(hover)) : null;
      if (area) for (const k of area) disc(k, 0xff7828, 0.5, 0.05);
      if (p.pathFrom && !area) {
        const flying = p.flyAlt !== null && p.flyAlt !== undefined && (p.flyAlt > 0 || (p.aimAlt ?? 0) > 0);
        const r = hexMovementCost(p.map, p.pathFrom, scenePoint(hover), flying ? { ...p.pathMode, fly: true } : p.pathMode);
        if (r.ok && r.steps.length) {
          // flying: the path rises / sinks from the current altitude to the aim height; climbing costs feet too
          const unit = p.map.unitsPerCell || 5;
          const fromK = hexKey(hexAt(p.map, p.pathFrom));
          const z0 = height(fromK) * unit + (p.flyAlt ?? 0), z1 = height(hover) * unit + (p.aimAlt ?? 0);
          const vertical = flying ? Math.abs(z1 - z0) : 0;
          const ok = p.pathBudget === null || p.pathBudget === undefined || r.cost + vertical <= p.pathBudget + 1e-9;
          const all = [p.pathFrom, ...r.steps];
          const pts = all.map((q, i) => {
            const k = hexKey(hexAt(p.map, q)); const w = toWorld(center(parseKey(k)));
            if (!flying) return new THREE.Vector3(w.x, top(k) + 0.15, w.z);
            const z = z0 + ((z1 - z0) * i) / Math.max(1, all.length - 1);
            return new THREE.Vector3(w.x, Math.max(top(k), BASE + (z / 5) * LEVEL) + 0.15, w.z);
          });
          const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.2);
          const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), 0.07, 6, false), new THREE.MeshBasicMaterial({ color: ok ? 0xf3dc9a : 0xff6b5a }));
          t.overlay.add(tube);
        }
      }
    }
    setTick((x) => x + 1);
  }, [hover, p.reach, p.pathFrom?.x, p.pathFrom?.y, p.pathBudget, p.areaAt, tiles, height, p.aimAlt, p.flyAlt, p.sightFrom?.x, p.sightFrom?.y, p.sightSide, p.lineRangeFt, p.tokens, quality]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- camera focus (active turn) and first framing
  useEffect(() => {
    if (!p.map.hex) return;
    const r = p.map.hex.radius;
    cam.current.dist = Math.max(14, r * 2.4);
    setTick((x) => x + 1);
  }, [p.map.hex?.radius]); // eslint-disable-line react-hooks/exhaustive-deps
  const flyRaf = useRef(0);
  const flyTo = (w: { x: number; z: number }) => {
    cancelAnimationFrame(flyRaf.current);
    const from = { ...cam.current };
    const start = performance.now();
    const step = (now: number) => {
      const e = Math.min(1, (now - start) / 500), q = 1 - (1 - e) ** 3;
      cam.current.tx = from.tx + (w.x - from.tx) * q; cam.current.tz = from.tz + (w.z - from.tz) * q;
      setTick((x) => x + 1);
      if (e < 1) flyRaf.current = requestAnimationFrame(step);
    };
    flyRaf.current = requestAnimationFrame(step);
  };
  useEffect(() => {
    if (!p.focus) return;
    flyTo(toWorld(center(parseKey(hexKey(hexAt(p.map, p.focus))))));
    return () => cancelAnimationFrame(flyRaf.current);
  }, [p.focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // APEX 2.5 – WASD: held keys pan the camera (while the pointer is over the map or the map has focus)
  const keys = useRef(new Set<string>());
  const lastKeyFrame = useRef(0);
  const over = useRef(false);
  useEffect(() => {
    const typing = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable); };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd'].includes(k) || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      if (!over.current && document.activeElement !== wrap.current) return;
      e.preventDefault(); keys.current.add(k); dirty.current = true;
    };
    const up = (e: KeyboardEvent) => { keys.current.delete(e.key.toLowerCase()); };
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  // --- render loop (wind, water, combat effects); pauses while the tab is hidden
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t = three.current;
      if (!t || document.hidden) return;
      // APEX 2.1 – render on demand: every frame only while something moves (effects, wind at medium/high, at most
      // the quality's frame rate); a still scene costs nothing
      const cfg = QUALITY[qualityRef.current];
      const busy = anim.current.fx.length > 0 || anim.current.moves.length > 0 || keys.current.size > 0;
      const animate = cfg.fps > 0;
      if (!dirty.current && !busy && !animate) return;
      if (!dirty.current && !busy && now - last < 1000 / cfg.fps) return;
      last = now;
      dirty.current = false;
      const sec = (now - start) / 1000;
      const a = anim.current;
      a.time.value = sec;
      for (const c of a.crowns) { c.rotation.z = Math.sin(sec * 0.9 + c.userData.phase) * 0.035; c.rotation.x = Math.sin(sec * 0.7 + c.userData.phase * 1.3) * 0.025; }
      for (const w of a.water) w.opacity = 0.7 + Math.sin(sec * 1.3 + (w.userData.phase as number)) * 0.05;
      for (const f of a.flames) { f.scale.y = 0.85 + Math.sin(sec * 9 + f.id) * 0.12 + Math.sin(sec * 23 + f.id * 2) * 0.05; f.rotation.y = sec * 0.6; }
      for (const w of a.wings) { if (w.userData.flapZ) w.rotation.z = Math.sin(sec * 6 + w.id) * (w.userData.amp as number) * (w.userData.side as number); else w.rotation.x = Math.sin(sec * 7 + w.id) * 0.6 * (w.userData.side as number); }
      // APEX 2.3 – idle life: breathing, weight shift, turning to the nearest opponent, creatures resting until approached
      idleStep(t.tokens, sec);
      faunaStep(a.fauna, t.tokens, sec);
      // standees turn towards the camera (around the vertical axis)
      const camPos = t.camera.position;
      for (const c of a.cards) { const wp = c.getWorldPosition(new THREE.Vector3()); const parentRot = c.parent ? c.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(); const yaw = Math.atan2(camPos.x - wp.x, camPos.z - wp.z); const pe = new THREE.Euler().setFromQuaternion(parentRot, 'YXZ'); c.rotation.y = yaw - pe.y; }
      a.fx = a.fx.filter((f) => { const age = now - f.born; if (age > f.life) { f.dispose(); return false; } if (age >= 0) f.update(age / f.life); return true; });
      a.moves = a.moves.filter((m) => stepMove(m, now));
      // APEX 2.5 – WASD pans smoothly while held (speed grows with the zoom)
      if (keys.current.size) {
        const c = cam.current, dt = Math.min(0.05, (now - (lastKeyFrame.current || now)) / 1000), sp = c.dist * 0.9 * dt;
        const fw = (keys.current.has('w') ? 1 : 0) - (keys.current.has('s') ? 1 : 0), rt = (keys.current.has('d') ? 1 : 0) - (keys.current.has('a') ? 1 : 0);
        c.tx += (-Math.sin(c.yaw) * fw + Math.cos(c.yaw) * rt) * sp; c.tz += (-Math.cos(c.yaw) * fw - Math.sin(c.yaw) * rt) * sp;
      }
      lastKeyFrame.current = now;
      const c = cam.current;
      t.camera.position.set(c.tx + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist, Math.sin(c.pitch) * c.dist, c.tz + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist);
      t.camera.lookAt(c.tx, 1, c.tz);
      for (const l of a.lights) if (l.userData.flicker) l.intensity = (l.userData.base as number) * (0.8 + 0.2 * Math.sin(sec * 11 + (l.userData.phase as number)) * Math.sin(sec * 6.7 + (l.userData.phase as number) * 1.7));
      if (t.composer) t.composer.render(); else t.renderer.render(t.scene, t.camera);
      t.renderer.shadowMap.needsUpdate = false;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- combat effects in 3D (APEX 1.9): streak, burst, floating number, area flash
  const seenFx = useRef<Set<string> | null>(null);
  useEffect(() => {
    const t = three.current;
    const list = p.fx ?? [];
    if (!t) return;
    if (!seenFx.current) { const newest = Math.max(0, ...list.map((f) => f.at)); seenFx.current = new Set(list.filter((f) => newest - f.at > 3000).map((f) => f.id)); }
    const fresh = list.filter((f) => !seenFx.current!.has(f.id)).sort((a, b) => a.at - b.at);
    const now = performance.now();
    const posOf = (actor?: string) => {
      if (!actor) return null;
      const id = actor.replace(/^(pc|npc)-/, '');
      const g = t.tokens.children.find((c) => c.userData.tokenId === id);
      return g ? g.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : null;
    };
    fresh.forEach((f, i) => {
      seenFx.current!.add(f.id);
      const born = now + i * 220;
      const color = new THREE.Color(FX_COLOR[f.element] ?? '#ffffff');
      const to = posOf(f.to) ?? (f.hexes?.length ? (() => { const k = f.hexes![Math.floor(f.hexes!.length / 2)]; const w = toWorld(center(parseKey(k))); return new THREE.Vector3(w.x, top(k) + 1, w.z); })() : null);
      const from = posOf(f.from);
      const objs: THREE.Object3D[] = [];
      const add = (o: THREE.Object3D) => { t.effects.add(o); objs.push(o); return o; };
      let update: (k: number) => void = () => undefined;
      const parts: Array<(k: number) => void> = [];
      if (f.kind === 'area' && f.hexes) {
        const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
        for (const k of f.hexes) {
          const pts = Array.from({ length: 6 }, (_, j) => corner(0, 0, 0.95, j));
          const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map((v) => new THREE.Vector2(v.x, v.y)))); g.rotateX(Math.PI / 2);
          const mesh = new THREE.Mesh(g, m); const w = toWorld(center(parseKey(k))); mesh.position.set(w.x, top(k) + 0.08, w.z);
          add(mesh);
        }
        // a fireball-like sphere at the area's centre
        const ball = add(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false })));
        if (to) ball.position.copy(to);
        const r = Math.max(1, (f.sizeFt ?? 10) / 5);
        parts.push((k) => { m.opacity = k < 0.15 ? k / 0.15 * 0.6 : 0.6 * (1 - (k - 0.15) / 0.85); const b = ball as THREE.Mesh; b.scale.setScalar(0.3 + r * Math.min(1, k * 3)); (b.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.55 * (1 - k * 1.4)); });
      }
      if (from && to && f.kind !== 'area' && (f.ranged || from.distanceTo(to) > 2.5)) {
        const geo = new THREE.BufferGeometry().setFromPoints([from, from.clone()]);
        const line = add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, linewidth: 2 }))) as THREE.Line;
        const glow = add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color }))) as THREE.Mesh;
        parts.push((k) => { const p2 = Math.min(1, k / 0.25); const head = from.clone().lerp(to, p2); geo.setFromPoints([from.clone().lerp(to, Math.max(0, p2 - 0.35)), head]); glow.position.copy(head); (line.material as THREE.LineBasicMaterial).opacity = k < 0.4 ? 1 : Math.max(0, 1 - (k - 0.4) * 3); glow.visible = k < 0.3; });
      }
      if (to && (f.kind === 'hit' || f.kind === 'crit' || f.kind === 'heal' || f.kind === 'buff' || f.kind === 'debuff')) {
        const burst = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: f.kind === 'heal' ? 0x7cf0a7 : f.kind === 'buff' ? 0xffe6a3 : color, transparent: true, opacity: 0, depthWrite: false }))) as THREE.Mesh;
        burst.position.copy(to);
        parts.push((k) => { const q = Math.max(0, (k - 0.2) / 0.5); burst.scale.setScalar(0.4 + q * (f.kind === 'crit' ? 2.6 : 1.8)); (burst.material as THREE.MeshBasicMaterial).opacity = q > 0 && q < 1 ? 0.5 * (1 - q) : 0; });
      }
      const text = f.kind === 'miss' ? 'Miss' : f.kind === 'resist' ? 'Resisted' : f.kind === 'heal' ? `+${f.amount ?? ''}` : f.kind === 'buff' ? `✦ ${f.label ?? ''}` : f.kind === 'debuff' ? `✧ ${f.label ?? ''}` : f.kind === 'area' ? '' : `${f.kind === 'crit' ? 'CRIT ' : ''}−${f.amount ?? 0}`;
      if (to && text) {
        const tc = f.kind === 'miss' || f.kind === 'resist' ? '#cfc8bb' : f.kind === 'heal' ? '#7cf0a7' : f.kind === 'crit' ? '#ffd76a' : f.kind === 'buff' ? '#ffe6a3' : f.kind === 'debuff' ? '#d6b8ff' : f.element === 'physical' ? '#ff6b5a' : `#${color.getHexString()}`;
        const spr = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text, tc, f.kind === 'crit'), transparent: true, depthTest: false, opacity: 0 }))) as THREE.Sprite;
        const w0 = f.kind === 'crit' ? 5 : 3.6;
        spr.scale.set(w0, w0 / 4, 1); spr.renderOrder = 10;
        parts.push((k) => { const q = Math.max(0, (k - 0.2) / 0.8); spr.position.copy(to).add(new THREE.Vector3(0, 1 + q * 1.6, 0)); spr.material.opacity = q <= 0 ? 0 : q < 0.15 ? q / 0.15 : Math.max(0, 1 - (q - 0.6) / 0.4); });
      }
      update = (k) => parts.forEach((fn) => fn(k));
      // dev only: window.__apex3dSlow stretches the effects (screenshots in tests)
      const slow = import.meta.env.DEV ? Number((window as unknown as { __apex3dSlow?: number }).__apex3dSlow) || 1 : 1;
      anim.current.fx.push({ born, life: 2200 * slow, update, dispose: () => objs.forEach((o) => { t.effects.remove(o); const m = o as THREE.Mesh; m.geometry?.dispose(); const mat = m.material as THREE.Material & { map?: THREE.Texture | null }; mat?.map?.dispose(); mat?.dispose?.(); }) });
    });
  }, [p.fx]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- picking
  const ray = useRef(new THREE.Raycaster());
  const pick = (e: { clientX: number; clientY: number }): { token?: string; hex?: HexKey } => {
    const t = three.current;
    if (!t) return {};
    const r = t.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.current.setFromCamera(ndc, t.camera);
    const hitTok = ray.current.intersectObjects(t.tokens.children, true)[0];
    if (hitTok) { let o: THREE.Object3D | null = hitTok.object; while (o && !o.userData.tokenId) o = o.parent; if (o) return { token: o.userData.tokenId as string, hex: hexKey(hexAt(p.map, { x: (o.position.x * HEX_SIZE) + ox, y: (o.position.z * HEX_SIZE) + oy })) }; }
    const hits = ray.current.intersectObjects(t.ground, false); // props are see-through for picking (merged meshes)
    const hit = hits[0];
    if (!hit) return {};
    if ((hit.object as THREE.InstancedMesh).isInstancedMesh && hit.object.userData.keys && hit.instanceId !== undefined) return { hex: (hit.object.userData.keys as HexKey[])[hit.instanceId] };
    { let o: THREE.Object3D | null = hit.object; while (o && o.parent !== t.dynamic) o = o.parent; if (o) return { hex: hexKey(hexAt(p.map, { x: o.position.x * HEX_SIZE + ox, y: o.position.z * HEX_SIZE + oy })) }; }
    const px = { x: hit.object.position.x * HEX_SIZE + ox, y: hit.object.position.z * HEX_SIZE + oy };
    return { hex: hexKey(hexAt(p.map, px)) };
  };

  // --- controls
  const drag = useRef<{ button: number; x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { button: e.button, x: e.clientX, y: e.clientY, moved: false };
    if (e.button === 1) e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && (d.button === 0 || d.button === 1)) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      d.x = e.clientX; d.y = e.clientY;
      const c = cam.current;
      if (d.button === 1 || e.shiftKey) {
        // orbit and tilt
        c.yaw -= dx * 0.008;
        c.pitch = Math.max(0.12, Math.min(1.5, c.pitch + dy * 0.006));
      } else {
        const s = c.dist / 600;
        c.tx -= (dx * Math.cos(c.yaw) + dy * Math.sin(c.yaw)) * s;
        c.tz -= (-dx * Math.sin(c.yaw) + dy * Math.cos(c.yaw)) * s;
      }
      setTick((x) => x + 1);
      return;
    }
    const k = pick(e).hex ?? null;
    if (k !== hover) setHover(k);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.button !== 0) return;
    const hit = pick(e);
    if (hit.token && p.onTokenClick) return p.onTokenClick(hit.token);
    if (hit.hex && p.onHexClick) p.onHexClick(hit.hex, scenePoint(hit.hex));
  };
  const onDouble = (e: React.MouseEvent) => {
    // APEX 2.5 – double-click any figure (also enemies, also off-turn): centre the camera on it
    const hit = pick(e);
    if (!hit.token) return;
    const o = three.current?.tokens.children.find((c) => c.userData.tokenId === hit.token);
    if (o) flyTo({ x: o.position.x, z: o.position.z });
  };
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const hit = pick(e);
    if (hit.token && p.onTokenContext) return p.onTokenContext(hit.token);
    if (hit.hex && p.onHexContext) p.onHexContext(hit.hex, scenePoint(hit.hex));
  };
  useEffect(() => {
    const el = wrap.current!;
    const wheel = (e: WheelEvent) => { if (e.shiftKey) return; e.preventDefault(); cam.current.dist = Math.max(5, Math.min(140, cam.current.dist * (e.deltaY > 0 ? 1.12 : 1 / 1.12))); setTick((x) => x + 1); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    const c = cam.current;
    const map: Record<string, () => void> = {
      ArrowLeft: () => { c.tx -= Math.cos(c.yaw); c.tz += Math.sin(c.yaw); }, ArrowRight: () => { c.tx += Math.cos(c.yaw); c.tz -= Math.sin(c.yaw); },
      ArrowUp: () => { c.tx -= Math.sin(c.yaw); c.tz -= Math.cos(c.yaw); }, ArrowDown: () => { c.tx += Math.sin(c.yaw); c.tz += Math.cos(c.yaw); },
      q: () => { c.yaw += 0.15; }, e: () => { c.yaw -= 0.15; }, r: () => { c.pitch = Math.min(1.5, c.pitch + 0.08); }, f: () => { c.pitch = Math.max(0.12, c.pitch - 0.08); },
      '+': () => { c.dist = Math.max(5, c.dist / 1.15); }, '-': () => { c.dist = Math.min(140, c.dist * 1.15); }, '0': () => { c.tx = 0; c.tz = 0; c.yaw = 0.6; c.pitch = 0.95; },
    };
    const f = map[e.key];
    if (f) { e.preventDefault(); f(); setTick((x) => x + 1); }
  };
  const hoverInfo = hover ? tiles.get(hover) : undefined;
  void tick;

  return (
    <div className="relative h-full w-full select-none" style={{ minHeight: 360 }}>
      <div ref={wrap} className="absolute inset-0 touch-none outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50" tabIndex={0} role="application" data-testid="hex-scene-3d"
        aria-label={`${p.label}. 3D map. WASD or drag to pan, middle mouse button to orbit and tilt, mouse wheel zooms, Q/E orbit, R/F tilt, double-click a figure to centre it.`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerEnter={() => { over.current = true; }} onPointerLeave={() => { setHover(null); over.current = false; }} onDoubleClick={onDouble} onContextMenu={onContext} onAuxClick={(e) => e.preventDefault()} onKeyDown={onKey} />
      {hover && hoverInfo && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-ink-600 bg-ink-950/90 px-2 py-1 text-xs text-marble-100" style={{ bottom: "auto", top: "5rem" }} data-testid="hover-3d">
          <b>{hoverInfo.label}</b> · height {height(hover) * (p.map.unitsPerCell || 5)} ft{hoverInfo.cost === null ? ' · impassable' : hoverInfo.cost > 1 ? ' · difficult' : ''}{p.reach?.has(hover) ? ` · reachable` : ''}
        </div>
      )}
      <div className="absolute right-3 top-12 flex items-center gap-1 rounded-md border border-ink-600 bg-ink-950/85 px-1.5 py-0.5 text-[10px] text-marble-300" role="group" aria-label="3D quality">
        <span title="Resolution, shadows, grass and animation – lower is faster on weak devices">⚙ 3D</span>
        {(['low', 'medium', 'high', 'ultra'] as const).map((v) => <button key={v} type="button" aria-pressed={quality === v} className={`rounded px-1 ${quality === v ? 'bg-gold-500/25 text-gold-100' : 'hover:text-gold-200'}`} onClick={() => setQuality(v)} data-testid={`quality-${v}`}>{v}</button>)}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-marble-500">WASD / left drag: pan · middle button: orbit · wheel: zoom · double-click figure: centre · right-click: act</div>
    </div>
  );
}

type Move = { id: string; obj: THREE.Object3D; pts: THREE.Vector3[]; born: number; dur: number };
/** One frame of a figure walking along its path; false when it has arrived. */
function stepMove(m: Move, now: number): boolean {
  const e = Math.min(1, (now - m.born) / m.dur);
  const f = e * (m.pts.length - 1), i = Math.min(m.pts.length - 2, Math.floor(f)), u = f - i;
  const a = m.pts[i], b = m.pts[i + 1];
  m.obj.position.lerpVectors(a, b, u);
  // a little bounce per step, facing the way it walks
  m.obj.position.y += Math.abs(Math.sin(u * Math.PI)) * 0.12 * (e < 1 ? 1 : 0);
  if (b.x !== a.x || b.z !== a.z) { m.obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); yawMemory.set(m.id, m.obj.rotation.y); }
  if (e >= 1) { m.obj.position.copy(m.pts[m.pts.length - 1]); m.obj.userData.moving = false; return false; }
  return true;
}
type Idle = { kind: string; body: THREE.Object3D; head?: THREE.Object3D; baseY: number; phase: number; hostile: boolean; yaw: number; rest: number; height: number; wings: THREE.Object3D[]; target?: number | null; /** APEX 2.4 – sneaking: 1 = crouched low */ crouch: number; crouchNow: number };
const ALERT_RANGE = 5 * Math.sqrt(3) * 1.05; // ≈ 5 hexes (25 ft): closer opponents wake resting creatures
type Critter = { obj: THREE.Object3D; behaviour: string; spots: THREE.Vector3[]; home: THREE.Vector3; target: THREE.Vector3 | null; wait: number; phase: number; wings: THREE.Object3D[]; last?: number };
/** Ambient animals: walk between spots and graze, hop, peck, prowl – or circle in the sky; shy away from figures. */
function faunaStep(list: Critter[], tokens: THREE.Group, sec: number) {
  for (const c of list) {
    const dt = Math.min(0.1, sec - (c.last ?? sec)); c.last = sec;
    const o = c.obj;
    if (c.behaviour === 'fly') {
      const r = 2.2 + (c.phase % 3) * 0.6, a = sec * (0.35 + (c.phase % 2) * 0.1) + c.phase;
      o.position.set(c.home.x + Math.cos(a) * r, c.home.y + 3.2 + Math.sin(sec * 0.7 + c.phase) * 0.5 + (c.phase % 4) * 0.3, c.home.z + Math.sin(a) * r);
      o.rotation.y = -a; // tangent of the circle
      for (const w of c.wings) w.rotation.z = Math.sin(sec * 9 + c.phase) * 0.6 * ((w.userData.side as number) ?? 1);
      continue;
    }
    // shy: a figure close by → run to the farthest spot
    let near: THREE.Object3D | null = null, nd = 2.4;
    for (const tk of tokens.children) { const d = tk.position.distanceTo(o.position); if (d < nd) { nd = d; near = tk; } }
    if (near && (!c.target || c.target.distanceTo(near.position) < 2.4)) { c.target = c.spots.reduce((b, sp) => (sp.distanceTo(near!.position) > b.distanceTo(near!.position) ? sp : b), c.spots[0]).clone(); c.wait = 0; }
    if (!c.target) {
      c.wait -= dt;
      // grazing / pecking: the body dips
      o.rotation.x = c.behaviour === 'graze' ? 0.18 + Math.sin(sec * 2 + c.phase) * 0.05 : c.behaviour === 'peck' ? Math.max(0, Math.sin(sec * 6 + c.phase)) * 0.35 : 0;
      if (c.wait <= 0) { c.target = c.spots[Math.floor(((Math.sin(sec * 13.7 + c.phase) + 1) / 2) * c.spots.length) % c.spots.length].clone().add(new THREE.Vector3(Math.sin(c.phase * 3 + sec) * 0.5, 0, Math.cos(c.phase * 5 + sec) * 0.5)); }
      continue;
    }
    o.rotation.x = 0;
    const to = c.target.clone().sub(o.position); to.y = 0;
    const d = to.length();
    const speed = (near ? 2.2 : 1) * (c.behaviour === 'hop' ? 0.9 : c.behaviour === 'prowl' ? 0.6 : c.behaviour === 'peck' ? 0.45 : 0.32);
    if (d < 0.08) { c.target = null; c.wait = 1.5 + (c.phase % 4); continue; }
    const yaw = Math.atan2(to.x, to.z); let dy = yaw - o.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); o.rotation.y += dy * Math.min(1, dt * 6);
    o.position.addScaledVector(to.normalize(), Math.min(d, speed * dt));
    const ground = c.spots.reduce((b, sp) => (Math.hypot(sp.x - o.position.x, sp.z - o.position.z) < Math.hypot(b.x - o.position.x, b.z - o.position.z) ? sp : b), c.spots[0]).y;
    o.position.y = ground + (c.behaviour === 'hop' ? Math.abs(Math.sin(sec * 9 + c.phase)) * 0.3 : 0);
  }
}
let idleTick = 0;
const yawMemory = new Map<string, number>();
/** Idle animation of all figures (runs in the render loop, ~0.1 ms for a battle). */
function idleStep(tokens: THREE.Group, sec: number) {
  const list = tokens.children.filter((c) => c.userData.idle) as THREE.Object3D[];
  // every few frames: the nearest opponent of every figure
  if (idleTick++ % 8 === 0) for (const a of list) {
    const ia = a.userData.idle as Idle;
    let best: THREE.Object3D | null = null, bd = Infinity;
    for (const b of list) { if (b === a || (b.userData.idle as Idle).hostile === ia.hostile) continue; const d = a.position.distanceTo(b.position); if (d < bd) { bd = d; best = b; } }
    ia.target = best && bd < ALERT_RANGE * 2.2 ? Math.atan2(best.position.x - a.position.x, best.position.z - a.position.z) : null;
    (ia as Idle & { near: number }).near = bd;
  }
  for (const a of list) {
    const ia = a.userData.idle as Idle & { near?: number };
    if (ia.kind === 'still') continue;
    const t = sec + ia.phase;
    // turn (slowly) towards the nearest opponent in sight range
    if (ia.target !== null && ia.target !== undefined && ia.kind !== 'standee' && !a.userData.moving) {
      let d = ia.target - a.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      a.rotation.y += d * 0.04;
      yawMemory.set(a.userData.tokenId as string, a.rotation.y);
    }
    // creatures rest when nobody is near and rise when someone approaches
    const restGoal = (ia.kind === 'creature' || ia.kind === 'flyer') && (ia.near ?? Infinity) > ALERT_RANGE ? 1 : 0;
    ia.rest += (restGoal - ia.rest) * 0.03;
    const breathe = Math.sin(t * (ia.kind === 'humanoid' ? 2.1 : 1.5)) * (ia.kind === 'humanoid' ? 0.012 : 0.025);
    ia.crouchNow += (ia.crouch - ia.crouchNow) * 0.08;
    const c = ia.crouchNow;
    ia.body.scale.y = (1 + breathe) * (1 - ia.rest * 0.28) * (1 - c * 0.3);
    ia.body.scale.x = ia.body.scale.z = (1 - breathe * 0.4 + ia.rest * 0.05) * (1 + c * 0.08);
    ia.body.position.y = ia.baseY;
    ia.body.rotation.z = ia.kind === 'humanoid' ? Math.sin(t * 0.7) * 0.018 * (1 - c) : 0;
    ia.body.rotation.x = ia.kind === 'humanoid' ? c * 0.2 : -ia.rest * 0.05 + Math.sin(t * 0.9) * 0.01;
    for (const w of ia.wings) w.userData.amp = ia.rest > 0.5 ? 0.04 : w.userData.amp0 ?? (w.userData.amp0 = w.userData.amp ?? 0.15);
    if (ia.head) {
      // the head looks around a little, or at the opponent (relative to the body)
      let rel = 0;
      if (ia.target !== null && ia.target !== undefined) { rel = ia.target - a.rotation.y; rel = Math.atan2(Math.sin(rel), Math.cos(rel)); }
      const goal = Math.max(-0.7, Math.min(0.7, rel)) + Math.sin(t * 0.4) * 0.25 * (ia.target === null ? 1 : 0.2);
      ia.head.rotation.y += (goal - ia.head.rotation.y) * 0.06;
      ia.head.rotation.x = Math.sin(t * 0.55) * 0.04;
    }
  }
}

let rockTex: THREE.Texture | null = null;
/** Layered rock for cliff sides. */
function rockTexture(): THREE.Texture {
  if (rockTex) return rockTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#d8d0c4'; g.fillRect(0, 0, 256, 256);
  let s = 11;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let y = 0; y < 256; y += 6 + Math.floor(rnd() * 10)) { g.fillStyle = `rgba(90,80,70,${0.15 + rnd() * 0.25})`; g.fillRect(0, y, 256, 1 + rnd() * 2); }
  for (let i = 0; i < 900; i++) { const v = 150 + Math.floor(rnd() * 90); g.fillStyle = `rgba(${v},${v - 8},${v - 16},0.5)`; g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 5, 1 + rnd() * 2); }
  rockTex = new THREE.CanvasTexture(cv);
  rockTex.wrapS = rockTex.wrapT = THREE.RepeatWrapping;
  rockTex.colorSpace = THREE.SRGBColorSpace;
  return rockTex;
}

/**
 * APEX 2.4 – ground surface: the texture runs in world space across the hexes (no repeating tile per hex), a bump
 * map gives it relief (stones, joints, clods – the rules stay flat), and a slow large-scale mottling breaks up
 * uniform colour.
 */
function groundSurface(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vApexW;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec4 apexW = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vApexW = apexW.xyz;
        vec2 apexUv = apexW.xz * 0.33;
        #ifdef USE_MAP
          vMapUv = apexUv;
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = apexUv;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vApexW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float apexN = sin(vApexW.x * 0.41 + 1.7) * sin(vApexW.z * 0.37 + 0.4) + 0.6 * sin(vApexW.x * 0.13 - vApexW.z * 0.17);
        diffuseColor.rgb *= 1.0 + apexN * 0.055;`);
  };
  m.customProgramCacheKey = () => 'apex-ground';
}
let rippleTex: THREE.Texture | null = null;
/** A soft ripple pattern for water (tiles seamlessly). */
function rippleTexture(): THREE.Texture {
  if (rippleTex) return rippleTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 256, 256);
  let s = 4242; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 256, y = rnd() * 256, len = 20 + rnd() * 50, a = 0.25 + rnd() * 0.35;
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
      g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 1.5 + rnd() * 2; g.beginPath();
      g.moveTo(x + dx, y + dy); g.quadraticCurveTo(x + dx + len / 2, y + dy - 4 - rnd() * 4, x + dx + len, y + dy); g.stroke();
    }
  }
  rippleTex = new THREE.CanvasTexture(cv); rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping; rippleTex.colorSpace = THREE.SRGBColorSpace;
  return rippleTex;
}
/** APEX 2.4 – water that flows: two ripple layers drift across the surface in world space. */
function waterMaterial(color: THREE.Color, time: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.74, roughness: 0.12, metalness: 0.3, side: THREE.DoubleSide, map: rippleTexture() });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uApexTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vApexXZ;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvApexXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vApexXZ;\nuniform float uApexTime;')
      .replace('#include <map_fragment>', `
        vec2 apexA = vApexXZ * 0.22 + vec2(uApexTime * 0.045, uApexTime * 0.018);
        vec2 apexB = vApexXZ * 0.31 + vec2(-uApexTime * 0.02, uApexTime * 0.037);
        float apexTa = texture2D(map, apexA).r, apexTb = texture2D(map, apexB).r;
        float apexHl = smoothstep(0.88, 1.0, apexTa) * 0.7 + smoothstep(0.88, 1.0, apexTb) * 0.55;
        diffuseColor.rgb = diffuseColor.rgb * (0.9 + (apexTa + apexTb - 1.7) * 0.5) + vec3(apexHl * 0.28);`);
  };
  m.customProgramCacheKey = () => 'apex-water';
  return m;
}

/** Floating text as a sprite texture (combat numbers, distances). */
function textTexture(text: string, color: string, big: boolean): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.font = `800 ${big ? 84 : 72}px Cinzel, Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = '#000'; g.strokeText(text, 256, 66);
  g.fillStyle = color; g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
