import type { ViewModel } from '../game/visibility';
import { fmt } from '../game/commands';
import { Bar, Section } from './ui';
import { CharacterPortrait } from './CharacterVisuals';

interface Props {
  view: ViewModel;
  selectedTokenId: string | null;
  onSelect: (id: string) => void;
  /** Online: portraits can be loaded. */
  online?: boolean;
}

export function PartyPanel({ view, selectedTokenId, onSelect, online = false }: Props) {
  const party = view.tokens.filter((t) => t.kind === 'player');
  const team = view.teams.find((t) => t.kind === 'party');
  return (
    <Section title={team ? `${team.emblem} ${team.name}` : 'Party'} right={<span className="text-[11px] text-marble-500">Movement points</span>}>
      <ul className="space-y-1">
        {party.map((t) => {
          const d = t.details!;
          const empty = d.movePoints <= 0;
          return (
            <li key={t.id}>
              <button
                onClick={() => onSelect(t.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                  selectedTokenId === t.id ? 'border-gold-400/70 bg-gold-400/10' : 'border-transparent hover:bg-ink-700/60'
                }`}
                title={`Select ${t.name} and show on map`}
              >
                <CharacterPortrait tokenId={t.id} portraitV={t.portraitV} online={online} color={t.color} accent={t.id === view.viewerId ? '#e8d4a6' : t.accent} initials={t.initials} name={t.name} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-marble-50">
                      {t.name}
                      {t.id === view.viewerId && <span className="ml-1 text-[10px] text-gold-300">(you)</span>}
                      <span className="ml-1 text-[10px] font-normal" style={{ color: t.accent ?? '#8a7a66' }}>
                        {t.title}
                      </span>
                    </span>
                    <span className={`text-xs tabular-nums ${empty ? 'text-blood-400' : 'text-gold-200'}`}>
                      {fmt(d.movePoints)}/{d.maxMovePoints}
                    </span>
                  </span>
                  <Bar value={d.movePoints} max={d.maxMovePoints} color={empty ? '#a3262b' : t.color} className="mt-1" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
