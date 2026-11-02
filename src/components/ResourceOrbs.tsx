/**
 * Health & resource orbs (APEX 0.5) – original APEX artwork: a glass sphere in a bronze-and-gold ring with a
 * slowly rising/falling liquid. Health is Centurion-red, the main resource deep imperial blue, a second
 * resource splits the orb into two halves. The numbers are always shown as text; the fill only illustrates
 * them. Only value changes animate (600 ms; none with prefers-reduced-motion) – no endless animation (measured cost).
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { effectiveOrbs, orbValue, spellSlotLevels, suggestedResources, walkingSpeed, movePointsForSpeed, type OrbValue } from '../game/resources';
import { newEntryId, type CharacterSheet, type OrbSource } from '../game/sheet';
import type { TokenView } from '../game/visibility';
import type { GameApi } from '../state/gameApi';

type Palette = { deep: string; mid: string; light: string };
const HEALTH: Palette = { deep: '#3a0f10', mid: '#8e2f2f', light: '#d0605a' };
const ARCANE: Palette = { deep: '#141d3a', mid: '#2f4c8e', light: '#6f8fd8' };
const VERDANT: Palette = { deep: '#14261b', mid: '#405b49', light: '#7fa489' };

export function Orb({ label, halves, size = 112, testId }: { label: string; halves: Array<{ value: OrbValue | null; palette: Palette }>; size?: number; testId?: string }) {
  const id = useId().replace(/:/g, '');
  const split = halves.length === 2;
  const r = 44;
  const level = (fill: number) => 100 - (6 + Math.max(0, Math.min(1, fill)) * 88); // y of the liquid surface
  const desc = halves.map((h) => (h.value ? `${h.value.label} ${h.value.current} of ${h.value.max}` : 'not configured')).join('; ');
  return (
    <figure className="apex-orb" style={{ width: size }} data-testid={testId} aria-label={`${label}: ${desc}`} role="img">
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <clipPath id={`c${id}`}>
            <circle cx="50" cy="50" r={r} />
          </clipPath>
          {halves.map((h, i) => (
            <linearGradient key={i} id={`g${id}${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={h.palette.light} />
              <stop offset=".55" stopColor={h.palette.mid} />
              <stop offset="1" stopColor={h.palette.deep} />
            </linearGradient>
          ))}
          <radialGradient id={`s${id}`} cx=".35" cy=".3" r=".75">
            <stop offset="0" stopColor="#fff" stopOpacity=".28" />
            <stop offset=".45" stopColor="#fff" stopOpacity=".04" />
            <stop offset="1" stopColor="#000" stopOpacity=".45" />
          </radialGradient>
          <linearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e8d4a6" />
            <stop offset=".35" stopColor="#a2803f" />
            <stop offset=".7" stopColor="#5f4b26" />
            <stop offset="1" stopColor="#c09b58" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="#0b0d0f" />
        <g clipPath={`url(#c${id})`}>
          {halves.map((h, i) => {
            const y = level(h.value?.fill ?? 0);
            const x = split ? (i === 0 ? 0 : 50) : 0;
            const w = split ? 50 : 100;
            return (
              <g key={i}>
                <rect className="apex-orb-liquid" x={x} y={y} width={w} height={100} fill={`url(#g${id}${i})`} style={{ transition: 'y 600ms cubic-bezier(.2,.7,.2,1)' }} />
                <path className="apex-orb-wave" d={`M${x} ${y} q ${w / 4} -2.2 ${w / 2} 0 t ${w / 2} 0 v 3 h -${w} z`} fill={h.palette.light} opacity=".35" />
              </g>
            );
          })}
          {split && <line x1="50" y1="0" x2="50" y2="100" stroke="#c09b58" strokeOpacity=".7" strokeWidth="1.2" />}
          <circle cx="50" cy="50" r={r} fill={`url(#s${id})`} />
        </g>
        <circle cx="50" cy="50" r={r + 1.5} fill="none" stroke={`url(#r${id})`} strokeWidth="4" />
        <circle cx="50" cy="50" r={r + 4} fill="none" stroke="#15181b" strokeWidth="1" opacity=".9" />
        {[0, 90, 180, 270].map((a) => (
          <rect key={a} x="48" y="1.5" width="4" height="5" rx="1" fill="#c09b58" transform={`rotate(${a} 50 50)`} />
        ))}
      </svg>
      <figcaption className="apex-orb-caption">
        {halves.map((h, i) => (
          <span key={i} className="block tabular-nums">
            {h.value ? (
              <>
                <b>{h.value.current}</b> / {h.value.max}
                {split && <span className="block text-[9px] uppercase tracking-wider text-marble-500">{h.value.label}</span>}
              </>
            ) : (
              '—'
            )}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Loads the sheet once per change (sheet ping), shows the orbs and the authorised controls. */
