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
    const obj = creature?.group ?? (look ? buildLowPoly(look).group : null);
    if (obj) url = shoot(obj, !creature, size);
  } catch { url = null; }
  cache.set(key, url);
  return url;
}

function shoot(obj: THREE.Object3D, headshot: boolean, size: number): string | null {
  if (!renderer) {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3026, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 4); scene.add(key);
  scene.add(obj);
  obj.rotation.y = headshot ? 0.25 : -0.65;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  // humanoids: head and shoulders; creatures: the whole beast
  const focus = headshot ? new THREE.Vector3(c.x, box.max.y - sz.y * 0.17, c.z) : c;
  const span = headshot ? sz.y * 0.36 : Math.max(sz.x, sz.y, sz.z) * 0.62;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const dist = span / Math.tan((15 * Math.PI) / 180);
  cam.position.set(focus.x + dist * 0.25, focus.y + dist * (headshot ? 0.06 : 0.35), focus.z + dist);
  cam.lookAt(focus);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  return url;
}
