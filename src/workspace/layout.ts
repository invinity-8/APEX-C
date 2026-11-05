/**
 * Modular workspace – pure layout model (APEX 0.5). No React here, so every operation is unit-tested.
 * A layout is PERSONAL (one device, one profile, one role): it is stored in localStorage only, never in the
 * shared game state, never sent to Supabase and never broadcast over Realtime.
 */
export type Dock = 'left' | 'right' | 'bottom';
export const DOCKS: Dock[] = ['left', 'right', 'bottom'];

export interface Layout {
  v: 1;
  docks: Record<Dock, string[]>;
  collapsed: string[];
  hidden: string[];
  /** Dock size in px (width for left/right, height for bottom). */
  size: Record<Dock, number>;
}

export interface WidgetMeta {
  id: string;
  /** Docks this widget may live in (default: all). */
  docks?: Dock[];
}

export const SIZE_LIMITS: Record<Dock, [number, number]> = { left: [260, 560], right: [300, 560], bottom: [140, 420] };
export const DEFAULT_SIZE: Record<Dock, number> = { left: 340, right: 390, bottom: 220 };

export function emptyLayout(): Layout {
  return { v: 1, docks: { left: [], right: [], bottom: [] }, collapsed: [], hidden: [], size: { ...DEFAULT_SIZE } };
}

/** Builds the default layout from `placement` (dock → ordered ids) plus ids collapsed by default. */
export function defaultLayout(placement: Partial<Record<Dock, string[]>>, collapsed: string[] = [], hidden: string[] = []): Layout {
  const l = emptyLayout();
  for (const d of DOCKS) l.docks[d] = [...(placement[d] ?? [])];
  l.collapsed = [...collapsed];
  l.hidden = [...hidden];
  return l;
}

const allowed = (meta: Map<string, WidgetMeta>, id: string, dock: Dock) => {
  const m = meta.get(id);
  return !!m && (!m.docks || m.docks.includes(dock));
};

/**
 * Makes any stored layout valid for the widgets this user may see: unknown ids (e.g. a GM widget in a player's
 * stored layout) are dropped, duplicates removed, sizes clamped, and new widgets added at their default place.
 */
export function normalizeLayout(raw: unknown, widgets: WidgetMeta[], defaults: Layout): Layout {
  const meta = new Map(widgets.map((w) => [w.id, w]));
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Layout>;
  const out = emptyLayout();
  const seen = new Set<string>();
  for (const d of DOCKS) {
    const list = Array.isArray(src.docks?.[d]) ? (src.docks![d] as unknown[]) : [];
    for (const id of list) if (typeof id === 'string' && !seen.has(id) && allowed(meta, id, d)) (seen.add(id), out.docks[d].push(id));
    const n = Number(src.size?.[d]);
    out.size[d] = Number.isFinite(n) ? Math.min(SIZE_LIMITS[d][1], Math.max(SIZE_LIMITS[d][0], Math.round(n))) : defaults.size[d];
  }
  const filt = (xs: unknown) => (Array.isArray(xs) ? [...new Set(xs.filter((x): x is string => typeof x === 'string' && meta.has(x)))] : null);
  out.hidden = filt(src.hidden) ?? [...defaults.hidden].filter((x) => meta.has(x));
  out.collapsed = filt(src.collapsed) ?? [...defaults.collapsed].filter((x) => meta.has(x));
  out.hidden = out.hidden.filter((id) => !seen.has(id));
  // widgets the stored layout does not know yet → their default dock (or hidden, if hidden by default)
  for (const w of widgets) {
    if (seen.has(w.id) || out.hidden.includes(w.id)) continue;
    const d = DOCKS.find((k) => defaults.docks[k].includes(w.id));
    if (d && allowed(meta, w.id, d)) {
      const order = defaults.docks[d];
      const before = order.slice(0, order.indexOf(w.id)).filter((x) => out.docks[d].includes(x));
      const at = before.length ? out.docks[d].indexOf(before[before.length - 1]) + 1 : 0;
      out.docks[d].splice(at, 0, w.id);
    } else if (defaults.hidden.includes(w.id) || !d) out.hidden.push(w.id);
    seen.add(w.id);
  }
  return out;
}

