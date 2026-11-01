import { useState } from 'react';
import type { Command } from '../game/commands';
import type { GameState, SiteVisibility } from '../game/types';
import { safeRadius } from '../game/zone';
import { hexCount } from '../game/hex';
import { MAX_RADIUS, MIN_RADIUS } from '../data/demo';
import { phaseName } from '../game/text';
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
      title="Game Master"
      right={
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'teams', label: 'Teams' },
            { value: 'events', label: 'Events & Sites' },
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
                title="Select and show on map"
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
                  { value: 'auto', label: 'On sight', hint: 'Visible once inside the party’s vision' },
                  { value: 'hidden', label: 'Hidden', hint: 'Never visible (camouflage, magic)' },
                  { value: 'revealed', label: 'Revealed' },
                ]}
              />
              <Segmented<'none' | 'approx' | 'exact'>
                value={team.tracking ? team.tracking.mode : 'none'}
                onChange={(v) => run({ type: 'setTracking', teamId: team.id, mode: v })}
                options={[
                  { value: 'none', label: 'No tracking' },
                  { value: 'approx', label: '≈' , hint: 'Approximate position' },
                  { value: 'exact', label: '◎', hint: 'Exact position' },
                ]}
              />
            </div>
            <div className="mt-1 text-[11px] text-marble-500">
              Strategy: {STRATEGY_LABEL[team.strategy]} · Aggression {team.aggression}/10
            </div>
          </li>
        );
      })}
      <li className="text-[11px] text-marble-500">Move rivals like player characters: select them on the map, then choose a destination.</li>
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
              <span className="text-[11px] text-marble-500">{ev.trigger.type === 'day' ? `Dawn of Day ${ev.trigger.day}` : ev.trigger.type === 'phase' ? phaseName(ev.trigger.phase, ev.trigger.day) : 'manual'}</span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-marble-300">{ev.description}</p>
            <div className="mt-1.5 flex items-center justify-between">
              <span className={`text-[11px] ${ev.status === 'done' ? 'text-emerald-300' : 'text-amber-300'}`}>
                {ev.status === 'done' ? '✓ triggered' : '○ pending'}
              </span>
              <button className="btn btn-ghost" disabled={ev.status === 'done'} onClick={() => run({ type: 'triggerEvent', eventId: ev.id })}>
                Trigger now
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <div className="label mb-1">Sites</div>
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
                  { value: 'public', label: 'Public', hint: 'Known to all' },
                  { value: 'onSight', label: 'On sight', hint: 'Becomes known once the party sees it' },
                  { value: 'hidden', label: 'Hidden', hint: 'Only the GM sees it' },
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
        label="Show party vision on map"
        checked={showPartyFog}
        onChange={() => setShowPartyFog(!showPartyFog)}
        hint="Dims what players cannot see or have not explored"
      />
      <Stepper
        label="Correct arena clock"
        value={phaseName(state.phase, state.day)}
        hint="Changes only the clock, without dawn/nightfall effects. Use the golden button above for normal progression."
        onDec={() => run(state.phase === 'night' ? { type: 'setDay', day: state.day, phase: 'day' } : { type: 'setDay', day: state.day - 1, phase: 'night' })}
        onInc={() => run(state.phase === 'day' ? { type: 'setDay', day: state.day, phase: 'night' } : { type: 'setDay', day: state.day + 1, phase: 'day' })}
      />
      <p className="text-[11px] leading-relaxed text-marble-500">
        Night: vision {state.config.phases.night.visionModifier >= 0 ? '+' : ''}
        {state.config.phases.night.visionModifier} (minimum {state.config.phases.night.minVision}). Movement points are restored at dawn only.
      </p>

      <div className="rounded-lg border border-ink-600 bg-ink-800/60 p-2 space-y-2">
        <div className="label">Shrinking Arena</div>
        <Toggle label="Shrinking enabled" checked={sh.enabled} onChange={() => run({ type: 'setShrink', enabled: !sh.enabled })} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-marble-300">Outer rings become</span>
          <Segmented
            value={sh.mode}
            onChange={(m) => run({ type: 'setShrink', mode: m })}
            options={[
              { value: 'danger', label: 'dangerous', hint: 'Passable, but dangerous' },
              { value: 'closed', label: 'closed', hint: 'Can no longer be entered' },
            ]}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-marble-500">
          From the dawn of Day {sh.startDay}, every {sh.intervalDays} days {sh.ringsPerStep} ring{sh.ringsPerStep === 1 ? '' : 's'}, warning {sh.warningDays} day
          {sh.warningDays === 1 ? '' : 's'} ahead. Today safe within ring <b className="text-marble-300">{safeRadius(state.config, state.day)}</b> of{' '}
          {state.config.mapRadius}. Shrinking is evaluated only at dawn. Defaults live in <code>src/data/demo.ts</code>.
        </p>
      </div>

      <div className="rounded-lg border border-ink-600 bg-ink-800/60 p-2 space-y-2">
        <div className="label">Generate new arena</div>
        <Stepper label="Map radius" value={radius} onDec={() => setRadius(Math.max(MIN_RADIUS, radius - 1))} onInc={() => setRadius(Math.min(MAX_RADIUS, radius + 1))} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-marble-300">Seed</span>
          <div className="flex gap-1">
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
              className="w-24 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-right text-xs tabular-nums"
            />
            <button className="btn btn-ghost px-2" title="Random seed" onClick={() => setSeed(Math.floor(Math.random() * 99999))}>
              🎲
            </button>
          </div>
        </div>
        <button
          className="btn btn-ghost w-full hover:border-blood-400/70"
          onClick={() => {
            if (confirm(`Generate a new arena with radius ${radius} (${hexCount(radius).toLocaleString('en-US')} hexes) and seed ${seed}? The current campaign state will be replaced.`)) {
              onRegenerate(radius, seed);
            }
          }}
        >
          Generate arena ({hexCount(radius).toLocaleString('en-US')} hexes)
        </button>
      </div>
    </div>
  );
}
