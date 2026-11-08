/**
 * Hex scene renderer – the Arena engine for every battle and region scene: the same painted
 * TerrainCanvas, light layer, token stacks, hover info, mouse-wheel zoom and drag-to-pan.
 * Only the content differs (scene terrain, scene markers, scene token positions).
 */
import { EliteFrame } from '../EnemyBadge';
import { useMemo, useRef, useState } from 'react';
import { ORIGIN, hexCorners, hexKey, hexesInRange, parseKey, type Axial, type HexKey } from '../../game/hex';
import type { HexView, TokenView, ViewModel } from '../../game/visibility';
import { fmt } from '../../game/text';
import type { MapNode, SceneMap } from '../../campaign/maps';
import { decodeTiles, hexAt, sceneElevation, tileSetOf } from '../../campaign/hexScene';
import type { TerrainType } from '../../game/terrain';
import { paintBattleChunk, paintRegionChunk } from './battlePainter';
import { gradientMap, paletteKey } from '../../campaign/palette';
import { TERRAIN } from '../../game/terrain';
import { HEX_SIZE, boundaryPath, center } from './geometry';
import { LightCanvas, usePrefersReducedMotion } from './LightCanvas';
import { MapDefs } from './MapDefs';
import { TokenStack } from './Markers';
import { TerrainCanvas } from './TerrainCanvas';
import { useHexViewport } from './useHexViewport';

export interface SceneToken {
  tokenId: string;
  x: number;
  y: number;
  name: string;
  color: string;
  /** Full token data for the Arena-style portrait marker, when the viewer knows it. */
  view?: TokenView;
  /** Enemy figure (red ring, icon, condition; HP for the GM). */
  enemy?: { icon: string; condition: 'healthy' | 'bloodied' | 'down'; hp?: number; maxHp?: number; ally?: boolean; elite?: boolean };
  /** Carries a light (torch glow). */
  torch?: boolean;
  /** Highlight as a valid target (attack mode). */
  target?: boolean;
}

interface Props {
  map: Pick<SceneMap, 'width' | 'height' | 'hex' | 'unitsPerCell' | 'unit' | 'palette'> & { nodes: MapNode[] };
  label: string;
  tokens?: SceneToken[];
  /** Show hidden markers and the spawn (GM editor / GM table). */
  gm?: boolean;
  /** Night darkens the map like the Arena; dusk is half-dark (dim light). */
  phase?: 'day' | 'dusk' | 'night';
  /** Player fog per hex ('v' visible, 'e' remembered, '.' unknown). Absent = everything visible (GM). */
  fog?: string;
  selectedTokenId?: string | null;
  /** Gold movement area (hex → cost in hex steps), like the Arena reach. */
  reach?: Map<HexKey, { cost: number }> | null;
  onHexClick?: (key: HexKey, point: { x: number; y: number }) => void;
  onTokenClick?: (tokenId: string) => void;
  /** Editor brush: while set, dragging paints hexes instead of panning. */
  onPaint?: (key: HexKey) => void;
  /** Highlighted hex (e.g. the selected marker). */
  selectedHex?: HexKey | null;
}

const MAX_K = 3.5;
const NO_TEAMS = new Set<string>();

