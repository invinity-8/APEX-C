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
import { spellCount, spellEffectOf } from '../game/spellEffects';
import { battleFeatures } from '../game/classFeatures';
import { CONDITION_TEXT, type ConditionId } from '../game/combatEffects';
import { beastsFor } from '../game/beastCatalog';
import { classLevel, formAllowed } from '../game/abilities';

const beastOptions = (sheet: CharacterSheet | null) => { const lvl = sheet ? classLevel(sheet, 'druid') ?? 0 : 0; return beastsFor(undefined).filter((b) => !formAllowed(b, lvl)); };
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
  spellTargets: Array<{ kind: 'pc'; tokenId: string; name: string } | { kind: 'npc'; id: string; name: string }>;
  setSpellTargets: (t: Props['spellTargets']) => void;
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
  const [adv, setAdv] = useState<'' | 'adv' | 'dis'>('');
  const [smite, setSmite] = useState(0);
  const [readyTrigger, setReadyTrigger] = useState('');
  const me2 = snapshot.self?.[tokenId];
  const features = sheet ? battleFeatures(sheet) : [];
  const canSmite = !!sheet?.abilities.some((x) => /divine smite/i.test(x.name));
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
      {reactions.filter((r) => r.kind === 'shield').map((r) => (
        <div key={r.id} role="alertdialog" aria-label="Shield" className="flex flex-wrap items-center gap-2 rounded border border-sky-400/70 bg-sky-500/15 px-2 py-1.5 text-sky-100" data-testid="shield-prompt">
          <span className="flex-1">🛡 <b>{r.target.name}</b> hits <b>{r.reactor.name}</b>. Cast <b>Shield</b> (reaction, +5 AC until your next turn – it may turn this hit into a miss)?</span>
          <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: true })}>Cast Shield</button>
          <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: false })}>Take the hit</button>
        </div>
      ))}
      {reactions.filter((r) => r.kind !== 'shield').map((r) => (
        <div key={r.id} role="alertdialog" aria-label="Opportunity attack" className="flex flex-wrap items-center gap-2 rounded border border-amber-400/70 bg-amber-500/15 px-2 py-1.5 text-amber-100" data-testid="reaction-prompt">
          <span className="flex-1">⚡ <b>{r.target.name}</b> leaves the reach of <b>{r.reactor.name}</b>. Use your reaction for an opportunity attack?</span>
          {melee.length > 1 && <select aria-label="Opportunity attack with" className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={reactWith} onChange={(e) => setReactWith(Number(e.target.value))}>{melee.map(({ a, i }) => <option key={i} value={i}>{a.name}</option>)}</select>}
          <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !melee.length} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: true, attackIndex: melee.length > 1 ? reactWith : melee[0]?.i ?? 0 })}>Attack</button>
          <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: false })}>Let them go</button>
        </div>
      ))}

      {(me2?.effects.length || me2?.concentration || me2?.readied) && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Your conditions and effects" data-testid="my-effects">
          {me2?.concentration && <span className="rounded-full border border-arcane-400/70 px-2 py-0.5 text-arcane-200" title="A new concentration spell ends it; damage forces a Constitution save">◎ Concentrating: {me2.concentration}</span>}
          {me2?.effects.map((e) => <span key={e.id} className="rounded-full border border-ink-500 px-2 py-0.5 text-marble-100" title={CONDITION_TEXT[e.key as ConditionId] ?? e.name}>{e.name}</span>)}
          {me2?.effects.some((e) => e.key === 'prone') && <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending} onClick={() => p.act({ action: 'condition', target: { kind: 'pc', tokenId }, condition: 'prone', add: false })}>Stand up</button>}
          {me2?.readied && <span className="rounded-full border border-gold-500/70 px-2 py-0.5 text-gold-200">⏳ Readied: {me2.readied.trigger} – right-click the target when it happens</span>}
        </div>
      )}
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

      {features.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Class features" data-testid="features">
          <span className="text-marble-400">Features:</span>
          {features.map((f) => f.id === 'wildShape' ? (
            <select key={f.id} aria-label="Wild Shape" className="rounded border border-emerald-600/60 bg-ink-900 px-1 py-0.5 text-emerald-200" value="" disabled={p.pending || !canAct || f.current === 0} onChange={(e) => e.target.value && p.act({ action: 'feature', tokenId, feature: 'wildShape', formId: e.target.value })}>
              <option value="">🐾 Wild Shape ({f.current ?? f.max} left)…</option>
              {beastOptions(sheet).map((b) => <option key={b.id} value={b.id}>{b.name} · CR {b.cr} · AC {b.ac} · {b.hp} HP</option>)}
            </select>
          ) : f.target === 'ally' ? (
            <select key={f.id} aria-label={f.name} className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value="" title={f.text} disabled={p.pending || !canAct || f.current === 0} onChange={(e) => { if (!e.target.value) return; const [kind, id] = e.target.value.split(':'); p.act({ action: 'feature', tokenId, feature: f.id, target: kind === 'pc' ? { kind: 'pc', tokenId: id } : { kind: 'npc', id }, ...(f.id === 'layOnHands' ? { amount: Math.max(1, Number(window.prompt('Hit points to restore?', '5')) || 5) } : {}) }); }}>
              <option value="">{f.name} ({f.current ?? f.max} left)…</option>
              {f.id === 'layOnHands' && <option value={`pc:${tokenId}`}>yourself</option>}
              {figures.filter((x) => x.kind === 'pc' || x.side === 'ally').map((x) => <option key={x.id} value={x.kind === 'pc' ? `pc:${x.tokenId}` : `npc:${x.id}`}>{x.name}</option>)}
            </select>
          ) : (
            <button key={f.id} type="button" className="btn btn-ghost px-2 py-0.5" title={f.text} disabled={p.pending || !canAct || f.current === 0} onClick={() => p.act({ action: 'feature', tokenId, feature: f.id })} data-testid={`feature-${f.id}`}>
              {f.name}{f.current !== null ? ` (${f.current})` : ''}
            </button>
          ))}
        </div>
      )}
      {encounter && p.myTurn && !b.action && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Ready an action">
          <input className="w-56 rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5" placeholder="Ready: trigger (e.g. when the orc opens the door)" value={readyTrigger} onChange={(e) => setReadyTrigger(e.target.value)} />
          <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending || !readyTrigger.trim() || p.ready?.kind !== 'attack'} title="Choose the attack in the Ready bar first" onClick={() => { p.act({ action: 'ready', actor: { kind: 'pc', tokenId }, attackIndex: p.ready?.kind === 'attack' ? p.ready.index : 0, trigger: readyTrigger }); setReadyTrigger(''); }}>⏳ Ready the chosen attack</button>
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
            {' · '}{(() => {
              const def = spellEffectOf(sp);
              if (area) return `${area.sizeFt}-ft ${area.shape}: hover to see the area, right-click to cast there.`;
              if (def?.targeting === 'self' || (!def && /^self/i.test(sp.range.trim()) && !area)) return <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !canAct} onClick={() => { p.act({ action: 'cast', tokenId, spellId: sp.id, slotLevel: (p.ready as { slotLevel: number }).slotLevel }); p.setReady(null); }}>Cast on yourself</button>;
              if (def && (def.targeting === 'enemy' || def.targeting === 'ally')) {
                const max = spellCount(def, sp.level, (p.ready as { slotLevel: number }).slotLevel || sp.level, lvl);
                return (
                  <span data-testid="spell-targets">
                    right-click {def.targeting === 'ally' ? 'allies (or yourself)' : 'enemies'} to choose {max > 1 ? `up to ${max} targets${def.projectiles ? ` (${def.projectiles.label}s – the same target can be chosen again)` : ''}` : 'the target'}: <b>{p.spellTargets.map((t) => t.name).join(', ') || '–'}</b> ({p.spellTargets.length}/{max}){' '}
                    <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !canAct || !p.spellTargets.length} onClick={() => { p.act({ action: 'cast', tokenId, spellId: sp.id, slotLevel: (p.ready as { slotLevel: number }).slotLevel, targets: p.spellTargets.map((t) => (t.kind === 'pc' ? { kind: 'pc', tokenId: t.tokenId } : { kind: 'npc', id: t.id })) }); p.setReady(null); }} data-testid="cast-targets">Cast</button>{' '}
                    <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => p.setSpellTargets([])}>Clear</button>
                  </span>
                );
              }
              return /regains? .*hit points/i.test(sp.description) ? 'right-click an ally (or open the target menu) to heal.' : 'right-click an enemy to cast at it.';
            })()}
          </p>
        );
      })()}
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className="btn btn-ghost px-2 py-0.5" aria-expanded={spellOpen} disabled={!(sheet?.spells.length)} onClick={() => setSpellOpen((v) => !v)} data-testid="open-spells">✦ Spellbook{sheet?.spells.length ? ` (${spells.length} ready)` : ''}</button>
        {slots.length > 0 && <span className="text-marble-400">Slots: {slots.map((s) => `${ordinal(s.level)} ${s.current}${s.max !== null ? `/${s.max}` : ''}`).join(' · ')}</span>}
        {!enemy && <span className="text-marble-500">Click an enemy on the map to attack it or cast at it.</span>}
      </div>
      {spellOpen && !enemy && (
        <div className="space-y-1" aria-label="Spellbook" data-testid="spellbook">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((l) => (sheet?.spells ?? []).some((x) => x.level === l)).map((l) => (
            <details key={l} open={l <= 3}>
              <summary className="cursor-pointer text-marble-300">{l === 0 ? 'Cantrips' : `${ordinal(l)} level`}{l > 0 ? ` · slots ${slots.find((x) => x.level === l)?.current ?? 0}/${slots.find((x) => x.level === l)?.max ?? 0}` : ''}</summary>
              <ul className="mt-1 space-y-1">
                {(sheet?.spells ?? []).filter((x) => x.level === l).sort((a, b) => a.name.localeCompare(b.name)).map((x) => (
                  <li key={x.id} className={`rounded border px-1.5 py-1 ${x.level > 0 && !x.prepared ? 'border-ink-800 opacity-60' : 'border-ink-700'}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <b className="text-marble-50">{x.name}</b>
                      <span className="text-marble-500">{x.castingTime || '1 action'} · {x.range || '—'}{x.concentration ? ' · concentration' : ''}{x.level > 0 && !x.prepared ? ' · not prepared' : ''}</span>
                      {(x.level === 0 || x.prepared) && <button type="button" className="btn btn-ghost ml-auto px-2 py-0.5" onClick={() => { p.setReady({ kind: 'spell', spellId: x.id, slotLevel: slotFor(x.id, x.level) }); setSpellOpen(false); }}>Ready</button>}
                    </div>
                    {x.description && <details><summary className="cursor-pointer text-[10px] text-marble-500">Description</summary><p className="whitespace-pre-wrap text-[11px] text-marble-300">{x.description}</p></details>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}

      {enemy && (
        <div className="space-y-1 rounded border border-gold-600/60 bg-ink-900/80 p-2" role="dialog" aria-label={`Target ${enemy.name}`} data-testid="target-menu">
          <div className="flex items-center gap-2">
            <b className="text-sm text-gold-200">🎯 {enemy.name}</b>
            <span className="text-marble-400">{feetTo(enemy) ?? '?'} ft away{enemy.condition === 'bloodied' ? ' · bloodied' : ''}</span>
            <button type="button" className="ml-auto text-marble-500 hover:text-gold-200" onClick={() => p.setTarget(null)} aria-label="Close target menu">✕</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-marble-300">
            <label>Roll <select aria-label="Advantage" className="rounded border border-ink-600 bg-ink-900 px-1" value={adv} onChange={(e) => setAdv(e.target.value as '' | 'adv' | 'dis')}><option value="">automatic</option><option value="adv">advantage (GM ruling)</option><option value="dis">disadvantage</option></select></label>
            {canSmite && <label title="Spent only on a hit">Divine Smite <select aria-label="Smite slot" className="rounded border border-ink-600 bg-ink-900 px-1" value={smite} onChange={(e) => setSmite(Number(e.target.value))}><option value={0}>no</option>{slots.filter((x) => x.current > 0).map((x) => <option key={x.level} value={x.level}>{ordinal(x.level)} slot</option>)}</select></label>}
            {me2?.readied && <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending} onClick={() => { p.act({ action: 'release', actor: { kind: 'pc', tokenId }, target: { kind: 'npc', id: enemy.id }, ...(adv ? { adv } : {}) }); p.setTarget(null); }} data-testid="release">⏳ Release readied attack (reaction)</button>}
          </div>
          <ul className="space-y-1" aria-label="Attacks">
            {p.attacks.map((a, i) => {
              const r = parseRangeFt(`${a.range} ${a.notes}`);
              const d = feetTo(enemy);
              const ok = d === null || d <= (r.rangeFt ?? r.reachFt);
              return (
                <li key={i} className="flex flex-wrap items-center gap-1.5 rounded border border-ink-700 px-1.5 py-1">
                  <span className="flex-1"><b className="text-marble-50">{r.rangeFt ? '🏹' : '⚔'} {a.name}</b> <span className="text-marble-400">{a.bonus} · {a.damage} · {r.rangeFt ? `range ${r.rangeFt} ft` : `reach ${r.reachFt} ft`}</span>{!ok && <span className="block text-[10px] text-rose-300">out of {r.rangeFt ? 'range' : 'reach'}</span>}</span>
                  <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !canAct || !ok} onClick={() => { p.act({ action: 'strike', attacker: { kind: 'pc', tokenId }, target: { kind: 'npc', id: enemy.id }, attackIndex: i, bonus, ...(adv ? { adv } : {}), ...(smite ? { smite } : {}) }); p.setTarget(null); }} data-testid="attack-option">
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
