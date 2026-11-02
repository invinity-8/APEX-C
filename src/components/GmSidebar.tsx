/**
 * GM navigation (APEX 0.4): one sidebar of collapsible sections with search, pinned favourites and a
 * badge for events awaiting a decision. Open/pinned state is remembered per profile in localStorage.
 * Collapsed sections are unmounted, so expensive panels (Players, World) only run while open – and an
 * open section keeps its component instance (stable keys), so nothing re-mounts on unrelated renders.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BareSections } from './ui';

export interface GmSection {
  id: string;
  title: string;
  icon: string;
  /** Extra words the search matches (e.g. "fog radius shrink"). */
  keywords: string;
  badge?: number;
  /** Rendered only while the section is open. */
  render: () => ReactNode;
}

interface Layout {
  open: string[];
  pinned: string[];
}

const DEFAULT_LAYOUT: Layout = { open: ['events'], pinned: ['events', 'announcements'] };

function loadLayout(key: string): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Layout> | null;
    if (raw && Array.isArray(raw.open) && Array.isArray(raw.pinned))
      return { open: raw.open.filter((x) => typeof x === 'string'), pinned: raw.pinned.filter((x) => typeof x === 'string') };
  } catch {
    /* private mode / corrupt value: defaults */
  }
  return DEFAULT_LAYOUT;
}

export function GmSidebar({ sections, storageKey }: { sections: GmSection[]; storageKey: string }) {
  const key = `apex.gm.layout.${storageKey}`;
  const [layout, setLayout] = useState<Layout>(() => loadLayout(key));
  const [q, setQ] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(layout));
    } catch {
      /* ignore */
    }
  }, [key, layout]);

  const toggle = (list: 'open' | 'pinned', id: string) =>
    setLayout((l) => ({ ...l, [list]: l[list].includes(id) ? l[list].filter((x) => x !== id) : [...l[list], id] }));
  const openSection = (id: string) => {
    setLayout((l) => (l.open.includes(id) ? l : { ...l, open: [...l.open, id] }));
    requestAnimationFrame(() => document.getElementById(`gm-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const needle = q.trim().toLowerCase();
  const ordered = useMemo(() => {
    const pinned = sections.filter((s) => layout.pinned.includes(s.id));
    const rest = sections.filter((s) => !layout.pinned.includes(s.id));
    return [...pinned, ...rest];
  }, [sections, layout.pinned]);
  const shown = needle ? ordered.filter((s) => `${s.title} ${s.keywords}`.toLowerCase().includes(needle)) : ordered;

  return (
    <nav aria-label="Game Master tools" className="space-y-2">
      <div className="panel space-y-2 p-2">
        <div className="flex items-center gap-2">
          <input
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none"
            placeholder="Search GM tools…"
            aria-label="Search GM tools"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-ghost shrink-0 px-2 py-1 text-[11px]" onClick={() => setLayout((l) => ({ ...l, open: [] }))} title="Collapse all sections">
            Collapse all
          </button>
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Jump to">
          {sections.map((s) => (
            <button key={s.id} className="chip text-marble-300 hover:text-gold-200" onClick={() => openSection(s.id)}>
              {s.icon} {s.title}
              {!!s.badge && <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-ink-950">{s.badge}</span>}
            </button>
          ))}
        </div>
      </div>
      {shown.map((s) => {
        const open = layout.open.includes(s.id) || (!!needle && shown.length === 1);
        const pinned = layout.pinned.includes(s.id);
        return (
          <section key={s.id} id={`gm-section-${s.id}`} className="panel scroll-mt-2" data-gm-section={s.id}>
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button
                className="flex flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-ink-800/60"
                aria-expanded={open}
                aria-controls={`gm-body-${s.id}`}
                onClick={() => toggle('open', s.id)}
              >
                <span className={`text-[10px] text-marble-500 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}>▶</span>
                <span aria-hidden>{s.icon}</span>
                <h2 className="panel-title">{s.title}</h2>
                {!!s.badge && (
                  <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-ink-950" aria-label={`${s.badge} awaiting`}>
                    {s.badge}
                  </span>
                )}
              </button>
              <button
                className={`px-1 text-sm ${pinned ? 'text-gold-300' : 'text-marble-600 hover:text-gold-200'}`}
                aria-pressed={pinned}
                aria-label={pinned ? `Unpin ${s.title}` : `Pin ${s.title} to the top`}
                title={pinned ? 'Unpin' : 'Pin to the top'}
                onClick={() => toggle('pinned', s.id)}
              >
                {pinned ? '★' : '☆'}
              </button>
            </div>
            {open && (
              <div id={`gm-body-${s.id}`} className="border-t border-ink-700/70 p-3">
                <BareSections.Provider value={true}>{s.render()}</BareSections.Provider>
              </div>
            )}
          </section>
        );
      })}
      {!shown.length && <p className="px-2 text-xs text-marble-500">No GM tool matches “{q}”.</p>}
    </nav>
  );
}
