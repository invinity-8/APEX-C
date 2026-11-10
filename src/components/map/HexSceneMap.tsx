/**
 * Hex scene renderer – the Arena engine for every battle and region scene: the same painted
 * TerrainCanvas, light layer, token stacks, hover info, mouse-wheel zoom and drag-to-pan.
 * Only the content differs (scene terrain, scene markers, scene token positions).
 */
import { EliteFrame } from '../EnemyBadge';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ORIGIN, distance, hexCorners, hexKey, hexesInRange, parseKey, type Axial, type HexKey } from '../../game/hex';
import { lineOfSight, sightRules } from '../../campaign/hexVision';
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
import { CombatFx } from './CombatFx';
import { beastIcon } from './effectIcons';
import type { SceneFx } from '../../game/sceneFx';
import { useHexViewport } from './useHexViewport';

import type { FigureLook } from '../../game/figure';

export interface SceneToken {
  tokenId: string;
  x: number;
  y: number;
  name: string;
  color: string;
  /** Full token data for the Arena-style portrait marker, when the viewer knows it. */
  view?: TokenView;
  /** Enemy figure (red ring, icon, condition; HP for the GM). */
  enemy?: { icon: string; condition: 'healthy' | 'bloodied' | 'down'; hp?: number; maxHp?: number; tempHp?: number; ally?: boolean; elite?: boolean; size?: string; build?: string; /** APEX 2.1: chosen low-poly look, or the creature kind an automatic look is picked from. */ look?: FigureLook; breed?: string };
  /** Carries a light (torch glow). */
  torch?: boolean;
  /** Highlight as a valid target (attack mode). */
  target?: boolean;
  /** Conditions / effects shown under the figure (e.g. "◎ Bless · Prone"). */
  badges?: string;
  /** APEX 1.6 – the same as icons above the figure (concentration, conditions, buffs). */
  icons?: Array<{ icon: string; name: string; tone: 'conc' | 'bad' | 'good' }>;
  /** APEX 1.9 – altitude above the ground in feet (flying). */
  alt?: number;
  /** APEX 1.6 – hit points of a character (life bar under the figure). */
  vitals?: { hp: number; maxHp: number; temp: number; form?: string };
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
  /** APEX 1.9 – flying / climbing for the path preview. */
  pathMode?: { fly?: boolean; climb?: boolean };
  /** Line of sight / range while hovering: white line within range and in sight, plus the reachable area. */
  lineFrom?: { x: number; y: number } | null;
  lineRangeFt?: number | null;
  /** APEX 1.5 – sight preview: hovering a hex shows which opponents would be in line of sight from THERE. */
  sightFrom?: { x: number; y: number } | null;
  /** Whose opponents: 'hostile' = enemies (characters, allies), 'party' = characters and allies (an enemy acting). */
  sightSide?: 'hostile' | 'party' | null;
  /** Area of effect preview for the hovered point. */
  areaAt?: ((point: { x: number; y: number }) => HexKey[]) | null;
  /** APEX 1.6 – recent combat events to animate (floating numbers, streaks, bursts). */
  fx?: SceneFx[];
  /** APEX 1.9 – the chosen aim height (Shift + wheel), shown at the hovered hex. */
  aimAlt?: number;
  /** Centre the camera on a point whenever `key` changes (active turn). */
  focus?: { key: string; x: number; y: number } | null;
}

const MAX_K = 3.5;
const NO_TEAMS = new Set<string>();

