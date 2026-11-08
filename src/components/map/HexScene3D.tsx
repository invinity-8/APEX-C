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
import { decodeTiles, heightLookup, hexAt, hexMovementCost, type TileDef } from '../../campaign/hexScene';
import { ORIGIN, hexKey, hexesInRange, parseKey, type HexKey } from '../../game/hex';
import { HEX_SIZE, center, corner } from './geometry';
import type { SceneToken } from './HexSceneMap';
import { beastIcon } from './effectIcons';

/** World units: a hex has corner radius 1; one 5-ft level ≈ 0.6 hex widths (a bit lower than true scale – easier to read). */
const LEVEL = 1.05;
const BASE = 0.35;
const toWorld = (px: { x: number; y: number }) => ({ x: px.x / HEX_SIZE, z: px.y / HEX_SIZE });

interface Props {
  map: Pick<SceneMap, 'width' | 'height' | 'hex' | 'unitsPerCell' | 'unit'> & { nodes: MapNode[] };
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
  areaAt?: ((point: { x: number; y: number }) => HexKey[]) | null;
  focus?: { key: string; x: number; y: number } | null;
}

type Cam = { tx: number; tz: number; yaw: number; pitch: number; dist: number };

export default function HexScene3D(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; ground: THREE.InstancedMesh | null; keys: HexKey[]; dynamic: THREE.Group; tokens: THREE.Group; overlay: THREE.Group } | null>(null);
  const cam = useRef<Cam>({ tx: 0, tz: 0, yaw: 0.6, pitch: 0.95, dist: 26 });
  const [hover, setHover] = useState<HexKey | null>(null);
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
  const scenePoint = (k: HexKey) => { const c = center(parseKey(k)); return { x: c.x + ox, y: c.y + oy }; };

  // --- renderer, lights, camera (once)
  useEffect(() => {
    const el = wrap.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    const hemi = new THREE.HemisphereLight(0xfff4dd, 0x2a2f2a, 0.9);
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.6);
    sun.position.set(-30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
    scene.add(hemi, sun);
    const dynamic = new THREE.Group(), tokens = new THREE.Group(), overlay = new THREE.Group();
    scene.add(dynamic, tokens, overlay);
    three.current = { renderer, scene, camera, ground: null, keys: [], dynamic, tokens, overlay };
    const resize = () => { const w = el.clientWidth || 600, h = el.clientHeight || 400; renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); setTick((t) => t + 1); };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => { ro.disconnect(); renderer.dispose(); el.removeChild(renderer.domElement); three.current = null; };
  }, []);

  // --- background and light by phase
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.scene.background = new THREE.Color(p.phase === 'night' ? 0x0b0f17 : p.phase === 'dusk' ? 0x2a2230 : 0x1b2027);
    t.scene.fog = new THREE.Fog(t.scene.background as THREE.Color, 60, 160);
    const [hemi, sun] = t.scene.children as [THREE.HemisphereLight, THREE.DirectionalLight];
    hemi.intensity = p.phase === 'night' ? 0.35 : p.phase === 'dusk' ? 0.6 : 0.9;
    sun.intensity = p.phase === 'night' ? 0.25 : p.phase === 'dusk' ? 0.9 : 1.6;
    setTick((x) => x + 1);
  }, [p.phase]);

  // --- terrain columns (instanced) and props (walls, trees, boulders)
  useEffect(() => {
    const t = three.current;
    if (!t || !p.map.hex) return;
    t.dynamic.clear();
    if (t.ground) { t.scene.remove(t.ground); t.ground.geometry.dispose(); }
    const keys = [...tiles.keys()].filter((k) => fogOf.get(k) !== '.');
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) { const c = corner(0, 0, 1.0, i); if (i === 0) shape.moveTo(c.x, c.y); else shape.lineTo(c.x, c.y); }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // extrude downwards along -y, shape lies in x/z
    geo.translate(0, 1, 0); // top face at y = 1, bottom at 0
    // tops in the tile colour, sides as rock/earth (darker, so plateaus and cliffs read as one mass)
    const mat = [new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02 }), new THREE.MeshStandardMaterial({ color: 0x8c7c68, roughness: 1, flatShading: true })];
    const mesh = new THREE.InstancedMesh(geo, mat, keys.length);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    keys.forEach((k, i) => {
      const tile = tiles.get(k)!;
      const w = toWorld(center(parseKey(k)));
      const water = /deep|shallow|water|river/.test(tile.id);
      const h = Math.max(0.12, top(k) - (water ? 0.18 : 0));
      m4.compose(new THREE.Vector3(w.x, 0, w.z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      mesh.setMatrixAt(i, m4);
      col.set(tile.fill);
      if (fogOf.get(k) === 'e') col.multiplyScalar(0.45); // remembered, not seen now
      else col.offsetHSL(0, 0, (((parseKey(k).q * 7 + parseKey(k).r * 13) % 5) - 2) * 0.008);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    t.scene.add(mesh);
    t.ground = mesh;
    t.keys = keys;
    // props
    const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    wallGeo.rotateX(Math.PI / 2); wallGeo.translate(0, 1, 0);
    const trunk = new THREE.CylinderGeometry(0.12, 0.16, 1.2, 6), crown = new THREE.ConeGeometry(0.75, 2.2, 7), rock = new THREE.DodecahedronGeometry(0.6, 0);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 1 }), leaves = new THREE.MeshStandardMaterial({ color: 0x2f5a33, roughness: 0.95, flatShading: true }), stone = new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 1, flatShading: true });
    for (const k of keys) {
      const tile = tiles.get(k)!;
      const w = toWorld(center(parseKey(k))), y = top(k);
      if (tile.id === 'wall') {
        const m = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(tile.fill).multiplyScalar(fogOf.get(k) === 'e' ? 0.45 : 0.9), roughness: 0.95 }));
        m.position.set(w.x, y, w.z); m.scale.set(0.97, LEVEL * 2, 0.97); m.castShadow = m.receiveShadow = true;
        t.dynamic.add(m);
      } else if (tile.id === 'tree') {
        const a = new THREE.Mesh(trunk, wood); a.position.set(w.x, y + 0.6, w.z);
        const b = new THREE.Mesh(crown, leaves); b.position.set(w.x, y + 2.1, w.z);
        a.castShadow = b.castShadow = true;
        t.dynamic.add(a, b);
      } else if (tile.id === 'boulder') {
        const r = new THREE.Mesh(rock, stone); r.position.set(w.x, y + 0.45, w.z); r.rotation.set(0.4, (parseKey(k).q * 1.7) % 3, 0.2); r.castShadow = true;
        t.dynamic.add(r);
      }
    }
    // markers (lights, locations) as small glowing pins
    for (const n of p.map.nodes) {
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
  }, [tiles, fogOf, height, p.gm, p.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- figures: upright markers with portrait / icon, name, life bar
  const tokenKey = JSON.stringify((p.tokens ?? []).map((tk) => [tk.tokenId, Math.round(tk.x), Math.round(tk.y), tk.name, tk.color, tk.enemy?.icon, tk.enemy?.condition, tk.enemy?.hp, tk.vitals?.hp, tk.vitals?.form, tk.target, tk.view?.portraitV, (tk.icons ?? []).map((i) => i.icon).join('')])) + (p.selectedTokenId ?? '');
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.tokens.children.forEach((c) => c.traverse((o) => { if ((o as THREE.Sprite).material) ((o as THREE.Sprite).material as THREE.SpriteMaterial).map?.dispose(); }));
    t.tokens.clear();
    const stacks = new Map<HexKey, SceneToken[]>();
    for (const tk of p.tokens ?? []) { const k = hexKey(hexAt(p.map, tk)); stacks.set(k, [...(stacks.get(k) ?? []), tk]); }
    for (const [k, group] of stacks) {
      group.forEach((tk, i) => {
        const w = toWorld(center(parseKey(k)));
        const off = group.length > 1 ? { x: Math.cos((i / group.length) * Math.PI * 2) * 0.45, z: Math.sin((i / group.length) * Math.PI * 2) * 0.45 } : { x: 0, z: 0 };
        const y = top(k);
        const g = new THREE.Group();
        g.position.set(w.x + off.x, y, w.z + off.z);
        g.userData = { tokenId: tk.tokenId };
        const enemy = tk.enemy, down = enemy?.condition === 'down';
        const ringColor = tk.tokenId === p.selectedTokenId ? 0xf3dc9a : enemy ? (enemy.ally ? 0x7fb8ff : 0xb3261e) : 0xe8d4a6;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.18, 24), new THREE.MeshStandardMaterial({ color: new THREE.Color(tk.color), roughness: 0.6 }));
        base.position.y = 0.09; base.castShadow = true;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: ringColor }));
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.2;
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x2a241c }));
        stand.position.y = 0.6;
        const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: figureTexture(tk), depthWrite: false, transparent: true, opacity: down ? 0.5 : 1 }));
        card.position.y = 1.75; card.scale.set(2.2, 2.2, 1);
        g.add(base, ring, stand, card);
        if (tk.target) { const tr = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.04, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffd36b })); tr.rotation.x = Math.PI / 2; tr.position.y = 0.25; g.add(tr); }
        t.tokens.add(g);
      });
    }
    setTick((x) => x + 1);
  }, [tokenKey, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- overlays: reach area, hover, path preview, area preview
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.overlay.children.forEach((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
    t.overlay.clear();
    const disc = (k: HexKey, color: number, opacity: number, lift = 0.02, scale = 0.92) => {
      const pts = Array.from({ length: 6 }, (_, i) => corner(0, 0, scale, i));
      const s = new THREE.Shape(pts.map((q) => new THREE.Vector2(q.x, q.y)));
      const g = new THREE.ShapeGeometry(s); g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
      const w = toWorld(center(parseKey(k)));
      m.position.set(w.x, top(k) + lift, w.z);
      t.overlay.add(m);
    };
    if (p.reach) for (const k of p.reach.keys()) if (tiles.has(k)) disc(k, 0xf3dc9a, 0.22);
    if (hover) {
      disc(hover, 0xffffff, 0.28, 0.04, 0.98);
      const area = p.areaAt ? p.areaAt(scenePoint(hover)) : null;
      if (area) for (const k of area) disc(k, 0xff7828, 0.5, 0.05);
      if (p.pathFrom && !area) {
        const r = hexMovementCost(p.map, p.pathFrom, scenePoint(hover));
        if (r.ok && r.steps.length) {
          const ok = p.pathBudget === null || p.pathBudget === undefined || r.cost <= p.pathBudget + 1e-9;
          const pts = [p.pathFrom, ...r.steps].map((q) => { const k = hexKey(hexAt(p.map, q)); const w = toWorld(center(parseKey(k))); return new THREE.Vector3(w.x, top(k) + 0.15, w.z); });
          const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.2);
          const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), 0.07, 6, false), new THREE.MeshBasicMaterial({ color: ok ? 0xf3dc9a : 0xff6b5a }));
          t.overlay.add(tube);
        }
      }
    }
    setTick((x) => x + 1);
  }, [hover, p.reach, p.pathFrom?.x, p.pathFrom?.y, p.pathBudget, p.areaAt, tiles, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- camera focus (active turn) and first framing
  useEffect(() => {
    if (!p.map.hex) return;
    const r = p.map.hex.radius;
    cam.current.dist = Math.max(14, r * 2.4);
    setTick((x) => x + 1);
  }, [p.map.hex?.radius]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!p.focus) return;
    const k = hexKey(hexAt(p.map, p.focus));
    const w = toWorld(center(parseKey(k)));
    const from = { ...cam.current };
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const e = Math.min(1, (now - start) / 500), q = 1 - (1 - e) ** 3;
      cam.current.tx = from.tx + (w.x - from.tx) * q; cam.current.tz = from.tz + (w.z - from.tz) * q;
      setTick((x) => x + 1);
      if (e < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [p.focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- render on change
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const c = cam.current;
    const ty = c.tx === 0 && c.tz === 0 ? 0 : 0;
    t.camera.position.set(c.tx + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist, ty + Math.sin(c.pitch) * c.dist, c.tz + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist);
    t.camera.lookAt(c.tx, ty + 1, c.tz);
    t.renderer.render(t.scene, t.camera);
  });

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
    const hits = [...(t.ground ? ray.current.intersectObject(t.ground) : []), ...ray.current.intersectObjects(t.dynamic.children, false)].sort((a, b) => a.distance - b.distance);
    const hit = hits[0];
    if (!hit) return {};
    if (hit.object === t.ground && hit.instanceId !== undefined) return { hex: t.keys[hit.instanceId] };
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
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const hit = pick(e);
    if (hit.token && p.onTokenContext) return p.onTokenContext(hit.token);
    if (hit.hex && p.onHexContext) p.onHexContext(hit.hex, scenePoint(hit.hex));
  };
  useEffect(() => {
    const el = wrap.current!;
    const wheel = (e: WheelEvent) => { e.preventDefault(); cam.current.dist = Math.max(5, Math.min(140, cam.current.dist * (e.deltaY > 0 ? 1.12 : 1 / 1.12))); setTick((x) => x + 1); };
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
        aria-label={`${p.label}. 3D map. Hold the middle mouse button to orbit and tilt, drag to pan, mouse wheel zooms, Q/E orbit, R/F tilt.`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHover(null)} onContextMenu={onContext} onAuxClick={(e) => e.preventDefault()} onKeyDown={onKey} />
      {hover && hoverInfo && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-ink-600 bg-ink-950/90 px-2 py-1 text-xs text-marble-100" data-testid="hover-3d">
          <b>{hoverInfo.label}</b> · height {height(hover) * (p.map.unitsPerCell || 5)} ft{hoverInfo.cost === null ? ' · impassable' : hoverInfo.cost > 1 ? ' · difficult' : ''}{p.reach?.has(hover) ? ` · reachable` : ''}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-marble-500">🖱 middle button: orbit / tilt · left drag: pan · wheel: zoom · right-click: act</div>
    </div>
  );
}

/** Canvas texture of an upright figure card: portrait-style disc with icon/initials, name, life bar, effect icons. */
function figureTexture(tk: SceneToken): THREE.Texture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const cx = size / 2, cy = 96, r = 62;
  const enemy = tk.enemy;
  g.beginPath(); g.arc(cx, cy, r + 6, 0, Math.PI * 2); g.fillStyle = enemy ? (enemy.ally ? '#7fb8ff' : '#b3261e') : '#e8d4a6'; g.fill();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = tk.vitals?.form ? '#1d2b20' : tk.color; g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const glyph = tk.vitals?.form ? beastIcon(tk.vitals.form) : enemy ? (enemy.condition === 'down' ? '✕' : enemy.icon) : (tk.view?.initials ?? tk.name.slice(0, 2));
  g.font = `bold ${tk.vitals?.form ? 70 : 54}px Inter, sans-serif`; g.fillStyle = enemy || tk.vitals?.form ? '#fff' : '#14110d';
  g.fillText(glyph, cx, cy + 2);
  if (tk.view?.portraitV && !tk.vitals?.form) {
    // the uploaded portrait replaces the initials once loaded
    const img = new Image();
    img.onload = () => { g.save(); g.beginPath(); g.arc(cx, cy, r - 2, 0, Math.PI * 2); g.clip(); g.drawImage(img, cx - r, cy - r, r * 2, r * 2); g.restore(); tex.needsUpdate = true; };
    img.src = `/api/apex?op=portrait&token=${encodeURIComponent(tk.tokenId)}&v=${tk.view.portraitV}`;
  }
  g.font = 'bold 26px Inter, sans-serif'; g.lineWidth = 6; g.strokeStyle = '#000';
  g.strokeText(tk.name.slice(0, 18), cx, 186); g.fillStyle = enemy ? '#ffd6d0' : '#f3e4bd'; g.fillText(tk.name.slice(0, 18), cx, 186);
  const hp = tk.vitals ?? (enemy?.hp !== undefined && enemy.maxHp ? { hp: enemy.hp, maxHp: enemy.maxHp, temp: enemy.tempHp ?? 0 } : null);
  if (hp && hp.maxHp > 0) {
    const w = 150, x = cx - w / 2, frac = Math.max(0, Math.min(1, hp.hp / hp.maxHp));
    g.fillStyle = '#0b0b0b'; g.fillRect(x - 3, 207, w + 6, 16);
    g.fillStyle = '#3a1414'; g.fillRect(x, 210, w, 10);
    g.fillStyle = frac <= 0.25 ? '#e5484d' : frac <= 0.5 ? '#f59e0b' : '#4ade80'; g.fillRect(x, 210, w * frac, 10);
    if (hp.temp) { g.fillStyle = '#60a5fa'; g.fillRect(x + w * frac, 210, Math.min(w * (1 - frac), (w * hp.temp) / hp.maxHp), 10); }
  }
  const icons = (tk.icons ?? []).slice(0, 5);
  icons.forEach((ic, i) => {
    const x = cx - ((icons.length - 1) * 30) / 2 + i * 30, y = 22;
    g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fillStyle = '#14110d'; g.fill(); g.lineWidth = 3; g.strokeStyle = ic.tone === 'conc' ? '#b9a8e3' : ic.tone === 'bad' ? '#e5484d' : '#c09b58'; g.stroke();
    g.font = '16px sans-serif'; g.fillStyle = '#fff'; g.fillText(ic.icon, x, y + 1);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
