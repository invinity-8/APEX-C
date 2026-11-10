/**
 * APEX 2.1 – live 3D preview of a low-poly figure (lazy chunk with three.js): turns slowly, drag to rotate.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { FigureLook } from '../game/figure';
import { buildLowPoly } from './map/lowpoly';

export default function FigurePreview({ look, ring = '#d8b25a', size = 280 }: { look: FigureLook; ring?: string; size?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const t = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; holder: THREE.Group; yaw: number; drag: number | null; spin: boolean } | null>(null);

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
    t.current = { renderer, scene, camera, holder, yaw: 0.5, drag: null, spin: true };
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const s = t.current; if (!s || document.hidden) return;
      if (s.spin && s.drag === null) s.yaw += 0.006;
      s.holder.rotation.y = s.yaw;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); renderer.dispose(); el.removeChild(renderer.domElement); t.current = null; };
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
    const fig = buildLowPoly(look);
    fig.group.position.y = 0.12;
    // tall figures (ogres, wizard hats) are framed by scaling the camera distance
    const h = Math.max(2.2, fig.height + 0.3);
    s.camera.position.set(0, h * 0.75, h * 2.9); s.camera.lookAt(0, h * 0.48, 0);
    s.holder.add(base, ringM, fig.group);
  }, [look, ring]);

  return (
    <div
      ref={wrap}
      className="cursor-grab touch-none select-none rounded-xl border border-ink-700 bg-[radial-gradient(circle_at_50%_40%,#2b2620,#0f0d0b)]"
      style={{ width: size, height: size * 1.15 }}
      aria-label="3D preview of the figure – drag to turn it"
      role="img"
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); if (t.current) { t.current.drag = e.clientX; t.current.spin = false; } }}
      onPointerMove={(e) => { const s = t.current; if (s && s.drag !== null) { s.yaw += (e.clientX - s.drag) * 0.012; s.drag = e.clientX; } }}
      onPointerUp={() => { if (t.current) t.current.drag = null; }}
      onDoubleClick={() => { if (t.current) t.current.spin = !t.current.spin; }}
      data-testid="figure-preview"
    />
  );
}
