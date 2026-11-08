/**
 * Hex scene renderer – the Arena engine for every battle and region scene: the same painted
 * TerrainCanvas, light layer, token stacks, hover info, mouse-wheel zoom and drag-to-pan.
 * Only the content differs (scene terrain, scene markers, scene token positions).
 */
import { EliteFrame } from '../EnemyBadge';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ORIGIN, distance, hexCorners, hexKey, hexesInRange, parseKey, type Axial, type HexKey } from '../../game/hex';
import { lineOfSight } from '../../campaign/hexVision';
import type { HexView, TokenView, ViewModel } from '../../game/visibility';
import { fmt } from '../../game/text';
import type { MapNode, SceneMap } from '../../campaign/maps';
import { decodeTiles, hexAt, hexMovementCost, sceneElevation, tileLookup, tileSetOf } from '../../campaign/hexScene';
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
  /** APEX 1.2 – right-click on a hex / a figure (confirm a move, cast at a point, open the attack menu). */
  onHexContext?: (key: HexKey, point: { x: number; y: number }) => void;
  onTokenContext?: (tokenId: string) => void;
  /** Path preview while hovering: from this figure, gold within the budget (feet), red beyond. */
  pathFrom?: { x: number; y: number } | null;
  pathBudget?: number | null;
  /** Line of sight / range while hovering: white line within range and in sight, plus the reachable area. */
  lineFrom?: { x: number; y: number } | null;
  lineRangeFt?: number | null;
  /** Area of effect preview for the hovered point. */
  areaAt?: ((point: { x: number; y: number }) => HexKey[]) | null;
  /** Centre the camera on a point whenever `key` changes (active turn). */
  focus?: { key: string; x: number; y: number } | null;
}

const MAX_K = 3.5;
const NO_TEAMS = new Set<string>();

