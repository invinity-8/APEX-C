/**
 * APEX 2.1 – enemy groups in the Enemy Library (GM): the built-in groups and the campaign's own ones. A group is a
 * named set of up to 12 creatures; in the scene editor groups are dragged onto battle maps as spawn markers.
 */
import { useState } from 'react';
import type { Command } from '../game/commands';
import type { DispatchResult } from '../state/gameApi';
import type { StatBlock } from '../game/bestiary';
import { allGroups, groupSize, groupXp, type EnemyGroup } from '../game/groups';

const input = 'rounded border border-ink-600 bg-ink-900 px-1.5 py-1 text-xs text-marble-50 focus:border-gold-400 focus:outline-none';
const ICONS = ['⚔', '🗡', '🏹', '🪓', '🕯', '⛧', '💀', '👺', '👹', '🐺', '🕷', '🐻', '👊', '💰', '🔥', '🛡', '☠', '🐉'];

export function GroupLibrary({ custom, blocks, run, busy }: { custom: EnemyGroup[]; blocks: StatBlock[]; run: (cmd: Command) => Promise<DispatchResult>; busy: boolean }) {
  const groups = allGroups(custom);
  const [shown, setShown] = useState(groups[0]?.id ?? '');
  const [editing, setEditing] = useState<EnemyGroup | null>(null);
  const sel = groups.find((g) => g.id === shown);
  const name = (id: string) => blocks.find((b) => b.id === id)?.name ?? id;
  const save = async (g: EnemyGroup) => { if ((await run({ type: 'enemyGroupSave', group: g })).ok) { setEditing(null); setShown(g.id); } };
  const own = (id: string) => custom.some((g) => g.id === id);
  return (
    <div className="grid gap-3 lg:grid-cols-[18rem_1fr]" data-testid="group-library">
      <section className="panel space-y-2 p-3">
        <button type="button" className="btn btn-gold w-full" onClick={() => setEditing({ id: `grp-${Math.random().toString(36).slice(2, 8)}`, name: 'New group', icon: '⚔', color: '#7a3a3a', members: [{ templateId: blocks[0]?.id ?? 'bandit', count: 3 }], source: 'custom' })} data-testid="new-group">+ New group</button>
        <ul className="space-y-1">
          {groups.map((g) => (
            <li key={g.id}>
              <button type="button" className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs ${shown === g.id ? 'border-gold-500 bg-gold-400/10' : 'border-ink-700 hover:border-gold-700'}`} onClick={() => (setShown(g.id), setEditing(null))}>
                <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: g.color }} aria-hidden>{g.icon}</span>
                <span className="flex-1"><b className="text-marble-50">{g.name}</b><span className="block text-marble-500">{groupSize(g)} creatures · {groupXp(g, blocks)} XP{own(g.id) ? ' · campaign' : ''}</span></span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        {editing ? (
          <form className="space-y-2 rounded-lg border border-gold-600/60 bg-ink-950/90 p-3 text-xs" onSubmit={(e) => { e.preventDefault(); void save(editing); }} aria-label="Edit group" data-testid="group-editor">
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${input} w-56`} aria-label="Group name" value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <input type="color" aria-label="Colour" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
              <span className="flex flex-wrap gap-0.5">{ICONS.map((i) => <button key={i} type="button" aria-pressed={editing.icon === i} className={`h-6 w-6 rounded ${editing.icon === i ? 'bg-gold-500/30' : 'hover:bg-ink-800'}`} onClick={() => setEditing({ ...editing, icon: i })}>{i}</button>)}</span>
            </div>
            {editing.members.map((m, i) => (
              <div key={i} className="flex items-center gap-1">
                <input type="number" min={1} max={12} className={`${input} w-14`} aria-label="Count" value={m.count} onChange={(e) => setEditing({ ...editing, members: editing.members.map((x, j) => (j === i ? { ...x, count: Math.max(1, Math.min(12, Number(e.target.value) || 1)) } : x)) })} />
                <span>×</span>
                <select className={`${input} flex-1`} aria-label="Creature" value={m.templateId} onChange={(e) => setEditing({ ...editing, members: editing.members.map((x, j) => (j === i ? { ...x, templateId: e.target.value } : x)) })}>
                  {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}{b.title ? ` ${b.title}` : ''} (CR {b.cr})</option>)}
                </select>
                <button type="button" className="btn btn-ghost px-1.5 py-0.5" disabled={editing.members.length <= 1} onClick={() => setEditing({ ...editing, members: editing.members.filter((_, j) => j !== i) })} aria-label="Remove">✕</button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={editing.members.length >= 8} onClick={() => setEditing({ ...editing, members: [...editing.members, { templateId: blocks[0]?.id ?? 'bandit', count: 1 }] })}>+ Creature</button>
            <textarea className={`${input} w-full`} rows={2} maxLength={300} placeholder="Note for the GM (tactics, loot …)" value={editing.note ?? ''} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            <p className={groupSize(editing) > 12 ? 'text-rose-300' : 'text-marble-400'}>{groupSize(editing)} / 12 creatures · {groupXp(editing, blocks)} XP</p>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-gold" disabled={busy || groupSize(editing) > 12 || !editing.name.trim()} data-testid="save-group">Save group</button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        ) : sel ? (
          <article className="space-y-2 rounded-lg border border-ink-700 bg-ink-950/80 p-3 text-sm">
            <h3 className="flex items-center gap-2 font-display text-lg text-gold-200"><span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: sel.color }}>{sel.icon}</span>{sel.name}</h3>
            <ul className="list-inside list-disc text-marble-200">{sel.members.map((m, i) => <li key={i}>{m.count}× {name(m.templateId)}</li>)}</ul>
            <p className="text-marble-400">{groupSize(sel)} creatures · {groupXp(sel, blocks)} XP (before the encounter multiplier)</p>
            {sel.note && <p className="text-marble-300">{sel.note}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(own(sel.id) ? structuredClone(sel) : { ...structuredClone(sel), id: `${sel.id.replace(/^g-/, 'grp-')}-own`.slice(0, 40), name: `${sel.name} (own)`.slice(0, 40), source: 'custom' })}>{own(sel.id) ? 'Edit' : 'Copy and adjust'}</button>
              {own(sel.id) && <button type="button" className="btn btn-ghost hover:text-blood-400" disabled={busy} onClick={() => void run({ type: 'enemyGroupRemove', id: sel.id })}>Delete</button>}
            </div>
            <p className="text-[11px] text-marble-500">Place groups on battle maps in Scenes → editor → ⚔ Enemy groups (drag them onto the map). During the game the GM spawns them from the battle tools.</p>
          </article>
        ) : null}
      </section>
    </div>
  );
}
