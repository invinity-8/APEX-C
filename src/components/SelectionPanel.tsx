import { hexKey, parseKey, type HexKey } from '../game/hex';
import { TERRAIN } from '../game/terrain';
import { fmt, type Command } from '../game/commands';
import type { GameState, SiteVisibility, TeamStrategy, TeamVisibility } from '../game/types';
import type { TokenView, ViewModel } from '../game/visibility';
import { Bar, Section, Segmented, Stepper, Toggle } from './ui';

interface Props {
  view: ViewModel;
  /** Nur im GM-Modus gesetzt. */
  gmState: GameState | null;
  selectedTokenId: string | null;
  selectedHex: HexKey | null;
  placeMode: boolean;
  setPlaceMode: (v: boolean) => void;
  run: (cmd: Command) => void;
  onSelectToken: (id: string) => void;
  onClear: () => void;
}

export const STRATEGY_LABEL: Record<TeamStrategy, string> = {
  manual: 'Manuell',
  patrol: 'Patrouillieren',
  forage: 'Ressourcen suchen',
  flee: 'Fliehen',
  pursue: 'Verfolgen',
  rest: 'Ruhen',
};

const SITE_TYPE_LABEL = { start: 'Startpunkt', camp: 'Lager', ruin: 'Ruine', shrine: 'Heiligtum', tower: 'Turm', cache: 'Versorgung' };
const STATUS_LABEL = { intact: 'intakt', looted: 'geplündert', destroyed: 'zerstört', occupied: 'bewohnt' };

export function SelectionPanel(props: Props) {
  const { view, selectedTokenId, selectedHex } = props;
  const token = view.tokens.find((t) => t.id === selectedTokenId) ?? null;
  const hexK = selectedHex ?? (token ? hexKey(token.pos) : null);
  if (!token && !hexK) {
    return (
      <Section title="Auswahl">
        <p className="text-xs leading-relaxed text-marble-300">
          Klicke auf eine <b className="text-marble-50">Figur</b>, um sie auszuwählen – erreichbare Felder leuchten golden. Klicke dann ein Feld, um zu ziehen.
          Ein Klick auf ein beliebiges Feld zeigt dessen Informationen.
        </p>
      </Section>
    );
  }
  return (
    <div className="space-y-3">
      {token && <TokenCard {...props} token={token} />}
      {hexK && <HexCard {...props} hexK={hexK} />}
    </div>
  );
}

