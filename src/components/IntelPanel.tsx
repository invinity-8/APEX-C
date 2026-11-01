import type { ViewModel } from '../game/visibility';
import { Section } from './ui';

/** Player view: what does the party know about rivals and sites? */
export function IntelPanel({ view, onFocus }: { view: ViewModel; onFocus: (q: number, r: number) => void }) {
  const rivals = view.teams.filter((t) => t.kind === 'rival');
  return (
    <Section title="Intelligence">
      <div className="label mb-1">Rivals</div>
      {rivals.length === 0 ? (
        <p className="text-xs text-marble-500">No rival teams discovered yet. Explore the arena!</p>
      ) : (
        <ul className="space-y-1">
          {rivals.map((t) => {
            const tr = view.trackers.find((x) => x.teamId === t.id);
            const pos = view.tokens.find((x) => x.teamId === t.id)?.pos ?? tr?.pos ?? t.lastSeen?.pos;
            return (
              <li key={t.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-ink-700"
                  onClick={() => pos && onFocus(pos.q, pos.r)}
                  title="Show on map"
                >
                  <span style={{ color: t.color }}>{t.emblem}</span>
                  <span className="text-marble-50">{t.name}</span>
                  <span className="ml-auto text-[11px]">
                    {t.currentlyVisible ? (
                      <span className="text-emerald-300">in sight</span>
                    ) : tr ? (
                      <span className="text-blood-400">🔴 tracked</span>
                    ) : t.lastSeen ? (
                      <span className="text-marble-500">last seen day {t.lastSeen.day}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="label mt-3 mb-1">Known sites</div>
      <ul className="space-y-1">
        {view.sites.map((s) => (
          <li key={s.id}>
            <button
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-ink-700"
              onClick={() => onFocus(s.pos.q, s.pos.r)}
            >
              <span className="text-gold-400">◆</span>
              <span className="text-marble-50">{s.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
