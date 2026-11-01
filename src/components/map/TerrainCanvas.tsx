/**
 * Terrain layer: paints the map into cached chunk bitmaps at a few levels of detail
 * and blits only the visible chunks on pan/zoom. ~5,000 hexes stay interactive because
 * hexes are not DOM nodes and each chunk is re-painted only when its content changes.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { HexView } from '../../game/visibility';
import { center } from './geometry';
import { paintDetails, paintEdges, paintGround, paintOverlays, paintSprites, type PaintEnv } from './painter';

export interface Transform {
  x: number;
  y: number;
  k: number;
}

const CHUNK = 480; // world px
const MARGIN = 96; // sprites reach this far beyond their hex
const LODS = [0.25, 0.5, 1, 2];
const PIXEL_BUDGET = 40_000_000; // ≈160 MB of chunk bitmaps at most
const FRAME_BUDGET_MS = 12;

interface Chunk {
  hexes: HexView[];
  sig: string;
}

interface Cached {
  canvas: HTMLCanvasElement;
  sig: string;
  px: number;
}

function buildIndex(hexes: HexView[], overlayFog: PaintEnv['overlayFog']): Map<string, Chunk> {
  const index = new Map<string, Chunk>();
  for (const h of hexes) {
    const c = center(h);
    const i0 = Math.floor((c.x - MARGIN) / CHUNK);
    const i1 = Math.floor((c.x + MARGIN) / CHUNK);
    const j0 = Math.floor((c.y - MARGIN) / CHUNK);
    const j1 = Math.floor((c.y + MARGIN) / CHUNK);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = `${i},${j}`;
        let ch = index.get(k);
        if (!ch) index.set(k, (ch = { hexes: [], sig: '' }));
        ch.hexes.push(h);
      }
  }
  for (const ch of index.values()) {
    ch.hexes.sort((a, b) => a.r - b.r || a.q - b.q);
    ch.sig = ch.hexes
      .map((h) => `${h.key}${h.terrain}${h.fog[0]}${h.zone[0]}${h.feature ?? ''}${h.edges ?? ''}${overlayFog ? (overlayFog[h.key] ?? '')[0] : ''}`)
      .join('|');
  }
  return index;
}

export function TerrainCanvas({
  hexes,
  byKey,
  overlayFog,
  fogUnknown,
  tf,
  size,
}: {
  hexes: HexView[];
  byKey: Record<string, HexView>;
  overlayFog: PaintEnv['overlayFog'];
  fogUnknown: boolean;
  tf: Transform | null;
  size: { w: number; h: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new Map<string, Cached>());
  const pixels = useRef(0);
  const raf = useRef(0);

  const index = useMemo(() => buildIndex(hexes, overlayFog), [hexes, overlayFog]);
  const env: PaintEnv = useMemo(() => ({ get: (k) => byKey[k], fogUnknown, overlayFog }), [byKey, fogUnknown, overlayFog]);

  const state = useRef({ index, env, tf, size });
  state.current = { index, env, tf, size };

  useEffect(() => {
    const render = (lod: number, key: string, ch: Chunk): Cached => {
      const [i, j] = key.split(',').map(Number);
      const px = Math.ceil(CHUNK * lod);
      const old = cache.current.get(`${lod}:${key}`);
      const canvas = old?.canvas ?? document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(lod, 0, 0, lod, -i * CHUNK * lod, -j * CHUNK * lod);
      ctx.clearRect(i * CHUNK, j * CHUNK, CHUNK, CHUNK);
      const e = state.current.env;
      for (const h of ch.hexes) paintGround(ctx, h, e);
      for (const h of ch.hexes) paintEdges(ctx, h, e);
      for (const h of ch.hexes) paintDetails(ctx, h, e);
      for (const h of ch.hexes) paintSprites(ctx, h, e);
      for (const h of ch.hexes) paintOverlays(ctx, h, e);
      const entry: Cached = { canvas, sig: ch.sig, px: px * px };
      if (!old) pixels.current += entry.px;
      cache.current.delete(`${lod}:${key}`);
      cache.current.set(`${lod}:${key}`, entry); // LRU: most recent last
      while (pixels.current > PIXEL_BUDGET && cache.current.size > 1) {
        const [oldestKey, oldest] = cache.current.entries().next().value as [string, Cached];
        cache.current.delete(oldestKey);
        pixels.current -= oldest.px;
      }
      return entry;
    };

    const draw = () => {
      raf.current = 0;
      const canvas = ref.current;
      const { tf, size, index } = state.current;
      if (!canvas || !tf || !size.w) return;
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
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const scale = tf.k * dpr;
      const lod = LODS.find((l) => l >= scale * 0.85) ?? LODS[LODS.length - 1];
      const wx0 = -tf.x / tf.k;
      const wy0 = -tf.y / tf.k;
      const wx1 = (size.w - tf.x) / tf.k;
      const wy1 = (size.h - tf.y) / tf.k;
      const start = performance.now();
      let pending = false;
      for (let i = Math.floor(wx0 / CHUNK); i <= Math.floor(wx1 / CHUNK); i++) {
        for (let j = Math.floor(wy0 / CHUNK); j <= Math.floor(wy1 / CHUNK); j++) {
          const key = `${i},${j}`;
          const ch = index.get(key);
          if (!ch) continue;
          let c = cache.current.get(`${lod}:${key}`);
          if (!c || c.sig !== ch.sig) {
            if (performance.now() - start < FRAME_BUDGET_MS) c = render(lod, key, ch);
            else {
              pending = true;
              // fall back to any other level of detail (possibly stale) until repainted
              c = c ?? LODS.map((l) => cache.current.get(`${l}:${key}`)).find(Boolean);
            }
          }
          if (!c) continue;
          const dx = (i * CHUNK * tf.k + tf.x) * dpr;
          const dy = (j * CHUNK * tf.k + tf.y) * dpr;
          const ds = CHUNK * tf.k * dpr;
          ctx.drawImage(c.canvas, dx, dy, ds + 0.5, ds + 0.5);
        }
      }
      if (pending) raf.current = requestAnimationFrame(draw);
    };

    if (!raf.current) raf.current = requestAnimationFrame(draw);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [index, env, tf, size]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" style={{ width: size.w, height: size.h }} aria-hidden="true" />;
}
