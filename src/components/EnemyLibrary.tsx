/**
 * GM Enemy Library (APEX 1.2): stat blocks of the built-in SRD creatures and the campaign's own creatures and
 * elites. Built-ins can be copied and changed (a copy with the same id replaces the built-in in this campaign).
 */
import { useMemo, useState } from 'react';
import type { Command } from '../game/commands';
import type { GameState } from '../game/types';
import type { DispatchResult } from '../state/gameApi';
import { ABILITY_KEYS, BUILTIN_BESTIARY, bestiary, displayName, mod, saveBonus, type NpcArea, type NpcAttack, type StatBlock } from '../game/bestiary';
import { EnemyBadge } from './EnemyBadge';

const input = 'rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function StatBlockView({ b }: { b: StatBlock }) {
  return (
    <article className="space-y-1.5 rounded-lg border border-gold-700/50 bg-[#1b1712] p-3 text-xs text-marble-200" data-testid="stat-block">
      <header className="flex items-center gap-3">
        <EnemyBadge icon={b.icon} color={b.color} elite={b.elite} size={44} />
        <div>
          <h3 className="font-display text-lg font-bold text-gold-200">{displayName(b)}</h3>
          <p className="italic text-marble-400">{b.size} {b.type} · CR {b.cr}{b.elite ? ' · Elite' : ''} · {b.source}</p>
        </div>
      </header>
      <p><b>Armor Class</b> {b.ac}{b.acNote ? ` (${b.acNote})` : ''} · <b>Hit Points</b> {b.hp}{b.hitDice ? ` (${b.hitDice})` : ''} · <b>Speed</b> {b.speedFt} ft.</p>
      <table className="w-full text-center">
        <thead><tr>{ABILITY_KEYS.map((k) => <th key={k} className="font-normal uppercase text-marble-500">{k}</th>)}</tr></thead>
        <tbody><tr>{ABILITY_KEYS.map((k) => <td key={k} className="tabular-nums">{b.abilities[k]} ({sign(mod(b.abilities[k]))})</td>)}</tr></tbody>
      </table>
      <p><b>Saving Throws</b> {ABILITY_KEYS.map((k) => `${k.toUpperCase()} ${sign(saveBonus(b, k))}`).join(', ')}</p>
      <p><b>Senses</b> {b.senses || '—'} · <b>Languages</b> {b.languages || '—'}</p>
      {b.traits.map((t) => <p key={t.name}><b className="italic">{t.name}.</b> {t.text}</p>)}
      <h4 className="border-b border-gold-700/40 font-display text-sm text-gold-200">Actions</h4>
      {b.multiattack > 1 && <p><b className="italic">Multiattack.</b> {b.multiattack} attacks per Attack action.</p>}
      {b.attacks.map((a) => (
        <p key={a.name}>
          <b className="italic">{a.name}.</b> {a.kind === 'melee' ? 'Melee' : a.kind === 'ranged' ? 'Ranged' : 'Spell'} attack: {sign(a.bonus)} to hit, {a.kind === 'melee' ? `reach ${a.reachFt} ft.` : `range ${a.rangeFt}${a.longRangeFt ? `/${a.longRangeFt}` : ''} ft.`} Hit: {a.damage} {a.damageType} damage.
        </p>
      ))}
      {b.areas?.map((a) => (
        <p key={a.name}><b className="italic">{a.name}{a.uses ? ` (${a.uses}/encounter)` : ''}.</b> {a.sizeFt}-ft {a.shape}{a.rangeFt ? ` within ${a.rangeFt} ft` : ''}: DC {a.dc} {a.save.toUpperCase()} save, {a.damage} {a.damageType} damage on a failure, half on a success.</p>
      ))}
    </article>
  );
}

const blank = (): StatBlock => ({ id: '', name: '', size: 'Medium', type: 'humanoid', ac: 12, hp: 20, speedFt: 30, abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, senses: '', darkvisionFt: 0, languages: '', cr: '1', attacks: [{ name: 'Weapon', kind: 'melee', bonus: 4, damage: '1d8+2', damageType: 'slashing', reachFt: 5 }], multiattack: 1, traits: [], color: '#7a3a3a', icon: '', source: 'custom' });

