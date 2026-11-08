/**
 * Generic tile painter for the scene tile library (src/campaign/hexScene.ts → TileDef.style).
 * One drawing routine per style, at two scales:
 *   battle – one hex is 5 ft: a single crate, a door, a pillar …
 *   region – one hex is 3 miles: many small trees, roofs of a village, a mountain range …
 * Colours come from the tile (fill/accent) and go through `tone`, so the scene colour scheme and the
 * grey "remembered" fog apply exactly as for the Arena painter.
 */
import type { TileDef } from '../../campaign/hexScene';
import type { HexView } from '../../game/visibility';
import { HEX_SIZE, center } from './geometry';
import { h32, hexPath, type Tone } from './painter';

const S = HEX_SIZE;
const TAU = Math.PI * 2;
type Ctx = CanvasRenderingContext2D;
type Scale = 'battle' | 'region';

const rnd = (h: HexView, i: number) => h32(h.q, h.r, 1000 + i);
const circle = (ctx: Ctx, x: number, y: number, r: number, fill: string) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
const shadow = (ctx: Ctx, x: number, y: number, rx: number, ry: number, tone: Tone) => { ctx.fillStyle = tone('#10100c', 0.35); ctx.beginPath(); ctx.ellipse(x + rx * 0.25, y + ry * 0.35, rx, ry, 0, 0, TAU); ctx.fill(); };

/** Base fill with a gentle gradient; every tile starts here. */
export function paintTileGround(ctx: Ctx, h: HexView, def: TileDef, tone: Tone) {
  const { x, y } = center(h);
  const v = (rnd(h, 1) - 0.5) * 0.08;
  const g = ctx.createLinearGradient(x - S, y - S, x + S, y + S);
  g.addColorStop(0, tone(def.fill, 1, 0.08 + v));
  g.addColorStop(1, tone(def.fill, 1, -0.1 + v));
  hexPath(ctx, x, y, S + 0.6);
  ctx.fillStyle = g;
  ctx.fill();
}

