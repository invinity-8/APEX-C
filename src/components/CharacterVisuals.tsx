/**
 * Cosmetic character visuals shared by map markers, party cards, the character dashboard and the
 * appearance preview: marker shapes (primary colour + accent ring) and portraits.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  zoomable = false,
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
  /** APEX 0.7: click opens a large portrait viewer. */
  zoomable?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const [zoom, setZoom] = useState(false);
  const url = src ?? (online && portraitV && !broken ? `/api/apex?op=portrait&token=${encodeURIComponent(tokenId)}&v=${portraitV}` : null);
  const ring = accent ?? color;
  const img = url ? (
    <img
      src={url}
      alt={`Portrait of ${name}`}
      width={size}
      height={size}
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size, boxShadow: `0 0 0 2px ${ring}, 0 0 0 4px #15181b` }}
    />
  ) : null;
  if (img && zoomable)
    return (
      <>
        <button type="button" className="shrink-0 cursor-zoom-in rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-300" aria-label={`Enlarge the portrait of ${name}`} onClick={() => setZoom(true)} data-testid="portrait-zoom">
          {img}
        </button>
        {zoom && <PortraitViewer url={url!} name={name} onClose={() => setZoom(false)} />}
      </>
    );
  return img ? (
    img
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

/** Large portrait viewer: full image (no crop), closes with ✕, Escape or a click outside; focus returns to the trigger. */
function PortraitViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true); // capture: the viewer closes before other Escape handlers run
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  // Portal to <body>: an ancestor with a backdrop-filter / transform would otherwise trap `position: fixed`.
  return createPortal(
    <div className="apex-portrait-viewer fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={`Portrait of ${name}`} onClick={onClose} data-testid="portrait-viewer">
      <figure className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={`Portrait of ${name}`} className="max-h-[85vh] max-w-[92vw] rounded-xl border border-gold-600/60 object-contain shadow-2xl" />
        <figcaption className="mt-2 text-center font-display text-lg text-gold-200">{name}</figcaption>
        <button ref={closeRef} type="button" className="btn btn-ghost absolute -top-3 -right-3 h-9 w-9 rounded-full bg-ink-900 px-0" aria-label="Close portrait" onClick={onClose}>
          ✕
        </button>
      </figure>
    </div>,
    document.body,
  );
}
