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
          <div className="text-[10px] uppercase tracking-[0.25em] text-marble-500">Arena des Ewigen Willens</div>
        </div>
      </div>

      {/* Tag */}
      <div className="flex items-center gap-3 rounded-xl border border-gold-700/50 bg-ink-850 px-3 py-1.5">
        <div className="text-center leading-none">
          <div className="text-[9px] uppercase tracking-[0.2em] text-marble-500">Arenatag</div>
          <div className="font-display text-2xl font-bold text-gold-200 tabular-nums">{view.day}</div>
        </div>
        <div className="h-8 w-px bg-ink-600" />
        <div className="text-[11px] leading-tight text-marble-300" title="Sicherer Radius der schrumpfenden Arena">
          {view.shrink.enabled ? (
            shrinking ? (
              <span className="text-blood-400">☠ Sicher bis Ring {safe}</span>
            ) : (
              <span>Schrumpft ab Tag {view.shrink.startDay}</span>
            )
          ) : (
            <span>Arena stabil</span>
          )}
          <div className="hidden text-marble-500 xl:block">≈ 1 Stunde Marsch pro Feld</div>
        </div>
      </div>

      {view.role === 'gm' ? (
        <button className="btn btn-gold px-4 py-2 text-sm" onClick={onEndDay} title="Beendet den Tag für alle: Bewegungspunkte zurücksetzen, Events & Schrumpfung anwenden">
          ☀ Tag {view.day} beenden
        </button>
      ) : (
        <span className="chip text-marble-300" title="Nur der Spielleiter kann den Tag beenden">
          ⏳ Der Spielleiter beendet den Tag
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Rollenwechsel */}
        <div className="flex items-center gap-2 rounded-xl border border-arcane-500/40 bg-ink-850 px-2 py-1">
          <span className="chip border-arcane-500/50 text-arcane-300" title="Demo-Modus: Alles wird nur in diesem Browser gespeichert. Kein Schutz geheimer Daten – für echtes Online-Spiel siehe docs/SUPABASE.md.">
            DEMO · lokal
          </span>
          <Segmented
            size="md"
            value={session.role}
            onChange={(role) => game.setSession({ ...session, role })}
            options={[
              { value: 'gm', label: '👁 Spielleiter', hint: 'Sieht alles' },
              { value: 'player', label: '🛡 Spieler', hint: 'Sieht nur freigegebene Informationen' },
            ]}
          />
          {session.role === 'player' && (
            <select
              className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-marble-50"
              value={session.viewerId}
              onChange={(e) => game.setSession({ ...session, viewerId: e.target.value })}
              title="Aus wessen Sicht spielst du?"
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  als {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Speichern */}
        <span className="text-[11px] text-marble-500" title="Der Spielstand wird automatisch in diesem Browser gespeichert">
          {game.savedAt ? `✓ ${game.savedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '…'}
        </span>
        <button className="btn btn-ghost" onClick={() => downloadState(state)} title="Spielstand als JSON-Datei herunterladen">
          ⤓<span className="hidden 2xl:inline"> Export</span>
        </button>
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} title="Spielstand aus JSON-Datei laden">
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
              notify('Spielstand importiert.', 'info');
            } catch (err) {
              notify(`Import fehlgeschlagen: ${(err as Error).message}`);
            }
          }}
        />
        <button
          className="btn btn-ghost hover:border-blood-400/70"
          onClick={() => {
            if (confirm('Demo-Spielstand wirklich zurücksetzen? Der aktuelle Fortschritt geht verloren (vorher ggf. exportieren).')) {
              game.reset();
              notify('Demo zurückgesetzt – Tag 1.', 'info');
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
