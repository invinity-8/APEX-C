/**
 * APEX 2.9 – small pictures of figures for the initiative bar: the creature model with its own coat (or the humanoid
 * figure's head and shoulders), rendered once by a shared off-screen renderer and cached as an image.
 */
import * as THREE from 'three';
import type { SceneToken } from './HexSceneMap';
import { buildCreature } from './creatures3d';
import { applyCoat } from './coat3d';
import { buildLowPoly } from './lowpoly';
import { figureCreature, figureLook } from './world3d';
import { individualOf } from '../../game/individual';

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string | null>();

export function figurePortrait(tk: SceneToken, tone?: string, size = 112): string | null {
  const e = tk.enemy;
  const key = JSON.stringify([e?.look, e?.breed, e?.creature, e?.seed ?? tk.tokenId, e?.sex, tk.name, tk.color, tone, size]);
  if (cache.has(key)) return cache.get(key)!;
  let url: string | null = null;
  try {
    const cid = figureCreature(tk);
    const creature = cid ? buildCreature(cid.kind, cid.tint, false, cid.variant) : null;
    if (creature && e?.seed && e.breed && !(cid?.tint && cid.kind === 'dragon')) applyCoat(creature.group, individualOf(e.breed, e.seed, tone));
    const look = creature ? null : figureLook(tk);
    if (creature) url = shoot(creature.group, size, creature.head ? new THREE.Vector3(...creature.head) : undefined);
    else if (look) { const fig = buildLowPoly(look); url = shoot(fig.group, size, undefined, fig.head); }
  } catch { url = null; }
  cache.set(key, url);
  return url;
}

/**
 * APEX 2.10 – a portrait: three lights (warm key, cool fill, a rim from behind that draws the outline), rendered at
 * twice the size for crisp edges. Humanoids: head and shoulders around the head pivot; creatures: the head and the
 * front of the body (the whole model when its head is not known).
 */
function shoot(obj: THREE.Object3D, size: number, creatureHead?: THREE.Vector3, figureHead?: THREE.Object3D): string | null {
  if (!renderer) {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  renderer.setPixelRatio(size <= 160 ? 2 : 1);
  renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3026, 1.1));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4); key.position.set(2.5, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.9); fill.position.set(-4, 1.5, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 2.2); rim.position.set(-1.5, 2.5, -4); scene.add(rim);
  const humanoid = !!figureHead;
  obj.rotation.y = humanoid ? 0.25 : -0.55;
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  let focus: THREE.Vector3, span: number;
  if (figureHead) {
    const h = new THREE.Vector3(); figureHead.getWorldPosition(h);
    // APEX 2.11 – a bust: head and shoulders (the face reads at initiative-bar size)
    const headY = h.y - box.min.y;
    focus = h.add(new THREE.Vector3(0, -headY * 0.06, 0)); span = Math.max(0.12, headY * 0.17);
  } else if (creatureHead) {
    const h = creatureHead.clone().applyMatrix4(obj.matrixWorld);
    focus = c.clone().lerp(h, 0.72); span = Math.max(sz.y * 0.3, Math.min(sz.y * 0.55, h.distanceTo(c) * 0.42 + sz.y * 0.12));
  } else { focus = c; span = Math.max(sz.x, sz.y, sz.z) * 0.62; }
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const dist = span / Math.tan((15 * Math.PI) / 180);
  cam.position.set(focus.x + dist * 0.25, focus.y + dist * (humanoid ? 0.1 : 0.3), focus.z + dist);
  cam.lookAt(focus);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  return url;
}