function tree(ctx: Ctx, x: number, y: number, r: number, fill: string, tone: Tone) {
  shadow(ctx, x, y, r, r * 0.8, tone);
  circle(ctx, x, y, r, tone(fill));
  circle(ctx, x - r * 0.3, y - r * 0.3, r * 0.55, tone(fill, 1, 0.18));
}
function conifer(ctx: Ctx, x: number, y: number, r: number, fill: string, tone: Tone) {
  shadow(ctx, x, y + r * 0.3, r * 0.7, r * 0.4, tone);
  ctx.fillStyle = tone(fill);
  ctx.beginPath(); ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 0.75, y + r * 0.6); ctx.lineTo(x - r * 0.75, y + r * 0.6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = tone(fill, 1, 0.15);
  ctx.beginPath(); ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x - r * 0.75, y + r * 0.6); ctx.lineTo(x - r * 0.1, y + r * 0.5); ctx.closePath(); ctx.fill();
}
function peak(ctx: Ctx, x: number, y: number, w: number, hgt: number, fill: string, cap: string | null, tone: Tone) {
  ctx.fillStyle = tone(fill, 1, -0.1);
  ctx.beginPath(); ctx.moveTo(x - w, y + hgt * 0.4); ctx.lineTo(x, y - hgt); ctx.lineTo(x + w, y + hgt * 0.4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = tone(fill, 1, 0.15);
  ctx.beginPath(); ctx.moveTo(x - w, y + hgt * 0.4); ctx.lineTo(x, y - hgt); ctx.lineTo(x - w * 0.15, y + hgt * 0.4); ctx.closePath(); ctx.fill();
  if (cap) { ctx.fillStyle = tone(cap); ctx.beginPath(); ctx.moveTo(x - w * 0.32, y - hgt * 0.45); ctx.lineTo(x, y - hgt); ctx.lineTo(x + w * 0.32, y - hgt * 0.45); ctx.closePath(); ctx.fill(); }
}
function house(ctx: Ctx, x: number, y: number, w: number, roof: string, tone: Tone) {
  shadow(ctx, x, y, w * 0.8, w * 0.5, tone);
  ctx.fillStyle = tone('#d8c8a0'); ctx.fillRect(x - w / 2, y - w * 0.25, w, w * 0.6);
  ctx.fillStyle = tone(roof); ctx.beginPath(); ctx.moveTo(x - w * 0.62, y - w * 0.2); ctx.lineTo(x, y - w * 0.75); ctx.lineTo(x + w * 0.62, y - w * 0.2); ctx.closePath(); ctx.fill();
}
function rock(ctx: Ctx, x: number, y: number, r: number, fill: string, tone: Tone, seed: number) {
  shadow(ctx, x, y, r, r * 0.75, tone);
  ctx.beginPath();
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU, rr = r * (0.75 + h32(seed, i) * 0.35); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.85; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
  ctx.closePath();
  const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  g.addColorStop(0, tone(fill, 1, 0.3)); g.addColorStop(1, tone(fill, 1, -0.2));
  ctx.fillStyle = g; ctx.fill();
}
function glow(ctx: Ctx, x: number, y: number, r: number, color: string, tone: Tone) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, tone(color, 0.85)); g.addColorStop(1, tone(color, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

/** Details inside the hex (clipped). */
export function paintTileDetails(ctx: Ctx, h: HexView, def: TileDef, tone: Tone, _scale: Scale) {
  const { x, y } = center(h);
  const acc = def.accent ?? def.fill;
  ctx.save();
  hexPath(ctx, x, y, S);
  ctx.clip();
  ctx.lineCap = 'round';
  switch (def.style) {
    case 'grass': case 'heath': case 'tallgrass': case 'savanna': {
      ctx.strokeStyle = tone(acc, 0.6); ctx.lineWidth = def.style === 'tallgrass' ? 1.4 : 1;
      const count = def.style === 'tallgrass' ? 14 : 8, len = def.style === 'tallgrass' ? 8 : 4;
      for (let i = 0; i < count; i++) { const px = x + (rnd(h, 10 + i) - 0.5) * S * 1.6, py = y + (rnd(h, 30 + i) - 0.5) * S * 1.6; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 1.5, py - len); ctx.moveTo(px, py); ctx.lineTo(px + 2, py - len); ctx.stroke(); }
      if (def.style === 'heath') for (let i = 0; i < 6; i++) circle(ctx, x + (rnd(h, 50 + i) - 0.5) * S * 1.4, y + (rnd(h, 60 + i) - 0.5) * S * 1.4, 2, tone(acc, 0.7));
      break;
    }
    case 'dots': case 'mud':
      for (let i = 0; i < 14; i++) circle(ctx, x + (rnd(h, 70 + i) - 0.5) * S * 1.6, y + (rnd(h, 90 + i) - 0.5) * S * 1.6, def.style === 'mud' ? 3 + rnd(h, i) * 4 : 0.8 + rnd(h, 110 + i) * 1.4, tone(acc, def.style === 'mud' ? 0.45 : 0.7));
      break;
    case 'dunes': case 'layers': case 'waves': {
      ctx.strokeStyle = tone(acc, def.style === 'waves' ? 0.5 : 0.7); ctx.lineWidth = def.style === 'layers' ? 2.2 : 1.5;
      for (let i = -3; i <= 3; i++) {
        const yy = y + i * 8 + (rnd(h, 120 + i) - 0.5) * 3;
        ctx.beginPath();
        for (let k = -S; k <= S; k += 4) { const wy = yy + Math.sin((k + x) / (def.style === 'layers' ? 18 : 7)) * (def.style === 'layers' ? 1.5 : 2.5); if (k === -S) ctx.moveTo(x + k, wy); else ctx.lineTo(x + k, wy); }
        ctx.stroke();
      }
      break;
    }
    case 'cracks': case 'ice': case 'lava': {
      if (def.style === 'lava') { glow(ctx, x, y, S, '#ffb04a', tone); }
      ctx.strokeStyle = def.style === 'lava' ? tone('#ffde7a', 0.95) : tone(acc, 0.8); ctx.lineWidth = def.style === 'lava' ? 2 : 1.2;
      for (let i = 0; i < 4; i++) { let px = x + (rnd(h, 130 + i) - 0.5) * S, py = y + (rnd(h, 140 + i) - 0.5) * S; ctx.beginPath(); ctx.moveTo(px, py); for (let k = 0; k < 4; k++) { px += (rnd(h, 150 + i * 5 + k) - 0.5) * 16; py += (rnd(h, 170 + i * 5 + k) - 0.5) * 16; ctx.lineTo(px, py); } ctx.stroke(); }
      if (def.style === 'ice') circle(ctx, x - S * 0.3, y - S * 0.3, S * 0.3, tone('#ffffff', 0.25));
      break;
    }
    case 'snow':
      for (let i = 0; i < 6; i++) circle(ctx, x + (rnd(h, 180 + i) - 0.5) * S * 1.4, y + (rnd(h, 190 + i) - 0.5) * S * 1.4, 3 + rnd(h, 200 + i) * 4, tone(acc, 0.35));
      break;
    case 'fields': {
      ctx.strokeStyle = tone(acc, 0.55); ctx.lineWidth = 1.2;
      const turn = rnd(h, 1) > 0.5;
      for (let i = -6; i <= 6; i++) { ctx.beginPath(); if (turn) { ctx.moveTo(x + i * 5, y - S); ctx.lineTo(x + i * 5, y + S); } else { ctx.moveTo(x - S, y + i * 5); ctx.lineTo(x + S, y + i * 5); } ctx.stroke(); }
      ctx.strokeStyle = tone('#5a4a2a', 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - S, y + (rnd(h, 2) - 0.5) * 10); ctx.lineTo(x + S, y + (rnd(h, 3) - 0.5) * 10); ctx.stroke();
      break;
    }
    case 'reeds': {
      for (let i = 0; i < 4; i++) circle(ctx, x + (rnd(h, 210 + i) - 0.5) * S, y + (rnd(h, 220 + i) - 0.5) * S, 5 + rnd(h, 230 + i) * 4, tone(acc, 0.7));
      ctx.strokeStyle = tone('#8a9a4a', 0.9); ctx.lineWidth = 1.2;
      for (let i = 0; i < 10; i++) { const px = x + (rnd(h, 240 + i) - 0.5) * S * 1.5, py = y + (rnd(h, 250 + i) - 0.5) * S * 1.5; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 1, py - 7); ctx.stroke(); }
      break;
    }
    case 'cobbles':
      for (let i = 0; i < 16; i++) { const px = x + ((i % 4) - 1.5) * 13 + (Math.floor(i / 4) % 2) * 6, py = y + (Math.floor(i / 4) - 1.5) * 12; ctx.fillStyle = tone(def.fill, 1, (rnd(h, 260 + i) - 0.5) * 0.25); ctx.strokeStyle = tone(acc, 0.9); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(px, py, 6, 5, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
      break;
    case 'marble': case 'carpet': {
      if (def.style === 'carpet') { ctx.strokeStyle = tone(acc, 0.9); ctx.lineWidth = 2; hexPath(ctx, x, y, S * 0.75); ctx.stroke(); hexPath(ctx, x, y, S * 0.45); ctx.stroke(); break; }
      ctx.strokeStyle = tone(acc, 0.8); ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(x - S, y + i * 12); ctx.lineTo(x + S, y + i * 12); ctx.moveTo(x + i * 12, y - S); ctx.lineTo(x + i * 12, y + S); ctx.stroke(); }
      ctx.strokeStyle = tone('#ffffff', 0.25); ctx.beginPath(); ctx.moveTo(x - S * 0.6, y - S * 0.2); ctx.lineTo(x + S * 0.3, y + S * 0.5); ctx.stroke();
      break;
    }
    case 'blight':
      for (let i = 0; i < 6; i++) circle(ctx, x + (rnd(h, 280 + i) - 0.5) * S * 1.4, y + (rnd(h, 290 + i) - 0.5) * S * 1.4, 3 + rnd(h, 300 + i) * 5, tone(acc, 0.45));
      break;
    case 'circle':
      glow(ctx, x, y, S * 0.9, acc, tone);
      ctx.strokeStyle = tone(acc, 0.95); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, S * 0.7, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, S * 0.45, 0, TAU); ctx.stroke();
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2, b = ((i + 2) / 5) * TAU - Math.PI / 2; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * S * 0.45, y + Math.sin(a) * S * 0.45); ctx.lineTo(x + Math.cos(b) * S * 0.45, y + Math.sin(b) * S * 0.45); ctx.stroke(); }
      break;
    case 'trap':
      ctx.fillStyle = tone(acc);
      for (let i = 0; i < 9; i++) { const px = x + ((i % 3) - 1) * 13, py = y + (Math.floor(i / 3) - 1) * 13; ctx.beginPath(); ctx.moveTo(px - 4, py + 4); ctx.lineTo(px, py - 6); ctx.lineTo(px + 4, py + 4); ctx.closePath(); ctx.fill(); }
      break;
    case 'web':
      ctx.strokeStyle = tone(acc, 0.75); ctx.lineWidth = 0.8;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * S, y + Math.sin(a) * S); ctx.stroke(); }
      for (let r = 6; r < S; r += 7) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
      break;
    case 'pit': {
      const g = ctx.createRadialGradient(x, y, 2, x, y, S);
      g.addColorStop(0, tone('#000000')); g.addColorStop(1, tone(acc));
      ctx.fillStyle = g; hexPath(ctx, x, y, S * 0.85); ctx.fill();
      break;
    }
    case 'rockwall':
      for (let i = 0; i < 5; i++) rock(ctx, x + (rnd(h, 310 + i) - 0.5) * S, y + (rnd(h, 320 + i) - 0.5) * S, S * 0.45, acc, tone, h.q * 13 + i);
      break;
    case 'stairs':
      ctx.strokeStyle = tone(acc, 0.9); ctx.lineWidth = 2;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(x - S * 0.7, y + i * 7); ctx.lineTo(x + S * 0.7, y + i * 7); ctx.stroke(); }
      break;
    case 'bridge':
      ctx.fillStyle = tone(acc); ctx.fillRect(x - S, y - S * 0.38, S * 2, S * 0.76);
      ctx.strokeStyle = tone('#3a2814', 0.8); ctx.lineWidth = 1;
      for (let i = -6; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(x + i * 5, y - S * 0.38); ctx.lineTo(x + i * 5, y + S * 0.38); ctx.stroke(); }
      break;
    case 'palisade':
      for (let i = -3; i <= 3; i++) { ctx.fillStyle = tone(i % 2 ? acc : def.fill); ctx.fillRect(x + i * 9 - 4.5, y - S, 9, S * 2); }
      break;
    case 'door':
      ctx.fillStyle = tone(def.fill); ctx.fillRect(x - S * 0.55, y - S * 0.8, S * 1.1, S * 1.6);
      ctx.strokeStyle = tone(acc); ctx.lineWidth = 1.5; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x + i * 9, y - S * 0.8); ctx.lineTo(x + i * 9, y + S * 0.8); ctx.stroke(); }
      circle(ctx, x + S * 0.35, y, 2.5, tone('#d8b860'));
      break;
    case 'oasis':
      circle(ctx, x, y, S * 0.45, tone(acc));
      break;
    case 'planks':
      break;
  }
  ctx.restore();
}

