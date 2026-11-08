/**
 * 5-foot battle-map painter (Canvas 2D) for the hex engine. Every hex is one 5 ft square of ground:
 * grass, earth, flagstones, planks, undergrowth, rubble, water – plus single trees, boulders and wall
 * segments drawn top-down at that scale. Procedural and original; cached per chunk by TerrainCanvas.
 * Remembered (explored but not visible) hexes are drawn dimmed, exactly like the Arena fog.
 */
import { DIRECTIONS, add, hexKey } from '../../game/hex';
import type { HexView } from '../../game/visibility';
import { HEX_SIZE, center, corner } from './geometry';
import { EDGE, h32, hexPath, makeTone, paintDetails, paintEdges, paintGround, paintOverlays, paintSprites, type PaintEnv, type Tone } from './painter';
import { tileDef } from '../../campaign/hexScene';
import { paintGenericHex } from './tilePainter';

const S = HEX_SIZE;
const TAU = Math.PI * 2;

const BASE: Record<string, [string, string]> = {
  grass: ['#7f9a4f', '#5f7a37'],
  dirt: ['#9a7d55', '#76603f'],
  stone: ['#9b978e', '#7a766e'],
  wood: ['#9a6a3c', '#7a502a'],
  undergrowth: ['#6c8a43', '#4d6a30'],
  rubble: ['#8d8173', '#6c6156'],
  shallow: ['#6aa3bf', '#4a84a3'],
  deep: ['#2d6688', '#1a4664'],
  tree: ['#6f8a45', '#56702f'],
  boulder: ['#7f9a4f', '#5f7a37'],
  wall: ['#5a544d', '#3e3a35'],
};

const dimOf = (h: HexView, env: PaintEnv) => {
  const fog = env.overlayFog ? env.overlayFog[h.key] : h.fog;
  return fog === 'explored' ? 0.55 : fog === 'unexplored' ? 0.8 : 0;
};

function ground(ctx: CanvasRenderingContext2D, h: HexView, tone: Tone) {
  const { x, y } = center(h);
  const [a, b] = BASE[h.tile ?? 'grass'] ?? BASE.grass;
  const v = (h32(h.q, h.r, 3) - 0.5) * 0.08;
  const g = ctx.createLinearGradient(x - S, y - S, x + S, y + S);
  g.addColorStop(0, tone(a, 1, v));
  g.addColorStop(1, tone(b, 1, v));
  hexPath(ctx, x, y, S + 0.6);
  ctx.fillStyle = g;
  ctx.fill();
}

