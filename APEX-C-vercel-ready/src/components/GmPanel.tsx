import { useState } from 'react';
import type { Command } from '../game/commands';
import type { GameState, SiteVisibility } from '../game/types';
import { safeRadius } from '../game/zone';
import { hexCount } from '../game/hex';
import { Section, Segmented, Stepper, Toggle } from './ui';
import { STRATEGY_LABEL } from './SelectionPanel';

interface Props {
  state: GameState;
  run: (cmd: Command) => void;
  onSelectToken: (id: string) => void;
  showPartyFog: boolean;
  setShowPartyFog: (v: boolean) => void;
  onRegenerate: (radius: number, seed: number) => void;
}

type Tab = 'teams' | 'events' | 'arena';

export function GmPanel({ state, run, onSelectToken, showPartyFog, setShowPartyFog, onRegenerate }: Props) {
  const [tab, setTab] = useState<Tab>('teams');
  return (
    <Section
      title="Spielleitung"
      right={
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'teams', label: 'Teams' },
            { value: 'events', label: 'Events & Orte' },
            { value: 'arena', label: 'Arena' },
          ]}
        />
      }
    >
      {tab === 'teams' && <TeamsTab state={state} run={run} onSelectToken={onSelectToken} />}
      {tab === 'events' && <EventsTab state={state} run={run} />}
      {tab === 'arena' && (
        <ArenaTab state={state} run={run} showPartyFog={showPartyFog} setShowPartyFog={setShowPartyFog} onRegenerate={onRegenerate} />
      )}
    </Section>
  );
}