/** Raised objects that may overlap the hex edge (trees, roofs, peaks, props). */
export function paintTileSprites(ctx: Ctx, h: HexView, def: TileDef, tone: Tone, _scale: Scale) {
  const { x, y } = center(h);
  const acc = def.accent ?? def.fill;
  const many = (count: number, spread: number, fn: (px: number, py: number, i: number) => void) => {
    const pts = Array.from({ length: count }, (_, i) => ({ px: x + (rnd(h, 400 + i) - 0.5) * S * spread, py: y + (rnd(h, 420 + i) - 0.5) * S * spread, i })).sort((a, b) => a.py - b.py);
    for (const p of pts) fn(p.px, p.py, p.i);
  };
  switch (def.style) {
    case 'trees': many(5, 1.3, (px, py) => tree(ctx, px, py, 7, def.fill, tone)); break;
    case 'conifers': many(7, 1.4, (px, py) => conifer(ctx, px, py, 8, acc, tone)); break;
    case 'palms': many(7, 1.4, (px, py) => tree(ctx, px, py, 8, acc, tone)); break;
    case 'savanna': many(2, 1.2, (px, py) => tree(ctx, px, py, 6, '#6f7a3a', tone)); break;
    case 'deadwood': {
      ctx.strokeStyle = tone(acc); ctx.lineWidth = 1.6;
      many(6, 1.4, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py + 5); ctx.lineTo(px, py - 8); ctx.moveTo(px, py - 3); ctx.lineTo(px - 5, py - 8); ctx.moveTo(px, py - 1); ctx.lineTo(px + 5, py - 7); ctx.stroke(); });
      break;
    }
    case 'bush': for (let i = 0; i < 4; i++) tree(ctx, x + (rnd(h, 430 + i) - 0.5) * S * 0.8, y + (rnd(h, 440 + i) - 0.5) * S * 0.8, S * 0.38, def.fill, tone); break;
    case 'hedge': for (let i = -2; i <= 2; i++) tree(ctx, x + i * 11, y + (rnd(h, 450 + i) - 0.5) * 6, S * 0.42, def.fill, tone); break;
    case 'pine': conifer(ctx, x, y + 4, S * 0.85, def.fill, tone); break;
    case 'stump': rock(ctx, x, y, S * 0.4, acc, tone, 7); circle(ctx, x, y - 2, S * 0.28, tone('#c8a070')); break;
    case 'mushrooms': for (let i = 0; i < 6; i++) { const px = x + (rnd(h, 460 + i) - 0.5) * S * 1.3, py = y + (rnd(h, 470 + i) - 0.5) * S * 1.3; glow(ctx, px, py, 9, acc, tone); circle(ctx, px, py, 3.5, tone(acc)); } break;
    case 'peaks': many(3, 1, (px, py) => peak(ctx, px, py, 13, 20, def.fill, '#eef2f4', tone)); break;
    case 'cliffs': for (let i = -1; i <= 1; i++) peak(ctx, x + i * 15, y + (i % 2) * 4, 14, 14, def.fill, null, tone); break;
    case 'volcano': peak(ctx, x, y + 6, S * 0.85, S * 1.1, def.fill, null, tone); glow(ctx, x, y - S * 0.95, 14, acc, tone); break;
    case 'crystals': many(5, 1.2, (px, py) => { glow(ctx, px, py, 10, acc, tone); ctx.fillStyle = tone(def.fill, 1, 0.3); ctx.beginPath(); ctx.moveTo(px, py - 11); ctx.lineTo(px + 4, py); ctx.lineTo(px, py + 3); ctx.lineTo(px - 4, py); ctx.closePath(); ctx.fill(); }); break;
    case 'oasis': many(3, 1.1, (px, py) => tree(ctx, px, py, 6, '#3a7a3a', tone)); break;
    case 'houses': many(5, 1.2, (px, py) => house(ctx, px, py, 9, acc, tone)); break;
    case 'city': {
      ctx.strokeStyle = tone('#5a5048'); ctx.lineWidth = 2.5; hexPath(ctx, x, y, S * 0.82); ctx.stroke();
      many(9, 1.1, (px, py) => house(ctx, px, py, 7, acc, tone));
      break;
    }
    case 'castle': case 'tower': {
      const w = def.style === 'castle' ? S * 0.9 : S * 0.35;
      shadow(ctx, x, y + 6, w, w * 0.4, tone);
      ctx.fillStyle = tone(acc); ctx.fillRect(x - w / 2, y - S * 0.6, w, S * 0.9);
      ctx.fillStyle = tone(acc, 1, 0.2);
      for (let i = 0; i < (def.style === 'castle' ? 4 : 2); i++) ctx.fillRect(x - w / 2 + i * (w / (def.style === 'castle' ? 3.6 : 1.8)), y - S * 0.72, w / 7, S * 0.14);
      if (def.style === 'castle') { ctx.fillStyle = tone('#a0402a'); ctx.beginPath(); ctx.moveTo(x - 6, y - S * 0.6); ctx.lineTo(x, y - S * 1.05); ctx.lineTo(x + 6, y - S * 0.6); ctx.closePath(); ctx.fill(); }
      break;
    }
    case 'tents': many(4, 1.1, (px, py) => { shadow(ctx, px, py, 7, 4, tone); ctx.fillStyle = tone(acc); ctx.beginPath(); ctx.moveTo(px - 7, py + 4); ctx.lineTo(px, py - 7); ctx.lineTo(px + 7, py + 4); ctx.closePath(); ctx.fill(); }); glow(ctx, x, y, 8, '#ff9a3a', tone); break;
    case 'cave': rock(ctx, x, y, S * 0.7, '#77706a', tone, 3); ctx.fillStyle = tone(acc); ctx.beginPath(); ctx.ellipse(x, y + 4, S * 0.3, S * 0.22, 0, Math.PI, 0); ctx.fill(); break;
    case 'shrine': shadow(ctx, x, y, 10, 5, tone); ctx.fillStyle = tone('#d8d0c0'); ctx.fillRect(x - 8, y - 10, 16, 14); glow(ctx, x, y - 4, 12, acc, tone); break;
    case 'pillar': shadow(ctx, x, y, S * 0.5, S * 0.4, tone); circle(ctx, x, y, S * 0.5, tone(def.fill, 1, -0.1)); circle(ctx, x - 3, y - 3, S * 0.38, tone(acc)); break;
    case 'statue': shadow(ctx, x, y, S * 0.5, S * 0.35, tone); ctx.fillStyle = tone(def.fill, 1, -0.15); ctx.fillRect(x - S * 0.4, y - S * 0.1, S * 0.8, S * 0.45); circle(ctx, x, y - S * 0.3, S * 0.22, tone(acc)); circle(ctx, x, y - S * 0.05, S * 0.28, tone(acc, 1, -0.1)); break;
    case 'stalagmite': rock(ctx, x, y, S * 0.5, acc, tone, 9); circle(ctx, x - 2, y - 2, S * 0.18, tone(acc, 1, 0.35)); break;
    case 'fence': ctx.strokeStyle = tone(acc); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - S, y); ctx.lineTo(x + S, y); ctx.stroke(); for (let i = -2; i <= 2; i++) { ctx.fillStyle = tone(acc, 1, -0.1); ctx.fillRect(x + i * 12 - 2, y - 7, 4, 14); } break;
    case 'table': shadow(ctx, x, y, S * 0.7, S * 0.45, tone); ctx.fillStyle = tone(def.fill, 1, 0.1); ctx.fillRect(x - S * 0.65, y - S * 0.4, S * 1.3, S * 0.8); ctx.strokeStyle = tone(acc); ctx.lineWidth = 1; ctx.strokeRect(x - S * 0.65, y - S * 0.4, S * 1.3, S * 0.8); break;
    case 'crates': for (const [dx, dy] of [[-8, -6], [7, -4], [-2, 8]]) { shadow(ctx, x + dx, y + dy, 9, 6, tone); ctx.fillStyle = tone(acc); ctx.fillRect(x + dx - 8, y + dy - 8, 16, 16); ctx.strokeStyle = tone('#4a321c'); ctx.lineWidth = 1.4; ctx.strokeRect(x + dx - 8, y + dy - 8, 16, 16); ctx.beginPath(); ctx.moveTo(x + dx - 8, y + dy - 8); ctx.lineTo(x + dx + 8, y + dy + 8); ctx.stroke(); } break;
    case 'barrels': for (const [dx, dy] of [[-8, -5], [8, -5], [0, 9]]) { shadow(ctx, x + dx, y + dy, 8, 6, tone); circle(ctx, x + dx, y + dy, 8, tone(acc)); ctx.strokeStyle = tone('#2a1a0c'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x + dx, y + dy, 5.5, 0, TAU); ctx.stroke(); } break;
    case 'bed': shadow(ctx, x, y, S * 0.5, S * 0.7, tone); ctx.fillStyle = tone(def.fill); ctx.fillRect(x - S * 0.42, y - S * 0.7, S * 0.84, S * 1.4); ctx.fillStyle = tone(acc); ctx.fillRect(x - S * 0.36, y - S * 0.62, S * 0.72, S * 0.36); ctx.fillStyle = tone('#5a6a9a'); ctx.fillRect(x - S * 0.36, y - S * 0.15, S * 0.72, S * 0.8); break;
    case 'altar': shadow(ctx, x, y, S * 0.6, S * 0.4, tone); ctx.fillStyle = tone(def.fill, 1, 0.2); ctx.fillRect(x - S * 0.55, y - S * 0.3, S * 1.1, S * 0.6); glow(ctx, x, y, 12, acc, tone); break;
    case 'fire': case 'brazier': {
      if (def.style === 'brazier') { circle(ctx, x, y, S * 0.42, tone('#3a3632')); circle(ctx, x, y, S * 0.32, tone('#1a1816')); }
      else for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; circle(ctx, x + Math.cos(a) * 9, y + Math.sin(a) * 9, 4, tone('#77736c')); }
      glow(ctx, x, y, S * 0.9, acc, tone); circle(ctx, x, y, 6, tone('#ffe08a')); circle(ctx, x, y + 2, 4, tone('#ff7a2a'));
      break;
    }
  }
}

/** Generic three-pass paint for one hex (used by the battle and region chunk painters). */
export function paintGenericHex(ctx: Ctx, h: HexView, def: TileDef, tone: Tone, scale: Scale, pass: 'ground' | 'details' | 'sprites') {
  if (pass === 'ground') paintTileGround(ctx, h, def, tone);
  else if (pass === 'details') paintTileDetails(ctx, h, def, tone, scale);
  else paintTileSprites(ctx, h, def, tone, scale);
}