function Editor({ start, onSave, onCancel, busy }: { start: StatBlock; onSave: (b: StatBlock) => void; onCancel: () => void; busy: boolean }) {
  const [b, setB] = useState<StatBlock>(structuredClone(start));
  const set = (patch: Partial<StatBlock>) => setB({ ...b, ...patch });
  const num = (v: string) => Math.round(Number(v) || 0);
  const setAttack = (i: number, patch: Partial<NpcAttack>) => set({ attacks: b.attacks.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const setArea = (i: number, patch: Partial<NpcArea>) => set({ areas: (b.areas ?? []).map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const field = (label: string, el: React.ReactNode) => <label className="flex flex-col gap-0.5 text-[11px] text-marble-400">{label}{el}</label>;
  return (
    <form className="space-y-2 rounded-lg border border-gold-600/60 bg-ink-950/90 p-3 text-xs" onSubmit={(e) => { e.preventDefault(); onSave({ ...b, id: b.id || b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) }); }} aria-label="Edit stat block">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field('Name', <input className={input} required maxLength={40} value={b.name} onChange={(e) => set({ name: e.target.value })} />)}
        {field('Title (elites, e.g. “the White”)', <input className={input} maxLength={40} value={b.title ?? ''} onChange={(e) => set({ title: e.target.value || undefined })} />)}
        {field('Id', <input className={input} maxLength={40} placeholder="from the name" value={b.id} onChange={(e) => set({ id: e.target.value.toLowerCase() })} />)}
        <label className="flex items-center gap-1.5 text-marble-200"><input type="checkbox" checked={!!b.elite} onChange={(e) => set({ elite: e.target.checked || undefined })} /> Elite (dragon frame)</label>
        {field('Size', <input className={input} value={b.size} onChange={(e) => set({ size: e.target.value })} />)}
        {field('Type', <input className={input} value={b.type} onChange={(e) => set({ type: e.target.value })} />)}
        {field('CR', <input className={input} value={b.cr} onChange={(e) => set({ cr: e.target.value })} />)}
        {field('Icon (2–3 letters)', <input className={input} maxLength={3} value={b.icon} onChange={(e) => set({ icon: e.target.value })} />)}
        {field('AC', <input className={input} type="number" value={b.ac} onChange={(e) => set({ ac: num(e.target.value) })} />)}
        {field('HP', <input className={input} type="number" value={b.hp} onChange={(e) => set({ hp: num(e.target.value) })} />)}
        {field('Speed (ft)', <input className={input} type="number" step={5} value={b.speedFt} onChange={(e) => set({ speedFt: num(e.target.value) })} />)}
        {field('Darkvision (ft)', <input className={input} type="number" step={10} value={b.darkvisionFt} onChange={(e) => set({ darkvisionFt: num(e.target.value) })} />)}
        {field('Multiattack (attacks per action)', <input className={input} type="number" min={1} max={6} value={b.multiattack} onChange={(e) => set({ multiattack: num(e.target.value) })} />)}
        {field('Colour', <input type="color" value={b.color} onChange={(e) => set({ color: e.target.value })} />)}
        {field('Senses', <input className={input} value={b.senses} onChange={(e) => set({ senses: e.target.value })} />)}
        {field('Languages', <input className={input} value={b.languages} onChange={(e) => set({ languages: e.target.value })} />)}
      </div>
      <div className="grid grid-cols-6 gap-2">
        {ABILITY_KEYS.map((k) => field(k.toUpperCase(), <input key={k} className={input} type="number" min={1} max={30} value={b.abilities[k]} onChange={(e) => set({ abilities: { ...b.abilities, [k]: num(e.target.value) } })} />))}
      </div>
      <fieldset className="space-y-1"><legend className="text-marble-300">Attacks</legend>
        {b.attacks.map((a, i) => (
          <div key={i} className="flex flex-wrap items-end gap-1">
            <input className={`${input} w-32`} aria-label="Attack name" value={a.name} onChange={(e) => setAttack(i, { name: e.target.value })} />
            <select className={input} aria-label="Attack kind" value={a.kind} onChange={(e) => setAttack(i, { kind: e.target.value as NpcAttack['kind'], ...(e.target.value !== 'melee' && !a.rangeFt ? { rangeFt: 80 } : {}) })}><option value="melee">melee</option><option value="ranged">ranged</option><option value="spell">spell attack</option></select>
            <input className={`${input} w-16`} type="number" aria-label="To hit" value={a.bonus} onChange={(e) => setAttack(i, { bonus: num(e.target.value) })} />
            <input className={`${input} w-24`} aria-label="Damage dice" value={a.damage} onChange={(e) => setAttack(i, { damage: e.target.value })} />
            <input className={`${input} w-24`} aria-label="Damage type" value={a.damageType} onChange={(e) => setAttack(i, { damageType: e.target.value })} />
            {a.kind === 'melee' ? <input className={`${input} w-16`} type="number" step={5} aria-label="Reach" value={a.reachFt} onChange={(e) => setAttack(i, { reachFt: num(e.target.value) })} /> : <input className={`${input} w-20`} type="number" step={5} aria-label="Range" value={a.rangeFt ?? 80} onChange={(e) => setAttack(i, { rangeFt: num(e.target.value) })} />}
            <button type="button" className="btn btn-ghost px-1.5 py-0.5" onClick={() => set({ attacks: b.attacks.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        {b.attacks.length < 6 && <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => set({ attacks: [...b.attacks, { name: 'Attack', kind: 'melee', bonus: 3, damage: '1d6+1', damageType: 'slashing', reachFt: 5 }] })}>+ Attack</button>}
      </fieldset>
      <fieldset className="space-y-1"><legend className="text-marble-300">Area abilities (saving throw)</legend>
        {(b.areas ?? []).map((a, i) => (
          <div key={i} className="flex flex-wrap items-end gap-1">
            <input className={`${input} w-32`} aria-label="Area name" value={a.name} onChange={(e) => setArea(i, { name: e.target.value })} />
            <select className={input} aria-label="Shape" value={a.shape} onChange={(e) => setArea(i, { shape: e.target.value as NpcArea['shape'] })}>{['sphere', 'cone', 'line', 'cube'].map((x) => <option key={x}>{x}</option>)}</select>
            <input className={`${input} w-16`} type="number" step={5} aria-label="Size ft" value={a.sizeFt} onChange={(e) => setArea(i, { sizeFt: num(e.target.value) })} />
            <input className={`${input} w-16`} type="number" step={5} aria-label="Range ft" value={a.rangeFt} onChange={(e) => setArea(i, { rangeFt: num(e.target.value) })} />
            <select className={input} aria-label="Save" value={a.save} onChange={(e) => setArea(i, { save: e.target.value as NpcArea['save'] })}>{ABILITY_KEYS.map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select>
            <input className={`${input} w-14`} type="number" aria-label="DC" value={a.dc} onChange={(e) => setArea(i, { dc: num(e.target.value) })} />
            <input className={`${input} w-20`} aria-label="Area damage" value={a.damage} onChange={(e) => setArea(i, { damage: e.target.value })} />
            <input className={`${input} w-20`} aria-label="Area damage type" value={a.damageType} onChange={(e) => setArea(i, { damageType: e.target.value })} />
            <button type="button" className="btn btn-ghost px-1.5 py-0.5" onClick={() => set({ areas: (b.areas ?? []).filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => set({ areas: [...(b.areas ?? []), { name: 'Breath', shape: 'cone', sizeFt: 15, rangeFt: 0, save: 'dex', dc: 12, damage: '2d6', damageType: 'fire', uses: 1 }] })}>+ Area ability</button>
      </fieldset>
      <fieldset className="space-y-1"><legend className="text-marble-300">Traits</legend>
        {b.traits.map((t, i) => (
          <div key={i} className="flex gap-1">
            <input className={`${input} w-40`} aria-label="Trait name" value={t.name} onChange={(e) => set({ traits: b.traits.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input className={`${input} flex-1`} aria-label="Trait text" value={t.text} onChange={(e) => set({ traits: b.traits.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
            <button type="button" className="btn btn-ghost px-1.5 py-0.5" onClick={() => set({ traits: b.traits.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => set({ traits: [...b.traits, { name: 'Trait', text: '' }] })}>+ Trait</button>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-gold" disabled={busy}>Save to library</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function EnemyLibrary({ state, run, busy = false }: { state: GameState; run: (cmd: Command) => Promise<DispatchResult>; busy?: boolean }) {
  const all = useMemo(() => bestiary(state), [state]);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState<string | null>(all[0]?.id ?? null);
  const [editing, setEditing] = useState<StatBlock | null>(null);
  const list = all.filter((b) => `${displayName(b)} ${b.type} ${b.cr}`.toLowerCase().includes(q.trim().toLowerCase()));
  const sel = all.find((b) => b.id === shown) ?? null;
  const own = (id: string) => (state.enemyLibrary ?? []).some((b) => b.id === id);
  const save = async (b: StatBlock) => { if ((await run({ type: 'enemyLibrarySave', block: b })).ok) { setEditing(null); setShown(b.id || null); } };
  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[18rem_1fr]" aria-label="Enemy library" data-testid="enemy-library">
      <section className="panel space-y-2 p-3">
        <h2 className="font-display text-xl font-black text-gold-200">Enemy Library</h2>
        <input className={`${input} w-full`} placeholder="Search creatures…" aria-label="Search creatures" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn btn-gold w-full" onClick={() => setEditing(blank())}>+ New creature / elite</button>
        <ul className="space-y-1">
          {list.map((b) => (
            <li key={b.id}>
              <button type="button" className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs ${shown === b.id ? 'border-gold-500 bg-gold-400/10' : 'border-ink-700 hover:border-gold-700'}`} onClick={() => (setShown(b.id), setEditing(null))}>
                <EnemyBadge icon={b.icon} color={b.color} elite={b.elite} size={26} />
                <span className="flex-1"><b className="text-marble-50">{displayName(b)}</b><span className="block text-marble-500">CR {b.cr} · AC {b.ac} · HP {b.hp}{own(b.id) ? ' · campaign' : ''}</span></span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-marble-500">Built-in creatures: SRD 5.1 (CC BY 4.0), simplified numbers. Place them on a battle map in Game → Scene tools.</p>
      </section>
      <section className="space-y-2">
        {editing ? (
          <Editor key={editing.id || 'new'} start={editing} onSave={(b) => void save(b)} onCancel={() => setEditing(null)} busy={busy} />
        ) : sel ? (
          <>
            <StatBlockView b={sel} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(own(sel.id) ? sel : { ...structuredClone(sel), source: 'custom' })}>{own(sel.id) ? 'Edit' : BUILTIN_BESTIARY.some((x) => x.id === sel.id) ? 'Adjust for this campaign' : 'Edit'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing({ ...structuredClone(sel), id: `${sel.id}-elite`.slice(0, 40), elite: true, title: 'the Elite', hp: Math.round(sel.hp * 2), source: 'custom' })}>Make an elite from it</button>
              {own(sel.id) && <button type="button" className="btn btn-ghost hover:text-blood-400" onClick={() => void run({ type: 'enemyLibraryRemove', id: sel.id })}>{BUILTIN_BESTIARY.some((x) => x.id === sel.id) ? 'Restore the SRD version' : 'Delete'}</button>}
            </div>
          </>
        ) : (
          <p className="text-marble-500">Choose a creature.</p>
        )}
      </section>
    </div>
  );
}
