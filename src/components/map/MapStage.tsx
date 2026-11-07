/**
 * Game map stage: the central map area with zoom controls and a drag handle on the bottom edge to make
 * the map taller or shorter. Zoom and height are personal display settings (localStorage only).
 * Scene maps read the zoom from MapZoomContext; the Arena map keeps its own wheel/pinch zoom.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export const MapZoomContext = createContext(1);
export const useMapZoom = () => useContext(MapZoomContext);

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const MIN_STAGE_HEIGHT = 240;
const HEIGHT_KEY = 'apex.game.map-height';
const ZOOM_KEY = 'apex.game.map-zoom';

/** Next zoom step in a direction (pure, tested). */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-6) ?? ZOOM_STEPS[0];
}
export const clampHeight = (h: number, max: number) => Math.round(Math.max(MIN_STAGE_HEIGHT, Math.min(Math.max(MIN_STAGE_HEIGHT, max), h)));

const read = (key: string): number | null => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const write = (key: string, v: number | null) => {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(v));
  } catch {
    /* display preference stays session-local */
  }
};

export function MapStage({ children, zoomable }: { children: ReactNode; zoomable: boolean }) {
  const [zoom, setZoom] = useState(() => {
    const z = read(ZOOM_KEY);
    return z && ZOOM_STEPS.includes(z) ? z : 1;
  });
  const [height, setHeight] = useState<number | null>(() => read(HEIGHT_KEY));
  const start = useRef<{ y: number; h: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => write(ZOOM_KEY, zoom === 1 ? null : zoom), [zoom]);
  useEffect(() => {
    const t = setTimeout(() => write(HEIGHT_KEY, height), 300);
    return () => clearTimeout(t);
  }, [height]);
  const maxHeight = () => (typeof window === 'undefined' ? 2000 : window.innerHeight * 2);
  const resize = (h: number) => setHeight(clampHeight(h, maxHeight()));

  return (
    <div ref={ref} className="map-stage" data-fixed-height={height !== null ? '' : undefined} style={height !== null ? { height } : undefined}>
      <MapZoomContext.Provider value={zoomable ? zoom : 1}>
        <div className="map-stage-body">{children}</div>
      </MapZoomContext.Provider>
      {zoomable && (
        <div className="map-stage-zoom" role="group" aria-label="Map zoom">
          <button type="button" className="ws-icon" aria-label="Zoom out" disabled={zoom <= ZOOM_STEPS[0]} onClick={() => setZoom((z) => stepZoom(z, -1))}>
            −
          </button>
          <button type="button" className="map-stage-zoom-value" aria-label="Reset zoom to 100%" title="Reset to 100%" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="ws-icon" aria-label="Zoom in" disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => setZoom((z) => stepZoom(z, 1))}>
            +
          </button>
        </div>
      )}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Map height – drag, or use the arrow keys; double-click to fill the screen"
        aria-valuenow={height ?? undefined}
        tabIndex={0}
        className="map-stage-resize"
        title="Drag to change the map height · double-click to fill"
        onDoubleClick={() => setHeight(null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 80 : 24;
          const cur = height ?? ref.current?.getBoundingClientRect().height ?? 480;
          if (e.key === 'ArrowDown') (e.preventDefault(), resize(cur + step));
          if (e.key === 'ArrowUp') (e.preventDefault(), resize(cur - step));
          if (e.key === 'Home' || e.key === 'Escape') setHeight(null);
        }}
        onPointerDown={(e) => {
          start.current = { y: e.clientY, h: height ?? ref.current?.getBoundingClientRect().height ?? 480 };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (start.current) resize(start.current.h + e.clientY - start.current.y);
        }}
        onPointerUp={() => (start.current = null)}
        onPointerCancel={() => (start.current = null)}
      />
    </div>
  );
}
