/**
 * Library preview of a hex scene: a small canvas drawn from the current draft's tiles (with the
 * scene's colour scheme), so maps can be recognised at a glance. No upload, always up to date.
 */
import { useEffect, useRef } from 'react';
import { decodeTiles, type HexSceneData } from '../campaign/hexScene';
import { gradientMap, type ScenePalette } from '../campaign/palette';
import { ORIGIN, hexesInRange, hexKey, toPixel } from '../game/hex';

const hex2rgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export function HexThumbnail({ hex, palette, label, width = 112, height = 72 }: { hex: HexSceneData; palette?: ScenePalette | null; label: string; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#161a20';
    ctx.fillRect(0, 0, width, height);
    const tiles = decodeTiles(hex);
    const r = hex.radius;
    const size = Math.min(width / (Math.sqrt(3) * (2 * r + 1)), height / (3 * r + 2));
    const recolor = palette ? gradientMap(palette) : null;
    for (const h of hexesInRange(ORIGIN, r)) {
      const t = tiles.get(hexKey(h));
      if (!t) continue;
      const c = toPixel(h, size);
      const rgb = recolor ? recolor(hex2rgb(t.fill)) : hex2rgb(t.fill);
      ctx.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 30);
        const x = width / 2 + c.x + (size + 0.4) * Math.cos(a), y = height / 2 + c.y + (size + 0.4) * Math.sin(a);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.fill();
    }
  }, [hex.terrain, hex.radius, hex.set, palette?.colors.join(','), palette?.strength, width, height]);
  return <div className="scene-thumbnail"><canvas ref={ref} role="img" aria-label={`${label} – map preview`} style={{ width, height }} /></div>;
}
