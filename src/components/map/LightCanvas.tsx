/**
 * Lighting layer (screen-blended over the terrain): glowing anomalies, the golden eagle,
 * labyrinth inscriptions, torches and camp fires, the party's torches at night, gentle
 * water glints and floating arcane motes. Fades smoothly between day and night.
 * Animations stop entirely with prefers-reduced-motion.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { ViewModel } from '../../game/visibility';
import { HEX_SIZE, center } from './geometry';
import { h32 } from './painter';
import type { Transform } from './TerrainCanvas';

const S = HEX_SIZE;

interface Light {
  x: number;
  y: number;
  r: number;
  color: string;
  day: number; // intensity during the day
  night: number; // intensity at night
  flicker: number; // 0 = steady
  seed: number;
  motes?: boolean;
  glint?: boolean;
}

const sprites = new Map<string, HTMLCanvasElement>();
function glow(color: string): HTMLCanvasElement {
  let c = sprites.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color.replace(/[\d.]+\)$/, '0.45)'));
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  sprites.set(color, c);
  return c;
}

export function usePrefersReducedMotion(): boolean {
  return useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
}

export function LightCanvas({ view, tf, size, reducedMotion }: { view: ViewModel; tf: Transform | null; size: { w: number; h: number }; reducedMotion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const nightness = useRef(view.phase === 'night' ? 1 : 0);

  const lights = useMemo(() => {
    const out: Light[] = [];
    for (const h of view.hexes) {
      if (!h.terrain || h.fog !== 'visible') continue;
      const { x, y } = center(h);
      const seed = h32(h.q, h.r, 101);
      if (h.feature === 'eagle') out.push({ x, y: y - S * 1.1, r: S * 3.2, color: 'rgba(255,214,120,1)', day: 0.18, night: 0.85, flicker: 0.05, seed });
      else if (h.feature === 'labyrinth' && h32(h.q, h.r, 77) < 0.45)
        out.push({ x, y, r: S * 0.75, color: 'rgba(255,205,110,1)', day: 0, night: 0.55, flicker: 0.15, seed });
      else if (h.terrain === 'magic') out.push({ x, y: y - 4, r: S * 1.5, color: 'rgba(170,110,255,1)', day: 0.22, night: 0.8, flicker: 0.25, seed, motes: true });
      else if (h.terrain === 'ruins' && seed < 0.22) out.push({ x: x + 6, y: y - 6, r: S * 1.1, color: 'rgba(255,150,60,1)', day: 0, night: 0.75, flicker: 0.4, seed });
      else if (h.terrain === 'water' && seed < 0.5) out.push({ x, y, r: S * 0.5, color: 'rgba(220,240,255,1)', day: 0.25, night: 0.12, flicker: 0, seed, glint: true });
    }
    for (const s of view.sites) {
      if (!view.hexByKey[`${s.pos.q},${s.pos.r}`] || s.type === 'start') continue;
      const { x, y } = center(s.pos);
      out.push({ x, y: y - S * 0.4, r: S * 1.6, color: s.type === 'shrine' ? 'rgba(180,140,255,1)' : 'rgba(255,160,70,1)', day: 0, night: 0.8, flicker: 0.35, seed: h32(s.pos.q, s.pos.r, 5) });
    }
    for (const t of view.tokens) {
      if (t.kind !== 'player') continue;
      const { x, y } = center(t.pos);
      out.push({ x, y, r: S * 2.4, color: 'rgba(255,190,110,1)', day: 0, night: 0.6, flicker: 0.2, seed: h32(t.pos.q, t.pos.r, 9) });
    }
    return out;
  }, [view]);

  const st = useRef({ tf, size, lights });
  st.current = { tf, size, lights };

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const target = view.phase === 'night' ? 1 : 0;
    const animated = !reducedMotion && st.current.lights.some((l) => l.flicker || l.motes || l.glint);

    const frame = (t: number) => {
      raf = 0;
      const canvas = ref.current;
      const { tf, size, lights } = st.current;
      if (!canvas || !tf || !size.w) return;
      if (document.hidden) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = last ? Math.min(100, t - last) : 16;
      if (animated && t - last < 33 && nightness.current === target) {
        raf = requestAnimationFrame(frame);
        return;
      }
      last = t;
      // smooth day/night fade
      if (nightness.current !== target) {
        const step = reducedMotion ? 1 : dt / 1500;
        nightness.current = target > nightness.current ? Math.min(target, nightness.current + step) : Math.max(target, nightness.current - step);
      }
      const n = nightness.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(size.w * dpr);
      const H = Math.round(size.h * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const k = tf.k * dpr;
      const sec = t / 1000;
      const pad = S * 4;
      const x0 = -tf.x / tf.k - pad;
      const y0 = -tf.y / tf.k - pad;
      const x1 = (size.w - tf.x) / tf.k + pad;
      const y1 = (size.h - tf.y) / tf.k + pad;
      for (const l of lights) {
        if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
        // Zoomed far out (large arenas): a glow smaller than ~1.5 px is invisible – skip the draw call.
        if (l.r * k < 1.5) continue;
        let a = l.day + (l.night - l.day) * n;
        if (a <= 0.01) continue;
        if (l.flicker && !reducedMotion) a *= 1 - l.flicker * 0.5 + l.flicker * 0.5 * Math.sin(sec * (3 + l.seed * 5) + l.seed * 40) * Math.sin(sec * 7.3 + l.seed * 13);
        const sx = (l.x * tf.k + tf.x) * dpr;
        const sy = (l.y * tf.k + tf.y) * dpr;
        if (l.glint) {
          if (reducedMotion || tf.k < 0.45) continue;
          const off = Math.sin(sec * 0.8 + l.seed * 20) * S * 0.35 * k;
          ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(sec * 1.3 + l.seed * 9));
          ctx.drawImage(glow(l.color), sx - l.r * k + off, sy - l.r * k * 0.3, l.r * 2 * k, l.r * 0.6 * k);
          continue;
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.drawImage(glow(l.color), sx - l.r * k, sy - l.r * k, l.r * 2 * k, l.r * 2 * k);
        if (l.motes && !reducedMotion && tf.k > 0.35) {
          for (let m = 0; m < 3; m++) {
            const ph = (sec * 0.25 + l.seed * 7 + m / 3) % 1;
            const mx = sx + Math.sin(sec * 0.9 + m * 2.1 + l.seed * 30) * S * 0.45 * k;
            const my = sy - ph * S * 1.2 * k;
            ctx.globalAlpha = Math.sin(ph * Math.PI) * (0.5 + 0.5 * n);
            const r = 3.5 * k;
            ctx.drawImage(glow('rgba(220,190,255,1)'), mx - r, my - r, r * 2, r * 2);
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (animated || nightness.current !== target) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [view.phase, reducedMotion, tf, size, lights]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ width: size.w, height: size.h, mixBlendMode: 'screen' }}
      aria-hidden="true"
    />
  );
}
