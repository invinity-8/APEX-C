/**
 * Map atmosphere (APEX 0.5): slowly drifting fog banks anchored in world space, a day/night light tint and a
 * soft vignette – the "painterly diorama" mood without touching the terrain renderer, hex geometry, pointer
 * mapping, fog of war or visibility (it is a pointer-transparent overlay on top of the same game state).
 *
 * Budget: ≤ 12 radial gradients per frame, capped at 24 fps, paused while the tab is hidden; under reduced
 * motion it draws ONE static frame. It can be switched off (Legend → Atmosphere) – then nothing is drawn.
 */
import { useEffect, useRef } from 'react';
import type { Transform } from './TerrainCanvas';

const BANKS = 9;
const FPS = 24;

function bankSeed(i: number) {
  const r = (n: number) => {
    const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: (r(1) - 0.5) * 2400, y: (r(2) - 0.5) * 2000, r: 260 + r(3) * 420, speed: 4 + r(4) * 9, phase: r(5) * Math.PI * 2 };
}
const SEEDS = Array.from({ length: BANKS }, (_, i) => bankSeed(i));

export function AtmosphereCanvas({ phase, tf, size, reducedMotion, enabled }: { phase: 'day' | 'night'; tf: Transform | null; size: { w: number; h: number }; reducedMotion: boolean; enabled: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ tf, size, phase });
  st.current = { tf, size, phase };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!enabled) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      raf = 0;
      const { tf, size, phase } = st.current;
      if (!tf || !size.w) return;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1); // atmosphere is soft – lower resolution is invisible
      const W = Math.round(size.w * dpr);
      const H = Math.round(size.h * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const night = phase === 'night';
      const sec = reducedMotion ? 0 : (now - t0) / 1000;
      // drifting fog banks (world anchored, so they move with pan/zoom like part of the diorama)
      for (const b of SEEDS) {
        const wx = b.x + Math.sin(sec / b.speed + b.phase) * 60 + sec * b.speed * 0.8;
        const wy = b.y + Math.cos(sec / (b.speed * 1.3) + b.phase) * 30;
        const sx = ((((wx + 1600) % 3200) + 3200) % 3200 - 1600) * tf.k + tf.x;
        const sy = wy * tf.k + tf.y;
        const r = b.r * tf.k * dpr;
        if (sx * dpr + r < 0 || sx * dpr - r > W || sy * dpr + r < 0 || sy * dpr - r > H) continue;
        const g = ctx.createRadialGradient(sx * dpr, sy * dpr, 0, sx * dpr, sy * dpr, r);
        const c = night ? '150,165,200' : '232,226,210';
        g.addColorStop(0, `rgba(${c},${night ? 0.13 : 0.08})`);
        g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(sx * dpr - r, sy * dpr - r, r * 2, r * 2);
      }
      // light tint: warm low sun by day, cool moonlight at night
      const tint = ctx.createLinearGradient(0, 0, W, H);
      if (night) {
        tint.addColorStop(0, 'rgba(70,90,140,0.10)');
        tint.addColorStop(1, 'rgba(20,25,45,0.18)');
      } else {
        tint.addColorStop(0, 'rgba(255,228,170,0.07)');
        tint.addColorStop(1, 'rgba(64,91,73,0.05)');
      }
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, W, H);
      // vignette
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(15,17,19,0)');
      v.addColorStop(1, `rgba(15,17,19,${night ? 0.55 : 0.4})`);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
      if (!reducedMotion) schedule();
    };
    const schedule = () => {
      raf = requestAnimationFrame((now) => {
        if (document.hidden || now - last < 1000 / FPS) return schedule();
        last = now;
        draw(now);
      });
    };
    if (reducedMotion) raf = requestAnimationFrame(draw);
    else schedule();
    return () => cancelAnimationFrame(raf);
  }, [enabled, reducedMotion, tf, size, phase]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" style={{ width: size.w, height: size.h }} aria-hidden="true" data-testid="atmosphere" />;
}
