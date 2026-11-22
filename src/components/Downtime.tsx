/**
 * APEX 2.12 – downtime in the client. Players: whether the party camps or is home, their hideout (its land, what
 * always stands there, the terrain editor) and the chest of each character. GM: send the party to camp or home and
 * bring them back. The Obelisk panel sits below (it opens during downtime).
 */
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type DowntimeStatus } from '../online/api';
import type { GameApi } from '../state/gameApi';
import type { SceneMap } from '../campaign/maps';
import type { SceneDefinition } from '../server/scenes';
import type { Item } from '../game/types';
import { KEEPSAKES, KEEPSAKE_LABEL, type Keepsake } from '../game/downtime';
import { survivesWipe } from '../game/obelisk';

const HexSceneEditor = lazy(() => import('./HexSceneEditor').then((m) => ({ default: m.HexSceneEditor })));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useDowntime(trigger: unknown) {
  const [status, setStatus] = useState<DowntimeStatus | null>(null);
  const load = useCallback(async () => { try { setStatus(await api.downtime()); } catch { /* shown elsewhere */ } }, []);
  useEffect(() => { void load(); }, [trigger, load]);
  return { status, load };
}

/** The character's pack and chest (move items between them). */
function ChestCard({ game, tokenId, open, act }: { game: GameApi; tokenId: string; open: boolean; act: (input: Record<string, unknown>) => Promise<void> }) {
  const t = game.view.tokens.find((x) => x.id === tokenId);
  const d = t?.details;
  if (!t || !d) return null;
  const worn = new Set(Object.values(d.equipment?.slots ?? {}).filter(Boolean) as string[]);
  const pack = d.inventory ?? [], chest = d.stash ?? [];
  const row = (i: Item, where: 'pack' | 'chest') => (
    <li key={i.id} className="flex items-center gap-2 rounded border border-ink-700 bg-ink-900/60 px-2 py-1">
      <span className="min-w-0 flex-1 truncate">{i.quantity > 1 ? `${i.quantity}× ` : ''}{i.name}{worn.has(i.id) && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-gold-300">worn</span>}</span>
      <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" disabled={!open} onClick={() => void act({ action: where === 'pack' ? 'stashPut' : 'stashTake', tokenId, itemId: i.id })}>{where === 'pack' ? '→ Chest' : '→ Pack'}</button>
    </li>
  );
  return (
    <section className="panel space-y-2 p-3" data-testid="chest-card">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="panel-title">{t.name} · Pack and chest</p>
        <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" disabled={!open || !pack.some((i) => !worn.has(i.id))} onClick={() => void act({ action: 'stashUnworn', tokenId })}>Store everything not worn</button></div>
      {!open && <p className="text-xs text-marble-500">Your chest stays at camp or at home – it opens during downtime.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><p className="label mb-1">Carried ({pack.length})</p><ul className="max-h-64 space-y-1 overflow-y-auto text-xs">{pack.map((i) => row(i, 'pack'))}</ul></div>
        <div><p className="label mb-1">Chest ({chest.length})</p><ul className="max-h-64 space-y-1 overflow-y-auto text-xs">{chest.length ? chest.map((i) => row(i, 'chest')) : <li className="text-marble-500">Empty.</li>}</ul></div>
      </div>
    </section>
  );
}

/** The terrain editor for the player's own hideout. */
function HideoutEditor({ map: start, onClose, onSaved }: { map: SceneMap; onClose: () => void; onSaved: (m: string) => void }) {
  const [map, setMap] = useState<SceneMap>(start);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const scene = { id: 'hideout', category: 'battle', name: 'Hideout', is_draft: false, is_legacy_arena: false, created_at: '', updated_at: '', revision: 1, archived: false, metadata: {} } as unknown as SceneDefinition;
  const change = (patch: Partial<SceneMap> | SceneMap, replace?: boolean) => setMap((m) => (replace ? (patch as SceneMap) : { ...m, ...patch }));
  const save = async () => { setBusy(true); try { const r = await api.downtimeAction({ action: 'save', map }); onSaved(r.message ?? 'Saved.'); onClose(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); } };
  return createPortal(
    <div className="fixed inset-0 z-[85] overflow-y-auto bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Shape your hideout">
      <div className="panel mx-auto max-w-6xl space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><b className="font-display text-lg text-gold-200">Shape your hideout</b>
          <span className="flex gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-gold" disabled={busy} onClick={() => void save()} data-testid="hideout-save">Save hideout</button></span></div>
        {note && <p role="alert" className="text-sm text-blood-300">{note}</p>}
        <Suspense fallback={<p className="text-sm text-marble-500">Loading the editor…</p>}>
          <HexSceneEditor scene={scene} map={map} change={change} busy={busy} setMessage={setNote} player />
        </Suspense>
      </div>
    </div>, document.body);
}

export function DowntimePlayer({ game, characters }: { game: GameApi; characters: string[] }) {
  const { status, load } = useDowntime(game.view);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const act = async (input: Record<string, unknown>) => {
    setNote('');
    try { const r = await api.downtimeAction(input); if (r.message) setNote(r.message); game.online?.refresh(); await load(); } catch (e) { setNote(msg(e)); }
  };
  if (!status) return null;
  const h = status.hideout;
  const open = !!status.active || !!status.obeliskOpen;
  const keep = new Set<Keepsake>(h?.keep ?? []);
  return (
    <div className="space-y-3" data-testid="downtime-player">
      <header className="obelisk-hero relative overflow-hidden rounded-2xl border border-gold-700/40 p-4">
        <div className="relative z-10">
          <p className="font-display text-[11px] uppercase tracking-[0.35em] text-gold-400">Downtime</p>
          <h1 className="font-display text-2xl font-bold text-marble-50">{status.active ? (status.mode === 'road' ? 'At camp' : 'At home') : 'On the adventure'}</h1>
          <p className="text-sm text-marble-300">{status.active ? (status.mode === 'road' ? 'The party has made camp for the night. Keep watch – the road is never quite safe.' : 'An arc has ended. Rest in your hideout, tend your gear, face the Obelisk.') : 'Downtime starts when your GM sends you to camp or home.'}</p>
        </div>
      </header>
      {note && <p role="status" className="rounded-lg border border-gold-700/40 bg-ink-900/80 px-3 py-2 text-sm text-gold-200">{note}</p>}
      <section className="panel space-y-2 p-3" data-testid="hideout-card">
        <p className="panel-title">Your hideout</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-marble-300">Land
            <select className="ml-2 rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-sm text-marble-50" value={h?.preset ?? ''} onChange={(e) => void act({ action: 'preset', preset: e.target.value })} data-testid="hideout-preset">
              {!h && <option value="">Choose…</option>}
              {status.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-gold px-3 py-1" disabled={!h?.map} onClick={() => setEditing(true)} data-testid="hideout-edit">Shape your hideout</button>
          <span className="text-[11px] text-marble-500">{h ? 'Changing the land makes a new one (your changes there are gone).' : 'Pick a land to found your hideout.'}</span>
        </div>
        {h && <div className="flex flex-wrap gap-1.5" aria-label="Always there">{KEEPSAKES.map((k) => (
          <button key={k} type="button" aria-pressed={keep.has(k)} className={`chip ${keep.has(k) ? 'border-gold-400 text-gold-100' : 'text-marble-400'}`} onClick={() => void act({ action: 'keep', keep: keep.has(k) ? [...keep].filter((x) => x !== k) : [...keep, k] })}>{keep.has(k) ? '✓ ' : ''}{KEEPSAKE_LABEL[k]}</button>
        ))}</div>}
      </section>
      {characters.map((id) => <ChestCard key={id} game={game} tokenId={id} open={open} act={act} />)}
      {editing && h?.map ? <HideoutEditor map={h.map as SceneMap} onClose={() => setEditing(false)} onSaved={(m) => { setNote(m); void load(); }} /> : null}
    </div>
  );
}

/** Before the Obelisk: what is at risk (everything carried), with a way to leave things in the chest. */
export function ObeliskRiskDialog({ game, tokenId, onEnter, onCancel }: { game: GameApi; tokenId: string; onEnter: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const t = game.view.tokens.find((x) => x.id === tokenId);
  const d = t?.details;
  const worn = new Set(Object.values(d?.equipment?.slots ?? {}).filter(Boolean) as string[]);
  const pack = d?.inventory ?? [];
  const risk = pack.filter((i) => !survivesWipe(i)), safe = pack.filter((i) => survivesWipe(i));
  const act = async (input: Record<string, unknown>) => { setBusy(true); setNote(''); try { await api.downtimeAction(input); game.online?.refresh(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); } };
  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Before the Obelisk" data-testid="obelisk-risk">
      <div className="obelisk-result panel w-full max-w-lg space-y-3 p-5">
        <h2 className="font-display text-xl text-gold-200">Before you enter</h2>
        <p className="text-sm text-marble-300">If you fall in the Obelisk, everything you carry is lost. Leave what you cannot risk in your chest. Quest items and the Cube are always safe.</p>
        {note && <p role="alert" className="text-sm text-blood-300">{note}</p>}
        <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
          {risk.length ? risk.map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded border border-blood-700/40 bg-blood-900/10 px-2 py-1">
              <span className="min-w-0 flex-1 truncate">{i.quantity > 1 ? `${i.quantity}× ` : ''}{i.name}{worn.has(i.id) && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-gold-300">worn</span>}</span>
              <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" disabled={busy} onClick={() => void act({ action: 'stashPut', tokenId, itemId: i.id })}>→ Chest</button>
            </li>
          )) : <li className="text-marble-400">Nothing at risk.</li>}
          {safe.map((i) => <li key={i.id} className="px-2 text-marble-500">✓ {i.name} (safe)</li>)}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" disabled={busy || !risk.some((i) => !worn.has(i.id))} onClick={() => void act({ action: 'stashUnworn', tokenId })}>Store everything not worn</button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-gold" disabled={busy} onClick={onEnter} data-testid="obelisk-risk-enter">Enter the Obelisk</button>
        </div>
      </div>
    </div>, document.body);
}

/** The GM's downtime controls. */
export function DowntimeGm({ notify, trigger }: { notify: (t: string, k?: 'error' | 'info') => void; trigger: unknown }) {
  const { status, load } = useDowntime(trigger);
  const [busy, setBusy] = useState(false);
  const act = async (input: Record<string, unknown>) => { setBusy(true); try { const r = await api.downtimeAction(input); if (r.message) notify(r.message, 'info'); await load(); } catch (e) { notify(msg(e)); } finally { setBusy(false); } };
  if (!status) return null;
  return (
    <section className="panel space-y-2 p-4" data-testid="downtime-gm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="panel-title">Downtime</p>
        <span className="text-xs text-marble-400">{status.active ? (status.mode === 'road' ? 'The party is at camp.' : 'Everyone is at home.') : 'The adventure is running.'}</span>
      </div>
      {!status.active ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-gold px-3 py-1.5" disabled={busy} onClick={() => void act({ action: 'start', mode: 'road' })} data-testid="downtime-road">🏕 Make camp (on the road)</button>
          <button type="button" className="btn btn-ghost px-3 py-1.5" disabled={busy} onClick={() => void act({ action: 'start', mode: 'home' })} data-testid="downtime-home">🏠 Send everyone home</button>
          <p className="w-full text-[11px] text-marble-500">On the road: one camp in the land the party stands in – players cannot reshape it, you keep every tool (a night attack?). At home: each player in their own hideout, which they shape themselves. The Obelisk opens during downtime.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-gold px-3 py-1.5" disabled={busy} onClick={() => void act({ action: 'end' })} data-testid="downtime-end">End downtime – back where they were</button>
        </div>
      )}
      {status.players?.length ? <ul className="text-xs text-marble-400">{status.players.map((p) => <li key={p.userId}>{p.name}: {status.hideouts?.[p.userId] ? `hideout (${status.presets.find((x) => x.id === status.hideouts?.[p.userId].preset)?.label ?? '…'})` : 'no hideout yet'}{status.active && p.sceneId && (p.sceneId === status.campSceneId || p.sceneId === status.hideouts?.[p.userId]?.sceneId) ? ' · there now' : ''}</li>)}</ul> : null}
    </section>
  );
}