export function HexSceneMap({ map, label, tokens: targetTokens = [], gm = false, phase = 'day', fog, selectedTokenId = null, reach, onHexClick, onTokenClick, onPaint, selectedHex, onHexContext, onTokenContext, pathFrom = null, pathBudget = null, pathMode, lineFrom = null, lineRangeFt = null, sightFrom = null, sightSide = null, areaAt = null, focus = null, fx = [], aimAlt = 0 }: Props) {
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
    const r = hexMovementCost(map, pathFrom, { x: c.x + ox, y: c.y + oy }, pathMode);
    if (!r.ok || !r.steps.length) return null;
    const pts = [toWorld(pathFrom), ...r.steps.map((p) => toWorld(p))];
    return { d: `M${pts.map((p) => `${p.x},${p.y}`).join('L')}`, cost: r.cost, end: pts[pts.length - 1], ok: pathBudget === null || r.cost <= pathBudget + 1e-9 };
  }, [pathFrom?.x, pathFrom?.y, hover, pathBudget, map.hex, pathMode?.fly, pathMode?.climb]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocksSight = useMemo(() => { const look = tileLookup(map); return (k: HexKey) => !!look(k)?.blocksSight; }, [map.hex]); // eslint-disable-line react-hooks/exhaustive-deps
  const groundHeight = useMemo(() => sightRules(map).height, [map.hex]); // eslint-disable-line react-hooks/exhaustive-deps
  const rangeArea = useMemo(() => {
    if (!lineFrom || !lineRangeFt || !map.hex) return null;
    const from = hexAt(map, lineFrom);
    const cells = Math.round(lineRangeFt / (map.unitsPerCell || 5));
    if (cells > 40) return null;
    const keys = hexesInRange(from, cells).map(hexKey).filter((k) => known(k) && lineOfSight(from, parseKey(k), blocksSight, groundHeight));
    return { keys: new Set(keys), d: keys.map((k) => { const c = center(parseKey(k)); return `M${hexCorners(c.x, c.y, HEX_SIZE * 0.9).replace(/ /g, 'L')}Z`; }).join('') };
  }, [lineFrom?.x, lineFrom?.y, lineRangeFt, map.hex, byKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Sight preview: from the hovered hex (where the figure could stand) to every opponent – white within the readied
  // range, gold in sight but beyond it. Hovering an opponent instead shows the line from the figure to it.
  const opponents = useMemo(() => (sightSide ? targetTokens.filter((t) => (sightSide === 'hostile' ? !!t.enemy && !t.enemy.ally : !t.enemy || !!t.enemy.ally) && t.enemy?.condition !== 'down') : []), [targetTokens, sightSide]);
  const sight = useMemo(() => {
    const origin = sightFrom ?? lineFrom;
    if (!origin || !hover || !map.hex || !known(hover)) return null;
    const unitFt = map.unitsPerCell || 5;
    const self = hexAt(map, origin);
    const h = parseKey(hover);
    const onOpponent = opponents.some((t) => hexKey(hexAt(map, t)) === hover);
    if (onOpponent || hexKey(self) === hover) {
      if (!onOpponent || !lineRangeFt) return null;
      const ft = distance(self, h) * unitFt;
      const ok = ft <= lineRangeFt && lineOfSight(self, h, blocksSight, groundHeight);
      return { kind: 'target' as const, a: center(self), lines: [{ b: center(h), ok, ft, label: `${ft} ft${ok ? '' : ' – no line of sight or out of range'}` }] };
    }
    const lines = opponents.flatMap((t) => {
      const to = hexAt(map, t);
      const ft = distance(h, to) * unitFt;
      if (ft > 40 * unitFt || !lineOfSight(h, to, blocksSight, groundHeight)) return [];
      return [{ b: center(to), ok: !lineRangeFt || ft <= lineRangeFt, ft, label: `${ft} ft` }];
    });
    return { kind: 'from' as const, a: center(h), lines, hidden: opponents.length - lines.length };
  }, [sightFrom?.x, sightFrom?.y, lineFrom?.x, lineFrom?.y, hover, opponents, lineRangeFt, map.hex, byKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const areaKeys = useMemo(() => (areaAt && hoverPoint ? areaAt(hoverPoint) : null), [areaAt, hover]); // eslint-disable-line react-hooks/exhaustive-deps

  // APEX 1.8 – relief: higher ground lighter, steps (one level) as light edges, cliffs (two or more) as dark edges
  const relief = useMemo(() => {
    if (!map.hex?.heights || !groundHeight) return null;
    const shade: string[] = [], steps: string[] = [], cliffs: string[] = [];
    const labels: Array<{ x: number; y: number; ft: number }> = [];
    for (const k of Object.keys(byKey)) {
      const h = parseKey(k), lv = groundHeight(k), c = center(h);
      if (lv > 0) { shade.push(`M${hexCorners(c.x, c.y, HEX_SIZE * 0.98).replace(/ /g, 'L')}Z`); labels.push({ x: c.x, y: c.y, ft: lv * (map.unitsPerCell || 5) }); }
      for (const d of [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }]) {
        const n = { q: h.q + d.q, r: h.r + d.r }, nk = hexKey(n);
        if (!byKey[nk]) continue;
        const dh = Math.abs(groundHeight(nk) - lv);
        if (!dh) continue;
        const cn = center(n), mx = (c.x + cn.x) / 2, my = (c.y + cn.y) / 2;
        const len = Math.hypot(cn.x - c.x, cn.y - c.y) || 1, px = -(cn.y - c.y) / len, py = (cn.x - c.x) / len, half = HEX_SIZE * 0.5;
        (dh >= 2 ? cliffs : steps).push(`M${mx + px * half},${my + py * half}L${mx - px * half},${my - py * half}`);
      }
    }
    const maxLv = Math.max(1, ...Object.keys(byKey).map((k) => groundHeight(k)));
    return { shade: Object.keys(byKey).filter((k) => groundHeight(k) > 0).map((k) => ({ k, a: 0.05 + 0.22 * (groundHeight(k) / maxLv) })), steps: steps.join(''), cliffs: cliffs.join(''), labels };
  }, [map.hex, byKey, groundHeight]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const pointKey = (e: { clientX: number; clientY: number }) => vp.keyAt(e.clientX, e.clientY, known);
  /** Right-click (or a long press on touch screens): act on the figure on that hex, else on the hex. */
  const contextAt = (e: { clientX: number; clientY: number }) => {
    const k = pointKey(e);
    if (!k) return;
    const onIt = stacks.find(([sk]) => sk === k)?.[1];
    if (onIt?.length && onTokenContext) return onTokenContext((onIt.find((t) => t.enemy) ?? onIt[0]).tokenId);
    const c = center(parseKey(k));
    onHexContext?.(k, { x: c.x + ox, y: c.y + oy });
  };
  // APEX 1.6 – touch: a tap previews (path, sight, area), a long press acts like a right-click
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const longPressAt = useRef(0);
  const cancelPress = () => { if (press.current) window.clearTimeout(press.current.timer); press.current = null; };

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
        if (e.pointerType === 'touch' && (onHexContext || onTokenContext)) {
          cancelPress();
          const at = { clientX: e.clientX, clientY: e.clientY };
          const k = pointKey(at);
          if (k) setHover(k);
          press.current = { x: e.clientX, y: e.clientY, timer: window.setTimeout(() => { press.current = null; longPressAt.current = Date.now(); navigator.vibrate?.(12); contextAt(at); }, 480) };
        }
        vp.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        const r = vp.wrapRef.current!.getBoundingClientRect();
        setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
        if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress();
        const k = pointKey(e);
        if (painting.current && onPaint) {
          if (k) onPaint(k);
          return;
        }
        if (!vp.dragging() && k !== hover) setHover(k);
      }}
      onPointerUp={() => { painting.current = false; cancelPress(); }}
      onPointerCancel={() => { painting.current = false; cancelPress(); }}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => {
        if (!onHexContext && !onTokenContext) return;
        e.preventDefault();
        if (Date.now() - longPressAt.current < 1000) return; // the long press already acted (Android also sends contextmenu)
        contextAt(e);
      }}
      onClick={(e) => {
        if (vp.consumeDragClick() || onPaint) return;
        if (Date.now() - longPressAt.current < 1000) return;
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
            {relief && (
              <g pointerEvents="none" data-testid="relief">
                {relief.shade.map(({ k, a }) => { const c = center(parseKey(k)); return <polygon key={`rl-${k}`} points={hexCorners(c.x, c.y, HEX_SIZE * 0.98)} fill={`rgba(255,244,214,${a.toFixed(3)})`} />; })}
                <path d={relief.steps} stroke="#f3e4bd" strokeOpacity={0.75} strokeWidth={1.6} strokeDasharray="3 3" fill="none" />
                <path d={relief.cliffs} stroke="#000" strokeOpacity={0.55} strokeWidth={6} strokeLinecap="round" fill="none" />
                <path d={relief.cliffs} stroke="#5b4630" strokeWidth={3} strokeLinecap="round" fill="none" />
                {gm && relief.labels.map((l) => <text key={`rlt-${l.x}-${l.y}`} x={l.x} y={l.y + HEX_SIZE * 0.55} textAnchor="middle" fontSize={8} fill="#f3e4bd" stroke="#000" strokeWidth={2} paintOrder="stroke">▲{l.ft}</text>)}
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
            {sight && (
              <g pointerEvents="none" data-testid={sight.kind === 'target' ? 'los-line' : 'sight-preview'}>
                {sight.lines.map((l, i) => (
                  <g key={i}>
                    <line x1={sight.a.x} y1={sight.a.y} x2={l.b.x} y2={l.b.y} stroke="#000" strokeOpacity={0.5} strokeWidth={4} />
                    <line x1={sight.a.x} y1={sight.a.y} x2={l.b.x} y2={l.b.y} stroke={sight.kind === 'target' && !l.ok ? '#ff6b5a' : l.ok ? '#ffffff' : '#f3c86a'} strokeWidth={2} strokeDasharray={l.ok ? undefined : '6 5'} />
                    <circle cx={l.b.x} cy={l.b.y} r={HEX_SIZE * 0.62} fill="none" stroke={l.ok ? '#ffffff' : '#f3c86a'} strokeOpacity={0.8} strokeWidth={1.6} />
                    <text x={(sight.a.x + l.b.x) / 2} y={(sight.a.y + l.b.y) / 2 - 6} textAnchor="middle" fontSize={11} fill={sight.kind === 'target' && !l.ok ? '#ff9a8a' : l.ok ? '#fff' : '#f3dc9a'} stroke="#000" strokeWidth={3} paintOrder="stroke">{l.label}</text>
                  </g>
                ))}
                {sight.kind === 'from' && (
                  <text x={sight.a.x} y={sight.a.y + HEX_SIZE * 1.15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke">👁 {sight.lines.length} in sight{sight.hidden ? ` · ${sight.hidden} blocked` : ''}</text>
                )}
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
                    {e.hp !== undefined && e.maxHp ? <LifeBar hp={e.hp} maxHp={e.maxHp} temp={e.tempHp ?? 0} y={HEX_SIZE * 0.62} party={e.ally} /> : null}
                    {enemy.icons?.length ? <FigureIcons icons={enemy.icons} /> : null}
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
                    <TokenStack tokens={views} selectedId={selectedTokenId} viewerId={null} hiddenTeamIds={NO_TEAMS} onSelect={(id) => onTokenClick?.(id)} portraits />
                    <circle cx={c.x} cy={c.y} r={HEX_SIZE * 0.8} fill="none" stroke="#ffd36b" strokeWidth={2.5} strokeDasharray="5 4" pointerEvents="none" />
                  </g>
                );
              }
              if (views.length === group.length) {
                const c0 = center(parseKey(k));
                const icons = group.flatMap((t) => t.icons ?? []);
                const v = group.length === 1 ? group[0].vitals : undefined;
                return (
                  <g key={k}>
                    <TokenStack tokens={views} selectedId={selectedTokenId} viewerId={null} hiddenTeamIds={NO_TEAMS} onSelect={(id) => onTokenClick?.(id)} portraits />
                    <g transform={`translate(${c0.x},${c0.y})`} pointerEvents="none">
                      {v?.form && (
                        <g data-testid="beast-form">
                          <title>{`Wild Shape: ${v.form}`}</title>
                          <circle r={HEX_SIZE * 0.52} fill="#1d2b20" stroke="#6fe39b" strokeWidth={2.5} />
                          <text y={HEX_SIZE * 0.2} textAnchor="middle" fontSize={HEX_SIZE * 0.62}>{beastIcon(v.form)}</text>
                          <circle cx={HEX_SIZE * 0.4} cy={-HEX_SIZE * 0.4} r={HEX_SIZE * 0.2} fill={group[0].color} stroke="#14110d" strokeWidth={1.2} />
                        </g>
                      )}
                      {v && v.maxHp > 0 && <LifeBar hp={v.hp} maxHp={v.maxHp} temp={v.temp} y={HEX_SIZE * 0.66} party />}
                      {icons.length > 0 && <FigureIcons icons={icons} />}
                    </g>
                  </g>
                );
              }
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
            {tokens.filter((t) => t.alt && !moving.has(t.tokenId)).map((t) => {
              const c = center(hexAt(map, t));
              return (
                <g key={`alt-${t.tokenId}`} transform={`translate(${c.x},${c.y})`} pointerEvents="none" data-testid="altitude-badge">
                  <ellipse cx={0} cy={HEX_SIZE * 0.55} rx={HEX_SIZE * 0.45} ry={HEX_SIZE * 0.14} fill="#000" fillOpacity={0.35} />
                  <g transform={`translate(${HEX_SIZE * 0.55},${-HEX_SIZE * 0.55})`}>
                    <rect x={-2} y={-8} width={34} height={13} rx={6} fill="#0b2233" stroke="#7fd6ff" strokeWidth={1} />
                    <text x={15} y={2} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#bfefff">↑{t.alt} ft</text>
                  </g>
                </g>
              );
            })}
            {hover && aimAlt > 0 && (() => { const c = center(parseKey(hover)); return <text x={c.x} y={c.y - HEX_SIZE * 0.85} textAnchor="middle" fontSize={10} fontWeight={700} fill="#bfefff" stroke="#000" strokeWidth={3} paintOrder="stroke" pointerEvents="none">⇕ {aimAlt} ft</text>; })()}
            {fx.length > 0 && <CombatFx fx={fx} posOf={(actor) => { const id = actor.replace(/^(pc|npc)-/, ''); const t = tokens.find((x) => x.tokenId === id); return t ? center(hexAt(map, t)) : null; }} />}
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
            {groundHeight && hover && groundHeight(hover) > 0 ? ` · height ${groundHeight(hover) * (map.unitsPerCell || 5)} ft` : ''}
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

/** Life bar under a figure: green (party) or red (enemy) above half, orange/red below; temporary HP as a blue cap. */
function LifeBar({ hp, maxHp, temp, y, party }: { hp: number; maxHp: number; temp: number; y: number; party?: boolean }) {
  const w = HEX_SIZE * 1.15, h = 5;
  const frac = Math.max(0, Math.min(1, hp / maxHp));
  const tempFrac = Math.min(1 - frac, temp / maxHp);
  const fill = frac <= 0.25 ? '#e5484d' : frac <= 0.5 ? '#f59e0b' : party ? '#4ade80' : '#6fcf6f';
  return (
    <g transform={`translate(${-w / 2},${y})`} data-testid="life-bar">
      <title>{`${hp}/${maxHp} HP${temp ? ` + ${temp} temporary` : ''}`}</title>
      <rect x={-1} y={-1} width={w + 2} height={h + 2} rx={2} fill="#0b0b0b" fillOpacity={0.85} />
      <rect width={w} height={h} rx={1.5} fill="#3a1414" />
      <rect width={w * frac} height={h} rx={1.5} fill={fill} style={{ transition: 'width .5s ease-out' }} />
      {tempFrac > 0 && <rect x={w * frac} width={w * tempFrac} height={h} rx={1.5} fill="#60a5fa" />}
      {temp > 0 && frac + temp / maxHp > 1 && <rect width={w} height={1.5} fill="#93c5fd" />}
    </g>
  );
}

/** Condition / buff / concentration icons in a row above a figure. */
function FigureIcons({ icons }: { icons: Array<{ icon: string; name: string; tone: 'conc' | 'bad' | 'good' }> }) {
  const shown = icons.slice(0, 5);
  const r = 6.5, gap = 14.5;
  const x0 = -((shown.length - 1) * gap) / 2;
  return (
    <g transform={`translate(0,${-HEX_SIZE * 0.92})`} data-testid="token-badges">
      {shown.map((ic, i) => (
        <g key={`${ic.name}-${i}`} transform={`translate(${x0 + i * gap},0)`}>
          <title>{ic.name}</title>
          <circle r={r} fill="#14110d" fillOpacity={0.92} stroke={ic.tone === 'conc' ? '#b9a8e3' : ic.tone === 'bad' ? '#e5484d' : '#c09b58'} strokeWidth={1.4} className={ic.tone === 'conc' ? 'fx-conc' : undefined} />
          <text y={3.2} textAnchor="middle" fontSize={8.5} fill={ic.tone === 'conc' ? '#d8ccff' : '#fff'}>{ic.icon}</text>
        </g>
      ))}
      {icons.length > shown.length && <text x={x0 + shown.length * gap} y={3} fontSize={8} fill="#f3dc9a" stroke="#000" strokeWidth={2} paintOrder="stroke">+{icons.length - shown.length}</text>}
    </g>
  );
}
