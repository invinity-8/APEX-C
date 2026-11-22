/**
 * APEX 2.11 – the Obelisk in the client. Players: the Obelisk tab (tiers, keystones, the last result, the wipe to
 * accept), a runner that keeps a trial going (one server beat after the other – the enemies act through the
 * server's AI), and the result dialog. GM: the Obelisk tab (records, keystones, losses to give back, trials in
 * progress) and an alert when a character falls (a toast, and a browser notification while APEX is open).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type ObeliskCharacter, type ObeliskReply, type ObeliskStatus } from '../online/api';
import { DANGER_LABEL, OBELISK_MAX, OBELISK_UNLOCK_STEP, dangerFor, emptyRecord, tierPlan, type Danger, type ObeliskAlert } from '../game/obelisk';
import type { GameState } from '../game/types';
import { play } from '../audio/sound';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DANGER_TONE: Record<Danger, string> = {
  trivial: 'text-marble-500', comfortable: 'text-emerald-300', challenging: 'text-gold-300', dangerous: 'text-amber-400', deadly: 'text-blood-400',
};
const LOOT_LABEL: Record<string, string> = { standard: '', minion: '', elite: 'Elite', boss: 'Guardian' };

/** The obelisk emblem (inline SVG, glowing runes). */
export function ObeliskGlyph({ className = 'h-10 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 40" className={className} aria-hidden="true">
      <defs><linearGradient id="og-s" x1="0" x2="1"><stop offset="0" stopColor="#14121a" /><stop offset=".55" stopColor="#34303c" /><stop offset="1" stopColor="#0d0c11" /></linearGradient></defs>
      <polygon points="7,38 17,38 15.5,8 8.5,8" fill="url(#og-s)" stroke="#c09b58" strokeOpacity=".5" strokeWidth=".6" />
      <polygon points="8.5,8 15.5,8 12,2" fill="#3a3542" stroke="#c09b58" strokeOpacity=".5" strokeWidth=".6" />
      {[12, 17, 22, 27, 32].map((y) => <rect key={y} x="10.8" y={y} width="2.4" height="2.6" rx=".6" fill="#9be4ff" className="obelisk-rune" style={{ animationDelay: `${y * 0.07}s` }} />)}
    </svg>
  );
}

/** Obelisk status for the signed-in user, reloaded when the game view changes (throttled). */
export function useObelisk(enabled: boolean, trigger: unknown) {
  const [status, setStatus] = useState<ObeliskStatus | null>(null);
  const [error, setError] = useState('');
  const last = useRef(0);
  const load = useCallback(async () => {
    try { last.current = Date.now(); setStatus(await api.obelisk()); setError(''); } catch (e) { setError(msg(e)); }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => void load(), Math.max(0, 1200 - (Date.now() - last.current)));
    return () => window.clearTimeout(t);
  }, [enabled, trigger, load]);
  return { status, error, load };
}
export type ObeliskHook = ReturnType<typeof useObelisk>;

// ---------------------------------------------------------------- players

