/**
 * Decorative campaign preview for the welcome screen, painted with the real map renderer.
 * It uses its own fixed seed – it does NOT show the actual campaign map (no Fog of War leak).
 */
import { useEffect, useRef } from 'react';
import { generateArena } from '../game/mapgen';
import type { HexView } from '../game/visibility';
import { HEX_SIZE, center } from '../components/map/geometry';
import { paintDetails, paintEdges, paintGround, paintOverlays, paintSprites, type PaintEnv } from '../components/map/painter';

const PREVIEW_RADIUS = 6;

function previewHexes(): HexView[] {
  const tiles = generateArena({ radius: PREVIEW_RADIUS, seed: 20261103, landmarkRadius: 2 });
  return Object.entries(tiles)
    .map(([key, t]) => ({ key, q: t.q, r: t.r, terrain: t.terrain, fog: 'visible' as const, zone: 'safe' as const, elevation: t.elevation, feature: t.feature }))
    .sort((a, b) => a.r - b.r || a.q - b.q);
}

export function CampaignPreview({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const hexes = previewHexes();
    const byKey = Object.fromEntries(hexes.map((h) => [h.key, h]));
    // Only the inner area is painted; outer hexes fade into mist.
    const env: PaintEnv = { get: (k) => byKey[k], fogUnknown: true };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || 560;
    const H = canvas.clientHeight || 300;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    const span = HEX_SIZE * Math.sqrt(3) * (2 * PREVIEW_RADIUS + 1);
    const k = (Math.max(W / span, H / (HEX_SIZE * 1.5 * (2 * PREVIEW_RADIUS) + HEX_SIZE * 2)) * 1.05);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, (W / 2) * dpr, (H / 2 + HEX_SIZE * k * 0.6) * dpr);
    for (const pass of [paintGround, paintEdges, paintDetails, paintSprites, paintOverlays]) for (const h of hexes) pass(ctx, h, env);
    // soft golden glow around the eagle
    const c = center({ q: 0, r: 0 });
    const g = ctx.createRadialGradient(c.x, c.y - HEX_SIZE, 0, c.x, c.y - HEX_SIZE, HEX_SIZE * 3);
    g.addColorStop(0, 'rgba(255,214,120,0.35)');
    g.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(c.x - HEX_SIZE * 3, c.y - HEX_SIZE * 4, HEX_SIZE * 6, HEX_SIZE * 6);
    ctx.globalCompositeOperation = 'source-over';
  }, []);
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-gold-700/50 bg-[#0b0a0e] ${className}`}>
      <canvas ref={ref} className="block h-full w-full" aria-hidden="true" />
      {/* vignette + mist so the preview fades into the unknown */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(11,10,14,0.85)_78%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0b0a0e] to-transparent" />
      <span className="absolute bottom-3 left-4 font-display text-[11px] tracking-[0.25em] text-gold-300/90 uppercase">Aquila Aurea · Labyrinthus Imperii</span>
    </div>
  );
}
