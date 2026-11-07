/**
 * Modular workspace (APEX 0.5): left dock · centre (map + optional bottom dock) · right dock.
 * Widgets can be dragged between compatible docks and reordered, moved with the keyboard via the widget
 * menu, collapsed, hidden and restored ("Widgets" menu), docks can be resized, and the whole workspace reset.
 *
 * Performance / safety:
 *  - the layout is personal and lives in localStorage (debounced write), never in the game state – no
 *    Supabase request and no Realtime broadcast for any drag, resize or collapse;
 *  - collapsed and hidden widgets are unmounted; open widgets keep stable keys (no re-mounting);
 *  - which widgets exist is decided by the caller from server-provided data – a player's client never
 *    receives GM widget definitions or GM data, so editing the stored layout cannot reveal them.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BareSections } from '../components/ui';
import {
  DOCKS,
  dockOf,
  hideWidget,
  moveWidget,
  normalizeLayout,
  nudgeWidget,
  readLayout,
  resizeDock,
  resetWidget,
  toggleCollapsed,
  writeLayout,
  type Dock,
  type Layout,
  type WidgetMeta,
} from './layout';

export interface WidgetDef extends WidgetMeta {
  title: string;
  icon: string;
  /** Small counter in the header (e.g. events awaiting a decision). */
  badge?: number;
  /**
   * Not relevant right now (e.g. Arena tools while a battle map is shown). The widget keeps its stored
   * dock, order and collapsed state but is not rendered and not offered in the "Widgets" menu.
   */
  inactive?: boolean;
  render: () => ReactNode;
}

interface WorkspaceApi {
  /** Shows a widget: restores it if hidden, expands it and scrolls it into view. */
  reveal: (id: string) => void;
}
const WorkspaceContext = createContext<WorkspaceApi>({ reveal: () => {} });
export const useWorkspace = () => useContext(WorkspaceContext);

const DOCK_LABEL: Record<Dock, string> = { left: 'left dock', right: 'right dock', bottom: 'bottom dock' };
const SAVE_DELAY_MS = 400;

