/**
 * Player combat controls on a battle map (APEX 1.1): turn economy (action, bonus action, reaction), a movement bar,
 * the standard actions (Dash, Disengage, Dodge …), a target menu when an enemy is clicked (weapon attacks with
 * range, spells with slot choice / upcasting) and the opportunity-attack prompt. The server checks every rule.
 */
import { useState } from 'react';
import type { SceneSnapshot } from '../server/sceneRuntime';
import type { SceneEncounter } from '../game/types';
import type { CharacterSheet, SheetAttack } from '../game/sheet';
import { STANDARD_ACTIONS, budgetOf, characterLevel, ordinal, pcActor, planSpell, spellSlots } from '../game/sceneActions';
import { parseRangeFt } from '../game/sceneCombat';
import { hexAt } from '../campaign/hexScene';
import { distance } from '../game/hex';
import { EconomyChips } from './BattleCommand';
import { parseArea } from '../campaign/hexArea';

/** The attack or spell "in hand": its range is shown on the map, area spells are aimed with a right-click. */
export type ReadyAction = { kind: 'attack'; index: number } | { kind: 'spell'; spellId: string; slotLevel: number } | null;

interface Props {
  snapshot: SceneSnapshot;
  encounter: SceneEncounter | null;
  tokenId: string;
  sheet: CharacterSheet | null;
  attacks: SheetAttack[];
  myTurn: boolean;
  free: boolean;
  pending: boolean;
  act: (input: Record<string, unknown>) => void;
  /** Enemy (figure id) clicked on the map – opens the target menu. */
  target: string | null;
  setTarget: (id: string | null) => void;
  movement: { allowance: number; spent: number; dashed?: boolean } | null;
  ready: ReadyAction;
  setReady: (r: ReadyAction) => void;
}