/** The player's Obelisk tab. */
export function ObeliskPanel({ ob, onEntered }: { ob: ObeliskHook; onEntered: () => void }) {
  const { status, error, load } = ob;
  const chars = status?.characters ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const me = chars.find((c) => c.tokenId === pick) ?? chars[0] ?? null;
  const [tier, setTier] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { if (me) setTier((t) => (t && t <= me.record.unlocked ? t : me.record.unlocked)); }, [me?.tokenId, me?.record.unlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (input: Record<string, unknown>, after?: (r: ObeliskReply) => void) => {
    setBusy(true); setNote('');
    try { const r = await api.obeliskAction(input); if (r.message) setNote(r.message); after?.(r); await load(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  if (!status) return <div className="p-6 text-sm text-marble-500">{error || 'The Obelisk stirs…'}</div>;
  if (!me) return <div className="p-6 text-sm text-marble-500">No character of yours can enter the Obelisk yet.</div>;
  const r = me.record;
  const run = status.run;
  const cost = status.keystonesRequired;
  const plan = tier ? tierPlan(tier) : null;
  const danger = tier ? dangerFor(tier, me.level) : null;
  const sealed = Array.from({ length: Math.min(OBELISK_UNLOCK_STEP, OBELISK_MAX - r.unlocked) }, (_, i) => r.unlocked + i + 1);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4" data-testid="obelisk-panel">
      <header className="obelisk-hero relative overflow-hidden rounded-2xl border border-gold-700/40 p-5">
        <div className="relative z-10 flex flex-wrap items-center gap-4">
          <ObeliskGlyph className="h-20 w-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[11px] uppercase tracking-[0.35em] text-gold-400">Solo trials</p>
            <h1 className="font-display text-3xl font-bold tracking-wide text-marble-50">The Obelisk</h1>
            <p className="mt-1 max-w-xl text-sm text-marble-300">Step alone into a fight the Obelisk weaves for you. Clear a tier and two more awaken. Fall, and the Obelisk keeps what you carried – your level stays yours.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Highest" value={r.best || '–'} />
            <Stat label="Keystones" value={r.keystones} />
            <Stat label="Falls" value={r.deaths} />
          </div>
        </div>
      </header>
      {chars.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {chars.map((c) => <button key={c.tokenId} className={`btn ${c.tokenId === me.tokenId ? 'btn-active' : 'btn-ghost'}`} onClick={() => setPick(c.tokenId)}>{c.name}{c.level ? ` · Lv ${c.level}` : ''}</button>)}
        </div>
      )}
      {note && <p role="status" className="rounded-lg border border-gold-700/40 bg-ink-900/80 px-3 py-2 text-sm text-gold-200">{note}</p>}
      {r.wipe && (
        <section className="panel border-blood-600/60 p-4" data-testid="obelisk-wipe">
          <p className="panel-title text-blood-400">You fell at tier {r.wipe.tier}</p>
          <p className="mt-1 text-sm text-marble-200">The Obelisk claimed your inventory ({r.wipe.count} item{r.wipe.count === 1 ? '' : 's'}). Your level, purse and quest items remain. Your GM has been told and may give single items back.</p>
          <button className="btn btn-danger mt-3 px-4 py-2 text-sm" disabled={busy} onClick={() => void act({ action: 'acceptWipe', tokenId: me.tokenId })} data-testid="obelisk-accept-wipe">Accept Inventory Wipe</button>
        </section>
      )}
      {run ? (
        <section className="panel p-4">
          <p className="panel-title">Trial in progress</p>
          <p className="mt-1 text-sm text-marble-200">Tier {run.tier} · {run.name}. Your fight is on the 🗺 Game tab – the Obelisk moves the enemies on their turns.</p>
          <button className="btn btn-gold mt-3 px-4 py-2 text-sm" onClick={onEntered}>To the fight</button>
        </section>
      ) : (
        <section className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="panel-title">Choose your tier</p>
            <p className="text-xs text-marble-500">{r.unlocked} of {OBELISK_MAX} awakened</p>
          </div>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10" role="listbox" aria-label="Obelisk tiers">
            {Array.from({ length: r.unlocked }, (_, i) => i + 1).map((t) => {
              const d = dangerFor(t, me.level), p = tierPlan(t);
              return (
                <button key={t} role="option" aria-selected={t === tier} onClick={() => setTier(t)} title={`Tier ${t} – ${DANGER_LABEL[d]}${p.loot !== 'standard' ? ` · ${LOOT_LABEL[p.loot]}` : ''}`}
                  className={`relative rounded-md border px-1 py-1.5 text-sm font-semibold tabular-nums transition-colors ${t === tier ? 'border-gold-300 bg-gold-400/20 text-gold-100 shadow-[0_0_14px_-4px_rgba(226,192,122,.8)]' : 'border-ink-600 bg-ink-800 text-marble-200 hover:border-gold-600'}`}>
                  {t}
                  {p.loot !== 'standard' && <span className={`absolute right-0.5 top-0 text-[8px] ${p.loot === 'boss' ? 'text-arcane-300' : 'text-gold-400'}`}>◆</span>}
                  <span className={`block h-0.5 rounded ${d === 'deadly' ? 'bg-blood-500' : d === 'dangerous' ? 'bg-amber-500' : d === 'challenging' ? 'bg-gold-500' : 'bg-emerald-600/60'}`} />
                </button>
              );
            })}
            {sealed.map((t) => <span key={t} className="grid place-items-center rounded-md border border-dashed border-ink-600 py-1.5 text-sm text-marble-600" title="Sealed – clear a lower tier">🔒</span>)}
          </div>
          {tier && plan && danger && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-600 bg-ink-900/70 p-3">
              <div>
                <p className="font-display text-lg text-marble-50">Tier {tier}{plan.loot !== 'standard' ? <span className="ml-2 text-xs uppercase tracking-widest text-arcane-300">{LOOT_LABEL[plan.loot]} spoils</span> : null}</p>
                <p className={`text-sm ${DANGER_TONE[danger]}`}>{DANGER_LABEL[danger]} for {me.name}{me.level ? '' : ' (no level on the sheet – counted as level 1)'}</p>
                {cost && <p className="text-xs text-marble-400">Costs 1 keystone · you hold {r.keystones}</p>}
              </div>
              <button className="btn btn-gold px-5 py-2 text-sm" disabled={busy || !!r.wipe || (cost && r.keystones < 1)} data-testid="obelisk-enter"
                onClick={() => void act({ action: 'start', tokenId: me.tokenId, tier }, (res) => { if (res.run) { play('door'); onEntered(); } })}>
                {busy ? 'The Obelisk wakes…' : 'Enter the Obelisk'}
              </button>
            </div>
          )}
        </section>
      )}
      {r.last && <LastResult last={r.last} />}
      <p className="text-xs text-marble-500">A trial uses your character as it is – your gear and abilities. Hit points, spell slots and timed effects are restored to their campaign values afterwards. You may withdraw while above half your hit points; below that, the fight decides.</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border border-gold-700/30 bg-ink-950/60 px-3 py-1.5"><p className="font-display text-xl text-gold-200 tabular-nums">{value}</p><p className="text-[10px] uppercase tracking-wider text-marble-500">{label}</p></div>;
}

function LastResult({ last }: { last: NonNullable<ObeliskCharacter['record']['last']> }) {
  const tone = last.outcome === 'victory' ? 'text-gold-300' : last.outcome === 'defeat' ? 'text-blood-400' : 'text-marble-300';
  const title = last.outcome === 'victory' ? `Tier ${last.tier} cleared` : last.outcome === 'defeat' ? `Fallen at tier ${last.tier}` : last.outcome === 'withdrawn' ? `Withdrew from tier ${last.tier}` : `Called back from tier ${last.tier}`;
  return (
    <section className="panel p-4">
      <p className={`panel-title ${tone}`}>Last trial · {new Date(last.at).toLocaleString()}</p>
      <p className="mt-1 text-sm text-marble-100">{title}</p>
      {last.loot?.length ? <p className="mt-1 text-sm text-marble-300">Spoils: {last.loot.join(', ')}</p> : null}
    </section>
  );
}

/**
 * Keeps a trial going while the player is in one: asks the server for one beat after the other (faster while the
 * enemies act, slower while it is the player's turn) and shows the outcome.
 */
export function ObeliskRunner({ ob, refresh, openTab }: { ob: ObeliskHook; refresh: () => void; openTab: () => void }) {
  const run = ob.status?.run ?? null;
  const [result, setResult] = useState<ObeliskReply | null>(null);
  const [tickNo, setTickNo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const runId = run?.id;
  useEffect(() => {
    if (!runId) return;
    let live = true;
    let wait = 1100;
    const timer = window.setTimeout(async () => {
      try {
        const r = await api.obeliskAction({ action: 'tick' });
        if (!live) return;
        if (r.outcome) { setResult(r); play(r.outcome === 'victory' ? 'coins' : r.outcome === 'defeat' ? 'necrotic' : 'door'); refresh(); await ob.load(); return; }
        if (r.run === null) { await ob.load(); return; }
        const acting = r.ai && !r.ai.idle && !r.ai.wait;
        if (acting) refresh();
        wait = acting ? 650 : r.ai?.wait ? 1800 : 2400;
      } catch { wait = 4000; }
      if (live) window.setTimeout(() => live && setTickNo((n) => n + 1), wait);
    }, 300);
    return () => { live = false; window.clearTimeout(timer); };
  }, [runId, tickNo]); // eslint-disable-line react-hooks/exhaustive-deps
  const withdraw = async () => {
    setBusy(true); setNote('');
    try { const r = await api.obeliskAction({ action: 'withdraw' }); if (r.outcome) setResult(r); refresh(); await ob.load(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  const acceptWipe = async (tokenId: string) => {
    setBusy(true);
    try { await api.obeliskAction({ action: 'acceptWipe', tokenId }); await ob.load(); setResult(null); } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  const lead = result ? (ob.status?.characters ?? []).find((c) => c.record.wipe) : null;
  return (
    <>
      {run && (
        <div className="fixed top-2 left-1/2 z-40 flex max-w-[94vw] -translate-x-1/2 items-center gap-3 rounded-full border border-arcane-400/50 bg-ink-950/90 px-4 py-1.5 text-xs text-marble-100 shadow-[0_0_24px_-6px_rgba(127,214,255,.6)]" data-testid="obelisk-banner">
          <ObeliskGlyph className="h-6 w-4" />
          <span className="font-display tracking-wide">Obelisk · Tier {run.tier}</span>
          <span className="hidden text-marble-400 sm:inline">{run.name}</span>
          <button className="btn btn-ghost px-2 py-0.5 text-[11px]" disabled={busy} onClick={() => void withdraw()}>Withdraw</button>
          {note && <span className="text-blood-300">{note}</span>}
        </div>
      )}
      {result && createPortal(
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" data-testid="obelisk-result">
          <div className={`obelisk-result panel w-full max-w-md p-6 text-center ${result.outcome === 'defeat' ? 'border-blood-600/70' : ''}`}>
            <ObeliskGlyph className="mx-auto h-16 w-10" />
            <h2 className={`mt-2 font-display text-2xl tracking-wide ${result.outcome === 'victory' ? 'text-gold-200' : result.outcome === 'defeat' ? 'text-blood-400' : 'text-marble-100'}`}>
              {result.outcome === 'victory' ? `Tier ${result.tier} cleared` : result.outcome === 'defeat' ? 'You have fallen' : result.outcome === 'withdrawn' ? 'You withdraw' : 'Called back'}
            </h2>
            <p className="mt-2 text-sm text-marble-300">{result.message}</p>
            {result.outcome === 'victory' && <p className="mt-2 text-sm text-gold-300">Tiers up to {Math.min(OBELISK_MAX, (result.tier ?? 1) + OBELISK_UNLOCK_STEP)} have awakened.</p>}
            {result.outcome === 'victory' && result.loot?.length ? <ul className="mt-3 space-y-1 text-left text-sm text-marble-100">{result.loot.map((l, i) => <li key={i} className="rounded border border-gold-700/30 bg-ink-900/70 px-2 py-1">◆ {l}</li>)}</ul> : null}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {result.outcome === 'defeat' && lead ? (
                <button className="btn btn-danger px-4 py-2 text-sm" disabled={busy} onClick={() => void acceptWipe(lead.tokenId)} data-testid="obelisk-result-accept">Accept Inventory Wipe</button>
              ) : (
                <button className="btn btn-gold px-4 py-2 text-sm" onClick={() => { setResult(null); openTab(); }}>To the Obelisk</button>
              )}
              <button className="btn btn-ghost px-4 py-2 text-sm" onClick={() => setResult(null)}>Close</button>
            </div>
          </div>
        </div>, document.body)}
    </>
  );
}

// ---------------------------------------------------------------- GM

/** A toast and a browser notification when a character falls in the Obelisk (while APEX is open). */
export function ObeliskAlerts({ state, notify, openTab }: { state: GameState; notify: (text: string, kind?: 'error' | 'info') => void; openTab: () => void }) {
  const alerts = state.obelisk?.alerts ?? [];
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = alerts.map((a) => a.id);
    if (!seen.current) { seen.current = new Set(ids); return; }
    const fresh = alerts.filter((a) => !seen.current!.has(a.id));
    for (const a of fresh) {
      seen.current.add(a.id);
      const text = `☠ ${a.name} fell at Obelisk tier ${a.tier} – ${a.count} item${a.count === 1 ? '' : 's'} lost. You can give items back in the Obelisk tab.`;
      notify(text, 'info');
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const n = new Notification('APEX · Obelisk', { body: text, tag: `apex-obelisk-${a.id}` });
          n.onclick = () => { window.focus(); openTab(); n.close(); };
        }
      } catch { /* notifications are optional */ }
    }
  }, [alerts, notify, openTab]);
  return null;
}

/** The GM's Obelisk tab. */
export function ObeliskGm({ state, notify }: { state: GameState; notify: (text: string, kind?: 'error' | 'info') => void }) {
  const ob = useObelisk(true, state.obelisk);
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const act = async (input: Record<string, unknown>) => {
    setBusy(true);
    try { const r = await api.obeliskAction(input); if (r.message) notify(r.message, 'info'); await ob.load(); } catch (e) { notify(msg(e)); } finally { setBusy(false); }
  };
  const o = state.obelisk;
  const records = o?.records ?? {};
  const runs = Object.values(o?.runs ?? {});
  const alerts: ObeliskAlert[] = o?.alerts ?? [];
  const levels = useMemo(() => Object.fromEntries((ob.status?.characters ?? []).map((c) => [c.tokenId, c.level])), [ob.status]);
  const players = Object.values(state.tokens).filter((t) => t.kind === 'player');
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4" data-testid="obelisk-gm">
      <header className="obelisk-hero relative overflow-hidden rounded-2xl border border-gold-700/40 p-5">
        <div className="relative z-10 flex flex-wrap items-center gap-4">
          <ObeliskGlyph className="h-16 w-10" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold tracking-wide text-marble-50">The Obelisk</h1>
            <p className="text-sm text-marble-300">Solo trials your players run between sessions. You only step in when someone falls.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-marble-200">
            <input type="checkbox" checked={!!o?.keystonesRequired} disabled={busy} onChange={(e) => void act({ action: 'required', on: e.target.checked })} />
            A trial costs a keystone
          </label>
          {perm === 'default' && <button className="btn btn-ghost" onClick={() => void Notification.requestPermission().then(setPerm)}>Allow notifications</button>}
          {perm === 'denied' && <span className="text-xs text-marble-500">Browser notifications are blocked – alerts show inside APEX.</span>}
        </div>
      </header>
      {alerts.length > 0 && (
        <section className="panel border-blood-600/50 p-4">
          <div className="flex items-center justify-between"><p className="panel-title text-blood-400">Falls</p><button className="btn btn-ghost" disabled={busy} onClick={() => void act({ action: 'dismiss', id: null })}>Dismiss all</button></div>
          <ul className="mt-2 space-y-1 text-sm">
            {alerts.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-ink-600 bg-ink-900/70 px-2 py-1"><span>☠ <b>{a.name}</b> fell at tier {a.tier} · {a.count} item{a.count === 1 ? '' : 's'} · {new Date(a.at).toLocaleString()}</span><button className="btn btn-ghost px-2 py-0.5" disabled={busy} onClick={() => void act({ action: 'dismiss', id: a.id })}>Dismiss</button></li>)}
          </ul>
        </section>
      )}
      {runs.length > 0 && (
        <section className="panel p-4">
          <p className="panel-title">Trials in progress</p>
          <ul className="mt-2 space-y-1 text-sm">
            {runs.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2"><span>{state.tokens[r.tokenId]?.name ?? 'A hero'} · tier {r.tier} · {r.name}</span><button className="btn btn-ghost px-2 py-0.5" disabled={busy} onClick={() => void act({ action: 'end', userId: r.userId })}>Call back (no reward, no loss)</button></li>)}
          </ul>
        </section>
      )}
      <section className="panel p-4">
        <p className="panel-title">Characters</p>
        <div className="mt-2 space-y-3">
          {players.map((t) => {
            const r = { ...emptyRecord(), ...(records[t.id] ?? {}) };
            const losses = (r.losses ?? []).filter((l) => l.items.length);
            return (
              <div key={t.id} className="rounded-lg border border-ink-600 bg-ink-900/60 p-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <b className="text-marble-50">{t.name}</b>
                  <span className="text-marble-400">Lv {levels[t.id] ?? '?'}</span>
                  <span className="chip">Best {r.best || '–'}</span>
                  <span className="chip">Clears {r.clears}</span>
                  <span className="chip">Falls {r.deaths}</span>
                  {r.wipe && <span className="chip border-blood-600 text-blood-300">Wipe not yet accepted</span>}
                  <span className="ml-auto flex items-center gap-1">
                    <span className="text-marble-400">Keystones {r.keystones}</span>
                    <button className="btn btn-ghost px-2 py-0.5" disabled={busy || r.keystones < 1} onClick={() => void act({ action: 'keystones', tokenId: t.id, delta: -1 })} aria-label={`Take a keystone from ${t.name}`}>−</button>
                    <button className="btn btn-ghost px-2 py-0.5" disabled={busy} onClick={() => void act({ action: 'keystones', tokenId: t.id, delta: 1 })} aria-label={`Give ${t.name} a keystone`}>+</button>
                  </span>
                  <label className="flex items-center gap-1 text-marble-400">Open up to
                    <input type="number" min={1} max={OBELISK_MAX} defaultValue={r.unlocked} key={r.unlocked} className="w-16 rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-marble-50"
                      onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== r.unlocked) void act({ action: 'unlock', tokenId: t.id, unlocked: n }); }} />
                  </label>
                </div>
                {losses.map((l) => (
                  <div key={l.id} className="mt-2 rounded border border-blood-700/40 bg-blood-900/10 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-marble-300">
                      <span>Lost at tier {l.tier} · {new Date(l.at).toLocaleString()}</span>
                      <button className="btn btn-ghost px-2 py-0.5" disabled={busy} onClick={() => void act({ action: 'restore', tokenId: t.id, lossId: l.id, itemId: null })}>Give all back</button>
                    </div>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {l.items.map((i) => <li key={i.id}><button className="chip hover:border-gold-500" disabled={busy} title="Give this item back" onClick={() => void act({ action: 'restore', tokenId: t.id, lossId: l.id, itemId: i.id })}>↩ {i.name}{i.quantity > 1 ? ` ×${i.quantity}` : ''}</button></li>)}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
      {(o?.log ?? []).length > 0 && (
        <section className="panel p-4">
          <p className="panel-title">Chronicle</p>
          <ul className="mt-2 space-y-0.5 text-xs text-marble-400">{(o?.log ?? []).slice(0, 15).map((l, i) => <li key={i}>{new Date(l.at).toLocaleString()} – {l.text}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
