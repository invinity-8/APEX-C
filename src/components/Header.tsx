import { useRef } from 'react';
import type { GameApi } from '../state/useGame';
import { downloadState } from '../state/storage';
import { safeRadius } from '../game/zone';
import { Segmented } from './ui';

interface Props {
  game: GameApi;
  onEndDay: () => void;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

export function Header({ game, onEndDay, notify }: Props) {
  const { view, session, state } = game;
  const fileRef = useRef<HTMLInputElement>(null);
  const players = Object.values(state.tokens).filter((t) => t.kind === 'player');
  const safe = safeRadius(state.config, view.day);
  const shrinking = view.shrink.enabled && safe < view.mapRadius;

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gold-700/40 bg-ink-900/80 px-4 py-2 backdrop-blur">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 64 64" className="h-9 w-9 drop-shadow-[0_0_8px_rgba(212,166,74,.45)]">
          <polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="#14110d" stroke="#d4a64a" strokeWidth={4} />
          <path d="M32 16 L44 46 H38 L35.5 39 H28.5 L26 46 H20 Z M30 34 H34 L32 28 Z" fill="#e8c46a" />
        </svg>
        <div className="leading-tight">
          <div className="font-display text-xl font-black tracking-[0.3em] text-gold-300">APEX</div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-marble-500">Arena of the Eternal Will</div>
        </div>
      </div>

      {/* Tag */}
      <div className="flex items-center gap-3 rounded-xl border border-gold-700/50 bg-ink-850 px-3 py-1.5">
        <div className="text-center leading-none">
          <div className="text-[9px] uppercase tracking-[0.2em] text-marble-500">Arena Day</div>
          <div className="font-display text-2xl font-bold text-gold-200 tabular-nums">{view.day}</div>
        </div>
        <div className="h-8 w-px bg-ink-600" />
        <div className="text-[11px] leading-tight text-marble-300" title="Sicherer Radius der schrumpfenden Arena">
          {view.shrink.enabled ? (
            shrinking ? (
              <span className="text-blood-400">☠ Safe through ring {safe}</span>
            ) : (
              <span>Shrinking begins day {view.shrink.startDay}</span>
            )
          ) : (
            <span>Arena stable</span>
          )}
          <div className="hidden text-marble-500 xl:block">≈ 1 hour of travel per hex</div>
        </div>
      </div>

      {view.role === 'gm' ? (
        <button className="btn btn-gold px-4 py-2 text-sm" onClick={onEndDay} title="Ends the day for everyone: restores movement, processes events and shrinking">
          ☀ End Day {view.day}
        </button>
      ) : (
        <span className="chip text-marble-300" title="Only the Game Master can end the day">
          ⏳ Only the Game Master can end the day
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Rollenwechsel */}
        <div className="flex items-center gap-2 rounded-xl border border-arcane-500/40 bg-ink-850 px-2 py-1">
          <span className="chip border-arcane-500/50 text-arcane-300" title="Demo-Modus: Alles wird nur in diesem Browser gespeichert. Kein Schutz geheimer Daten – für echtes Online-Spiel siehe docs/SUPABASE.md.">
            DEMO · local
          </span>
          <Segmented
            size="md"
            value={session.role}
            onChange={(role) => game.setSession({ ...session, role })}
            options={[
              { value: 'gm', label: '👁 Game Master', hint: 'Sees everything' },
              { value: 'player', label: '🛡 Player', hint: 'Sees only revealed information' },
            ]}
          />
          {session.role === 'player' && (
            <select
              className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-marble-50"
              value={session.viewerId}
              onChange={(e) => game.setSession({ ...session, viewerId: e.target.value })}
              title="Whose perspective are you playing?"
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  as {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Speichern */}
        <span className="text-[11px] text-marble-500" title="The save is stored automatically in this browser">
          {game.savedAt ? `✓ ${game.savedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '…'}
        </span>
        <button className="btn btn-ghost" onClick={() => downloadState(state)} title="Download save as JSON">
          ⤓<span className="hidden 2xl:inline"> Export</span>
        </button>
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} title="Import save from JSON">
          ⤒<span className="hidden 2xl:inline"> Import</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              game.importJson(await file.text());
              notify('Save imported.', 'info');
            } catch (err) {
              notify(`Import failed: ${(err as Error).message}`);
            }
          }}
        />
        <button
          className="btn btn-ghost hover:border-blood-400/70"
          onClick={() => {
            if (confirm('Reset the demo save? Current progress will be lost (export first if needed).')) {
              game.reset();
              notify('Demo reset – Day 1.', 'info');
            }
          }}
          title="Demo-Spielstand zurücksetzen"
        >
          ↺<span className="hidden 2xl:inline"> Reset</span>
        </button>
      </div>
    </header>
  );
}