export function HexSceneMap({ map, label, tokens = [], gm = false, phase = 'day', fog, selectedTokenId = null, reach, onHexClick, onTokenClick, onPaint, selectedHex }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [hover, setHover] = useState<HexKey | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const painting = useRef(false);
  const ox = map.width / 2, oy = map.height / 2;
  const toWorld = (p: { x: number; y: number }) => ({ x: p.x - ox, y: p.y - oy });

  const battle = tileSetOf(map.hex) === 'battle';
  // GM vision modes: '.' = nobody on that side sees the hex (darker than "remembered")
  const fogOf = (f: string): HexView['fog'] => (f === 'v' ? 'visible' : f === '.' && gm ? 'unexplored' : 'explored');
  const { hexes, byKey, defs } = useMemo(() => {
    const out: HexView[] = [];
    const tiles = map.hex ? decodeTiles(map.hex) : new Map();
    if (map.hex) {
      hexesInRange(ORIGIN, map.hex.radius).forEach((h, i) => {
        const t = tiles.get(hexKey(h));
        const f = fog ? fog[i] : 'v';
        if (!t || f === '.' || f === undefined) return;
        const view: HexView = battle
          ? { key: hexKey(h), q: h.q, r: h.r, terrain: null, tile: t.id, fog: fogOf(f), zone: 'safe' }
          : t.id in TERRAIN
            ? { key: hexKey(h), q: h.q, r: h.r, terrain: t.id as TerrainType, fog: fogOf(f), zone: 'safe', elevation: sceneElevation(h, t.id as TerrainType) }
            : { key: hexKey(h), q: h.q, r: h.r, terrain: null, tile: t.id, fog: fogOf(f), zone: 'safe' };
        out.push(view);
      });
    }
    return { hexes: out, byKey: Object.fromEntries(out.map((h) => [h.key, h])) as Record<HexKey, HexView>, defs: tiles };
  }, [map.hex, fog, battle]);

  // Players (fog) fit to what they know – the size of the hidden map is not revealed by the zoom.
  const bounds = useMemo(() => {
    if (fog && hexes.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const h of hexes) { const c = center(h); x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
      const pad = HEX_SIZE * 4;
      return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }
    const r = (map.hex?.radius ?? 4) + 1.5;
    const w = Math.sqrt(3) * HEX_SIZE * r, h = 1.5 * HEX_SIZE * r + HEX_SIZE;
    return { x0: -w, y0: -h, x1: w, y1: h };
  }, [map.hex?.radius, fog, hexes]);

  const vp = useHexViewport({ bounds, maxK: MAX_K, fitMaxK: 1.6, fitSignature: `${label}:${map.hex?.radius}` });
  const known = (k: HexKey) => !!byKey[k];

  // Arena-style light layer (water glints, motes) without Arena sites or party torches.
  const pKey = paletteKey(map.palette);
  const recolor = useMemo(() => (map.palette ? { key: pKey, fn: gradientMap(map.palette) } : null), [pKey]);
  const lightView = useMemo(() => ({ phase: phase === 'day' ? 'day' : 'night', hexes, hexByKey: byKey, sites: [], tokens: [] }) as unknown as ViewModel, [phase, hexes, byKey]);

  const stacks = useMemo(() => {
    const m = new Map<HexKey, SceneToken[]>();
    for (const t of tokens) {
      const k = hexKey(hexAt(map, t));
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [tokens, map.width, map.height]);

  const reachShape = useMemo(() => {
    if (!reach || !reach.size) return null;
    const fill = [...reach.keys()]
      .map((k) => {
        const c = center(parseKey(k));
        return `M${hexCorners(c.x, c.y, HEX_SIZE * 0.86).replace(/ /g, 'L')}Z`;
      })
      .join('');
    return { fill, edge: boundaryPath(reach.keys(), (k) => reach.has(k), parseKey) };
  }, [reach]);

  const markers = map.nodes.filter((n) => n.kind !== 'wall' && n.kind !== 'area' && (gm || (n.visible && n.kind !== 'spawn')) && (!fog || !!byKey[hexKey(hexAt(map, n))]));
  const hoverHex = hover ? byKey[hover] : null;
  const hoverTile = hover ? defs.get(hover) : undefined;
  const hoverMarker = hover ? markers.find((n) => hexKey(hexAt(map, n)) === hover) : null;
  const hoverTokens = hover ? stacks.find(([k]) => k === hover)?.[1] ?? [] : [];
  const tf = vp.tf;
  const bgSize = 320 * (tf?.k ?? 1);
  const unit = map.unit === 'feet' ? 'ft' : 'mi';

  const pointKey = (e: React.PointerEvent | React.MouseEvent) => vp.keyAt(e.clientX, e.clientY, known);

  return (
    <div
      ref={vp.wrapRef}
      className="explore-bg relative h-full w-full touch-none overflow-hidden select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50"
      style={{ cursor: onPaint ? 'crosshair' : vp.dragging() ? 'grabbing' : onHexClick ? 'pointer' : 'default', backgroundPosition: tf ? `${tf.x}px ${tf.y}px` : undefined, backgroundSize: `${bgSize}px ${bgSize}px, cover` }}
      tabIndex={0}
      role="application"
      aria-label={`${label}. Hex map. Mouse wheel zooms, drag pans, arrow keys pan, plus and minus zoom, 0 recentres.`}
      data-testid="hex-scene-map"
      onKeyDown={vp.onKeyDown}
      onPointerDown={(e) => {
        if (onPaint) {
          const k = pointKey(e);
          if (k) {
            painting.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            onPaint(k);
            return;
          }
        }
        vp.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        const r = vp.wrapRef.current!.getBoundingClientRect();
        setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
        const k = pointKey(e);
        if (painting.current && onPaint) {
          if (k) onPaint(k);
          return;
        }
        if (!vp.dragging() && k !== hover) setHover(k);
      }}
      onPointerUp={() => (painting.current = false)}
      onPointerCancel={() => (painting.current = false)}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        if (vp.consumeDragClick() || onPaint) return;
        const k = pointKey(e);
        if (!k || !onHexClick) return;
        const c = center(parseKey(k));
        onHexClick(k, { x: c.x + ox, y: c.y + oy });
      }}
    >
      <TerrainCanvas hexes={hexes} byKey={byKey} overlayFog={null} fogUnknown={!!fog && !battle} tf={tf} size={vp.size} paintChunk={battle ? paintBattleChunk : paintRegionChunk} recolor={recolor} />
      <div className={`atmo atmo-day ${phase === 'day' ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
      <div className="atmo atmo-night" style={{ opacity: phase === 'night' ? 1 : phase === 'dusk' ? 0.5 : 0 }} aria-hidden="true" />
      <LightCanvas view={lightView} tf={tf} size={vp.size} reducedMotion={reducedMotion} />

      <svg width={vp.size.w} height={vp.size.h} className="absolute inset-0 block">
        <MapDefs />
        <defs>
          <radialGradient id="scene-light-glow">
            <stop offset="0%" stopColor="#ffd98a" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#ffb347" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ffb347" stopOpacity="0" />
          </radialGradient>
        </defs>
        {tf && (
          <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
            {reachShape && (
              <g pointerEvents="none">
                <path d={reachShape.fill} fill="rgba(243,220,154,0.16)" />
                <path d={reachShape.edge} stroke="#000" strokeOpacity={0.5} strokeWidth={5} fill="none" />
                <path d={reachShape.edge} stroke="#e8d4a6" strokeWidth={2.2} fill="none" />
              </g>
            )}
            {markers.map((n) => {
              const p = toWorld(n);
              const spawn = n.kind === 'spawn';
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} pointerEvents="none" opacity={n.visible || spawn ? 1 : 0.6}>
                  {n.kind === 'light' && <circle r={((n.lightFt ?? 30) / 5) * HEX_SIZE * 1.6} fill="url(#scene-light-glow)" opacity={phase === 'day' ? 0.25 : 0.9} />}
                  {n.kind === 'label' ? null : n.kind === 'light' ? (
                    <circle r={HEX_SIZE * 0.32} fill="#ffcf6b" stroke="#7a4a12" strokeWidth={2} />
                  ) : (
                    <polygon points={hexCorners(0, 0, HEX_SIZE * 0.55)} fill={spawn ? 'rgba(110,200,140,.35)' : 'rgba(217,189,118,.85)'} stroke={spawn ? '#9fe2b0' : '#3a2c14'} strokeWidth={1.5} />
                  )}
                  <text y={n.kind === 'label' ? 4 : -HEX_SIZE * 0.75} textAnchor="middle" fontSize={n.kind === 'label' ? 14 : 11} fill="#f3e4bd" stroke="#000" strokeWidth={3} paintOrder="stroke" fontFamily="Georgia, serif">
                    {spawn ? `⇣ ${n.label || 'Spawn'}` : n.label}
                    {!n.visible && !spawn ? ' (hidden)' : ''}
                  </text>
                </g>
              );
            })}
            {selectedHex && byKey[selectedHex] && <HexOutline k={selectedHex} color="#e8d4a6" width={3} />}
            {hover && hover !== selectedHex && <HexOutline k={hover} color="rgba(255,255,255,0.75)" width={1.6} />}
            {tokens.filter((t) => t.torch).map((t) => { const c = center(hexAt(map, t)); return <circle key={`torch-${t.tokenId}`} cx={c.x} cy={c.y} r={HEX_SIZE * 8 * 1.6} fill="url(#scene-light-glow)" pointerEvents="none" opacity={phase === 'day' ? 0.2 : 0.85} />; })}
            {stacks.map(([k, group]) => {
              const enemy = group.find((t) => t.enemy);
              if (enemy?.enemy) {
                const c = center(parseKey(k)), e = enemy.enemy, down = e.condition === 'down';
                return (
                  <g key={k} transform={`translate(${c.x},${c.y})`} onClick={(ev) => (ev.stopPropagation(), onTokenClick?.(enemy.tokenId))} style={{ cursor: onTokenClick ? 'pointer' : undefined }} data-testid="enemy-token" opacity={down ? 0.45 : 1}>
                    {enemy.target && <circle r={HEX_SIZE * 0.78} fill="none" stroke="#ffd36b" strokeWidth={2.5} strokeDasharray="5 4" />}
                    {enemy.tokenId === selectedTokenId && <circle r={HEX_SIZE * 0.72} fill="none" stroke="#f3dc9a" strokeWidth={3} />}
                    {e.elite && <EliteFrame r={HEX_SIZE * 0.55} />}
                    <circle r={HEX_SIZE * 0.55} fill={enemy.color} stroke={e.condition === 'bloodied' ? '#ff5a4a' : e.ally ? '#7fb8ff' : '#b3261e'} strokeWidth={3} />
                    <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={2.5} paintOrder="stroke">{down ? '✕' : e.icon}</text>
                    {e.hp !== undefined && e.maxHp ? (
                      <g transform={`translate(${-HEX_SIZE * 0.55},${HEX_SIZE * 0.62})`}>
                        <rect width={HEX_SIZE * 1.1} height={4} fill="#2a0e0e" />
                        <rect width={(HEX_SIZE * 1.1 * e.hp) / e.maxHp} height={4} fill={e.hp * 2 <= e.maxHp ? '#e5484d' : '#6fcf6f'} />
                      </g>
                    ) : null}
                    <text y={HEX_SIZE * 1.05} textAnchor="middle" fontSize={9} fill={e.ally ? '#cfe4ff' : '#ffd6d0'} stroke="#000" strokeWidth={2.5} paintOrder="stroke">
                      {e.ally ? '🛡 ' : ''}
                      {enemy.name}{e.hp !== undefined ? ` ${e.hp}/${e.maxHp}` : e.condition === 'bloodied' ? ' (bloodied)' : ''}
                    </text>
                  </g>
                );
              }
              const views = group.map((t) => t.view && ({ ...t.view, pos: parseKey(k) } as TokenView)).filter((v): v is TokenView => !!v);
              if (views.length === group.length && group.some((t) => t.target)) {
                const c = center(parseKey(k));
                return (
                  <g key={k}>
                    <TokenStack tokens={views} selectedId={selectedTokenId} viewerId={null} hiddenTeamIds={NO_TEAMS} onSelect={(id) => onTokenClick?.(id)} />
                    <circle cx={c.x} cy={c.y} r={HEX_SIZE * 0.8} fill="none" stroke="#ffd36b" strokeWidth={2.5} strokeDasharray="5 4" pointerEvents="none" />
                  </g>
                );
              }
              if (views.length === group.length) return <TokenStack key={k} tokens={views} selectedId={selectedTokenId} viewerId={null} hiddenTeamIds={NO_TEAMS} onSelect={(id) => onTokenClick?.(id)} />;
              const c = center(parseKey(k));
              return (
                <g key={k} transform={`translate(${c.x},${c.y})`} onClick={(e) => (e.stopPropagation(), onTokenClick?.(group[0].tokenId))}>
                  <circle r={HEX_SIZE * 0.5} fill={group[0].color} stroke={group.some((t) => t.tokenId === selectedTokenId) ? '#f3dc9a' : '#fff'} strokeWidth={2} />
                  <text y={HEX_SIZE * 0.95} textAnchor="middle" fontSize={10} fill="#fff" stroke="#000" strokeWidth={2.5} paintOrder="stroke">
                    {group.map((t) => t.name).join(', ')}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {hoverHex && hoverTile && !vp.dragging() && (
        <div className="pointer-events-none absolute z-20 max-w-64 rounded-lg border border-gold-700/50 bg-ink-900/95 px-3 py-2 text-xs shadow-xl" style={{ left: Math.min(mouse.x + 16, vp.size.w - 260), top: Math.min(mouse.y + 16, vp.size.h - 120) }}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-marble-50">{hoverTile.label}</span>
            <span className="text-marble-500">
              {hoverHex.q}|{hoverHex.r}
            </span>
          </div>
          <div className="text-marble-300">
            {hoverTile.cost === null ? 'Impassable' : `Cost: ${fmt(hoverTile.cost * map.unitsPerCell)} ${unit}`}
            {hoverTile.blocksSight ? ' · blocks sight' : ''}
            {hoverHex.fog === 'explored' ? <span className="text-marble-500"> · remembered</span> : null}
          </div>
          {reach?.has(hover!) && <div className="text-gold-200">→ reachable · {fmt(reach.get(hover!)!.cost * map.unitsPerCell)} {unit}</div>}
          {hoverMarker && <div className="mt-1 text-gold-300">◆ {hoverMarker.label || hoverMarker.kind}</div>}
          {hoverTokens.length > 0 && <div className="mt-1 text-marble-100">{hoverTokens.map((t) => t.name).join(', ')}</div>}
        </div>
      )}

      <div className="absolute right-3 bottom-3 z-10 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-ghost h-9 w-9 text-base" title="Zoom in (+)" aria-label="Zoom in" onClick={() => vp.zoomAt(1.25, vp.size.w / 2, vp.size.h / 2)}>
          +
        </button>
        <button type="button" className="btn btn-ghost h-9 w-9 text-base" title="Zoom out (−)" aria-label="Zoom out" onClick={() => vp.zoomAt(0.8, vp.size.w / 2, vp.size.h / 2)}>
          −
        </button>
        <button type="button" className="btn btn-ghost h-9 w-9" title="Show the whole map (0)" aria-label="Show the whole map" onClick={vp.fit}>
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <polygon points="10,2 17,6 17,14 10,18 3,14 3,6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function HexOutline({ k, color, width }: { k: HexKey; color: string; width: number }) {
  const c = center(parseKey(k));
  return <polygon points={hexCorners(c.x, c.y, HEX_SIZE - width / 2)} fill="none" stroke={color} strokeWidth={width} pointerEvents="none" />;
}

export type { Axial };
