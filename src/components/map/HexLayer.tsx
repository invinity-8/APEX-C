import { memo, useMemo } from 'react';
import { hexCorners, hexKey, neighbors, parseKey, type HexKey } from '../../game/hex';
import { stringHash } from '../../game/rng';
import { TERRAIN } from '../../game/terrain';
import type { Fog, HexView } from '../../game/visibility';
import { HEX_SIZE, boundaryPath, center, shade } from './geometry';

interface Props {
  hexes: HexView[];
  /** Zusätzliche Abdunklung (GM: "Gruppensicht einblenden"). */
  overlayFog?: Record<HexKey, Fog> | null;
}

/** Statische Kartenebene: Gelände, Nebel, Straßen, Zonen, Arenarand. Neu gezeichnet nur bei Änderungen. */
export const HexLayer = memo(function HexLayer({ hexes, overlayFog }: Props) {
  const byKey = useMemo(() => Object.fromEntries(hexes.map((h) => [h.key, h])), [hexes]);

  const roads = useMemo(() => {
    const segs: string[] = [];
    for (const h of hexes) {
      if (h.terrain !== 'road') continue;
      const c = center(h);
      for (const n of neighbors(h)) {
        const nk = hexKey(n);
        const nh = byKey[nk];
        if (!nh || nh.terrain === null) continue;
        // Straßen verbinden sich untereinander; Richtung Zentrum laufen sie ins Startgebiet aus.
        const towardCenter = Math.abs(n.q) + Math.abs(n.r) + Math.abs(n.q + n.r) < Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r);
        if (nh.terrain === 'road' ? nk > h.key : towardCenter && nh.terrain === 'plains') {
          const c2 = center(n);
          segs.push(`M${c.x.toFixed(1)},${c.y.toFixed(1)}L${c2.x.toFixed(1)},${c2.y.toFixed(1)}`);
        }
      }
    }
    return segs.join('');
  }, [hexes, byKey]);

  const border = useMemo(() => boundaryPath(Object.keys(byKey), (k) => k in byKey, parseKey), [byKey]);
  const safeEdge = useMemo(
    () => boundaryPath(Object.keys(byKey), (k) => byKey[k]?.zone === 'safe', parseKey),
    [byKey],
  );
  const anyUnsafe = hexes.some((h) => h.zone !== 'safe');

  return (
    <g>
      {/* Gelände */}
      {hexes.map((h) => {
        const c = center(h);
        const pts = hexCorners(c.x, c.y, HEX_SIZE);
        if (h.terrain === null) {
          return <polygon key={h.key} data-key={h.key} points={pts} fill="#16130f" stroke="#2c271f" strokeWidth={1} />;
        }
        const def = TERRAIN[h.terrain];
        return (
          <polygon
            key={h.key}
            data-key={h.key}
            points={pts}
            fill={shade(def.fill, h.key)}
            stroke={def.stroke}
            strokeOpacity={0.55}
            strokeWidth={1}
          />
        );
      })}

      {/* Straßen */}
      <path d={roads} stroke="#e6cf8f" strokeOpacity={0.55} strokeWidth={5} strokeLinecap="round" fill="none" pointerEvents="none" />
      <path d={roads} stroke="#5b4a2c" strokeWidth={1.2} strokeDasharray="3 5" fill="none" pointerEvents="none" />

      {/* Geländesymbole */}
      <g pointerEvents="none">
        {hexes.map((h) => (h.terrain ? <TerrainGlyph key={h.key} h={h} /> : null))}
      </g>

      {/* Nebel: erforscht, aber aktuell nicht sichtbar */}
      <g pointerEvents="none">
        {hexes.map((h) => {
          const fog = overlayFog ? overlayFog[h.key] : h.fog;
          if (fog === 'visible' || !fog) return null;
          const c = center(h);
          return (
            <polygon
              key={h.key}
              points={hexCorners(c.x, c.y, fog === 'unexplored' && !overlayFog ? HEX_SIZE - 1 : HEX_SIZE + 0.5)}
              fill={fog === 'explored' ? 'rgba(8,7,10,0.55)' : overlayFog ? 'rgba(4,3,6,0.72)' : 'url(#fog-unexplored)'}
            />
          );
        })}
      </g>

      {/* Schrumpfende Arena */}
      <g pointerEvents="none">
        {hexes.map((h) => {
          if (h.zone === 'safe') return null;
          const c = center(h);
          const pts = hexCorners(c.x, c.y, HEX_SIZE);
          if (h.zone === 'warning') return <polygon key={h.key} points={pts} fill="rgba(234,179,8,0.10)" />;
          return <polygon key={h.key} points={pts} fill={h.zone === 'closed' ? 'url(#hatch-closed)' : 'url(#hatch-danger)'} />;
        })}
        {anyUnsafe && (
          <>
            <path d={safeEdge} stroke="#e5484d" strokeWidth={5} strokeOpacity={0.25} fill="none" />
            <path d={safeEdge} stroke="#ff7b7f" strokeWidth={1.6} strokeDasharray="6 4" fill="none" />
          </>
        )}
      </g>

      {/* Arenarand */}
      <path d={border} stroke="#000" strokeWidth={9} strokeOpacity={0.6} fill="none" pointerEvents="none" />
      <path d={border} stroke="#d4a64a" strokeWidth={3.2} fill="none" filter="url(#gold-glow)" pointerEvents="none" />
      <path d={border} stroke="#f3dc9a" strokeWidth={0.8} fill="none" pointerEvents="none" />
    </g>
  );
});