export const dockOf = (l: Layout, id: string): Dock | null => DOCKS.find((d) => l.docks[d].includes(id)) ?? null;

/** Moves a widget to `dock` at `index` (also used for reordering inside one dock). Restores hidden widgets. */
export function moveWidget(l: Layout, id: string, dock: Dock, index: number, widgets: WidgetMeta[]): Layout {
  const meta = new Map(widgets.map((w) => [w.id, w]));
  if (!allowed(meta, id, dock)) return l;
  const next: Layout = { ...l, docks: { left: [...l.docks.left], right: [...l.docks.right], bottom: [...l.docks.bottom] }, hidden: l.hidden.filter((x) => x !== id) };
  const from = dockOf(l, id);
  let at = Math.max(0, Math.min(index, next.docks[dock].length));
  if (from) {
    const i = next.docks[from].indexOf(id);
    next.docks[from].splice(i, 1);
    if (from === dock && i < at) at -= 1;
  }
  next.docks[dock].splice(Math.min(at, next.docks[dock].length), 0, id);
  return next;
}

/** Keyboard reordering: -1 = up/left, +1 = down/right within the same dock. */
export function nudgeWidget(l: Layout, id: string, delta: -1 | 1, widgets: WidgetMeta[]): Layout {
  const d = dockOf(l, id);
  if (!d) return l;
  const i = l.docks[d].indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= l.docks[d].length) return l;
  return moveWidget(l, id, d, delta > 0 ? j + 1 : j, widgets);
}

/** Hiding never deletes data – the widget just leaves its dock and stays available in "Add widget". */
export function hideWidget(l: Layout, id: string): Layout {
  const d = dockOf(l, id);
  if (!d) return l;
  return { ...l, docks: { ...l.docks, [d]: l.docks[d].filter((x) => x !== id) }, hidden: l.hidden.includes(id) ? l.hidden : [...l.hidden, id] };
}

export function toggleCollapsed(l: Layout, id: string, collapsed?: boolean): Layout {
  const is = l.collapsed.includes(id);
  const want = collapsed ?? !is;
  if (want === is) return l;
  return { ...l, collapsed: want ? [...l.collapsed, id] : l.collapsed.filter((x) => x !== id) };
}

export function resizeDock(l: Layout, dock: Dock, px: number): Layout {
  const [lo, hi] = SIZE_LIMITS[dock];
  return { ...l, size: { ...l.size, [dock]: Math.min(hi, Math.max(lo, Math.round(px))) } };
}

// ---------------------------------------------------------------- persistence (debounced, local only)

/** v2 (APEX 0.7 consolidation): merged widgets – older layouts are not reused, everybody starts from the tidy default. */
export const layoutKey = (scope: string, role: 'gm' | 'player') => `apex.workspace.v2.${role}.${scope}`;

export function readLayout(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

export function writeLayout(key: string, l: Layout): void {
  try {
    localStorage.setItem(key, JSON.stringify(l));
  } catch {
    /* private mode / quota – layout simply is not remembered */
  }
}

/** Puts ONE widget back to its default dock, position and collapsed state; every other widget stays where it is. */
export function resetWidget(l: Layout, id: string, defaults: Layout): Layout {
  const docks = { left: l.docks.left.filter((x) => x !== id), right: l.docks.right.filter((x) => x !== id), bottom: l.docks.bottom.filter((x) => x !== id) };
  const hidden = l.hidden.filter((x) => x !== id);
  const collapsed = l.collapsed.filter((x) => x !== id);
  if (defaults.collapsed.includes(id)) collapsed.push(id);
  const home = DOCKS.find((d) => defaults.docks[d].includes(id));
  if (!home) return { ...l, docks, hidden: [...hidden, id], collapsed };
  const order = defaults.docks[home];
  const before = order.slice(0, order.indexOf(id)).filter((x) => docks[home].includes(x));
  const at = before.length ? docks[home].indexOf(before[before.length - 1]) + 1 : 0;
  docks[home].splice(at, 0, id);
  return { ...l, docks, hidden, collapsed };
}
