/**
 * Tabs inside one workspace widget (APEX 0.7 consolidation): related panels share one widget instead of each
 * occupying its own slot in the dock. Only the active tab is rendered; the choice is remembered per device.
 */
import { useState, type ReactNode } from 'react';

export interface WidgetTab {
  id: string;
  label: string;
  badge?: number;
  render: () => ReactNode;
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export function WidgetTabs({ id, tabs }: { id: string; tabs: WidgetTab[] }) {
  const key = `apex.widgetTab.${id}`;
  const [active, setActive] = useState(() => read(key) ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!current) return null;
  const pick = (t: string) => {
    setActive(t);
    try {
      localStorage.setItem(key, t);
    } catch {
      /* private mode – the choice is simply not remembered */
    }
  };
  return (
    <div className="space-y-2">
      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-ink-700 pb-1" role="tablist" aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === current.id}
              className={`rounded-md px-2 py-0.5 text-xs font-medium ${t.id === current.id ? 'bg-gold-400/20 text-gold-100' : 'text-marble-400 hover:bg-ink-800 hover:text-marble-100'}`}
              onClick={() => pick(t.id)}
            >
              {t.label}
              {t.badge ? <span className="ml-1 rounded-full bg-gold-400 px-1.5 text-[10px] font-bold text-ink-950">{t.badge}</span> : null}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" aria-label={current.label}>
        {current.render()}
      </div>
    </div>
  );
}
