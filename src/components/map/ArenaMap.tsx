/**
 * The arena map. Layers (bottom → top):
 *   1. Exploration canvas – an endless, non-informative dark parchment (CSS, pans with the map)
 *   2. TerrainCanvas      – painted 2.5D terrain, cached in chunks
 *   3. Day/night tint     – CSS overlays with smooth transitions
 *   4. LightCanvas        – glows, torches, motes (screen blend)
 *   5. SVG overlay        – reach area, path preview, selection, sites, trackers, tokens
 *   6. HTML               – tooltip, legend, zoom controls
 * Hit testing uses hex math (pixel → axial), so no DOM node exists per hex.
 * Player views only contain known hexes: the outline and size of the arena cannot be
 * read from the data, the SVG bounds, the zoom limits or the scroll range.
 */
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { fromPixel, hexCorners, hexKey, parseKey, type HexKey } from '../../game/hex';
import { pathTo, type ReachInfo } from '../../game/movement';
import { TERRAIN } from '../../game/terrain';
import { fmt } from '../../game/text';
import type { Fog, TokenView, ViewModel } from '../../game/visibility';
import type { ReachExplanation } from '../../game/viewRules';
import { HEX_SIZE, boundaryPath, center } from './geometry';
import { HEX_FEATURE_INFO } from './landmark';
import { Legend } from './Legend';
import { LightCanvas, usePrefersReducedMotion } from './LightCanvas';
import { AtmosphereCanvas } from './AtmosphereCanvas';
import { MapDefs } from './MapDefs';
import { LastSeenMarker, SiteMarker, TokenStack, TrackerMarker } from './Markers';
import { TerrainCanvas, type Transform } from './TerrainCanvas';

export interface MapHandle {
  focus: (key: HexKey) => void;
}

interface Props {
  view: ViewModel;
  selectedTokenId: string | null;
  selectedHex: HexKey | null;
  /** Reachable hexes of the selected character (within its MP budget). */
  reach: Map<HexKey, ReachInfo> | null;
  /** Path search without budget – for cost previews. */
  fullReach: Map<HexKey, ReachInfo> | null;
  explain: (key: HexKey) => ReachExplanation | null;
  placeMode: boolean;
  overlayFog: Record<HexKey, Fog> | null;
  hiddenTeamIds: Set<string>;
  onHexClick: (key: HexKey) => void;
  onTokenClick: (id: string) => void;
  mapRef?: Ref<MapHandle>;
}

const MAX_K = 3.5;