function TerrainGlyph({ h }: { h: HexView }) {
  const c = center(h);
  const v = stringHash(h.key);
  const flip = v % 2 === 0 ? 1 : -1;
  switch (h.terrain) {
    case 'forest':
      return (
        <g transform={`translate(${c.x},${c.y}) scale(${flip},1)`} fill="#4f7a44" stroke="#1c2d19" strokeWidth={0.6}>
          <path d="M-9,6 L-4,-6 L1,6 Z" />
          <path d="M-1,9 L5,-4 L11,9 Z" fill="#5e8c51" />
          <path d="M-12,-1 L-8,-10 L-4,-1 Z" fill="#43693a" />
        </g>
      );
    case 'mountain':
      return (
        <g transform={`translate(${c.x},${c.y + 2}) scale(${flip},1)`}>
          <path d="M-14,8 L-3,-10 L4,0 L8,-5 L15,8 Z" fill="#9c9690" stroke="#3a3632" strokeWidth={0.8} />
          <path d="M-6,-5 L-3,-10 L0,-5.5 L-2,-4 Z" fill="#efeae2" />
        </g>
      );
    case 'water':
      return (
        <g transform={`translate(${c.x},${c.y})`} stroke="#5f93ba" strokeWidth={1.2} fill="none" strokeLinecap="round" opacity={0.7}>
          <path d="M-10,-3 q3,-3 6,0 t6,0 t6,0" />
          <path d="M-7,5 q3,-3 6,0 t6,0" />
        </g>
      );
    case 'ruins':
      return (
        <g transform={`translate(${c.x},${c.y})`} fill="#cdb79a" stroke="#4a3b2c" strokeWidth={0.6}>
          <rect x={-9} y={-6} width={4} height={13} />
          <rect x={-2} y={-1} width={4} height={8} />
          <rect x={5} y={-8} width={4} height={15} />
          <rect x={-11} y={-8} width={8} height={2} />
        </g>
      );
    case 'magic':
      return (
        <g transform={`translate(${c.x},${c.y}) rotate(${v % 45})`}>
          <circle r={9} fill="#a77ef0" opacity={0.18} />
          <path d="M0,-9 L2,-2 L9,0 L2,2 L0,9 L-2,2 L-9,0 L-2,-2 Z" fill="#cdb2ff" opacity={0.85} />
        </g>
      );
    case 'plains':
      if (v % 3 !== 0) return null;
      return (
        <g transform={`translate(${c.x + (v % 7) - 3},${c.y + (v % 5) - 2})`} stroke="#8f8c55" strokeWidth={1} strokeLinecap="round">
          <path d="M-3,3 l1,-4 M0,3 l0,-5 M3,3 l-1,-4" />
        </g>
      );
    default:
      return null;
  }
}

/** Gemeinsame SVG-Definitionen (Muster, Filter). */
export function MapDefs() {
  return (
    <defs>
      <pattern id="fog-unexplored" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
        <rect width="8" height="8" fill="#15120e" />
        <path d="M0,0 L0,8" stroke="#1f1b15" strokeWidth="2" />
      </pattern>
      <pattern id="hatch-danger" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill="rgba(229,72,77,0.16)" />
        <path d="M0,0 L0,7" stroke="rgba(229,72,77,0.45)" strokeWidth="2" />
      </pattern>
      <pattern id="hatch-closed" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill="rgba(60,8,10,0.6)" />
        <path d="M0,0 L0,7" stroke="rgba(229,72,77,0.6)" strokeWidth="2.5" />
      </pattern>
      <filter id="gold-glow" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="3" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="token-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000" floodOpacity="0.8" />
      </filter>
      <radialGradient id="map-bg" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="#1d1914" />
        <stop offset="100%" stopColor="#08070a" />
      </radialGradient>
    </defs>
  );
}
