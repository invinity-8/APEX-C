/** GM: custom Wild Shape forms (APEX 0.7) – validated by the server (parseBeast); SRD beasts stay read-only. */
import { useState, type FormEvent } from 'react';
import type { Command } from '../game/commands';
import { crLabel, speedLabel, type BeastForm } from '../game/beasts';
import type { DispatchResult } from '../state/gameApi';

const input = 'rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-marble-50 focus:border-gold-400 focus:outline-none';
const CRS = [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6];

export function BeastEditor({ beasts, run }: { beasts: BeastForm[]; run: (cmd: Command) => Promise<DispatchResult> }) {
  const [f, setF] = useState({ name: '', cr: 0.25, ac: 12, hp: 11, hitDice: '', walk: 30, climb: 0, swim: 0, fly: 0, str: 12, dex: 12, con: 12, int: 3, wis: 12, cha: 6, senses: '', attack: '', toHit: 3, damage: '', traits: '' });
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Math.round(Number(e.target.value) || 0) });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = f.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
    if (!id) return;
    const r = await run({
      type: 'gmSetBeast',
      beast: {
        id,
        name: f.name.trim(),
        cr: f.cr,
        ac: f.ac,
        hp: f.hp,
        hitDice: f.hitDice,
        speed: { walk: f.walk, ...(f.climb ? { climb: f.climb } : {}), ...(f.swim ? { swim: f.swim } : {}), ...(f.fly ? { fly: f.fly } : {}) },
        str: f.str,
        dex: f.dex,
        con: f.con,
        int: f.int,
        wis: f.wis,
        cha: f.cha,
        senses: f.senses,
        traits: f.traits ? [f.traits] : [],
        attacks: f.attack ? [{ name: f.attack, toHit: f.toHit, damage: f.damage }] : [],
        source: 'GM',
      } as BeastForm,
    });
    if (r.ok) setF({ ...f, name: '' });
  };
  return (
    <section className="panel space-y-2 p-3 text-xs" aria-label="Wild Shape forms">
      <h3 className="panel-title">Wild Shape forms (custom)</h3>
      <p className="text-marble-500">SRD 5.1 beasts are built in. Add your own forms here – Wild Shape limits (CR, flying, swimming) still apply.</p>
      <ul className="space-y-1">
        {beasts.map((b) => (
          <li key={b.id} className="flex items-center gap-2" data-custom-beast={b.id}>
            <b className="text-marble-100">{b.name}</b>
            <span className="text-marble-500">
              CR {crLabel(b.cr)} · AC {b.ac} · {b.hp} HP · {speedLabel(b.speed)}
            </span>
            <span className="flex-1" />
            <button className="btn btn-ghost px-2 py-0.5" onClick={() => void run({ type: 'gmRemoveBeast', beastId: b.id })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form className="grid gap-1.5 sm:grid-cols-6" onSubmit={submit} aria-label="New beast form">
        <input className={`${input} sm:col-span-2`} placeholder="Name" aria-label="Beast name" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select className={input} aria-label="Challenge rating" value={f.cr} onChange={(e) => setF({ ...f, cr: Number(e.target.value) })}>
          {CRS.map((c) => (
            <option key={c} value={c}>
              CR {crLabel(c)}
            </option>
          ))}
        </select>
        <input className={input} type="number" aria-label="Armor class" title="AC" value={f.ac} onChange={num('ac')} />
        <input className={input} type="number" aria-label="Hit points" title="HP" value={f.hp} onChange={num('hp')} />
        <input className={input} placeholder="Hit dice" aria-label="Hit dice" value={f.hitDice} onChange={(e) => setF({ ...f, hitDice: e.target.value })} />
        {(['walk', 'climb', 'swim', 'fly'] as const).map((k) => (
          <label key={k} className="text-marble-400">
            {k} ft
            <input className={`${input} w-full`} type="number" aria-label={`${k} speed`} value={f[k]} onChange={num(k)} />
          </label>
        ))}
        {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => (
          <label key={k} className="text-marble-400 uppercase">
            {k}
            <input className={`${input} w-full`} type="number" aria-label={k} value={f[k]} onChange={num(k)} />
          </label>
        ))}
        <input className={`${input} sm:col-span-2`} placeholder="Attack name" aria-label="Attack name" value={f.attack} onChange={(e) => setF({ ...f, attack: e.target.value })} />
        <input className={input} type="number" aria-label="Attack bonus" title="to hit" value={f.toHit} onChange={num('toHit')} />
        <input className={`${input} sm:col-span-3`} placeholder="Damage, e.g. 1d8+3 piercing" aria-label="Attack damage" value={f.damage} onChange={(e) => setF({ ...f, damage: e.target.value })} />
        <input className={`${input} sm:col-span-3`} placeholder="Senses" aria-label="Senses" value={f.senses} onChange={(e) => setF({ ...f, senses: e.target.value })} />
        <input className={`${input} sm:col-span-3`} placeholder="Trait (optional)" aria-label="Trait" value={f.traits} onChange={(e) => setF({ ...f, traits: e.target.value })} />
        <button className="btn btn-gold sm:col-span-6" type="submit" disabled={!f.name.trim()}>
          Save beast form
        </button>
      </form>
    </section>
  );
}