function TeamsTab({ state, run, onSelectToken }: Pick<Props, 'state' | 'run' | 'onSelectToken'>) {
  const rivals = Object.values(state.teams).filter((t) => t.kind === 'rival');
  return (
    <ul className="space-y-2">
      {rivals.map((team) => {
        const tok = Object.values(state.tokens).find((t) => t.teamId === team.id);
        return (
          <li key={team.id} className="rounded-lg border border-ink-600 bg-ink-800/60 p-2">
            <div className="flex items-center gap-2">
              <span className="text-base" style={{ color: team.color }}>
                {team.emblem}
              </span>
              <button
                className="text-sm font-semibold text-marble-50 hover:text-gold-200"
                onClick={() => tok && onSelectToken(tok.id)}
                title="Auswählen und auf der Karte zeigen"
              >
                {team.name}
              </button>
              {tok && (
                <span className="ml-auto text-[11px] tabular-nums text-marble-500">
                  {tok.pos.q}|{tok.pos.r}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Segmented
                value={team.visibility}
                onChange={(v) => run({ type: 'setTeamVisibility', teamId: team.id, visibility: v })}
                options={[
                  { value: 'auto', label: 'Bei Sicht' },
                  { value: 'hidden', label: 'Verborgen' },
                  { value: 'revealed', label: 'Enthüllt' },
                ]}
              />
              <Segmented<'none' | 'approx' | 'exact'>
                value={team.tracking ? team.tracking.mode : 'none'}
                onChange={(v) => run({ type: 'setTracking', teamId: team.id, mode: v })}
                options={[
                  { value: 'none', label: 'Kein Tracking' },
                  { value: 'approx', label: '≈' , hint: 'Ungefähre Position' },
                  { value: 'exact', label: '◎', hint: 'Genaue Position' },
                ]}
              />
            </div>
            <div className="mt-1 text-[11px] text-marble-500">
              Strategie: {STRATEGY_LABEL[team.strategy]} · Aggressivität {team.aggression}/10
            </div>
          </li>
        );
      })}
      <li className="text-[11px] text-marble-500">Rivalen verschiebst du wie Spielerfiguren: auf der Karte anklicken, dann Zielfeld wählen.</li>
    </ul>
  );
}

function EventsTab({ state, run }: Pick<Props, 'state' | 'run'>) {
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {Object.values(state.events).map((ev) => (
          <li key={ev.id} className="rounded-lg border border-ink-600 bg-ink-800/60 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-marble-50">⚡ {ev.name}</span>
              <span className="text-[11px] text-marble-500">{ev.trigger.type === 'day' ? `Tag ${ev.trigger.day}` : 'manuell'}</span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-marble-300">{ev.description}</p>
            <div className="mt-1.5 flex items-center justify-between">
              <span className={`text-[11px] ${ev.status === 'done' ? 'text-emerald-300' : 'text-amber-300'}`}>
                {ev.status === 'done' ? '✓ ausgelöst' : '○ ausstehend'}
              </span>
              <button className="btn btn-ghost" disabled={ev.status === 'done'} onClick={() => run({ type: 'triggerEvent', eventId: ev.id })}>
                Jetzt auslösen
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <div className="label mb-1">Orte</div>
        <ul className="space-y-1">
          {Object.values(state.sites).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-marble-100" title={s.gmNotes}>
                {s.name}
              </span>
              <Segmented<SiteVisibility>
                value={s.visibility}
                onChange={(v) => run({ type: 'setSiteVisibility', siteId: s.id, visibility: v })}
                options={[
                  { value: 'public', label: 'Öffentl.', hint: 'Allen bekannt' },
                  { value: 'onSight', label: 'Bei Sicht', hint: 'Wird bekannt, sobald die Gruppe ihn sieht' },
                  { value: 'hidden', label: 'Versteckt', hint: 'Nur der GM sieht ihn' },
                ]}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ArenaTab({ state, run, showPartyFog, setShowPartyFog, onRegenerate }: Omit<Props, 'onSelectToken'>) {
  const [radius, setRadius] = useState(state.config.mapRadius);
  const [seed, setSeed] = useState(state.config.seed);
  const sh = state.config.shrink;
  return (
    <div className="space-y-3">
      <Toggle
        label="Sicht der Gruppe auf der Karte einblenden"
        checked={showPartyFog}
        onChange={() => setShowPartyFog(!showPartyFog)}
        hint="Dunkelt ab, was die Spieler nicht sehen bzw. noch nicht erforscht haben"
      />
      <Stepper
        label="Arenatag korrigieren"
        value={state.day}
        hint="Setzt nur die Zahl – ohne Tageswechsel-Effekte. Für den normalen Ablauf den goldenen Button oben nutzen."
        onDec={() => run({ type: 'setDay', day: state.day - 1 })}
        onInc={() => run({ type: 'setDay', day: state.day + 1 })}
      />

      <div className="rounded-lg border border-ink-600 bg-ink-800/60 p-2 space-y-2">
        <div className="label">Schrumpfende Arena</div>
        <Toggle label="Schrumpfung aktiv" checked={sh.enabled} onChange={() => run({ type: 'setShrink', enabled: !sh.enabled })} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-marble-300">Äußere Ringe werden</span>
          <Segmented
            value={sh.mode}
            onChange={(m) => run({ type: 'setShrink', mode: m })}
            options={[
              { value: 'danger', label: 'gefährlich', hint: 'Betretbar, aber mit Konsequenzen' },
              { value: 'closed', label: 'gesperrt', hint: 'Nicht mehr betretbar' },
            ]}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-marble-500">
          Ab Tag {sh.startDay}, alle {sh.intervalDays} Tage {sh.ringsPerStep} Ring, Warnung {sh.warningDays} Tag vorher. Heute sicher bis Ring{' '}
          <b className="text-marble-300">{safeRadius(state.config, state.day)}</b>. Werte änderbar in <code>src/data/demo.ts</code>.
        </p>
      </div>

      <div className="rounded-lg border border-ink-600 bg-ink-800/60 p-2 space-y-2">
        <div className="label">Neue Arena erzeugen</div>
        <Stepper label="Kartenradius" value={radius} onDec={() => setRadius(Math.max(4, radius - 1))} onInc={() => setRadius(Math.min(20, radius + 1))} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-marble-300">Seed</span>
          <div className="flex gap-1">
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
              className="w-24 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-right text-xs tabular-nums"
            />
            <button className="btn btn-ghost px-2" title="Zufälliger Seed" onClick={() => setSeed(Math.floor(Math.random() * 99999))}>
              🎲
            </button>
          </div>
        </div>
        <button
          className="btn btn-ghost w-full hover:border-blood-400/70"
          onClick={() => {
            if (confirm(`Neue Arena mit Radius ${radius} (${hexCount(radius)} Felder) und Seed ${seed} erzeugen? Der aktuelle Spielstand wird ersetzt.`)) {
              onRegenerate(radius, seed);
            }
          }}
        >
          Arena erzeugen ({hexCount(radius)} Felder)
        </button>
      </div>
    </div>
  );
}
