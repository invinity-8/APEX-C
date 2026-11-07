/**
 * Shared viewport of the hex map engine (Arena and all hex scenes): size tracking, fit, mouse-wheel
 * zoom around the cursor, drag to pan, two-finger pinch, keyboard pan/zoom and pixel → hex hit testing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fromPixel, hexKey, type HexKey } from '../../game/hex';
import { HEX_SIZE } from './geometry';
import type { Transform } from './TerrainCanvas';

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

export function useHexViewport({ bounds, maxK, fitMaxK, fitSignature }: { bounds: Bounds; maxK: number; fitMaxK: number; fitSignature: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tf, setTf] = useState<Transform | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pointers: Map<number, { x: number; y: number }>; pinch?: number } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitK = size.w ? Math.min(size.w / (bounds.x1 - bounds.x0), size.h / (bounds.y1 - bounds.y0)) : 1;
  // Zoom limit derives from the shown area only, so it reveals nothing about hidden map size.
  const minK = Math.max(0.08, Math.min(0.5, fitK * 0.6));

  const fit = useCallback(() => {
    const k = Math.max(minK, Math.min(fitMaxK, fitK));
    setTf({ k, x: size.w / 2 - ((bounds.x0 + bounds.x1) / 2) * k, y: size.h / 2 - ((bounds.y0 + bounds.y1) / 2) * k });
  }, [minK, fitK, fitMaxK, size, bounds]);

  const fittedFor = useRef('');
  useEffect(() => {
    if (size.w > 0 && fittedFor.current !== fitSignature) {
      fittedFor.current = fitSignature;
      fit();
    }
  }, [size, fitSignature, fit]);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      setTf((t) => {
        if (!t) return t;
        const k = Math.max(minK, Math.min(maxK, t.k * factor));
        const f = k / t.k;
        return { k, x: px - (px - t.x) * f, y: py - (py - t.y) * f };
      });
    },
    [minK, maxK],
  );

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
        if (d.pinch && wrapRef.current) {
          const rect = wrapRef.current.getBoundingClientRect();
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

  /** Screen position → hex key (null when `known` says the hex is not part of the map). */
  const keyAt = (clientX: number, clientY: number, known: (k: HexKey) => boolean): HexKey | null => {
    if (!tf || !wrapRef.current) return null;
    const r = wrapRef.current.getBoundingClientRect();
    const k = hexKey(fromPixel((clientX - r.left - tf.x) / tf.k, (clientY - r.top - tf.y) / tf.k, HEX_SIZE));
    return known(k) ? k : null;
  };

  /** True once after a drag: the following click must not act on the map. */
  const consumeDragClick = () => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
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

  return { wrapRef, size, tf, setTf, zoomAt, fit, onPointerDown, onKeyDown, keyAt, consumeDragClick, dragging: () => !!drag.current?.moved };
}
