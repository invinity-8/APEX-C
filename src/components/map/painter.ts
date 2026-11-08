/**
 * Stylised 2.5D terrain painter (Canvas 2D). Draws one hex at a time in world coordinates.
 * All art is procedural and original: painted gradients, soft relief, edge transitions,
 * layered sprites (trees, peaks, ruins, crystals), and the central imperial landmark.
 *
 * Results are cached per chunk by TerrainCanvas, so this code runs rarely.
 */
import { DIRECTIONS, add, hexKey } from '../../game/hex';
import { TERRAIN, type TerrainType } from '../../game/terrain';
import type { HexView } from '../../game/visibility';
import { HEX_SIZE, center, corner } from './geometry';

const S = HEX_SIZE;
const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);

/** Corner indices of the edge shared with the neighbour in direction i. */
export const EDGE: Array<[number, number]> = [
  [0, 1],
  [5, 0],
  [4, 5],
  [3, 4],
  [2, 3],
  [1, 2],
];

// ---------------------------------------------------------------- deterministic noise

export function h32(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- colour helpers

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const FOG_RGB: [number, number, number] = [16, 15, 22];

/** Colour transform for a hex: brightness tweak (relief) and fog dimming for remembered hexes. */
export type Tone = (hex: string, alpha?: number, lift?: number) => string;

/**
 * Scene colour scheme (gradient map): set by TerrainCanvas while a chunk is painted. Applied before the
 * fog dimming, so remembered hexes keep their grey look whatever the palette.
 */
let RECOLOR: ((rgb: [number, number, number]) => [number, number, number]) | null = null;
export function withRecolor<T>(fn: typeof RECOLOR, paint: () => T): T {
  const prev = RECOLOR;
  RECOLOR = fn;
  try { return paint(); } finally { RECOLOR = prev; }
}

export function makeTone(dim: number): Tone {
  return (hex, alpha = 1, lift = 0) => {
    let [r, g, b] = RECOLOR ? RECOLOR(parse(hex)) : parse(hex);
    if (lift) {
      const t = Math.max(-1, Math.min(1, lift));
      const target = t > 0 ? 255 : 0;
      r += (target - r) * Math.abs(t);
      g += (target - g) * Math.abs(t);
      b += (target - b) * Math.abs(t);
    }
    if (dim > 0) {
      const grey = (r + g + b) / 3;
      r = (r * 0.5 + grey * 0.5) * (1 - dim) + FOG_RGB[0] * dim;
      g = (g * 0.5 + grey * 0.5) * (1 - dim) + FOG_RGB[1] * dim;
      b = (b * 0.5 + grey * 0.5) * (1 - dim) + FOG_RGB[2] * dim;
    }
    return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
  };
}

// ---------------------------------------------------------------- geometry helpers

export function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const p = corner(cx, cy, size, i);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

const edgeMid = (cx: number, cy: number, dir: number) => {
  const [a, b] = EDGE[dir];
  const p = corner(cx, cy, S, a);
  const q = corner(cx, cy, S, b);
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
};

// ---------------------------------------------------------------- context

export interface PaintEnv {
  /** Known neighbour lookup (undefined = unknown or outside). */
  get: (key: string) => HexView | undefined;
  /** Players: draw fog wisps towards unknown neighbours. */
  fogUnknown: boolean;
  /** GM "party vision" overlay: fog per hex overriding the view. */
  overlayFog?: Record<string, 'unexplored' | 'explored' | 'visible'> | null;
}

const GROUND: Partial<Record<TerrainType, { a: string; b: string; c: string }>> = {
  road: { a: '#a7b265', b: '#7b8a45', c: '#55612d' }, // roads lie on grassland
  river: { a: '#9aab5c', b: '#6f8240', c: '#4b5a2a' },
  ruins: { a: '#b7a37f', b: '#8b7458', c: '#5d4b37' },
};

function dimOf(h: HexView, env: PaintEnv): number {
  const fog = env.overlayFog ? env.overlayFog[h.key] : h.fog;
  if (fog === 'explored') return 0.5;
  if (fog === 'unexplored') return 0.78;
  return 0;
}

// ---------------------------------------------------------------- passes

/** Pass 1: painted ground with relief gradient and per-hex variation. */
export function paintGround(ctx: CanvasRenderingContext2D, h: HexView, env: PaintEnv) {
  if (!h.terrain) return;
  const { x, y } = center(h);
  const tone = makeTone(dimOf(h, env));
  const def = TERRAIN[h.terrain];
  const elev = h.elevation ?? 0.5;
  const v = h32(h.q, h.r, 7) - 0.5;
  const lift = (elev - 0.5) * 0.18 + v * 0.06;
  let pal = GROUND[h.terrain] ?? { a: def.light, b: def.fill, c: def.stroke };
  if (h.feature) pal = { a: '#f3ecdc', b: '#d6ccb7', c: '#a99c80' };

  const g = ctx.createLinearGradient(x - S * 0.7, y - S, x + S * 0.6, y + S);
  g.addColorStop(0, tone(pal.a, 1, lift));
  g.addColorStop(0.55, tone(pal.b, 1, lift));
  g.addColorStop(1, tone(pal.c, 1, lift * 0.5));
  hexPath(ctx, x, y, S + 0.6); // slight overlap avoids hairline seams
  ctx.fillStyle = g;
  ctx.fill();

  if (h.terrain === 'water') {
    const rg = ctx.createRadialGradient(x, y, S * 0.1, x, y, S);
    rg.addColorStop(0, tone('#0f2c42', 0.85));
    rg.addColorStop(1, tone('#0f2c42', 0));
    ctx.fillStyle = rg;
    hexPath(ctx, x, y, S);
    ctx.fill();
  }
}

/** Pass 2: soft transitions towards differing neighbours, fog wisps towards unknown land. */
export function paintEdges(ctx: CanvasRenderingContext2D, h: HexView, env: PaintEnv) {
  if (!h.terrain) return;
  const { x, y } = center(h);
  const tone = makeTone(dimOf(h, env));
  for (let i = 0; i < 6; i++) {
    const outside = ((h.edges ?? 0) >> i) & 1;
    if (outside) continue;
    const nk = hexKey(add(h, DIRECTIONS[i]));
    const n = env.get(nk);
    const [a, b] = EDGE[i];
    const p = corner(x, y, S, a);
    const q = corner(x, y, S, b);
    const m = edgeMid(x, y, i);
    if (!n) {
      if (!env.fogUnknown) continue;
      // Unknown neighbour: a dark mist creeping in from the edge.
      const depth = 0.62;
      const g = ctx.createLinearGradient(m.x, m.y, m.x + (x - m.x) * depth, m.y + (y - m.y) * depth);
      g.addColorStop(0, 'rgba(9,8,13,0.92)');
      g.addColorStop(1, 'rgba(9,8,13,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.lineTo(q.x + (x - q.x) * depth, q.y + (y - q.y) * depth);
      ctx.lineTo(p.x + (x - p.x) * depth, p.y + (y - p.y) * depth);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    if (!n.terrain || n.terrain === h.terrain || !!n.feature !== !!h.feature) continue;
    if (n.terrain === 'road' || h.terrain === 'road' || n.terrain === 'river') continue; // ribbons handle these
    const nd = TERRAIN[n.terrain];
    const depth = 0.42;
    const g = ctx.createLinearGradient(m.x, m.y, m.x + (x - m.x) * depth, m.y + (y - m.y) * depth);
    g.addColorStop(0, tone(n.feature ? '#d6ccb7' : nd.fill, 0.5));
    g.addColorStop(1, tone(nd.fill, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.lineTo(q.x + (x - q.x) * depth, q.y + (y - q.y) * depth);
    ctx.lineTo(p.x + (x - p.x) * depth, p.y + (y - p.y) * depth);
    ctx.closePath();
    ctx.fill();
  }
}

/** Pass 3: flat decorations that must stay below sprites (rivers, roads, mosaics, labyrinth walls). */
export function paintDetails(ctx: CanvasRenderingContext2D, h: HexView, env: PaintEnv) {
  if (!h.terrain) return;
  const { x, y } = center(h);
  const tone = makeTone(dimOf(h, env));

  if (h.feature === 'labyrinth' || h.feature === 'plaza' || h.feature === 'eagle') {
    paintLabyrinthFloor(ctx, h, tone);
  } else if (h.terrain === 'river') {
    paintRibbon(ctx, h, env, tone, (n) => n.terrain === 'river' || n.terrain === 'water', S * 0.5, '#2f6f8f', '#5fa3c4', '#3d5a31', true);
  } else if (h.terrain === 'road') {
    paintRibbon(ctx, h, env, tone, (n) => n.terrain === 'road' || !!n.feature, S * 0.34, '#cdb586', '#e6d3a6', '#6f5a33', false);
  } else if (h.terrain === 'water') {
    // reflections & shore foam
    ctx.strokeStyle = tone('#bfe0f0', 0.28);
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const ox = (h32(h.q, h.r, 20 + i) - 0.5) * S * 1.1;
      const oy = (h32(h.q, h.r, 30 + i) - 0.5) * S * 1.1;
      ctx.beginPath();
      ctx.moveTo(x + ox - 5, y + oy);
      ctx.quadraticCurveTo(x + ox, y + oy - 2, x + ox + 5, y + oy);
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      if (((h.edges ?? 0) >> i) & 1) continue;
      const n = env.get(hexKey(add(h, DIRECTIONS[i])));
      if (!n || !n.terrain || n.terrain === 'water' || n.terrain === 'river') continue;
      const [a, b] = EDGE[i];
      const p = corner(x, y, S - 2.5, a);
      const q = corner(x, y, S - 2.5, b);
      ctx.strokeStyle = tone('#dff1f7', 0.35);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
  } else if (h.terrain === 'magic') {
    ctx.strokeStyle = tone('#c9a6ff', 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y + 3, S * 0.55, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(x, y + 3, S * 0.42, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (h.terrain === 'plains') {
    for (let i = 0; i < 4; i++) {
      const ox = (h32(h.q, h.r, 40 + i) - 0.5) * S * 1.2;
      const oy = (h32(h.q, h.r, 50 + i) - 0.5) * S * 1.1;
      ctx.strokeStyle = tone('#55612d', 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + ox - 2, y + oy + 2);
      ctx.lineTo(x + ox - 1, y + oy - 2);
      ctx.moveTo(x + ox, y + oy + 2);
      ctx.lineTo(x + ox + 0.5, y + oy - 3);
      ctx.moveTo(x + ox + 2, y + oy + 2);
      ctx.lineTo(x + ox + 2.5, y + oy - 1.5);
      ctx.stroke();
    }
    if (h32(h.q, h.r, 60) < 0.3) {
      ctx.fillStyle = tone(h32(h.q, h.r, 61) < 0.5 ? '#e9c46a' : '#d65a5a', 0.8);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x + (h32(h.q, h.r, 62 + i) - 0.5) * S, y + (h32(h.q, h.r, 65 + i) - 0.5) * S, 1.2, 0, TAU);
        ctx.fill();
      }
    }
  } else if (h.terrain === 'ruins') {
    // cracked paving
    ctx.strokeStyle = tone('#4a3b2c', 0.35);
    ctx.lineWidth = 0.8;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x - S * 0.6, y + i * 9);
      ctx.lineTo(x + S * 0.6, y + i * 9 + 2);
      ctx.stroke();
    }
  }

  // Hex grid line – subtle but readable for tactical play.
  hexPath(ctx, x, y, S);
  ctx.strokeStyle = h.feature ? 'rgba(80,64,30,0.25)' : 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
}

function paintRibbon(
  ctx: CanvasRenderingContext2D,
  h: HexView,
  env: PaintEnv,
  tone: ReturnType<typeof makeTone>,
  connects: (n: HexView) => boolean,
  width: number,
  color: string,
  shine: string,
  bank: string,
  water: boolean,
) {
  const { x, y } = center(h);
  const dirs: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (((h.edges ?? 0) >> i) & 1) {
      if (water) dirs.push(i); // rivers flow out of the arena
      continue;
    }
    const n = env.get(hexKey(add(h, DIRECTIONS[i])));
    if (n && n.terrain && connects(n)) dirs.push(i);
  }
  if (dirs.length === 0) dirs.push(h32(h.q, h.r, 3) < 0.5 ? 0 : 3);
  if (dirs.length === 1) dirs.push((dirs[0] + 3) % 6);
  const strokes = (w: number, style: string, dash?: number[]) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.setLineDash(dash ?? []);
    for (const d of dirs) {
      const m = edgeMid(x, y, d);
      const bend = (h32(h.q, h.r, d) - 0.5) * S * 0.35;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo((x + m.x) / 2 + bend, (y + m.y) / 2 - bend, m.x, m.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  };
  strokes(width + 4, tone(bank, water ? 0.55 : 0.45));
  strokes(width, tone(color));
  if (water) strokes(width * 0.35, tone(shine, 0.6));
  else strokes(width * 0.55, tone('#8e7647', 0.55), [2.5, 3.5]);
  ctx.fillStyle = tone(color);
  ctx.beginPath();
  ctx.arc(x, y, width / 2, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------- labyrinth & mosaic

function paintLabyrinthFloor(ctx: CanvasRenderingContext2D, h: HexView, tone: ReturnType<typeof makeTone>) {
  const { x, y } = center(h);
  ctx.save();
  hexPath(ctx, x, y, S + 0.6);
  ctx.clip();
  // marble veins
  ctx.strokeStyle = tone('#b9ad94', 0.35);
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 2; i++) {
    const a = h32(h.q, h.r, 90 + i) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(a) * S, y - Math.sin(a) * S);
    ctx.bezierCurveTo(x, y + (i ? 8 : -8), x + 4, y, x + Math.cos(a) * S, y + Math.sin(a) * S);
    ctx.stroke();
  }
  // Concentric labyrinth walls centred on the arena origin → seamless across hexes.
  const ringStep = S * SQRT3 * 0.5;
  const dist = Math.hypot(x, y);
  const k0 = Math.max(1, Math.floor((dist - S) / ringStep));
  const k1 = Math.ceil((dist + S) / ringStep);
  const buckets = (k: number) => 8 + k * 4;
  const isFloor = h.feature === 'plaza' || h.feature === 'eagle';
  const ang = Math.atan2(y, x);
  const halfW = dist > S ? Math.asin(Math.min(1, (S * 1.25) / dist)) : Math.PI;
  for (let k = k0; k <= k1; k++) {
    const R = k * ringStep;
    if (isFloor) {
      if (k > 2) continue;
      // mosaic rings of the eagle's dais
      ctx.strokeStyle = tone(k === 1 ? '#c9973c' : '#3c3226', 0.85);
      ctx.lineWidth = k === 1 ? 2.5 : 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, R + (k === 2 ? 8 : 0), 0, TAU);
      ctx.stroke();
      continue;
    }
    if (k < 3) continue;
    const n = buckets(k);
    for (let b = 0; b < n; b++) {
      const a0 = (b / n) * TAU;
      const a1 = ((b + 1) / n) * TAU;
      const mid = (a0 + a1) / 2;
      const d = Math.abs(((mid - ang + Math.PI * 3) % TAU) - Math.PI);
      if (d > halfW + TAU / n) continue;
      if (h32(k, b, 5) >= 0.2) wall(ctx, tone, () => ctx.arc(0, 0, R, a0, a1));
      // radial connectors
      if (h32(k, b, 9) < 0.22) {
        wall(ctx, tone, () => {
          ctx.moveTo(Math.cos(a0) * R, Math.sin(a0) * R);
          ctx.lineTo(Math.cos(a0) * (R + ringStep), Math.sin(a0) * (R + ringStep));
        });
      }
    }
  }
  // gold inscription glyphs
  ctx.fillStyle = tone('#c9973c', 0.7);
  ctx.font = `${S * 0.28}px Cinzel, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (h.feature === 'labyrinth' && h32(h.q, h.r, 77) < 0.45) {
    const glyphs = 'ΑΩΨΦΣΞ✦ⅤⅩ';
    ctx.fillText(glyphs[Math.floor(h32(h.q, h.r, 78) * glyphs.length)], x + (h32(h.q, h.r, 79) - 0.5) * S * 0.6, y + (h32(h.q, h.r, 80) - 0.5) * S * 0.6);
  }
  ctx.restore();
}

function wall(ctx: CanvasRenderingContext2D, tone: ReturnType<typeof makeTone>, path: () => void) {
  ctx.lineCap = 'butt';
  ctx.beginPath();
  path();
  ctx.strokeStyle = tone('#000000', 0.25);
  ctx.lineWidth = 6;
  ctx.translate(1.5, 2.5);
  ctx.stroke();
  ctx.translate(-1.5, -2.5);
  ctx.beginPath();
  path();
  ctx.strokeStyle = tone('#8d826b');
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.beginPath();
  path();
  ctx.strokeStyle = tone('#f2ead8');
  ctx.lineWidth = 2;
  ctx.translate(-0.6, -0.8);
  ctx.stroke();
  ctx.translate(0.6, 0.8);
}

// ---------------------------------------------------------------- sprites (pass 4, painter's order)

export function paintSprites(ctx: CanvasRenderingContext2D, h: HexView, env: PaintEnv) {
  if (!h.terrain) return;
  const { x, y } = center(h);
  const tone = makeTone(dimOf(h, env));
  if (h.feature === 'eagle') return paintEagle(ctx, x, y, tone);
  if (h.feature) return;
  switch (h.terrain) {
    case 'forest': {
      const spots: Array<[number, number]> = [
        [-0.42, -0.2],
        [0.36, -0.32],
        [-0.02, 0.0],
        [-0.36, 0.38],
        [0.38, 0.3],
        [0.02, 0.55],
      ];
      const conifer = h32(h.q, h.r, 1) < 0.55;
      spots
        .map(([ox, oy], i) => ({ ox: ox + (h32(h.q, h.r, i) - 0.5) * 0.18, oy: oy + (h32(h.q, h.r, i + 9) - 0.5) * 0.12, i }))
        .sort((a, b) => a.oy - b.oy)
        .forEach(({ ox, oy, i }) => tree(ctx, x + ox * S, y + oy * S, S * (0.27 + h32(h.q, h.r, i + 3) * 0.1), conifer !== i % 3 > 0, tone));
      return;
    }
    case 'mountain':
      return mountain(ctx, x, y, h, tone);
    case 'hills':
      return hills(ctx, x, y, h, tone);
    case 'ruins':
      return ruins(ctx, x, y, h, tone);
    case 'magic':
      return crystals(ctx, x, y, h, tone);
    default:
      return;
  }
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.28) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 1, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, conifer: boolean, tone: Tone) {
  shadow(ctx, x + r * 0.3, y + r * 0.15, r * 0.9, r * 0.35);
  ctx.fillStyle = tone('#4a3420');
  ctx.fillRect(x - r * 0.1, y - r * 0.2, r * 0.2, r * 0.45);
  if (conifer) {
    for (let i = 0; i < 3; i++) {
      const w = r * (1 - i * 0.22);
      const top = y - r * (0.75 + i * 0.55);
      const base = y - r * (0.05 + i * 0.5);
      const g = ctx.createLinearGradient(x - w, top, x + w, base);
      g.addColorStop(0, tone('#5f9a52'));
      g.addColorStop(0.5, tone('#2f6234'));
      g.addColorStop(1, tone('#1b3a20'));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, top - r * 0.35);
      ctx.lineTo(x + w, base);
      ctx.quadraticCurveTo(x, base + r * 0.15, x - w, base);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    const blobs: Array<[number, number, number]> = [
      [-0.38, -0.55, 0.55],
      [0.36, -0.6, 0.55],
      [0, -0.95, 0.62],
    ];
    for (const [ox, oy, rr] of blobs) {
      const g = ctx.createRadialGradient(x + ox * r - rr * r * 0.35, y + oy * r - rr * r * 0.4, rr * r * 0.1, x + ox * r, y + oy * r, rr * r);
      g.addColorStop(0, tone('#7fb662'));
      g.addColorStop(0.6, tone('#3f7a3c'));
      g.addColorStop(1, tone('#22482a'));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + ox * r, y + oy * r, rr * r, 0, TAU);
      ctx.fill();
    }
  }
}

function mountain(ctx: CanvasRenderingContext2D, x: number, y: number, h: HexView, tone: Tone) {
  const elev = h.elevation ?? 0.7;
  const peaks = h32(h.q, h.r, 2) < 0.45 ? 2 : 1;
  shadow(ctx, x + 4, y + S * 0.42, S * 0.85, S * 0.22, 0.32);
  for (let p = 0; p < peaks; p++) {
    const px = x + (peaks === 2 ? (p ? 0.32 : -0.28) * S : (h32(h.q, h.r, 4) - 0.5) * S * 0.2);
    const scale = peaks === 2 ? (p ? 0.7 : 0.95) : 1.05;
    const base = y + S * (0.45 - p * 0.05);
    const top = base - S * (0.95 + elev * 0.5) * scale;
    const half = S * 0.72 * scale;
    const apexX = px + (h32(h.q, h.r, 5 + p) - 0.5) * S * 0.2;
    // lit west face
    ctx.fillStyle = tone('#b7b0a6');
    ctx.beginPath();
    ctx.moveTo(px - half, base);
    ctx.lineTo(apexX, top);
    ctx.lineTo(apexX + S * 0.05, base);
    ctx.closePath();
    ctx.fill();
    // shaded east face
    ctx.fillStyle = tone('#5c5651');
    ctx.beginPath();
    ctx.moveTo(apexX, top);
    ctx.lineTo(px + half, base);
    ctx.lineTo(apexX + S * 0.05, base);
    ctx.closePath();
    ctx.fill();
    // ridges
    ctx.strokeStyle = tone('#3d3834', 0.6);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(apexX, top);
    ctx.lineTo(apexX - half * 0.35, base - S * 0.25);
    ctx.moveTo(apexX + half * 0.2, top + S * 0.35);
    ctx.lineTo(apexX + half * 0.55, base - S * 0.08);
    ctx.stroke();
    if (elev > 0.55) {
      ctx.fillStyle = tone('#f4f1ea');
      ctx.beginPath();
      ctx.moveTo(apexX, top);
      ctx.lineTo(apexX - half * 0.3, top + (base - top) * 0.3);
      ctx.lineTo(apexX - half * 0.08, top + (base - top) * 0.24);
      ctx.lineTo(apexX + half * 0.06, top + (base - top) * 0.33);
      ctx.lineTo(apexX + half * 0.25, top + (base - top) * 0.27);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function hills(ctx: CanvasRenderingContext2D, x: number, y: number, h: HexView, tone: Tone) {
  const mounds: Array<[number, number, number]> = [
    [-0.25, 0.1, 0.55],
    [0.3, 0.32, 0.45],
  ];
  for (const [ox, oy, r] of mounds) {
    const cx = x + (ox + (h32(h.q, h.r, 11) - 0.5) * 0.15) * S;
    const cy = y + oy * S;
    const g = ctx.createLinearGradient(cx - r * S, cy - r * S, cx + r * S * 0.5, cy);
    g.addColorStop(0, tone('#c9bb7d'));
    g.addColorStop(0.6, tone('#8a7b4c'));
    g.addColorStop(1, tone('#5c5030'));
    shadow(ctx, cx + 3, cy + 1, r * S * 0.95, r * S * 0.25, 0.22);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * S, r * S * 0.62, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fill();
  }
}

function ruins(ctx: CanvasRenderingContext2D, x: number, y: number, h: HexView, tone: Tone) {
  const variant = Math.floor(h32(h.q, h.r, 12) * 3);
  shadow(ctx, x + 3, y + S * 0.35, S * 0.7, S * 0.16, 0.25);
  const column = (cx: number, base: number, height: number) => {
    const w = S * 0.16;
    const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, tone('#f1e8d6'));
    g.addColorStop(1, tone('#a8977a'));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, base);
    ctx.lineTo(cx - w / 2, base - height);
    ctx.lineTo(cx - w * 0.1, base - height - 3);
    ctx.lineTo(cx + w * 0.15, base - height + 1);
    ctx.lineTo(cx + w / 2, base - height - 2);
    ctx.lineTo(cx + w / 2, base);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = tone('#7a6a52', 0.6);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx, base);
    ctx.lineTo(cx, base - height + 2);
    ctx.stroke();
    ctx.fillStyle = tone('#d9ccb4');
    ctx.fillRect(cx - w * 0.7, base - 2.5, w * 1.4, 2.5);
  };
  if (variant === 0) {
    // broken arch
    ctx.strokeStyle = tone('#cbbb9c');
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y + S * 0.1, S * 0.36, Math.PI, Math.PI * 1.72);
    ctx.stroke();
    column(x - S * 0.36, y + S * 0.38, S * 0.3);
    column(x + S * 0.36, y + S * 0.38, S * 0.12);
  } else {
    column(x - S * 0.38, y + S * 0.3, S * (0.55 + h32(h.q, h.r, 13) * 0.2));
    column(x - S * 0.02, y + S * 0.4, S * 0.25);
    column(x + S * 0.34, y + S * 0.28, S * (0.45 + h32(h.q, h.r, 14) * 0.3));
    if (variant === 2) {
      ctx.fillStyle = tone('#e3d7bf');
      ctx.fillRect(x - S * 0.48, y - S * 0.35, S * 0.55, S * 0.1); // fallen architrave
    }
  }
  // rubble
  ctx.fillStyle = tone('#b3a283');
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + (h32(h.q, h.r, 15 + i) - 0.5) * S * 1.1, y + S * (0.38 + h32(h.q, h.r, 19 + i) * 0.12), 3.5, 2.5);
  }
}

function crystals(ctx: CanvasRenderingContext2D, x: number, y: number, h: HexView, tone: Tone) {
  const n = 3 + Math.floor(h32(h.q, h.r, 22) * 2);
  for (let i = 0; i < n; i++) {
    const cx = x + (h32(h.q, h.r, 23 + i) - 0.5) * S * 0.9;
    const base = y + (h32(h.q, h.r, 28 + i) - 0.2) * S * 0.6;
    const hgt = S * (0.35 + h32(h.q, h.r, 33 + i) * 0.4);
    const w = S * 0.11;
    shadow(ctx, cx + 2, base, w * 1.4, w * 0.5, 0.25);
    ctx.fillStyle = tone('#d9c4ff');
    ctx.beginPath();
    ctx.moveTo(cx - w, base);
    ctx.lineTo(cx - w * 0.8, base - hgt * 0.75);
    ctx.lineTo(cx, base - hgt);
    ctx.lineTo(cx, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = tone('#7b4fc4');
    ctx.beginPath();
    ctx.moveTo(cx, base);
    ctx.lineTo(cx, base - hgt);
    ctx.lineTo(cx + w * 0.8, base - hgt * 0.75);
    ctx.lineTo(cx + w, base);
    ctx.closePath();
    ctx.fill();
  }
}

/** The Aquila Aurea: an original stylised golden Roman eagle on a pedestal. */
function paintEagle(ctx: CanvasRenderingContext2D, x: number, y: number, tone: Tone) {
  const s = S;
  // pedestal
  shadow(ctx, x + 4, y + s * 0.5, s * 1.1, s * 0.3, 0.35);
  const ped = ctx.createLinearGradient(x - s * 0.6, 0, x + s * 0.6, 0);
  ped.addColorStop(0, tone('#f4eee0'));
  ped.addColorStop(1, tone('#a99c80'));
  ctx.fillStyle = ped;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.55, y + s * 0.5);
  ctx.lineTo(x - s * 0.42, y - s * 0.05);
  ctx.lineTo(x + s * 0.42, y - s * 0.05);
  ctx.lineTo(x + s * 0.55, y + s * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tone('#c9973c');
  ctx.fillRect(x - s * 0.5, y - s * 0.12, s, s * 0.1);
  // laurel wreath
  ctx.strokeStyle = tone('#d9b45a');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y + s * 0.2, s * 0.22, 0, TAU);
  ctx.stroke();

  const gold = ctx.createLinearGradient(x, y - s * 2.3, x, y);
  gold.addColorStop(0, tone('#fff1b8'));
  gold.addColorStop(0.45, tone('#e7bd57'));
  gold.addColorStop(1, tone('#9c6f22'));
  const outline = tone('#5a4214');
  const by = y - s * 0.15; // feet
  ctx.lineJoin = 'round';

  const wing = (dir: 1 | -1) => {
    ctx.beginPath();
    ctx.moveTo(x + dir * s * 0.12, by - s * 0.95);
    ctx.bezierCurveTo(x + dir * s * 0.5, by - s * 1.25, x + dir * s * 0.9, by - s * 1.6, x + dir * s * 1.35, by - s * 2.15);
    // feather tips (stepped)
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      ctx.lineTo(x + dir * s * (1.3 - t * 0.28), by - s * (1.85 - t * 0.55));
      ctx.lineTo(x + dir * s * (1.18 - t * 0.28), by - s * (1.8 - t * 0.5));
    }
    ctx.bezierCurveTo(x + dir * s * 0.75, by - s * 0.95, x + dir * s * 0.4, by - s * 0.65, x + dir * s * 0.14, by - s * 0.6);
    ctx.closePath();
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = tone('#8a6420', 0.7);
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + dir * s * (0.3 + i * 0.12), by - s * (0.85 + i * 0.05));
      ctx.lineTo(x + dir * s * (0.75 + i * 0.13), by - s * (1.35 + i * 0.12));
      ctx.stroke();
    }
  };
  wing(-1);
  wing(1);

  // body
  ctx.beginPath();
  ctx.moveTo(x - s * 0.2, by - s * 0.15);
  ctx.bezierCurveTo(x - s * 0.32, by - s * 0.7, x - s * 0.2, by - s * 1.15, x, by - s * 1.25);
  ctx.bezierCurveTo(x + s * 0.2, by - s * 1.15, x + s * 0.32, by - s * 0.7, x + s * 0.2, by - s * 0.15);
  ctx.lineTo(x + s * 0.28, by + s * 0.02); // tail
  ctx.lineTo(x, by - s * 0.05);
  ctx.lineTo(x - s * 0.28, by + s * 0.02);
  ctx.closePath();
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // chest feathers
  ctx.strokeStyle = tone('#8a6420', 0.6);
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x, by - s * (0.45 + i * 0.2), s * 0.12, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  // head facing left (classic aquila profile)
  ctx.beginPath();
  ctx.moveTo(x + s * 0.08, by - s * 1.18);
  ctx.bezierCurveTo(x + s * 0.1, by - s * 1.45, x - s * 0.1, by - s * 1.58, x - s * 0.22, by - s * 1.48);
  ctx.lineTo(x - s * 0.4, by - s * 1.4); // beak
  ctx.quadraticCurveTo(x - s * 0.33, by - s * 1.32, x - s * 0.22, by - s * 1.33);
  ctx.bezierCurveTo(x - s * 0.15, by - s * 1.22, x - s * 0.08, by - s * 1.15, x - s * 0.05, by - s * 1.1);
  ctx.closePath();
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = tone('#2a1d08');
  ctx.beginPath();
  ctx.arc(x - s * 0.17, by - s * 1.42, 1.3, 0, TAU);
  ctx.fill();
  // talons on a golden orb
  const orb = ctx.createRadialGradient(x - 3, by - 3, 1, x, by, s * 0.16);
  orb.addColorStop(0, tone('#fff1b8'));
  orb.addColorStop(1, tone('#a67a26'));
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(x, by + s * 0.02, s * 0.15, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 0.9;
  ctx.stroke();
}

// ---------------------------------------------------------------- overlays (pass 5)

export function paintOverlays(ctx: CanvasRenderingContext2D, h: HexView, env: PaintEnv) {
  const { x, y } = center(h);
  if (h.zone !== 'safe') {
    hexPath(ctx, x, y, S);
    if (h.zone === 'warning') {
      ctx.fillStyle = 'rgba(234,179,8,0.12)';
      ctx.fill();
    } else {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = h.zone === 'closed' ? 'rgba(60,8,10,0.55)' : 'rgba(229,72,77,0.16)';
      ctx.fillRect(x - S, y - S, S * 2, S * 2);
      ctx.strokeStyle = h.zone === 'closed' ? 'rgba(229,72,77,0.6)' : 'rgba(229,72,77,0.45)';
      ctx.lineWidth = 2;
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 8 - S, y - S);
        ctx.lineTo(x + i * 8 + S, y + S);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  // The arena wall: only along edges known to lead outside.
  const edges = h.edges ?? 0;
  if (edges) {
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      if (!((edges >> i) & 1)) continue;
      const [a, b] = EDGE[i];
      const p = corner(x, y, S, a);
      const q = corner(x, y, S, b);
      const line = (w: number, c: string) => {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      };
      line(9, 'rgba(0,0,0,0.55)');
      line(4, '#b8862f');
      line(1.4, '#f6dd94');
    }
  }
  void env;
}