export function ArenaMap(props: Props) {
  const { view, selectedTokenId, selectedHex, reach, fullReach, explain, placeMode, overlayFog, hiddenTeamIds } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tf, setTf] = useState<Transform | null>(null);
  const [hover, setHover] = useState<HexKey | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean; pointers: Map<number, { x: number; y: number }>; pinch?: number } | null>(null);
  const suppressClick = useRef(false);
  const reducedMotion = usePrefersReducedMotion();
  // APEX 0.5 atmosphere overlay – a personal display preference (localStorage only)
  const [atmosphere, setAtmosphereState] = useState(() => {
    try {
      return localStorage.getItem('apex.map.atmosphere') !== 'off';
    } catch {
      return true;
    }
  });
  const setAtmosphere = (on: boolean) => {
    setAtmosphereState(on);
    try {
      localStorage.setItem('apex.map.atmosphere', on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  };
  const isGm = view.role === 'gm';

  // Bounding box of what this viewer knows (GM: the whole arena; players: explored area only).
  const bounds = useMemo(() => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const h of view.hexes) {
      const c = center(h);
      x0 = Math.min(x0, c.x);
      y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x);
      y1 = Math.max(y1, c.y);
    }
    if (!Number.isFinite(x0)) return { x0: -100, y0: -100, x1: 100, y1: 100 };
    const pad = HEX_SIZE * 3;
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }, [view.hexes]);

  const fitK = useMemo(() => {
    if (!size.w) return 1;
    return Math.min(size.w / (bounds.x1 - bounds.x0), size.h / (bounds.y1 - bounds.y0));
  }, [size, bounds]);
  // Zoom limit derives from the KNOWN area only, so it reveals nothing about the arena size.
  const minK = Math.max(0.08, Math.min(0.5, fitK * 0.6));

  const fit = useCallback(() => {
    const k = Math.max(minK, Math.min(isGm ? MAX_K : 1.4, fitK));
    setTf({ k, x: size.w / 2 - ((bounds.x0 + bounds.x1) / 2) * k, y: size.h / 2 - ((bounds.y0 + bounds.y1) / 2) * k });
  }, [minK, fitK, size, bounds, isGm]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit once initially and whenever the GM's arena size or the player's perspective changes.
  const fittedFor = useRef('');
  useEffect(() => {
    const sig = `${view.role}:${view.viewerId}:${view.mapRadius}`;
    if (size.w > 0 && fittedFor.current !== sig) {
      fittedFor.current = sig;
      fit();
    }
  }, [size, view.role, view.viewerId, view.mapRadius, fit]);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      setTf((t) => {
        if (!t) return t;
        const k = Math.max(minK, Math.min(MAX_K, t.k * factor));
        const f = k / t.k;
        return { k, x: px - (px - t.x) * f, y: py - (py - t.y) * f };
      });
    },
    [minK],
  );

  useImperativeHandle(props.mapRef, () => ({
    focus: (key: HexKey) => {
      const c = center(parseKey(key));
      setTf((t) => {
        const k = Math.max(t?.k ?? 1, 0.85);
        return { k, x: size.w / 2 - c.x * k, y: size.h / 2 - c.y * k };
      });
    },
  }));

  // Wheel zoom (non-passive so the page does not scroll).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const d = drag.current ?? { x: e.clientX, y: e.clientY, moved: false, pointers: new Map() };
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pointers.size === 1) {
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved = false;
    }
    drag.current = d;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || !d.pointers.has(e.pointerId)) return;
      const prev = d.pointers.get(e.pointerId)!;
      d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (d.pointers.size === 2) {
        const [a, b] = [...d.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (d.pinch) {
          const rect = wrapRef.current!.getBoundingClientRect();
          zoomAt(dist / d.pinch, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        }
        d.pinch = dist;
        d.moved = true;
        return;
      }
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.moved = true;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setTf((t) => (t ? { ...t, x: t.x + dx, y: t.y + dy } : t));
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.pointers.delete(e.pointerId);
      d.pinch = undefined;
      if (d.pointers.size === 0) {
        suppressClick.current = d.moved;
        drag.current = null;
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [zoomAt]);

  /** Screen position → known hex key (unknown space is not interactive). */
  const keyAt = (clientX: number, clientY: number): HexKey | null => {
    if (!tf || !wrapRef.current) return null;
    const r = wrapRef.current.getBoundingClientRect();
    const k = hexKey(fromPixel((clientX - r.left - tf.x) / tf.k, (clientY - r.top - tf.y) / tf.k, HEX_SIZE));
    return view.hexByKey[k] ? k : null;
  };

  const handleClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const key = keyAt(e.clientX, e.clientY);
    if (key) props.onHexClick(key);
  };

  // Keyboard: arrows pan, +/- zoom, 0 fits.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 60;
    const pan = (dx: number, dy: number) => setTf((t) => (t ? { ...t, x: t.x + dx, y: t.y + dy } : t));
    if (e.key === 'ArrowLeft') pan(step, 0);
    else if (e.key === 'ArrowRight') pan(-step, 0);
    else if (e.key === 'ArrowUp') pan(0, step);
    else if (e.key === 'ArrowDown') pan(0, -step);
    else if (e.key === '+' || e.key === '=') zoomAt(1.25, size.w / 2, size.h / 2);
    else if (e.key === '-') zoomAt(0.8, size.w / 2, size.h / 2);
    else if (e.key === '0') fit();
    else return;
    e.preventDefault();
  };

  // Group tokens per hex
  const stacks = useMemo(() => {
    const m = new Map<HexKey, TokenView[]>();
    for (const t of view.tokens) {
      const k = hexKey(t.pos);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'player' ? -1 : 1));
    return [...m.values()];
  }, [view.tokens]);

  const selectedToken = view.tokens.find((t) => t.id === selectedTokenId) ?? null;
  const hoverExplain = hover && selectedToken?.details ? explain(hover) : null;
  const previewPath = useMemo(() => {
    if (!hover || !selectedToken || !fullReach || placeMode) return null;
    const p = pathTo(fullReach, hover);
    if (!p || !p.length) return null;
    return [selectedToken.pos, ...p].map((h) => center(h));
  }, [hover, selectedToken, fullReach, placeMode]);

  const reachShapes = useMemo(() => {
    if (!reach) return null;
    const own = selectedToken ? hexKey(selectedToken.pos) : '';
    const fill = [...reach.keys()]
      .filter((k) => k !== own)
      .map((k) => {
        const c = center(parseKey(k));
        return `M${hexCorners(c.x, c.y, HEX_SIZE * 0.86).replace(/ /g, 'L')}Z`;
      })
      .join('');
    return { fill, edge: boundaryPath(reach.keys(), (k) => reach.has(k), parseKey) };
  }, [reach, selectedToken]);

  const hoverHex = hover ? view.hexByKey[hover] : null;
  const hoverTokens = hover ? view.tokens.filter((t) => hexKey(t.pos) === hover) : [];
  const hoverSite = hoverHex?.siteId ? view.sites.find((s) => s.id === hoverHex.siteId) : null;
  const night = view.phase === 'night';
  const bgSize = 320 * (tf?.k ?? 1);

  return (
    <div
      ref={wrapRef}
      className="explore-bg relative h-full w-full touch-none overflow-hidden select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50"
      style={{
        cursor: drag.current?.moved ? 'grabbing' : placeMode ? 'crosshair' : 'default',
        backgroundPosition: tf ? `${tf.x}px ${tf.y}px` : undefined,
        backgroundSize: `${bgSize}px ${bgSize}px, cover`,
      }}
      tabIndex={0}
      role="application"
      aria-label="Arena map. Arrow keys pan, plus and minus zoom, 0 recentres."
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        const r = wrapRef.current!.getBoundingClientRect();
        setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
        if (!drag.current?.moved) {
          const k = keyAt(e.clientX, e.clientY);
          if (k !== hover) setHover(k);
        }
      }}
      onPointerLeave={() => setHover(null)}
      onClick={handleClick}
    >
      <TerrainCanvas hexes={view.hexes} byKey={view.hexByKey} overlayFog={overlayFog} fogUnknown={!isGm} tf={tf} size={size} />

      {/* Day / night atmosphere */}
      <div className={`atmo atmo-day ${night ? 'opacity-0' : 'opacity-100'}`} aria-hidden="true" />
      <div className={`atmo atmo-night ${night ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />

      <LightCanvas view={view} tf={tf} size={size} reducedMotion={reducedMotion} />
      <AtmosphereCanvas phase={view.phase} tf={tf} size={size} reducedMotion={reducedMotion} enabled={atmosphere} />

      <svg width={size.w} height={size.h} className="absolute inset-0 block">
        <MapDefs />
        {tf && (
          <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
            {reachShapes && (
              <g pointerEvents="none">
                <path d={reachShapes.fill} fill="rgba(243,220,154,0.16)" />
                <path d={reachShapes.edge} stroke="#000" strokeOpacity={0.5} strokeWidth={5} fill="none" />
                <path d={reachShapes.edge} stroke="#e8d4a6" strokeWidth={2.2} fill="none" />
              </g>
            )}

            <g pointerEvents="none">
              {view.sites
                .filter((s) => !(s.type === 'start' && view.hexByKey[hexKey(s.pos)]?.feature === 'eagle'))
                .map((s) => (
                  <SiteMarker key={s.id} site={s} gm={isGm} />
                ))}
              {view.role === 'player' &&
                view.teams.filter((t) => t.kind === 'rival' && !t.currentlyVisible && t.lastSeen).map((t) => <LastSeenMarker key={t.id} team={t} />)}
            </g>

            {previewPath && (
              <g pointerEvents="none">
                <polyline
                  points={previewPath.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={hoverExplain?.ok ? '#e8d4a6' : '#e5484d'}
                  strokeWidth={3}
                  strokeDasharray="6 5"
                  strokeLinecap="round"
                  filter="url(#soft-glow)"
                />
                {previewPath.slice(1).map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={hoverExplain?.ok ? '#e8d4a6' : '#e5484d'} />
                ))}
              </g>
            )}

            {selectedHex && view.hexByKey[selectedHex] && <HexOutline k={selectedHex} color="#e8d4a6" width={3} />}
            {hover && hover !== selectedHex && <HexOutline k={hover} color="rgba(255,255,255,0.75)" width={1.6} />}

            {view.trackers.map((t) => (
              <TrackerMarker key={t.teamId} t={t} />
            ))}

            {stacks.map((s) => (
              <TokenStack
                key={hexKey(s[0].pos)}
                tokens={s}
                selectedId={selectedTokenId}
                viewerId={view.viewerId}
                hiddenTeamIds={hiddenTeamIds}
                onSelect={props.onTokenClick}
              />
            ))}
          </g>
        )}
      </svg>

      {hoverHex && !drag.current?.moved && (
        <div
          className="pointer-events-none absolute z-20 max-w-64 rounded-lg border border-gold-700/50 bg-ink-900/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(mouse.x + 16, size.w - 260), top: Math.min(mouse.y + 16, size.h - 150) }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-marble-50">
              {hoverHex.feature ? 'Imperial Marble' : hoverHex.terrain ? TERRAIN[hoverHex.terrain].label : 'Unexplored'}
            </span>
            <span className="text-marble-500">
              {hoverHex.q}|{hoverHex.r}
            </span>
          </div>
          {hoverHex.terrain && (
            <div className="text-marble-300">
              {TERRAIN[hoverHex.terrain].cost === null ? 'Impassable' : `Cost: ${fmt(TERRAIN[hoverHex.terrain].cost!)} MP`}
              {hoverHex.fog === 'explored' && <span className="text-marble-500"> · remembered</span>}
            </div>
          )}
          {hoverHex.feature && !hoverSite && <div className="mt-1 text-gold-200">{HEX_FEATURE_INFO[hoverHex.feature].split(' – ')[0]}</div>}
          {hoverHex.edges ? <div className="text-gold-300">▰ Arena wall</div> : null}
          {hoverHex.zone !== 'safe' && (
            <div className={hoverHex.zone === 'warning' ? 'text-amber-300' : 'text-blood-400'}>
              {hoverHex.zone === 'warning' ? '⚠ Soon a death zone' : hoverHex.zone === 'closed' ? '⛔ Closed' : '☠ Death zone'}
            </div>
          )}
          {hoverSite && <div className="mt-1 text-gold-300">◆ {hoverSite.name}</div>}
          {hoverTokens.length > 0 && <div className="mt-1 text-marble-100">{hoverTokens.map((t) => t.name).join(', ')}</div>}
          {placeMode && selectedToken && <div className="mt-1 text-arcane-300">Click: place {selectedToken.name} here</div>}
          {!placeMode && hoverExplain && (
            <div className={`mt-1 font-medium ${hoverExplain.ok ? 'text-gold-200' : 'text-blood-400'}`}>
              {hoverExplain.ok ? `→ ${hoverExplain.steps} ${hoverExplain.steps === 1 ? 'hex' : 'hexes'} · ${fmt(hoverExplain.cost)} MP` : `✕ ${hoverExplain.reason}`}
            </div>
          )}
        </div>
      )}

      <Legend atmosphere={atmosphere} setAtmosphere={setAtmosphere} />

      <div className="absolute right-3 bottom-3 z-10 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost h-9 w-9 text-base" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)}>
          +
        </button>
        <button className="btn btn-ghost h-9 w-9 text-base" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomAt(0.8, size.w / 2, size.h / 2)}>
          −
        </button>
        <button
          className="btn btn-ghost h-9 w-9"
          title={isGm ? 'Show the whole arena (0)' : 'Show the explored area (0)'}
          aria-label={isGm ? 'Show the whole arena' : 'Show the explored area'}
          onClick={fit}
        >
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
