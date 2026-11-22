/**
 * APEX 2.1 – live 3D preview of a low-poly figure (lazy chunk with three.js): turns slowly, drag to rotate.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { FigureLook } from '../game/figure';
import { buildLowPoly } from './map/lowpoly';
import { buildCreature } from './map/creatures3d';

export default function FigurePreview({ look, creature, ring = '#d8b25a', size = 280 }: { look?: FigureLook; creature?: { kind: string; tint?: string; variant?: 'male' | 'female' | 'young' }; ring?: string; size?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const wingsRef = useRef<THREE.Object3D[]>([]);
  const t = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; holder: THREE.Group; yaw: number; drag: number | null; dragY: number | null; spin: boolean; zoom: number; focus: number; h: number } | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(size, size * 1.15);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1 / 1.15, 0.1, 50);
    camera.position.set(0, 1.6, 6.2); camera.lookAt(0, 1.05, 0);
    scene.add(new THREE.HemisphereLight(0xfff4dd, 0x2a2f2a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.7); sun.position.set(-3, 5, 4); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 0.6); rim.position.set(3, 2, -4); scene.add(rim);
    const holder = new THREE.Group(); scene.add(holder);
    t.current = { renderer, scene, camera, holder, yaw: 0.5, drag: null, dragY: null, spin: true, zoom: 1, focus: 0, h: 2.2 };
    // APEX 2.13 – zoom with the wheel (towards the face), drag up and down to look along the figure
    const wheel = (e: WheelEvent) => { const st = t.current; if (!st) return; e.preventDefault(); st.zoom = Math.max(1, Math.min(4.5, st.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); };
    el.addEventListener('wheel', wheel, { passive: false });
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const s = t.current; if (!s || document.hidden) return;
      if (s.spin && s.drag === null) s.yaw += 0.006;
      s.holder.rotation.y = s.yaw;
      { const z = (s.zoom - 1) / 3.5, aim = Math.min(1, Math.max(0, 0.46 + z * 0.42 + s.focus)) * s.h; s.camera.position.set(0, aim + s.h * 0.27 / s.zoom, (s.h * 2.9) / s.zoom); s.camera.lookAt(0, aim, 0); }
      const sec = performance.now() / 1000;
      for (const w of wingsRef.current) w.rotation.z = Math.sin(sec * 6) * ((w.userData.amp as number) ?? 0.5) * ((w.userData.side as number) ?? 1);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    return () => { el.removeEventListener('wheel', wheel); cancelAnimationFrame(raf); renderer.dispose(); el.removeChild(renderer.domElement); t.current = null; };
  }, [size]);

  useEffect(() => {
    const s = t.current;
    if (!s) return;
    s.holder.children.forEach((c) => c.traverse((o) => (o as THREE.Mesh).geometry?.dispose()));
    s.holder.clear();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0x1d1a16, roughness: 0.5 }));
    base.position.y = 0.06;
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: ring }));
    ringM.rotation.x = Math.PI / 2; ringM.position.y = 0.12;
    const made = creature ? buildCreature(creature.kind, creature.tint, true, creature.variant) : look ? buildLowPoly(look) : null;
    if (!made) return;
    const fig = { group: made.group, height: made.height };
    if (creature) { const bb = new THREE.Box3().setFromObject(made.group); const k = 2.0 / Math.max(1.2, bb.getSize(new THREE.Vector3()).length() * 0.6); made.group.scale.setScalar(k); fig.height = made.height * k; }
    fig.group.position.y = 0.12;
    wingsRef.current = (made as { wings?: THREE.Object3D[] }).wings ?? [];
    // tall figures (ogres, wizard hats) are framed by scaling the camera distance
    const h = Math.max(2.2, fig.height + 0.3);
    s.h = h;
    s.holder.add(base, ringM, fig.group);
  }, [look, creature?.kind, creature?.tint, creature?.variant, ring]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = (k: number) => { const st = t.current; if (st) st.zoom = Math.max(1, Math.min(4.5, st.zoom * k)); };
  return (
    <div className="relative" style={{ width: size, height: size * 1.15 }}>
    <div
      ref={wrap}
      className="cursor-grab touch-none select-none rounded-xl border border-ink-700 bg-[radial-gradient(circle_at_50%_40%,#2b2620,#0f0d0b)]"
      style={{ width: size, height: size * 1.15 }}
      aria-label="3D preview of the figure – drag to turn it, mouse wheel to zoom"
      role="img"
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); if (t.current) { t.current.drag = e.clientX; t.current.dragY = e.clientY; t.current.spin = false; } }}
      onPointerMove={(e) => { const s = t.current; if (s && s.drag !== null) { s.yaw += (e.clientX - s.drag) * 0.012; s.drag = e.clientX; if (s.dragY !== null && s.zoom > 1.05) { s.focus = Math.max(-0.6, Math.min(0.3, s.focus + (e.clientY - s.dragY) * 0.004)); s.dragY = e.clientY; } } }}
      onPointerUp={() => { if (t.current) { t.current.drag = null; t.current.dragY = null; } }}
      onDoubleClick={() => { if (t.current) t.current.spin = !t.current.spin; }}
      data-testid="figure-preview"
    />
    <div className="absolute bottom-1.5 right-1.5 flex flex-col gap-1">
      <button type="button" className="btn btn-ghost h-6 w-6 px-0 text-sm" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>+</button>
      <button type="button" className="btn btn-ghost h-6 w-6 px-0 text-sm" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>−</button>
    </div>
    </div>
  );
}