function details(ctx: CanvasRenderingContext2D, h: HexView, tone: Tone, env: PaintEnv) {
  const { x, y } = center(h);
  const r = (i: number) => h32(h.q, h.r, i);
  ctx.save();
  hexPath(ctx, x, y, S);
  ctx.clip();
  switch (h.tile) {
    case 'grass':
    case 'tree':
    case 'boulder':
    case 'undergrowth': {
      ctx.strokeStyle = tone('#a9c26a', 0.55);
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const px = x + (r(10 + i) - 0.5) * S * 1.5, py = y + (r(20 + i) - 0.5) * S * 1.5;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 1.5, py - 4);
        ctx.moveTo(px, py);
        ctx.lineTo(px + 1.5, py - 4.5);
        ctx.stroke();
      }
      if (h.tile === 'undergrowth') {
        for (let i = 0; i < 5; i++) {
          const px = x + (r(30 + i) - 0.5) * S * 1.2, py = y + (r(40 + i) - 0.5) * S * 1.2, rad = 5 + r(50 + i) * 5;
          ctx.fillStyle = tone('#2f4d22', 0.45);
          ctx.beginPath();
          ctx.arc(px + 1.5, py + 2, rad, 0, TAU);
          ctx.fill();
          ctx.fillStyle = tone(i % 2 ? '#4f7a32' : '#5f8a3b');
          ctx.beginPath();
          ctx.arc(px, py, rad, 0, TAU);
          ctx.fill();
        }
      }
      break;
    }
    case 'dirt':
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = tone(i % 2 ? '#6a5236' : '#b39a73', 0.7);
        ctx.beginPath();
        ctx.arc(x + (r(60 + i) - 0.5) * S * 1.5, y + (r(70 + i) - 0.5) * S * 1.5, 0.8 + r(80 + i) * 1.4, 0, TAU);
        ctx.fill();
      }
      break;
    case 'stone': {
      // Three flagstones per hex with dark joints.
      ctx.strokeStyle = tone('#55524c', 0.9);
      ctx.lineWidth = 1.6;
      const turn = Math.floor(r(1) * 2);
      for (const dir of [0 + turn, 2 + turn, 4 + turn]) {
        const [a, b] = EDGE[dir % 6];
        const p = corner(x, y, S, a), q = corner(x, y, S, b);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo((p.x + q.x) / 2, (p.y + q.y) / 2);
        ctx.stroke();
      }
      ctx.fillStyle = tone('#c9c4b8', 0.12);
      ctx.beginPath();
      ctx.arc(x - S * 0.3, y - S * 0.3, S * 0.35, 0, TAU);
      ctx.fill();
      break;
    }
    case 'wood': {
      ctx.strokeStyle = tone('#5a3b1e', 0.85);
      ctx.lineWidth = 1.2;
      for (let row = -3; row <= 3; row++) {
        const yy = y + row * 9;
        ctx.beginPath();
        ctx.moveTo(x - S, yy);
        ctx.lineTo(x + S, yy);
        ctx.stroke();
        const off = (row % 2 ? 0.3 : -0.2) * S + (r(90 + row) - 0.5) * 6;
        ctx.beginPath();
        ctx.moveTo(x + off, yy);
        ctx.lineTo(x + off, yy + 9);
        ctx.stroke();
      }
      break;
    }
    case 'rubble':
      for (let i = 0; i < 7; i++) {
        const px = x + (r(100 + i) - 0.5) * S * 1.3, py = y + (r(110 + i) - 0.5) * S * 1.3, rad = 3 + r(120 + i) * 4;
        stone(ctx, px, py, rad, tone, h.q * 31 + i);
      }
      break;
    case 'shallow':
    case 'deep': {
      ctx.strokeStyle = tone(h.tile === 'deep' ? '#7fb6d6' : '#cde8f4', h.tile === 'deep' ? 0.35 : 0.5);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const px = x + (r(130 + i) - 0.5) * S, py = y + (r(140 + i) - 0.5) * S;
        ctx.beginPath();
        ctx.arc(px, py, 6 + i * 2, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      break;
    }
    case 'wall': {
      // Masonry courses; the top face is lighter towards the light (north-west).
      ctx.strokeStyle = tone('#2a2724', 0.9);
      ctx.lineWidth = 1.4;
      for (let row = -3; row <= 3; row++) {
        const yy = y + row * 8;
        ctx.beginPath();
        ctx.moveTo(x - S, yy);
        ctx.lineTo(x + S, yy);
        ctx.stroke();
        for (let col = -3; col <= 3; col++) {
          const xx = x + col * 14 + (row % 2 ? 7 : 0);
          ctx.beginPath();
          ctx.moveTo(xx, yy);
          ctx.lineTo(xx, yy + 8);
          ctx.stroke();
        }
      }
      ctx.fillStyle = tone('#ffffff', 0.08);
      ctx.fillRect(x - S, y - S, S * 2, S * 0.7);
      break;
    }
  }
  ctx.restore();
  // Wall faces: a dark lip where a wall meets open ground (reads as height at 5 ft scale).
  if (h.tile === 'wall') {
    for (let d = 0; d < 6; d++) {
      const n = env.get(hexKey(add(h, DIRECTIONS[d])));
      if (!n || n.tile === 'wall') continue;
      const [a, b] = EDGE[d];
      const p = corner(x, y, S, a), q = corner(x, y, S, b);
      ctx.strokeStyle = tone('#1a1816', 0.95);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.strokeStyle = tone('#b9b2a6', 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function stone(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, tone: Tone, seed: number) {
  ctx.fillStyle = tone('#3c3934', 0.45);
  ctx.beginPath();
  ctx.ellipse(x + rad * 0.25, y + rad * 0.35, rad, rad * 0.75, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU, rr = rad * (0.75 + h32(seed, i) * 0.35);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.85;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(x - rad, y - rad, x + rad, y + rad);
  g.addColorStop(0, tone('#c4beb3'));
  g.addColorStop(1, tone('#6f6a62'));
  ctx.fillStyle = g;
  ctx.fill();
}

function sprites(ctx: CanvasRenderingContext2D, h: HexView, tone: Tone) {
  const { x, y } = center(h);
  if (h.tile === 'boulder') stone(ctx, x, y, S * 0.62, tone, h.q * 17 + h.r);
  if (h.tile === 'tree') {
    // Top-down crown of one tree (≈ 5 ft trunk area, crown slightly larger), with a cast shadow.
    ctx.fillStyle = tone('#10200f', 0.4);
    ctx.beginPath();
    ctx.ellipse(x + 6, y + 8, S * 0.95, S * 0.8, 0, 0, TAU);
    ctx.fill();
    const lobes = 6;
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * TAU + h32(h.q, h.r, 5) * TAU;
      const px = x + Math.cos(a) * S * 0.42, py = y + Math.sin(a) * S * 0.42;
      ctx.fillStyle = tone(i % 2 ? '#2f5f2f' : '#376d35');
      ctx.beginPath();
      ctx.arc(px, py, S * 0.48, 0, TAU);
      ctx.fill();
    }
    const g = ctx.createRadialGradient(x - S * 0.25, y - S * 0.3, 2, x, y, S * 0.7);
    g.addColorStop(0, tone('#79a95a'));
    g.addColorStop(1, tone('#2f5f2f', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, S * 0.7, 0, TAU);
    ctx.fill();
  }
}

/** Paints one chunk of battle hexes (ground → details → tall sprites → 5-ft grid). */
export function paintBattleChunk(ctx: CanvasRenderingContext2D, hexes: HexView[], env: PaintEnv) {
  const tones = new Map<HexView, Tone>(hexes.map((h) => [h, makeTone(dimOf(h, env))]));
  // Library tiles (with a generic style) use the shared tile painter; the original set keeps its art.
  const generic = (h: HexView) => { const d = tileDef('battle', h.tile ?? ''); return d?.style ? d : null; };
  for (const h of hexes) { const d = generic(h); if (d) paintGenericHex(ctx, h, d, tones.get(h)!, 'battle', 'ground'); else ground(ctx, h, tones.get(h)!); }
  for (const h of hexes) { const d = generic(h); if (d) paintGenericHex(ctx, h, d, tones.get(h)!, 'battle', 'details'); else details(ctx, h, tones.get(h)!, env); }
  for (const h of hexes) { const d = generic(h); if (d) paintGenericHex(ctx, h, d, tones.get(h)!, 'battle', 'sprites'); else sprites(ctx, h, tones.get(h)!); }
  ctx.strokeStyle = 'rgba(20,18,14,0.28)';
  ctx.lineWidth = 0.8;
  for (const h of hexes) {
    const { x, y } = center(h);
    hexPath(ctx, x, y, S);
    ctx.stroke();
  }
}

/** Region chunk: Arena terrain uses the Arena painter, library tiles the shared tile painter. */
export function paintRegionChunk(ctx: CanvasRenderingContext2D, hexes: HexView[], env: PaintEnv) {
  const generic = hexes.filter((h) => !h.terrain && h.tile);
  const tones = new Map<HexView, Tone>(generic.map((h) => [h, makeTone(dimOf(h, env))]));
  const defOf = (h: HexView) => tileDef('region', h.tile!)!;
  for (const h of generic) paintGenericHex(ctx, h, defOf(h), tones.get(h)!, 'region', 'ground');
  for (const h of hexes) if (h.terrain) paintGround(ctx, h, env);
  for (const h of hexes) if (h.terrain) paintEdges(ctx, h, env);
  for (const h of hexes) if (h.terrain) paintDetails(ctx, h, env);
  for (const h of generic) paintGenericHex(ctx, h, defOf(h), tones.get(h)!, 'region', 'details');
  for (const h of hexes) if (h.terrain) paintSprites(ctx, h, env);
  for (const h of generic) paintGenericHex(ctx, h, defOf(h), tones.get(h)!, 'region', 'sprites');
  for (const h of hexes) if (h.terrain) paintOverlays(ctx, h, env);
}
