/**
 * APEX 0.5 workspace widgets:
 *  - PartyHealth: portrait, name, title, current / max HP, percentage and status per player character.
 *    One request (GET op=party) on mount and whenever a sheet changes (existing sheet ping) – no polling.
 *  - GmTools: the GM's most-used actions at the top of the right dock.
 *  - CharacterSummary: compact sheet summary of the selected (or chosen) character.
 */
import { useEffect, useState } from 'react';
import type { CharacterSheet } from '../game/sheet';
import type { GameState } from '../game/types';
import type { TokenView, ViewModel } from '../game/visibility';
import type { GameApi } from '../state/gameApi';
import { useWorkspace } from '../workspace/Workspace';
import { CharacterPortrait } from './CharacterVisuals';
import { Toggle } from './ui';

type Vital = { tokenId: string; hp: { current: number; max: number; temp: number } | null };

export function usePartyVitals(game: GameApi): Vital[] | null {
  const [vitals, setVitals] = useState<Vital[] | null>(null);
  const { sheets } = game;
  useEffect(() => {
    let live = true;
    void sheets.party().then((v) => live && setVitals(v));
    return () => {
      live = false;
    };
    // sheets.revision changes only when a sheet changed somewhere (live ping) – one request per change
  }, [sheets]);
  return vitals;
}

export function hpTone(pct: number): string {
  return pct <= 0 ? '#5a1d1d' : pct < 0.25 ? '#c0504c' : pct < 0.5 ? '#d6a548' : '#5d7d66';
}