export function Workspace({ widgets, defaults, storageKey, center }: { widgets: WidgetDef[]; defaults: Layout; storageKey: string; center: ReactNode }) {
  const metas = useMemo(() => widgets.map(({ id, docks }) => ({ id, docks })), [widgets]);
  const idsKey = metas.map((m) => m.id).join('|');
  const [layout, setLayout] = useState<Layout>(() => normalizeLayout(readLayout(storageKey), metas, defaults));
  // widgets appear/disappear (e.g. role change, online features): re-normalise once per change of the id set
  const lastIds = useRef(idsKey);
  useEffect(() => {
    if (lastIds.current === idsKey) return;
    lastIds.current = idsKey;
    setLayout((l) => normalizeLayout(l, metas, defaults));
  }, [idsKey, metas, defaults]);
  // debounced, local-only persistence
  useEffect(() => {
    const t = setTimeout(() => writeLayout(storageKey, layout), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [layout, storageKey]);

  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ dock: Dock; index: number } | null>(null);

  const reveal = useCallback(
    (id: string) => {
      setLayout((l) => {
        let next = l;
        if (!dockOf(next, id)) {
          const home = DOCKS.find((d) => defaults.docks[d].includes(id)) ?? 'right';
          next = moveWidget(next, id, home, 0, metas);
        }
        return toggleCollapsed(next, id, false);
      });
      requestAnimationFrame(() => document.getElementById(`widget-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    },
    [defaults, metas],
  );
  const api = useMemo(() => ({ reveal }), [reveal]);

  const onDragOver = (dock: Dock) => (e: React.DragEvent<HTMLElement>) => {
    if (!drag || (byId.get(drag)?.docks && !byId.get(drag)!.docks!.includes(dock))) return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(':scope > [data-widget]')].filter((el) => el.dataset.widget !== drag);
    const horizontal = dock === 'bottom';
    let index = items.length;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    // translate index among "others" into the index in the dock list
    const list = layout.docks[dock].filter((x) => x !== drag);
    const target = index < list.length ? layout.docks[dock].indexOf(list[index]) : layout.docks[dock].length;
    if (!drop || drop.dock !== dock || drop.index !== target) setDrop({ dock, index: target });
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (drag && drop) setLayout((l) => moveWidget(l, drag, drop.dock, drop.index, metas));
    setDrag(null);
    setDrop(null);
  };

  const renderDock = (dock: Dock) => {
    const ids = layout.docks[dock].filter((id) => byId.has(id) && !byId.get(id)!.inactive);
    const visible = ids.length > 0 || !!drag;
    if (!visible) return null;
    const size = layout.size[dock];
    return (
      <aside
        key={dock}
        aria-label={`Workspace ${DOCK_LABEL[dock]}`}
        data-dock={dock}
        className={`ws-dock ws-dock-${dock} ${drag ? 'ws-dock-dragging' : ''}`}
        style={{ ['--dock-size' as string]: `${size}px` }}
        onDragOver={onDragOver(dock)}
        onDrop={onDrop}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop((d) => (d?.dock === dock ? null : d));
        }}
      >
        {dock !== 'left' && <ResizeHandle dock={dock} size={size} onResize={(px) => setLayout((l) => resizeDock(l, dock, px))} />}
        {ids.map((id, i) => (
          <WidgetFrame
            key={id}
            def={byId.get(id)!}
            dock={dock}
            first={i === 0}
            last={i === ids.length - 1}
            collapsed={layout.collapsed.includes(id)}
            dropBefore={drop?.dock === dock && drop.index === i && drag !== id}
            onToggle={() => setLayout((l) => toggleCollapsed(l, id))}
            onHide={() => setLayout((l) => hideWidget(l, id))}
            onNudge={(d) => setLayout((l) => nudgeWidget(l, id, d, metas))}
            onMoveTo={(d) => setLayout((l) => moveWidget(l, id, d, l.docks[d].length, metas))}
            onReset={() => setLayout((l) => resetWidget(l, id, defaults))}
            onDragStart={() => setDrag(id)}
            onDragEnd={() => {
              setDrag(null);
              setDrop(null);
            }}
          />
        ))}
        {drop?.dock === dock && drop.index >= ids.length && <div className="ws-drop-line" aria-hidden />}
        {!ids.length && <div className="ws-drop-empty">Drop a widget here</div>}
        {dock === 'left' && <ResizeHandle dock={dock} size={size} onResize={(px) => setLayout((l) => resizeDock(l, dock, px))} />}
      </aside>
    );
  };

  const hiddenDefs = layout.hidden.map((id) => byId.get(id)).filter((w): w is WidgetDef => !!w && !w.inactive);
  return (
    <WorkspaceContext.Provider value={api}>
      <div className="ws-root">
        {renderDock('left')}
        <div className="ws-center">
          <div className="ws-map">
            {center}
            <WidgetMenu hidden={hiddenDefs} onAdd={(id) => reveal(id)} onReset={() => setLayout(normalizeLayout(null, metas, defaults))} />
          </div>
          {renderDock('bottom')}
        </div>
        {renderDock('right')}
      </div>
    </WorkspaceContext.Provider>
  );
}

function WidgetFrame(props: {
  def: WidgetDef;
  dock: Dock;
  first: boolean;
  last: boolean;
  collapsed: boolean;
  dropBefore: boolean;
  onToggle: () => void;
  onHide: () => void;
  onNudge: (d: -1 | 1) => void;
  onMoveTo: (d: Dock) => void;
  onReset: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { def, dock, collapsed } = props;
  const [menu, setMenu] = useState(false);
  const allowedDocks = DOCKS.filter((d) => d !== dock && (!def.docks || def.docks.includes(d)));
  return (
    <>
      {props.dropBefore && <div className="ws-drop-line" aria-hidden />}
      <section id={`widget-${def.id}`} data-widget={def.id} className="panel ws-widget" aria-label={def.title}>
        <div
          className="widget-header ws-handle"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', def.id);
            props.onDragStart();
          }}
          onDragEnd={props.onDragEnd}
        >
          <span className="cursor-grab text-marble-500" aria-hidden title="Drag to move">
            ⠿
          </span>
          <button className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={!collapsed} onClick={props.onToggle}>
            <span aria-hidden>{def.icon}</span>
            <h2 className="panel-title truncate">{def.title}</h2>
            {!!def.badge && (
              <span className="rounded-full bg-gold-400 px-1.5 text-[10px] font-bold text-ink-950" aria-label={`${def.badge} pending`}>
                {def.badge}
              </span>
            )}
          </button>
          <div className="relative">
            <button className="ws-icon" aria-label={`${def.title} options`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              ⋯
            </button>
            {menu && (
              <div role="menu" className="ws-menu" onMouseLeave={() => setMenu(false)}>
                <MenuItem disabled={props.first} onClick={() => (props.onNudge(-1), setMenu(false))}>
                  {dock === 'bottom' ? '← Move left' : '↑ Move up'}
                </MenuItem>
                <MenuItem disabled={props.last} onClick={() => (props.onNudge(1), setMenu(false))}>
                  {dock === 'bottom' ? '→ Move right' : '↓ Move down'}
                </MenuItem>
                {allowedDocks.map((d) => (
                  <MenuItem key={d} onClick={() => (props.onMoveTo(d), setMenu(false))}>
                    Move to {DOCK_LABEL[d]}
                  </MenuItem>
                ))}
                <MenuItem onClick={() => (props.onToggle(), setMenu(false))}>{collapsed ? 'Expand' : 'Collapse'}</MenuItem>
                <MenuItem onClick={() => (props.onReset(), setMenu(false))}>↺ Reset to default position</MenuItem>
                <MenuItem onClick={() => (props.onHide(), setMenu(false))}>Close (restore via “Widgets”)</MenuItem>
              </div>
            )}
          </div>
          <button className="ws-icon" aria-label={`Close ${def.title}`} title="Close – restore it via “Widgets”" onClick={props.onHide}>
            ×
          </button>
        </div>
        {!collapsed && (
          <div className="ws-body">
            <BareSections.Provider value={true}>{def.render()}</BareSections.Provider>
          </div>
        )}
      </section>
    </>
  );
}

function MenuItem({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button role="menuitem" className="ws-menu-item" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function WidgetMenu({ hidden, onAdd, onReset }: { hidden: WidgetDef[]; onAdd: (id: string) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ws-widget-menu">
      <button className="btn btn-ghost px-2 py-1 text-[11px]" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ☰ Widgets{hidden.length ? ` (${hidden.length} hidden)` : ''}
      </button>
      {open && (
        <div role="menu" className="ws-menu right-0 left-auto w-60" onMouseLeave={() => setOpen(false)}>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-marble-500">Add widget</div>
          {hidden.length ? (
            hidden.map((w) => (
              <MenuItem key={w.id} onClick={() => (onAdd(w.id), setOpen(false))}>
                {w.icon} {w.title}
              </MenuItem>
            ))
          ) : (
            <div className="px-2 py-1 text-[11px] text-marble-500">All widgets are shown.</div>
          )}
          <div className="imperial-rule my-1" />
          <MenuItem onClick={() => (onReset(), setOpen(false))}>↺ Reset Layout to Default</MenuItem>
        </div>
      )}
    </div>
  );
}

function ResizeHandle({ dock, size, onResize }: { dock: Dock; size: number; onResize: (px: number) => void }) {
  const start = useRef<{ p: number; size: number } | null>(null);
  const horizontal = dock !== 'bottom';
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={`Resize ${DOCK_LABEL[dock]}`}
      aria-valuenow={size}
      tabIndex={0}
      className={`ws-resize ws-resize-${dock}`}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 16;
        const grow = dock === 'left' ? 'ArrowRight' : dock === 'right' ? 'ArrowLeft' : 'ArrowUp';
        const shrink = dock === 'left' ? 'ArrowLeft' : dock === 'right' ? 'ArrowRight' : 'ArrowDown';
        if (e.key === grow) onResize(size + step);
        if (e.key === shrink) onResize(size - step);
      }}
      onPointerDown={(e) => {
        start.current = { p: horizontal ? e.clientX : e.clientY, size };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const d = (horizontal ? e.clientX : e.clientY) - start.current.p;
        onResize(start.current.size + (dock === 'left' ? d : -d));
      }}
      onPointerUp={() => (start.current = null)}
    />
  );
}