function TokenCard({ view, gmState, token, placeMode, setPlaceMode, run, onClear }: Props & { token: TokenView }) {
  const d = token.details;
  const isGm = view.role === 'gm';
  const viewerId = view.viewerId;
  const canMove = isGm || (!!d && !!viewerId && (token.id === viewerId || d.controllers.includes(viewerId)));
  const team = view.teams.find((t) => t.id === token.teamId);
  const full = gmState?.tokens[token.id];
  const fullTeam = gmState?.teams[token.teamId];
  const otherPlayers = gmState ? Object.values(gmState.tokens).filter((t) => t.kind === 'player' && t.id !== token.id) : [];

  return (
    <Section
      title={token.kind === 'player' ? 'Figur' : 'Rivalenteam'}
      right={
        <button className="btn btn-ghost px-2 py-0.5" onClick={onClear} title="Auswahl aufheben (Esc)">
          ✕
        </button>
      }
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          style={
            token.kind === 'player'
              ? { background: token.color, color: '#14110d' }
              : { background: '#14110d', color: token.color, boxShadow: `inset 0 0 0 2px ${token.color}` }
          }
        >
          {token.initials}
        </span>
        <div className="min-w-0">
          <div className="font-display text-base font-bold text-marble-50">{token.name}</div>
          <div className="text-xs text-marble-300">{token.title}</div>
          {team && token.kind === 'rival' && <div className="mt-0.5 text-[11px] italic text-marble-500">„{team.motto}“</div>}
        </div>
      </div>

      {d && (
        <div className="mt-3 space-y-2">
          <div>
            <div className="flex justify-between text-xs">
              <span className="text-marble-300">Bewegungspunkte</span>
              <span className="tabular-nums text-gold-200">
                {fmt(d.movePoints)} / {d.maxMovePoints}
              </span>
            </div>
            <Bar value={d.movePoints} max={d.maxMovePoints} className="mt-1" />
          </div>
          {token.kind === 'player' && (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-marble-300">Sichtweite</span>
                <span className="text-marble-50">
                  {d.visionRadius + d.visionBonus} Felder
                  {d.visionBonus !== 0 && (
                    <span className={d.visionBonus > 0 ? 'text-emerald-300' : 'text-blood-400'}>
                      {' '}
                      ({d.visionBonus > 0 ? '+' : ''}
                      {d.visionBonus} heute)
                    </span>
                  )}
                </span>
              </div>
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-marble-300" title="Gebundene Willenskraft (Voluntas)">Willenskraft</span>
                  <span className="tabular-nums text-arcane-300">
                    {d.will.current} / {d.will.max}
                  </span>
                </div>
                <Bar value={d.will.current} max={d.will.max} color="#a77ef0" className="mt-1" />
              </div>
              {d.inventory.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-marble-300 hover:text-marble-50">Ausrüstung ({d.inventory.length})</summary>
                  <ul className="mt-1.5 space-y-1">
                    {d.inventory.map((i) => (
                      <li key={i.id} className="rounded-md bg-ink-800 px-2 py-1" title={i.description}>
                        <span className="text-marble-50">{i.name}</span>
                        {i.quantity > 1 && <span className="text-marble-500"> ×{i.quantity}</span>}
                        {i.willCapacity !== undefined && (
                          <span className="text-arcane-300">
                            {' '}
                            · {i.willCharge}/{i.willCapacity} Wille
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}

      <p className={`mt-3 rounded-md px-2 py-1.5 text-[11px] ${canMove ? 'bg-gold-400/10 text-gold-200' : 'bg-ink-800 text-marble-500'}`}>
        {placeMode
          ? '✥ Frei platzieren aktiv: Klicke irgendein Feld.'
          : canMove
            ? d && d.movePoints <= 0
              ? 'Keine Bewegungspunkte mehr – warte auf den nächsten Tag.'
              : 'Klicke ein golden markiertes Feld, um dorthin zu ziehen.'
            : 'Du kannst diese Figur nicht bewegen.'}
      </p>

      {/* ---------- GM-Werkzeuge ---------- */}
      {isGm && full && (
        <div className="mt-3 space-y-2 border-t border-ink-600 pt-3">
          <div className="label">Spielleitung</div>
          <button
            className={`btn w-full ${placeMode ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setPlaceMode(!placeMode)}
            title="Figur ohne Bewegungskosten auf ein beliebiges Feld setzen"
          >
            ✥ {placeMode ? 'Frei platzieren beenden' : 'Frei platzieren'}
          </button>
          <Stepper
            label="Bewegungspunkte"
            value={fmt(full.movePoints)}
            onDec={() => run({ type: 'adjustMovePoints', tokenId: full.id, delta: -1 })}
            onInc={() => run({ type: 'adjustMovePoints', tokenId: full.id, delta: 1 })}
          />
          <Stepper
            label="BP pro Tag"
            value={full.maxMovePoints}
            hint="Startwert für jeden neuen Tag"
            onDec={() => run({ type: 'adjustMaxMovePoints', tokenId: full.id, delta: -1 })}
            onInc={() => run({ type: 'adjustMaxMovePoints', tokenId: full.id, delta: 1 })}
          />
          {full.kind === 'player' && (
            <>
              <Stepper
                label="Sichtweite (Basis)"
                value={full.visionRadius}
                onDec={() => run({ type: 'adjustVisionRadius', tokenId: full.id, delta: -1 })}
                onInc={() => run({ type: 'adjustVisionRadius', tokenId: full.id, delta: 1 })}
              />
              <Stepper
                label="Sichtbonus heute"
                value={(full.visionBonus > 0 ? '+' : '') + full.visionBonus}
                hint="Temporär, z. B. Baum oder Turm bestiegen. Verfällt bei Tageswechsel."
                onDec={() => run({ type: 'adjustVisionBonus', tokenId: full.id, delta: -1 })}
                onInc={() => run({ type: 'adjustVisionBonus', tokenId: full.id, delta: 1 })}
              />
              <Toggle
                label="Teilt Sicht & Wissen mit der Gruppe"
                checked={full.sharesWithParty}
                onChange={() => run({ type: 'toggleShare', tokenId: full.id })}
                hint="Aus: Die anderen Spieler sehen diese Figur und ihre Entdeckungen nicht."
              />
              <div>
                <div className="mb-1 text-xs text-marble-300">Darf zusätzlich gesteuert werden von:</div>
                <div className="flex flex-wrap gap-1">
                  {otherPlayers.map((p) => {
                    const on = full.controllers.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        className={`chip ${on ? 'border-gold-400 text-gold-200' : 'text-marble-500'}`}
                        onClick={() => run({ type: 'toggleController', tokenId: full.id, controllerId: p.id })}
                      >
                        {on ? '✓' : '+'} {p.name.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
          {full.kind === 'rival' && fullTeam && <RivalControls team={fullTeam} run={run} />}
        </div>
      )}
    </Section>
  );
}

export function RivalControls({ team, run }: { team: NonNullable<GameState['teams'][string]>; run: (c: Command) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-marble-300">Für Spieler</span>
        <Segmented<TeamVisibility>
          value={team.visibility}
          onChange={(v) => run({ type: 'setTeamVisibility', teamId: team.id, visibility: v })}
          options={[
            { value: 'auto', label: 'Bei Sicht', hint: 'Sichtbar, sobald im Sichtfeld der Gruppe' },
            { value: 'hidden', label: 'Verborgen', hint: 'Nie sichtbar (Tarnung, Magie)' },
            { value: 'revealed', label: 'Enthüllt', hint: 'Immer sichtbar' },
          ]}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-marble-300" title="Roter Marker für die Spieler – deckt kein Gelände auf">
          Tracking
        </span>
        <Segmented<'none' | 'approx' | 'exact'>
          value={team.tracking ? team.tracking.mode : 'none'}
          onChange={(v) => run({ type: 'setTracking', teamId: team.id, mode: v })}
          options={[
            { value: 'none', label: 'Aus' },
            { value: 'approx', label: 'Ungefähr', hint: 'Marker mit Unsicherheitsradius 2' },
            { value: 'exact', label: 'Genau' },
          ]}
        />
      </div>
      {team.tracking && (
        <button className="btn btn-ghost w-full" onClick={() => run({ type: 'setTracking', teamId: team.id, mode: team.tracking!.mode })}>
          🔴 Marker auf aktuelle Position aktualisieren (Stand: Tag {team.tracking.day})
        </button>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-marble-300" title="Wird in einer späteren Phase für automatische Züge genutzt">
          Strategie <span className="text-marble-500">(vorbereitet)</span>
        </span>
        <select
          className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs"
          value={team.strategy}
          onChange={(e) => run({ type: 'setTeamStrategy', teamId: team.id, strategy: e.target.value as TeamStrategy })}
        >
          {Object.entries(STRATEGY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="rounded-md bg-ink-800 p-2 text-[11px] leading-relaxed text-marble-300">
        <div>
          <span className="text-marble-500">Persönlichkeit:</span> {team.personality}
        </div>
        <div>
          <span className="text-marble-500">Aggressivität:</span> {team.aggression}/10
        </div>
        <div>
          <span className="text-marble-500">Ziele:</span> {team.goals.join(' · ')}
        </div>
        <div>
          <span className="text-marble-500">Ressourcen:</span> {team.resources.join(' · ') || '—'}
        </div>
      </div>
    </div>
  );
}

function HexCard({ view, gmState, hexK, run, onSelectToken, selectedTokenId }: Props & { hexK: HexKey }) {
  const hex = view.hexByKey[hexK];
  if (!hex) return null;
  const def = hex.terrain ? TERRAIN[hex.terrain] : null;
  const site = hex.siteId ? view.sites.find((s) => s.id === hex.siteId) : null;
  const tokens = view.tokens.filter((t) => hexKey(t.pos) === hexK);
  const { q, r } = parseKey(hexK);
  const ring = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;

  return (
    <Section title="Feld" right={<span className="text-[11px] tabular-nums text-marble-500">q {q} · r {r} · Ring {ring}</span>}>
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 h-8 w-8 shrink-0 border border-black/50"
          style={{ background: def ? def.fill : '#0c0b0a', clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)' }}
        />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-marble-50">
            {def ? def.label : 'Unerforscht'}
            {hex.fog === 'explored' && <span className="ml-1.5 text-[11px] font-normal text-marble-500">(zuletzt gesehen)</span>}
          </div>
          <div className="text-xs text-marble-300">
            {def ? def.description : 'Niemand aus deiner Gruppe war bisher in Sichtweite dieses Feldes.'}
          </div>
          {def && (
            <div className="mt-1 flex flex-wrap gap-1">
              <span className={`chip ${def.cost === null ? 'text-blood-400' : ''}`}>{def.cost === null ? '⛔ unpassierbar' : `${fmt(def.cost)} BP`}</span>
              {def.difficult && <span className="chip text-amber-300">schwieriges Gelände</span>}
              {hex.zone !== 'safe' && (
                <span className={`chip ${hex.zone === 'warning' ? 'text-amber-300' : 'text-blood-400'}`}>
                  {hex.zone === 'warning' ? '⚠ bald Todeszone' : hex.zone === 'closed' ? '⛔ gesperrt' : '☠ Todeszone'}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {site && (
        <div className="mt-3 rounded-lg border border-gold-700/50 bg-ink-800/70 p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-sm font-bold text-gold-200">◆ {site.name}</span>
            <span className="text-[11px] text-marble-500">
              {SITE_TYPE_LABEL[site.type]} · {STATUS_LABEL[site.status]}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-marble-300">{site.description}</p>
          {site.interactions.length > 0 && (
            <div className="mt-1.5 text-[11px]">
              <span className="text-marble-500">Möglich: </span>
              {site.interactions.join(' · ')}
            </div>
          )}
          {site.rewards.length > 0 && (
            <div className="text-[11px]">
              <span className="text-marble-500">Belohnung: </span>
              {site.rewards.join(' · ')}
            </div>
          )}
          {gmState && site.gmNotes && (
            <div className="mt-2 rounded-md border border-arcane-500/40 bg-arcane-500/10 p-1.5 text-[11px] text-arcane-300">🔒 GM: {site.gmNotes}</div>
          )}
          {gmState && site.visibility && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-marble-300">Für Spieler</span>
              <Segmented<SiteVisibility>
                value={site.visibility}
                onChange={(v) => run({ type: 'setSiteVisibility', siteId: site.id, visibility: v })}
                options={[
                  { value: 'public', label: 'Öffentlich' },
                  { value: 'onSight', label: 'Bei Sicht' },
                  { value: 'hidden', label: 'Versteckt' },
                ]}
              />
            </div>
          )}
        </div>
      )}

      {tokens.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1">Auf diesem Feld ({tokens.length})</div>
          <ul className="space-y-1">
            {tokens.map((t) => (
              <li key={t.id}>
                <button
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-ink-700 ${t.id === selectedTokenId ? 'bg-gold-400/10 text-gold-200' : ''}`}
                  onClick={() => onSelectToken(t.id)}
                >
                  <span className="h-3 w-3 rounded-full" style={{ background: t.color }} />
                  {t.name}
                  <span className="ml-auto text-marble-500">{t.kind === 'player' ? 'Spieler' : 'Rivale'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
