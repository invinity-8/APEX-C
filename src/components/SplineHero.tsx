/**
 * Welcome-screen hero (APEX 0.5): the "Aquila Aurea" scene built in Spline (asset registry: spline.aquila-aurea).
 *
 * Loading strategy – never blocks or breaks the app:
 *  1. The poster (8 KB WebP rendered from the same Spline scene) is shown immediately.
 *  2. Only when the device can afford it (no reduced motion, no Save-Data, ≥ 4 CPU threads, ≥ 4 GB memory if
 *     reported) and the hero is on screen, the Spline runtime is lazy-loaded (separate chunk) and the scene
 *     file is fetched from OUR origin (public/assets/spline – versioned in the repo, cached immutably).
 *  3. Any failure keeps the poster. The runtime is disposed on unmount (it only lives on the welcome screen).
 * The game itself never depends on Spline.
 */
import { useEffect, useRef, useState } from 'react';
import { asset } from '../assets/registry';

const SCENE = asset('spline.aquila-aurea')!.path.replace(/^public/, '');
const POSTER = asset('spline.aquila-aurea.poster')!.path.replace(/^public/, '');

export function canRun3d(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if ((nav.hardwareConcurrency ?? 8) < 4) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
  try {
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl2') || c.getContext('webgl'))) return false;
  } catch {
    return false;
  }
  return true;
}

export function SplineHero({ className = '' }: { className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'poster' | 'loading' | 'live' | 'fallback'>('poster');

  useEffect(() => {
    if (!canRun3d() || !wrap.current) return;
    let disposed = false;
    let app: { dispose?: () => void } | null = null;
    const io = new IntersectionObserver(
      async ([e]) => {
        if (!e.isIntersecting || app || disposed) return;
        io.disconnect();
        setState('loading');
        try {
          const t0 = performance.now();
          const { Application } = await import('@splinetool/runtime');
          if (disposed || !canvas.current) return;
          const a = new Application(canvas.current);
          app = a as unknown as { dispose?: () => void };
          await a.load(SCENE);
          if (disposed) return a.dispose?.();
          (window as unknown as { __apexSplineMs?: number }).__apexSplineMs = Math.round(performance.now() - t0);
          setState('live');
        } catch {
          if (!disposed) setState('fallback');
        }
      },
      { rootMargin: '100px' },
    );
    io.observe(wrap.current);
    return () => {
      disposed = true;
      io.disconnect();
      app?.dispose?.();
    };
  }, []);

  return (
    <div ref={wrap} className={`apex-hero ${className}`} data-testid="spline-hero" data-state={state}>
      <img src={POSTER} alt="The Aquila Aurea – the golden eagle at the heart of the arena, ringed by columns and the labyrinth" className={`apex-hero-poster ${state === 'live' ? 'apex-hero-hidden' : ''}`} />
      <canvas ref={canvas} className={`apex-hero-canvas ${state === 'live' ? '' : 'apex-hero-hidden'}`} aria-hidden="true" />
    </div>
  );
}
