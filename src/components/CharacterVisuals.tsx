/**
 * Cosmetic character visuals shared by map markers, party cards, the character dashboard and the
 * appearance preview: marker shapes (primary colour + accent ring) and portraits.
 */
import { useState } from 'react';
import type { MarkerStyle } from '../game/types';

export const MARKER_LABEL: Record<MarkerStyle, string> = { medallion: 'Medallion', gem: 'Gem', hexagon: 'Hexagon', crest: 'Crest' };

export function markerPath(style: MarkerStyle, r: number): string | null {
  switch (style) {
    case 'gem':
      return `M0,${-r * 1.12} L${r * 1.0},0 L0,${r * 1.12} L${-r * 1.0},0 Z`;
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${(Math.cos(a) * r * 1.06).toFixed(2)},${(Math.sin(a) * r * 1.06).toFixed(2)}`;
      });
      return `M${pts.join(' L')} Z`;
    }
    case 'crest':
      return `M${-r * 0.92},${-r * 0.95} L${r * 0.92},${-r * 0.95} L${r * 0.92},${r * 0.15} Q${r * 0.9},${r * 0.8} 0,${r * 1.12} Q${-r * 0.9},${r * 0.8} ${-r * 0.92},${r * 0.15} Z`;
    default:
      return null; // medallion = circle
  }
}

/** SVG marker body (centred on 0,0). */
export function MarkerShape({ style = 'medallion', r, color, accent, highlight, filter }: { style?: MarkerStyle; r: number; color: string; accent?: string; highlight?: boolean; filter?: string }) {
  const stroke = highlight ? '#e8d4a6' : (accent ?? '#15181b');
  const sw = highlight ? 2.4 : accent ? 2 : 1.6;
  const d = markerPath(style, r);
  return d ? <path d={d} fill={color} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" filter={filter} /> : <circle r={r} fill={color} stroke={stroke} strokeWidth={sw} filter={filter} />;
}

/** Standalone marker preview (appearance editor, cards). */
export function MarkerPreview({ style, color, accent, initials, size = 48 }: { style?: MarkerStyle; color: string; accent?: string; initials: string; size?: number }) {
  const r = size * 0.36;
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden="true">
      <MarkerShape style={style} r={r} color={color} accent={accent} />
      <text y={r * 0.36} textAnchor="middle" fontSize={r * 0.95} fontWeight={700} fill="#14110d" fontFamily="Inter, sans-serif">
        {initials}
      </text>
    </svg>
  );
}

/** Portrait (private, served via a signed redirect) with a styled fallback. */
export function CharacterPortrait({
  tokenId,
  portraitV,
  online,
  color,
  accent,
  initials,
  name,
  size = 56,
  src,
}: {
  tokenId: string;
  portraitV?: number;
  online: boolean;
  color: string;
  accent?: string;
  initials: string;
  name: string;
  size?: number;
  /** Explicit image (e.g. unsaved crop preview). */
  src?: string;
}) {
  const [broken, setBroken] = useState(false);
  const url = src ?? (online && portraitV && !broken ? `/api/apex?op=portrait&token=${encodeURIComponent(tokenId)}&v=${portraitV}` : null);
  const ring = accent ?? color;
  return url ? (
    <img
      src={url}
      alt={`Portrait of ${name}`}
      width={size}
      height={size}
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size, boxShadow: `0 0 0 2px ${ring}, 0 0 0 4px #15181b` }}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-display font-black"
      style={{ width: size, height: size, background: color, color: '#14110d', fontSize: size * 0.36, boxShadow: `0 0 0 2px ${ring}, 0 0 0 4px #15181b` }}
      aria-label={name}
    >
      {initials}
    </span>
  );
}