export function VitalsPanel({ game, token, canEdit }: { game: GameApi; token: TokenView; canEdit: boolean }) {
  const { sheets } = game;
  const [data, setData] = useState<{ sheet: CharacterSheet; version: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void sheets.load(token.id).then((r) => live && (r.ok ? setData({ sheet: r.sheet.sheet, version: r.sheet.version }) : setErr(r.error)));
    return () => {
      live = false;
    };
  }, [sheets, token.id]);
  const adjust = useCallback(
    async (target: 'hp' | 'resource', delta: number, resourceId?: string) => {
      const r = await sheets.adjust(token.id, target, delta, resourceId);
      if (r.ok) setData({ sheet: r.sheet.sheet, version: r.sheet.version });
      else setErr(r.error);
    },
    [sheets, token.id],
  );
  const saveSheet = async (sheet: CharacterSheet) => {
    if (!data) return;
    const r = await sheets.save(token.id, sheet, data.version);
    if (r.ok) setData({ sheet: r.sheet.sheet, version: r.sheet.version });
    else setErr(r.error);
  };
  if (!data) return <p className="text-xs text-marble-500">{err ?? 'Loading…'}</p>;
  const { sheet } = data;
  const hp = sheet.hitPoints;
  const orbs = effectiveOrbs(sheet);
  const primary = orbValue(sheet, orbs.primary);
  const secondary = orbValue(sheet, orbs.secondary);
  const slots = spellSlotLevels(sheet);
  const speed = walkingSpeed(sheet);
  const d = token.details;
  return (
    <div className="space-y-3 text-xs" data-testid="vitals">
      <div className="flex items-start justify-around gap-2">
        <div className="flex flex-col items-center gap-1">
          <Orb label="Health" testId="orb-health" halves={[{ value: hp ? { label: 'HP', current: hp.current, max: hp.max, fill: hp.max ? hp.current / hp.max : 0, source: { type: 'spellSlots' } } : null, palette: HEALTH }]} />
          <span className="label">Health{hp?.temp ? ` · +${hp.temp} temp` : ''}</span>
          {canEdit && hp && (
            <div className="flex gap-1">
              <button className="btn btn-ghost h-7 w-9 px-0" aria-label="Lose 1 hit point" onClick={() => void adjust('hp', -1)}>
                −1
              </button>
              <button className="btn btn-ghost h-7 w-9 px-0" aria-label="Heal 1 hit point" onClick={() => void adjust('hp', 1)}>
                +1
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-1">
          <Orb
            label="Main resource"
            testId="orb-resource"
            halves={secondary ? [{ value: primary, palette: ARCANE }, { value: secondary, palette: VERDANT }] : [{ value: primary, palette: ARCANE }]}
          />
          <span className="label max-w-[9rem] truncate text-center">{secondary ? `${primary?.label ?? '—'} · ${secondary.label}` : (primary?.label ?? 'No resource')}</span>
          {primary?.source.type === 'spellSlots' && <span className="text-[10px] text-marble-500" title="Weighted: a level-N slot counts N">weighted {primary.current}/{primary.max}</span>}
        </div>
      </div>

      {slots.length > 0 && (
        <section aria-label="Spell slots">
          <div className="label mb-1">Spell slots</div>
          <div className="flex flex-wrap gap-1.5">
            {slots.map(({ level, resource }) => (
              <div key={resource.id} className="flex items-center gap-1 rounded-md border border-ink-600 bg-ink-900/60 px-1.5 py-0.5" data-slot-level={level}>
                <span className="text-marble-500">L{level}</span>
                <span className="tabular-nums text-marble-50">
                  {resource.current}/{resource.max ?? '–'}
                </span>
                {canEdit && (
                  <>
                    <button className="px-1 text-marble-300 hover:text-gold-200 disabled:opacity-30" aria-label={`Spend a level ${level} slot`} disabled={resource.current <= 0} onClick={() => void adjust('resource', -1, resource.id)}>
                      −
                    </button>
                    <button className="px-1 text-marble-300 hover:text-gold-200 disabled:opacity-30" aria-label={`Regain a level ${level} slot`} disabled={resource.max !== null && resource.current >= resource.max} onClick={() => void adjust('resource', 1, resource.id)}>
                      +
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {[orbs.primary, orbs.secondary].map((src, i) => {
        if (!src || src.type !== 'resource') return null;
        const r = sheet.resources.find((x) => x.id === src.resourceId);
        if (!r || !canEdit) return null;
        return (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="text-marble-300">{r.name}</span>
            <span className="flex items-center gap-1">
              <button className="btn btn-ghost h-6 w-7 px-0" aria-label={`Use 1 ${r.name}`} onClick={() => void adjust('resource', -1, r.id)}>
                −
              </button>
              <span className="w-12 text-center tabular-nums">
                {r.current}/{r.max ?? '–'}
              </span>
              <button className="btn btn-ghost h-6 w-7 px-0" aria-label={`Regain 1 ${r.name}`} onClick={() => void adjust('resource', 1, r.id)}>
                +
              </button>
            </span>
          </div>
        );
      })}

      {d && (
        <p className="text-[11px] text-marble-500" data-testid="movement-rule">
          Movement {d.movePoints}/{d.maxMovePoints} MP per day
          {speed ? ` · walking speed ${speed} ft → ${movePointsForSpeed(speed)} MP${d.speedFt === speed ? '' : ' (the GM applies speed changes)'}` : ''}
        </p>
      )}

      {canEdit && (
        <>
          <button className="text-[11px] text-marble-500 hover:text-gold-200" aria-expanded={configOpen} onClick={() => setConfigOpen((o) => !o)}>
            {configOpen ? '▾' : '▸'} Configure orb resources
          </button>
          {configOpen && <OrbConfigEditor sheet={sheet} onSave={saveSheet} />}
        </>
      )}
      {err && <p className="text-blood-400">{err}</p>}
    </div>
  );
}

function OrbConfigEditor({ sheet, onSave }: { sheet: CharacterSheet; onSave: (s: CharacterSheet) => void }) {
  const cur = effectiveOrbs(sheet);
  const enc = (s: OrbSource | null) => (!s ? '' : s.type === 'spellSlots' ? 'slots' : `r:${s.resourceId}`);
  const dec = (v: string): OrbSource | null => (v === 'slots' ? { type: 'spellSlots' } : v.startsWith('r:') ? { type: 'resource', resourceId: v.slice(2) } : null);
  const [primary, setPrimary] = useState(enc(cur.primary));
  const [secondary, setSecondary] = useState(enc(cur.secondary));
  const [newName, setNewName] = useState('');
  const [newMax, setNewMax] = useState(2);
  const hasSlots = spellSlotLevels(sheet).length > 0;
  const options = [
    ...(hasSlots ? [{ v: 'slots', l: 'Spell slots (weighted)' }] : []),
    ...sheet.resources.filter((r) => !/^spell slots/i.test(r.name)).map((r) => ({ v: `r:${r.id}`, l: r.name })),
  ];
  const suggestions = suggestedResources(sheet);
  const sel = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50';
  return (
    <div className="space-y-2 rounded-lg border border-gold-700/40 bg-ink-900/50 p-2">
      <label className="block text-marble-300">
        Main resource
        <select className={sel} aria-label="Main resource" value={primary} onChange={(e) => setPrimary(e.target.value)}>
          <option value="">none</option>
          {options.map((o) => (
            <option key={o.v} value={o.v}>
              {o.l}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-marble-300">
        Second resource (split orb)
        <select className={sel} aria-label="Second resource" value={secondary} onChange={(e) => setSecondary(e.target.value)}>
          <option value="">none</option>
          {options
            .filter((o) => o.v !== primary)
            .map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
        </select>
      </label>
      <button className="btn btn-gold" onClick={() => onSave({ ...sheet, orbs: { primary: dec(primary), secondary: dec(secondary) } })}>
        Save orb configuration
      </button>
      <div className="imperial-rule" />
      <div className="text-marble-300">Add a resource</div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((n) => (
            <button key={n} className="chip text-gold-200" title="Suggested for your class – enter the maximum yourself" onClick={() => setNewName(n)}>
              + {n}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <input className={sel} aria-label="New resource name" placeholder="e.g. Wild Shape" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} />
        <input className={`${sel} w-16`} aria-label="Maximum" type="number" min={1} max={99} value={newMax} onChange={(e) => setNewMax(Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))))} />
        <button
          className="btn btn-ghost"
          disabled={!newName.trim()}
          onClick={() => {
            onSave({ ...sheet, resources: [...sheet.resources, { id: newEntryId('r'), name: newName.trim(), current: newMax, max: newMax }] });
            setNewName('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
