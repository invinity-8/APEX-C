import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { hexCorners, hexKey, parseKey, type HexKey } from '../../game/hex';
import { pathTo, type ReachInfo } from '../../game/movement';
import { TERRAIN } from '../../game/terrain';
import type { Fog, TokenView, ViewModel } from '../../game/visibility';
import type { ReachExplanation } from '../../game/viewRules';
import { fmt } from '../../game/commands';
import { HEX_SIZE, boundaryPath, center } from './geometry';
import { HexLayer, MapDefs } from './HexLayer';
import { LastSeenMarker, SiteMarker, TokenStack, TrackerMarker } from './Markers';
import { Legend } from './Legend';

export interface MapHandle {
  focus: (key: HexKey) => void;
}

interface Props {
  view: ViewModel;
  selectedTokenId: string | null;
  selectedHex: HexKey | null;
  /** Erreichbare Felder der ausgewählten Figur (mit BP-Budget). */
  reach: Map<HexKey, ReachInfo> | null;
  /** Wegsuche ohne Budget – für die Kostenanzeige. */
  fullReach: Map<HexKey, ReachInfo> | null;
  explain: (key: HexKey) => ReachExplanation | null;
  placeMode: boolean;
  overlayFog: Record<HexKey, Fog> | null;
  hiddenTeamIds: Set<string>;
  onHexClick: (key: HexKey) => void;
  onTokenClick: (id: string) => void;
  mapRef?: Ref<MapHandle>;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.25;
const MAX_K = 4;

export function ArenaMap(props: Props) {
  const { view, selectedTokenId, selectedHex, reach, fullReach, explain, placeMode, overlayFog, hiddenTeamIds } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tf, setTf] = useState<Transform | null>(null);
  const [hover, setHover] = useState<HexKey | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean; pointers: Map<number, { x: number; y: number }>; pinch?: number } | null>(null);
  const suppressClick = useRef(false);

  // Kartengröße in Pixeln (für "Ganze Arena zeigen")
  const bounds = useMemo(() => {
    const R = view.mapRadius;
    return { w: HEX_SIZE * Math.sqrt(3) * (2 * R + 1), h: HEX_SIZE * (3 * R + 2) };
  }, [view.mapRadius]);

  const fit = useCallback(() => {
    const k = Math.min(size.w / bounds.w, size.h / bounds.h) * 0.94;
    setTf({ x: size.w / 2, y: size.h / 2, k: Math.max(MIN_K, Math.min(MAX_K, k)) });
  }, [size, bounds]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Beim ersten Mal und bei geänderter Kartengröße einpassen.
  const fittedFor = useRef<string>('');
  useEffect(() => {
    const sig = `${view.mapRadius}`;
    if (size.w > 0 && fittedFor.current !== sig) {
      fittedFor.current = sig;
      fit();
    }
  }, [size, view.mapRadius, fit]);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setTf((t) => {
      if (!t) return t;
      const k = Math.max(MIN_K, Math.min(MAX_K, t.k * factor));
      const f = k / t.k;
      return { k, x: px - (px - t.x) * f, y: py - (py - t.y) * f };
    });
  }, []);

  useImperativeHandle(props.mapRef, () => ({
    focus: (key: HexKey) => {
      const c = center(parseKey(key));
      setTf((t) => {
        const k = Math.max(t?.k ?? 1, 0.85);
        return { k, x: size.w / 2 - c.x * k, y: size.h / 2 - c.y * k };
      });
    },
  }));

  // Mausrad-Zoom (nicht-passiver Listener, damit die Seite nicht scrollt).
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

  // Panning & Pinch-Zoom: Bewegungen laufen über window, damit Klicks auf Felder normal funktionieren.
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

  const keyFromEvent = (e: React.SyntheticEvent): HexKey | null =>
    ((e.target as Element).closest('[data-key]') as HTMLElement | null)?.dataset.key ?? null;

  const handleClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const key = keyFromEvent(e);
    if (key) props.onHexClick(key);
  };

  // Figuren pro Feld gruppieren
  const stacks = useMemo(() => {
    const m = new Map<HexKey, TokenView[]>();
    for (const t of view.tokens) {
      const k = hexKey(t.pos);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    // eigene Figur zuerst
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

  const reachEdge = useMemo(() => (reach ? boundaryPath(reach.keys(), (k) => reach.has(k), parseKey) : ''), [reach]);

  const hoverHex = hover ? view.hexByKey[hover] : null;
  const hoverTokens = hover ? view.tokens.filter((t) => hexKey(t.pos) === hover) : [];
  const hoverSite = hoverHex?.siteId ? view.sites.find((s) => s.id === hoverHex.siteId) : null;

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        const r = wrapRef.current!.getBoundingClientRect();
        setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onPointerLeave={() => setHover(null)}
      style={{ cursor: drag.current?.moved ? 'grabbing' : placeMode ? 'crosshair' : 'default' }}
    >
      <svg width={size.w} height={size.h} className="block" onClick={handleClick}>
        <MapDefs />
        <rect width={size.w} height={size.h} fill="url(#map-bg)" />
        {tf && (
          <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
            <g
              onPointerOver={(e) => {
                const k = keyFromEvent(e);
                if (k) setHover(k);
              }}
            >
              <HexLayer hexes={view.hexes} overlayFog={overlayFog} />
            </g>

            {/* Erreichbare Felder: leichte Füllung + goldene Reichweitengrenze */}
            {reach && (
              <g pointerEvents="none">
                {[...reach.keys()].map((k) => {
                  if (selectedToken && k === hexKey(selectedToken.pos)) return null;
                  const c = center(parseKey(k));
                  return <polygon key={k} points={hexCorners(c.x, c.y, HEX_SIZE * 0.82)} fill="rgba(243,220,154,0.13)" />;
                })}
                <path d={reachEdge} stroke="#000" strokeOpacity={0.5} strokeWidth={5} fill="none" />
                <path d={reachEdge} stroke="#f3dc9a" strokeWidth={2.2} fill="none" />
              </g>
            )}

            {/* Orte, Sichtungen, Tracking */}
            {view.sites.map((s) => (
              <SiteMarker key={s.id} site={s} gm={view.role === 'gm'} />
            ))}
            {view.role === 'player' &&
              view.teams.filter((t) => t.kind === 'rival' && !t.currentlyVisible && t.lastSeen).map((t) => <LastSeenMarker key={t.id} team={t} />)}

            {/* Wegvorschau */}
            {previewPath && (
              <g pointerEvents="none">
                <polyline
                  points={previewPath.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={hoverExplain?.ok ? '#f3dc9a' : '#e5484d'}
                  strokeWidth={3}
                  strokeDasharray="6 5"
                  strokeLinecap="round"
                />
                {previewPath.slice(1).map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={hoverExplain?.ok ? '#f3dc9a' : '#e5484d'} />
                ))}
              </g>
            )}

            {/* Auswahl & Hover */}
            {selectedHex && view.hexByKey[selectedHex] && (
              <HexOutline k={selectedHex} color="#f3dc9a" width={3} />
            )}
            {hover && hover !== selectedHex && <HexOutline k={hover} color="rgba(255,255,255,0.7)" width={1.6} />}

            {view.trackers.map((t) => (
              <TrackerMarker key={t.teamId} t={t} />
            ))}

            {/* Figuren */}
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

      {/* Tooltip */}
      {hoverHex && !drag.current?.moved && (
        <div
          className="pointer-events-none absolute z-20 max-w-64 rounded-lg border border-gold-700/50 bg-ink-900/95 px-3 py-2 text-xs shadow-xl"
          style={{
            left: Math.min(mouse.x + 16, size.w - 260),
            top: Math.min(mouse.y + 16, size.h - 140),
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-marble-50">
              {hoverHex.terrain ? TERRAIN[hoverHex.terrain].label : 'Unerforscht'}
            </span>
            <span className="text-marble-500">
              {hoverHex.q}|{hoverHex.r}
            </span>
          </div>
          {hoverHex.terrain && (
            <div className="text-marble-300">
              {TERRAIN[hoverHex.terrain].cost === null ? 'Nicht passierbar' : `Kosten: ${fmt(TERRAIN[hoverHex.terrain].cost!)} BP`}
              {hoverHex.fog === 'explored' && <span className="text-marble-500"> · erinnert</span>}
            </div>
          )}
          {hoverHex.zone !== 'safe' && (
            <div className={hoverHex.zone === 'warning' ? 'text-amber-300' : 'text-blood-400'}>
              {hoverHex.zone === 'warning' ? '⚠ Wird bald zur Todeszone' : hoverHex.zone === 'closed' ? '⛔ Gesperrt' : '☠ Todeszone'}
            </div>
          )}
          {hoverSite && <div className="mt-1 text-gold-300">◆ {hoverSite.name}</div>}
          {hoverTokens.length > 0 && <div className="mt-1 text-marble-100">{hoverTokens.map((t) => t.name).join(', ')}</div>}
          {placeMode && selectedToken && <div className="mt-1 text-arcane-300">Klicken: {selectedToken.name} hierher setzen</div>}
          {!placeMode && hoverExplain && (
            <div className={`mt-1 font-medium ${hoverExplain.ok ? 'text-gold-200' : 'text-blood-400'}`}>
              {hoverExplain.ok
                ? `→ ${hoverExplain.steps} Feld${hoverExplain.steps === 1 ? '' : 'er'} · ${fmt(hoverExplain.cost)} BP`
                : `✕ ${hoverExplain.reason}`}
            </div>
          )}
        </div>
      )}

      <Legend />

      {/* Zoom */}
      <div className="absolute right-3 bottom-3 z-10 flex flex-col gap-1.5">
        <button className="btn btn-ghost h-9 w-9 text-base" title="Hineinzoomen" onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)}>
          +
        </button>
        <button className="btn btn-ghost h-9 w-9 text-base" title="Herauszoomen" onClick={() => zoomAt(0.8, size.w / 2, size.h / 2)}>
          −
        </button>
        <button className="btn btn-ghost h-9 w-9" title="Ganze Arena zeigen" onClick={fit}>
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