export function PartyHealth({ game, view, onSelect, selectedTokenId }: { game: GameApi; view: ViewModel; onSelect: (id: string) => void; selectedTokenId: string | null }) {
  const vitals = usePartyVitals(game);
  const party = view.tokens.filter((t) => t.kind === 'player' && (!vitals || vitals.some((v) => v.tokenId === t.id)));
  if (!party.length) return <p className="text-xs text-marble-500">No player characters.</p>;
  return (
    <ul className="space-y-1.5" aria-label="Party health">
      {party.map((t) => {
        const hp = vitals?.find((v) => v.tokenId === t.id)?.hp ?? null;
        const pct = hp && hp.max > 0 ? Math.max(0, Math.min(1, hp.current / hp.max)) : null;
        const status = !hp ? 'No sheet' : hp.current <= 0 ? 'Down' : pct! < 0.25 ? 'Critical' : pct! < 0.5 ? 'Wounded' : 'Healthy';
        return (
          <li key={t.id}>
            <button
              className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-left transition-colors ${selectedTokenId === t.id ? 'border-gold-400/70 bg-gold-400/10' : 'border-ink-600 bg-ink-800/50 hover:border-gold-500/50'}`}
              onClick={() => onSelect(t.id)}
              data-party-member={t.id}
            >
              <CharacterPortrait tokenId={t.id} portraitV={t.portraitV} online={game.mode === 'online'} color={t.color} accent={t.accent} initials={t.initials} name={t.name} size={36} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate text-sm font-semibold text-marble-50">{t.name}</span>
                  {t.title && <span className="truncate text-[10px] text-gold-300">{t.title}</span>}
                </span>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-ink-700" role="meter" aria-label={`${t.name} hit points`} aria-valuemin={0} aria-valuemax={hp?.max ?? 0} aria-valuenow={hp?.current ?? 0}>
                  {pct !== null && <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, background: hpTone(pct) }} />}
                </span>
                <span className="mt-0.5 flex justify-between text-[11px] tabular-nums text-marble-300">
                  <span>{hp ? `${hp.current} / ${hp.max} HP${hp.temp ? ` (+${hp.temp} temp)` : ''}` : '— / —'}</span>
                  <span className={hp && hp.current <= 0 ? 'text-blood-400' : 'text-marble-500'}>
                    {pct !== null ? `${Math.round(pct * 100)}% · ` : ''}
                    {status}
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function GmTools({
  state,
  view,
  onAdvance,
  showPartyFog,
  setShowPartyFog,
  busy,
}: {
  state: GameState;
  view: ViewModel;
  onAdvance: () => void;
  showPartyFog: boolean;
  setShowPartyFog: (v: boolean) => void;
  busy: boolean;
}) {
  const ws = useWorkspace();
  const awaiting = Object.values(state.events).filter((e) => e.status === 'awaiting').length;
  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-1.5">
        <button className="btn btn-gold col-span-2" disabled={busy} onClick={onAdvance}>
          {view.phase === 'day' ? `☾ Begin Night ${view.day}` : `☀ Begin Day ${view.day + 1}`}
        </button>
        <button className="btn btn-ghost" onClick={() => ws.reveal('events')}>
          ⚡ Events{awaiting ? ` (${awaiting} waiting)` : ''}
        </button>
        <button className="btn btn-ghost" onClick={() => ws.reveal('announcements')}>
          📣 Announce
        </button>
        <button className="btn btn-ghost" onClick={() => ws.reveal('party-health')}>
          ♥ Party health
        </button>
        <button className="btn btn-ghost" onClick={() => ws.reveal('world')}>
          🌍 World
        </button>
      </div>
      <Toggle label="Show party vision on map" checked={showPartyFog} onChange={() => setShowPartyFog(!showPartyFog)} />
    </div>
  );
}

export function CharacterSummary({ game, token }: { game: GameApi; token: TokenView | null }) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const { sheets } = game;
  const id = token?.kind === 'player' ? token.id : null;
  useEffect(() => {
    if (!id) return setSheet(null);
    let live = true;
    void sheets.load(id).then((r) => live && setSheet(r.ok ? r.sheet.sheet : null));
    return () => {
      live = false;
    };
  }, [id, sheets]);
  if (!token || token.kind !== 'player') return <p className="text-xs text-marble-500">Select a player character on the map or in Party Health.</p>;
  const stat = (label: string) => sheet?.combat.find((c) => c.label === label)?.value;
  const build = sheet?.details.find((d) => /class/i.test(d.label))?.value;
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <CharacterPortrait tokenId={token.id} portraitV={token.portraitV} online={game.mode === 'online'} color={token.color} accent={token.accent} initials={token.initials} name={token.name} size={44} zoomable />
        <div className="min-w-0">
          <div className="truncate font-display text-base font-bold text-gold-200">{token.name}</div>
          <div className="truncate text-marble-300">{build ?? token.title ?? '—'}</div>
        </div>
      </div>
      {sheet ? (
        <>
          <div className="grid grid-cols-4 gap-1 text-center">
            {[
              ['HP', sheet.hitPoints ? `${sheet.hitPoints.current}/${sheet.hitPoints.max}` : '—'],
              ['AC', stat('Armor Class') ?? '—'],
              ['Init', stat('Initiative') ?? '—'],
              ['Speed', (stat('Speed (walking)') ?? stat('Speed') ?? '—').replace(/\s*ft\.?/i, ' ft')],
            ].map(([l, v]) => (
              <div key={l} className="rounded-md border border-ink-600 bg-ink-900/60 px-1 py-1">
                <div className="text-[9px] uppercase tracking-wider text-marble-500">{l}</div>
                <div className="font-semibold tabular-nums text-marble-50">{v}</div>
              </div>
            ))}
          </div>
          {sheet.attributes.length > 0 && (
            <div className="grid grid-cols-6 gap-1 text-center">
              {sheet.attributes.slice(0, 6).map((a) => (
                <div key={a.id} className="rounded border border-ink-700 py-0.5">
                  <div className="text-[9px] text-marble-500">{a.name.slice(0, 3).toUpperCase()}</div>
                  <div className="tabular-nums text-marble-50">{a.value || '–'}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-marble-500">No character sheet yet.</p>
      )}
    </div>
  );
}