export function PlayerCombat(p: Props) {
  const { snapshot, encounter, tokenId, sheet } = p;
  const map = snapshot.scene?.map;
  const me = snapshot.motion?.tokens.find((t) => t.tokenId === tokenId) ?? snapshot.spawn;
  const figures = snapshot.figures ?? [];
  const enemy = p.target ? figures.find((f) => f.id === p.target) : null;
  const feetTo = (to: { x: number; y: number }) => (map?.hex && me ? distance(hexAt(map, me), hexAt(map, to)) * 5 : null);
  const actor = pcActor(tokenId);
  const b = budgetOf(encounter, actor);
  const canAct = p.free || p.myTurn;
  const [more, setMore] = useState('');
  const [bonus, setBonus] = useState(false);
  const [slot, setSlot] = useState<Record<string, number>>({});
  const [spellOpen, setSpellOpen] = useState(false);
  const reactions = snapshot.reactions ?? [];
  const melee = p.attacks.map((a, i) => ({ a, i })).filter(({ a }) => !parseRangeFt(`${a.range} ${a.notes}`).rangeFt);
  const [reactWith, setReactWith] = useState(0);
  const slots = sheet ? spellSlots(sheet) : [];
  const spells = (sheet?.spells ?? []).filter((s) => s.level === 0 || s.prepared).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const lvl = sheet ? characterLevel(sheet) : 1;
  const slotFor = (id: string, level: number) => slot[id] ?? (level === 0 ? 0 : slots.find((s) => s.level >= level && s.current > 0)?.level ?? level);
  const moveTotal = p.movement ? Math.max(p.movement.allowance, 1) : 0;
  const moveLeft = p.movement ? Math.max(0, p.movement.allowance - p.movement.spent) : 0;

  const spellRow = (id: string, withTarget: boolean) => {
    const s = spells.find((x) => x.id === id)!;
    const lv = slotFor(id, s.level);
    const plan = sheet ? planSpell(sheet, id, lv, lvl) : { error: 'No sheet.' };
    const range = 'error' in plan ? null : plan.rangeFt;
    const dist = withTarget && enemy ? feetTo(enemy) : null;
    const outOfRange = range !== null && dist !== null && dist > range;
    return (
      <li key={id} className="flex flex-wrap items-center gap-1.5 rounded border border-ink-700 px-1.5 py-1">
        <span className="min-w-[8rem] flex-1">
          <b className="text-marble-50">{s.name}</b> <span className="text-marble-500">{s.level ? `${ordinal(s.level)} level` : 'cantrip'}{s.range ? ` · ${s.range}` : ''}{s.castingTime ? ` · ${s.castingTime}` : ''}</span>
          {'error' in plan ? <span className="block text-[10px] text-rose-300">{plan.error}</span> : <span className="block text-[10px] text-marble-400">{plan.mode === 'attack' ? 'Spell attack' : plan.mode === 'save' ? `${plan.save ?? ''} save` : 'Effect'}{plan.damage ? ` · ${plan.damage}` : ''}{outOfRange ? ` · out of range (${dist} ft)` : ''}</span>}
        </span>
        {s.level > 0 && (
          <select aria-label={`Slot for ${s.name}`} className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={lv} onChange={(e) => setSlot({ ...slot, [id]: Number(e.target.value) })}>
            {slots.filter((x) => x.level >= s.level).map((x) => <option key={x.level} value={x.level} disabled={x.current < 1}>{ordinal(x.level)} slot ({x.current}{x.max !== null ? `/${x.max}` : ''}){x.level > s.level ? ' – upcast' : ''}</option>)}
          </select>
        )}
        <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !canAct || 'error' in plan || outOfRange} onClick={() => { p.act({ action: 'cast', tokenId, spellId: id, slotLevel: lv, ...(withTarget && enemy ? { target: { kind: 'npc', id: enemy.id }, point: { x: enemy.x, y: enemy.y } } : {}) }); p.setTarget(null); setSpellOpen(false); }} data-testid="cast-spell">
          Cast{withTarget && enemy ? ` at ${enemy.name}` : ''}
        </button>
      </li>
    );
  };

  return (
    <section className="space-y-1.5 rounded-lg border border-gold-700/50 bg-ink-950/80 p-2 text-xs" aria-label="Combat actions" data-testid="player-combat">
      {reactions.map((r) => (
        <div key={r.id} role="alertdialog" aria-label="Opportunity attack" className="flex flex-wrap items-center gap-2 rounded border border-amber-400/70 bg-amber-500/15 px-2 py-1.5 text-amber-100" data-testid="reaction-prompt">
          <span className="flex-1">⚡ <b>{r.target.name}</b> leaves the reach of <b>{r.reactor.name}</b>. Use your reaction for an opportunity attack?</span>
          {melee.length > 1 && <select aria-label="Opportunity attack with" className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={reactWith} onChange={(e) => setReactWith(Number(e.target.value))}>{melee.map(({ a, i }) => <option key={i} value={i}>{a.name}</option>)}</select>}
          <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !melee.length} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: true, attackIndex: melee.length > 1 ? reactWith : melee[0]?.i ?? 0 })}>Attack</button>
          <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: false })}>Let them go</button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <EconomyChips encounter={encounter} actor={actor} />
        {p.movement && !p.free && (
          <span className="flex min-w-[10rem] flex-1 items-center gap-2" title={`${moveLeft} of ${p.movement.allowance} ft left${p.movement.dashed ? ' (Dash)' : ''}`}>
            <span className="text-marble-400">Move</span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-full border border-ink-600 bg-ink-800" role="meter" aria-label="Movement left" aria-valuemin={0} aria-valuemax={p.movement.allowance} aria-valuenow={moveLeft} data-testid="movement-bar">
              <span className="absolute inset-y-0 left-0 bg-gold-400 transition-[width] duration-300" style={{ width: `${(moveLeft / moveTotal) * 100}%` }} />
              {p.movement.dashed && <span className="absolute inset-y-0 border-l border-dashed border-sky-300" style={{ left: '50%' }} />}
            </span>
            <b className="tabular-nums text-marble-100">{Math.round(moveLeft)} / {Math.round(p.movement.allowance)} ft</b>
          </span>
        )}
      </div>

      {encounter && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Standard actions">
          {(['dash', 'disengage', 'dodge'] as const).map((id) => {
            const a = STANDARD_ACTIONS.find((x) => x.id === id)!;
            return (
              <button key={id} type="button" className="btn btn-ghost px-2 py-0.5" title={a.text} disabled={p.pending || !p.myTurn || (bonus ? !!b.bonus : !!b.action)} onClick={() => p.act({ action: 'standard', actor: { kind: 'pc', tokenId }, act: id, viaBonus: bonus })} data-testid={`act-${id}`}>
                {a.label}
              </button>
            );
          })}
          <select aria-label="More actions" className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={more} disabled={p.pending || !p.myTurn} onChange={(e) => setMore(e.target.value)}>
            <option value="">More…</option>
            {STANDARD_ACTIONS.filter((a) => !['dash', 'disengage', 'dodge'].includes(a.id)).map((a) => <option key={a.id} value={a.id} title={a.text}>{a.label}</option>)}
          </select>
          {more && <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending || !p.myTurn} onClick={() => { p.act({ action: 'standard', actor: { kind: 'pc', tokenId }, act: more, viaBonus: bonus }); setMore(''); }}>Do it</button>}
          <label className="flex items-center gap-1 text-marble-300" title="E.g. Cunning Action, off-hand attack, bonus-action spells – only if a feature allows it">
            <input type="checkbox" checked={bonus} onChange={(e) => setBonus(e.target.checked)} /> as bonus action
          </label>
          <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending || !p.myTurn || !!b.bonus} onClick={() => p.act({ action: 'standard', actor: { kind: 'pc', tokenId }, act: 'bonusOther' })}>Other bonus action</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Ready an attack or spell" data-testid="ready-bar">
        <span className="text-marble-400">Ready:</span>
        {p.attacks.map((a, i) => {
          const r = parseRangeFt(`${a.range} ${a.notes}`);
          const on = p.ready?.kind === 'attack' && p.ready.index === i;
          return <button key={`a${i}`} type="button" className={`rounded-full border px-2 py-0.5 ${on ? 'border-gold-400 bg-gold-400/20 text-gold-100' : 'border-ink-600 text-marble-200 hover:border-gold-700'}`} aria-pressed={on} title={`${a.bonus} · ${a.damage} · ${r.rangeFt ? `range ${r.rangeFt} ft` : `reach ${r.reachFt} ft`}`} onClick={() => p.setReady(on ? null : { kind: 'attack', index: i })}>{r.rangeFt ? '🏹' : '⚔'} {a.name.replace(' (equipped)', '')}</button>;
        })}
        {spells.map((sp) => {
          const on = p.ready?.kind === 'spell' && p.ready.spellId === sp.id;
          return <button key={sp.id} type="button" className={`rounded-full border px-2 py-0.5 ${on ? 'border-arcane-400 bg-arcane-400/20 text-arcane-100' : 'border-ink-600 text-marble-200 hover:border-arcane-400/60'}`} aria-pressed={on} title={`${sp.level ? `${ordinal(sp.level)} level` : 'cantrip'} · ${sp.range}`} onClick={() => p.setReady(on ? null : { kind: 'spell', spellId: sp.id, slotLevel: slotFor(sp.id, sp.level) })} data-testid="ready-spell">✦ {sp.name}</button>;
        })}
      </div>
      {p.ready?.kind === 'spell' && (() => {
        const sp = spells.find((x) => x.id === (p.ready as { spellId: string }).spellId);
        if (!sp) return null;
        const area = parseArea(`${sp.range} ${sp.description}`);
        return (
          <p className="text-arcane-200">
            ✦ {sp.name}{sp.level > 0 && <> with a <select aria-label="Slot level" className="rounded border border-ink-600 bg-ink-900 px-1" value={(p.ready as { slotLevel: number }).slotLevel} onChange={(e) => p.setReady({ kind: 'spell', spellId: sp.id, slotLevel: Number(e.target.value) })}>{slots.filter((x) => x.level >= sp.level).map((x) => <option key={x.level} value={x.level} disabled={x.current < 1}>{ordinal(x.level)}-level slot ({x.current} left){x.level > sp.level ? ' – upcast' : ''}</option>)}</select></>}
            {' · '}{area ? `${area.sizeFt}-ft ${area.shape}: hover to see the area, right-click to cast there.` : 'right-click an enemy to cast at it.'}
          </p>
        );
      })()}
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className="btn btn-ghost px-2 py-0.5" aria-expanded={spellOpen} disabled={!spells.length} onClick={() => setSpellOpen((v) => !v)} data-testid="open-spells">✦ Spells{spells.length ? ` (${spells.length})` : ''}</button>
        {slots.length > 0 && <span className="text-marble-400">Slots: {slots.map((s) => `${ordinal(s.level)} ${s.current}${s.max !== null ? `/${s.max}` : ''}`).join(' · ')}</span>}
        {!enemy && <span className="text-marble-500">Click an enemy on the map to attack it or cast at it.</span>}
      </div>
      {spellOpen && !enemy && <ul className="space-y-1" aria-label="Prepared spells">{spells.map((s) => spellRow(s.id, false))}</ul>}

      {enemy && (
        <div className="space-y-1 rounded border border-gold-600/60 bg-ink-900/80 p-2" role="dialog" aria-label={`Target ${enemy.name}`} data-testid="target-menu">
          <div className="flex items-center gap-2">
            <b className="text-sm text-gold-200">🎯 {enemy.name}</b>
            <span className="text-marble-400">{feetTo(enemy) ?? '?'} ft away{enemy.condition === 'bloodied' ? ' · bloodied' : ''}</span>
            <button type="button" className="ml-auto text-marble-500 hover:text-gold-200" onClick={() => p.setTarget(null)} aria-label="Close target menu">✕</button>
          </div>
          <ul className="space-y-1" aria-label="Attacks">
            {p.attacks.map((a, i) => {
              const r = parseRangeFt(`${a.range} ${a.notes}`);
              const d = feetTo(enemy);
              const ok = d === null || d <= (r.rangeFt ?? r.reachFt);
              return (
                <li key={i} className="flex flex-wrap items-center gap-1.5 rounded border border-ink-700 px-1.5 py-1">
                  <span className="flex-1"><b className="text-marble-50">{r.rangeFt ? '🏹' : '⚔'} {a.name}</b> <span className="text-marble-400">{a.bonus} · {a.damage} · {r.rangeFt ? `range ${r.rangeFt} ft` : `reach ${r.reachFt} ft`}</span>{!ok && <span className="block text-[10px] text-rose-300">out of {r.rangeFt ? 'range' : 'reach'}</span>}</span>
                  <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !canAct || !ok} onClick={() => { p.act({ action: 'strike', attacker: { kind: 'pc', tokenId }, target: { kind: 'npc', id: enemy.id }, attackIndex: i, bonus }); p.setTarget(null); }} data-testid="attack-option">
                    Attack{bonus ? ' (bonus)' : ''}
                  </button>
                </li>
              );
            })}
          </ul>
          {spells.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-marble-500">Spells</p>
              <ul className="space-y-1" aria-label="Spells at target">{spells.map((s) => spellRow(s.id, true))}</ul>
            </>
          )}
          {b.attackAction && <p className="text-marble-400">Attack action: {b.attacks ?? 0} attack(s) made this turn.</p>}
        </div>
      )}
    </section>
  );
}