export function HexSceneMap({ map, label, tokens: targetTokens = [], gm = false, phase = 'day', fog, selectedTokenId = null, reach, onHexClick, onTokenClick, onPaint, selectedHex, onHexContext, onTokenContext, pathFrom = null, pathBudget = null, lineFrom = null, lineRangeFt = null, areaAt = null, focus = null }: Props) {
  const { tokens, moving } = useAnimatedTokens(targetTokens, map);
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

  // camera: glide to the active figure when its turn starts
  const focusedFor = useRef('');
  const setTf = vp.setTf;
  useEffect(() => {
    if (!focus || !vp.tf || !vp.size.w || focusedFor.current === focus.key) return;
    focusedFor.current = focus.key;
    const k = Math.max(vp.tf.k, 0.9);
    const w = { x: focus.x - ox, y: focus.y - oy };
    const from = vp.tf, to = { k, x: vp.size.w / 2 - w.x * k, y: vp.size.h / 2 - w.y * k };
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 450), e = 1 - (1 - t) ** 3;
      setTf({ k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [focus?.key, vp.tf === null, vp.size.w]); // eslint-disable-line react-hooks/exhaustive-deps

  // previews for the hovered hex
  const hoverPoint = hover ? (() => { const c = center(parseKey(hover)); return { x: c.x + ox, y: c.y + oy }; })() : null;
  const pathPreview = useMemo(() => {
    if (!pathFrom || !hover || !map.hex || !known(hover)) return null;
    const c = center(parseKey(hover));
    const r = hexMovementCost(map, pathFrom, { x: c.x + ox, y: c.y + oy });
    if (!r.ok || !r.steps.length) return null;
    const pts = [toWorld(pathFrom), ...r.steps.map((p) => toWorld(p))];
    return { d: `M${pts.map((p) => `${p.x},${p.y}`).join('L')}`, cost: r.cost, end: pts[pts.length - 1], ok: pathBudget === null || r.cost <= pathBudget + 1e-9 };
  }, [pathFrom?.x, pathFrom?.y, hover, pathBudget, map.hex]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocksSight = useMemo(() => { const look = tileLookup(map); return (k: HexKey) => !!look(k)?.blocksSight; }, [map.hex]); // eslint-disable-line react-hooks/exhaustive-deps
  const rangeArea = useMemo(() => {
    if (!lineFrom || !lineRangeFt || !map.hex) return null;
    const from = hexAt(map, lineFrom);
    const cells = Math.round(lineRangeFt / (map.unitsPerCell || 5));
    if (cells > 40) return null;
    const keys = hexesInRange(from, cells).map(hexKey).filter((k) => known(k) && lineOfSight(from, parseKey(k), blocksSight));
    return { keys: new Set(keys), d: keys.map((k) => { const c = center(parseKey(k)); return `M${hexCorners(c.x, c.y, HEX_SIZE * 0.9).replace(/ /g, 'L')}Z`; }).join('') };
  }, [lineFrom?.x, lineFrom?.y, lineRangeFt, map.hex, byKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const losLine = lineFrom && hover && lineRangeFt ? (() => {
    const a = center(hexAt(map, lineFrom)), b = center(parseKey(hover));
    const ok = !!rangeArea?.keys.has(hover);
    return { a, b, ok, ft: distance(hexAt(map, lineFrom), parseKey(hover)) * (map.unitsPerCell || 5) };
  })() : null;
  const areaKeys = useMemo(() => (areaAt && hoverPoint ? areaAt(hoverPoint) : null), [areaAt, hover]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arena-style light layer (water glints, motes) without Arena sites or party torches.
  const pKey = paletteKey(map.palette);
  const recolor = useMemo(() => (map.palette ? { key: pKey, fn: gradientMap(map.palette) } : null), [pKey]);
  const lightView = useMemo(() => ({ phase: phase === 'day' ? 'day' : 'night', hexes, hexByKey: byKey, sites: [], tokens: [] }) as unknown as ViewModel, [phase, hexes, byKey]);

  const stacks = useMemo(() => {
    const m = new Map<HexKey, SceneToken[]>();
    for (const t of tokens) {
      if (moving.has(t.tokenId)) continue;
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
      onContextMenu={(e) => {
        if (!onHexContext && !onTokenContext) return;
        e.preventDefault();
        const k = pointKey(e);
        if (!k) return;
        const onIt = stacks.find(([sk]) => sk === k)?.[1];
        if (onIt?.length && onTokenContext) return onTokenContext((onIt.find((t) => t.enemy) ?? onIt[0]).tokenId);
        const c = center(parseKey(k));
        onHexContext?.(k, { x: c.x + ox, y: c.y + oy });
      }}
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
            {rangeArea && <path d={rangeArea.d} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" strokeWidth={0.8} pointerEvents="none" />}
            {areaKeys && areaKeys.map((k) => { const c = center(parseKey(k)); return <polygon key={`area-${k}`} points={hexCorners(c.x, c.y, HEX_SIZE * 0.92)} fill="rgba(255,120,40,0.35)" stroke="#ffb066" strokeWidth={1.2} pointerEvents="none" />; })}
            {pathPreview && (
              <g pointerEvents="none" data-testid="path-preview">
                <path d={pathPreview.d} fill="none" stroke="#000" strokeOpacity={0.55} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
                <path d={pathPreview.d} fill="none" stroke={pathPreview.ok ? '#f3dc9a' : '#ff6b5a'} strokeWidth={3} strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" />
                <text x={pathPreview.end.x} y={pathPreview.end.y - HEX_SIZE * 0.7} textAnchor="middle" fontSize={12} fontWeight={700} fill={pathPreview.ok ? '#f3dc9a' : '#ff9a8a'} stroke="#000" strokeWidth={3} paintOrder="stroke">{fmt(pathPreview.cost)} {unit}{pathPreview.ok ? '' : ' – too far'}</text>
              </g>
            )}
            {losLine && (
              <g pointerEvents="none" data-testid="los-line">
                <line x1={losLine.a.x} y1={losLine.a.y} x2={losLine.b.x} y2={losLine.b.y} stroke="#000" strokeOpacity={0.5} strokeWidth={4} />
                <line x1={losLine.a.x} y1={losLine.a.y} x2={losLine.b.x} y2={losLine.b.y} stroke={losLine.ok ? '#ffffff' : '#ff6b5a'} strokeWidth={2} strokeDasharray={losLine.ok ? undefined : '6 5'} />
                <text x={(losLine.a.x + losLine.b.x) / 2} y={(losLine.a.y + losLine.b.y) / 2 - 6} textAnchor="middle" fontSize={11} fill={losLine.ok ? '#fff' : '#ff9a8a'} stroke="#000" strokeWidth={3} paintOrder="stroke">{losLine.ft} ft{losLine.ok ? '' : ' – no line of sight or out of range'}</text>
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
            {tokens.filter((t) => moving.has(t.tokenId)).map((t) => {
              const w = toWorld(t);
              return (
                <g key={`moving-${t.tokenId}`} transform={`translate(${w.x},${w.y})`} pointerEvents="none" data-testid="moving-token">
                  {t.enemy?.elite && <EliteFrame r={HEX_SIZE * 0.55} />}
                  <circle r={HEX_SIZE * 0.55} fill={t.color} stroke={t.enemy ? (t.enemy.ally ? '#7fb8ff' : '#b3261e') : '#fff'} strokeWidth={3} />
                  <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={2.5} paintOrder="stroke">{t.enemy?.icon ?? t.view?.initials ?? t.name.slice(0, 2)}</text>
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

/**
 * Smooth movement: when a figure's position changes it glides along its path (≈ 160 ms per hex, at most 1.6 s)
 * instead of jumping. Returns the tokens at their animated positions and the ids currently moving.
 */
function useAnimatedTokens(tokens: SceneToken[], map: Pick<SceneMap, 'width' | 'height' | 'hex' | 'unitsPerCell'>) {
  const shown = useRef(new Map<string, { x: number; y: number }>());
  const anim = useRef(new Map<string, { pts: Array<{ x: number; y: number }>; t0: number; dur: number }>());
  const [, setFrame] = useState(0);
  const reduced = usePrefersReducedMotion();
  const now = performance.now();
  for (const t of tokens) {
    const prev = shown.current.get(t.tokenId);
    const a = anim.current.get(t.tokenId);
    const target = a ? a.pts[a.pts.length - 1] : prev;
    if (prev && target && (Math.abs(target.x - t.x) > 0.5 || Math.abs(target.y - t.y) > 0.5) && !reduced) {
      const start = a ? positionAt(a, now) : prev;
      const path = map.hex ? hexMovementCost(map, start, t) : null;
      const pts = path && path.ok && path.steps.length ? [start, ...path.steps.map((p) => ({ x: p.x, y: p.y }))] : [start, { x: t.x, y: t.y }];
      pts[pts.length - 1] = { x: t.x, y: t.y };
      anim.current.set(t.tokenId, { pts, t0: now, dur: Math.min(1600, Math.max(250, (pts.length - 1) * 160)) });
    }
    if (!prev) shown.current.set(t.tokenId, { x: t.x, y: t.y });
  }
  const active = anim.current.size > 0;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const n = performance.now();
      for (const [id, a] of anim.current) if (n - a.t0 >= a.dur) { anim.current.delete(id); shown.current.set(id, a.pts[a.pts.length - 1]); }
      setFrame((f) => f + 1);
      if (anim.current.size) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, tokens]);
  const moving = new Set(anim.current.keys());
  const out = tokens.map((t) => {
    const a = anim.current.get(t.tokenId);
    if (!a) { shown.current.set(t.tokenId, { x: t.x, y: t.y }); return t; }
    const p = positionAt(a, now);
    shown.current.set(t.tokenId, p);
    return { ...t, x: p.x, y: p.y };
  });
  return { tokens: out, moving };
}

function positionAt(a: { pts: Array<{ x: number; y: number }>; t0: number; dur: number }, now: number) {
  const t = Math.max(0, Math.min(1, (now - a.t0) / a.dur));
  const seg = (a.pts.length - 1) * t;
  const i = Math.min(a.pts.length - 2, Math.floor(seg));
  if (i < 0) return a.pts[0];
  const f = seg - i, p = a.pts[i], q = a.pts[i + 1];
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
}
