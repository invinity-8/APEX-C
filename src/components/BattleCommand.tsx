/**
 * GM battle command on the map (APEX 1.1): vision modes, the selected figure (character, enemy or ally) with its
 * turn economy and actions (move, attack, standard actions, HP), and open reaction prompts (opportunity attacks).
 *
 * Click a figure on the map to select it; with "Move" the next hex click moves it, with "Attack" the next figure
 * click attacks that target. All rules run on the server.
 */
import { useEffect, useState } from 'react';
import type { SceneSnapshot } from '../server/sceneRuntime';
import type { SceneEncounter } from '../game/types';
import { npcAttacks, type SceneEnemy } from '../game/sceneCombat';
import { CONDITIONS, CONDITION_TEXT, type ConditionId } from '../game/combatEffects';
import { STANDARD_ACTIONS, budgetOf, isActiveActor, npcActor, pcActor, reactionUsed } from '../game/sceneActions';
import type { SheetAttack } from '../game/sheet';

export type FigureRef = { kind: 'pc'; id: string } | { kind: 'npc'; id: string };
export type BattleMode = null | 'move' | 'attack';
export const refKey = (r: FigureRef) => (r.kind === 'pc' ? pcActor(r.id) : npcActor(r.id));
export const toSide = (r: FigureRef) => (r.kind === 'pc' ? { kind: 'pc', tokenId: r.id } : { kind: 'npc', id: r.id });

export const VIEW_LABEL: Record<string, string> = { all: 'Full view', party: 'Party sight', enemies: 'Enemy sight' };

/** Action / bonus action / reaction / Dash … chips for one creature (shared by GM and player). */
export function EconomyChips({ encounter, actor }: { encounter: SceneEncounter | null; actor: string }) {
  if (!encounter) return <span className="text-marble-500">Free play – no initiative.</span>;
  const b = budgetOf(encounter, actor);
  const chip = (label: string, used: boolean, title: string) => (
    <span key={label} title={title} className={`rounded-full border px-2 py-0.5 text-[11px] ${used ? 'border-ink-600 text-marble-500 line-through' : 'border-emerald-500/60 text-emerald-200'}`} data-used={used} data-testid={`eco-${label.toLowerCase().replace(/\s/g, '-')}`}>
      {label}
    </span>
  );
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label="Turn economy">
      {chip('Action', !!b.action, b.attackAction ? `Attack action · ${b.attacks ?? 0} attack(s) made` : b.last ? `Used: ${b.last}` : 'Available')}
      {chip('Bonus action', !!b.bonus, 'One bonus action per turn')}
      {chip('Reaction', reactionUsed(encounter, actor), 'Refreshes at the start of the creature’s turn')}
      {b.dash && <span className="rounded-full border border-sky-500/60 px-2 py-0.5 text-[11px] text-sky-200">Dashing</span>}
      {b.disengage && <span className="rounded-full border border-sky-500/60 px-2 py-0.5 text-[11px] text-sky-200">Disengaged</span>}
      {b.dodge && <span className="rounded-full border border-sky-500/60 px-2 py-0.5 text-[11px] text-sky-200">Dodging</span>}
    </span>
  );
}

interface Props {
  snapshot: SceneSnapshot;
  encounter: SceneEncounter | null;
  enemies: SceneEnemy[];
  view: string;
  setView: (v: string) => void;
  selected: FigureRef | null;
  setSelected: (r: FigureRef | null) => void;
  mode: BattleMode;
  setMode: (m: BattleMode) => void;
  busy: boolean;
  /** POST scene-turn with the scene id added. */
  act: (input: Record<string, unknown>) => void;
  /** Sheet attacks of a character (equipment first) for GM attacks with a character. */
  loadAttacks: (tokenId: string) => Promise<SheetAttack[]>;
  pcAttack: number;
  setPcAttack: (i: number) => void;
  npcAttack: number;
  setNpcAttack: (i: number) => void;
  /** Index of the NPC area ability being aimed (right-click a hex). */
  areaMode: number | null;
  setAreaMode: (i: number | null) => void;
  adv: '' | 'adv' | 'dis';
  setAdv: (a: '' | 'adv' | 'dis') => void;
}

export function BattleCommand(p: Props) {
  const { snapshot, encounter, selected } = p;
  const figures = snapshot.figures ?? [];
  const fig = selected ? figures.find((f) => (selected.kind === 'pc' ? f.kind === 'pc' && f.tokenId === selected.id : f.kind === 'enemy' && f.id === selected.id)) : null;
  const npc = selected?.kind === 'npc' ? p.enemies.find((e) => e.id === selected.id) : null;
  const [attacks, setAttacks] = useState<SheetAttack[]>([]);
  const loadAttacks = p.loadAttacks;
  useEffect(() => {
    let live = true;
    if (selected?.kind === 'pc') void loadAttacks(selected.id).then((a) => live && setAttacks(a)).catch(() => undefined);
    else setAttacks([]);
    return () => { live = false; };
  }, [selected?.kind, selected?.id, loadAttacks]);
  const actor = selected ? refKey(selected) : '';
  const isTurn = !!encounter && isActiveActor(encounter, actor);
  const reactions = snapshot.reactions ?? [];
  const viewOpts = ['all', 'party', 'enemies', ...(selected ? [actor.startsWith('pc-') ? actor : selected.id] : [])];
  return (
    <section className="battle-command space-y-2 rounded-lg border border-gold-700/50 bg-ink-950/85 p-2 text-xs" aria-label="Battle command" data-testid="battle-command">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Vision">
        <span className="text-marble-400">Vision:</span>
        {viewOpts.map((v) => (
          <button key={v} type="button" className="btn btn-ghost px-2 py-0.5" aria-pressed={p.view === v} onClick={() => p.setView(v)} data-testid={`view-${v.startsWith('pc-') || !VIEW_LABEL[v] ? 'figure' : v}`}>
            {VIEW_LABEL[v] ?? `👁 ${fig?.name ?? 'Selected'}`}
          </button>
        ))}
        {p.view !== 'all' && <span className="text-marble-500">grey hexes are out of sight{p.view.startsWith('pc-') || !VIEW_LABEL[p.view] ? '' : ' for everyone in this group'}</span>}
      </div>

      {!!reactions.length && (
        <ul className="space-y-1" aria-label="Reaction prompts" data-testid="gm-reactions">
          {reactions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded border border-amber-400/60 bg-amber-500/10 px-2 py-1 text-amber-100">
              <span className="flex-1">{r.kind === 'shield' ? <>🛡 <b>{r.reactor.name}</b> may cast <b>Shield</b> against <b>{r.target.name}</b>'s hit (the player decides; the GM may too).</> : <>⚡ <b>{r.reactor.name}</b> may make an opportunity attack against <b>{r.target.name}</b> (reaction).</>}</span>
              <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.busy} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: true })}>Attack</button>
              <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.busy} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: false })}>Skip</button>
            </li>
          ))}
        </ul>
      )}

      {!selected || !fig ? (
        <p className="text-marble-400">Click a character, enemy or ally on the map to command it. Click an initiative entry to select that creature.</p>
      ) : (
        <div className="space-y-1.5" data-testid="selected-figure">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm text-gold-200">{fig.name}</b>
            <span className="text-marble-400">{selected.kind === 'pc' ? 'character' : fig.side === 'ally' ? 'ally' : 'enemy'}{npc ? ` · AC ${npc.ac} · HP ${npc.hp}/${npc.maxHp} · speed ${npc.speedFt} ft${encounter ? ` (${Math.max(0, npc.speedFt * (budgetOf(encounter, actor).dash ? 2 : 1) - (budgetOf(encounter, actor).moved ?? 0))} ft left)` : ''}${(npc.multiattack ?? 1) > 1 ? ` · Multiattack ${npc.multiattack}` : ''}` : ''}</span>
            {isTurn && <span className="rounded bg-gold-400/20 px-1.5 text-gold-200">their turn</span>}
            <button type="button" className="ml-auto text-marble-500 hover:text-gold-200" onClick={() => (p.setSelected(null), p.setMode(null))}>✕</button>
          </div>
          <EconomyChips encounter={encounter} actor={actor} />
          <div className="flex flex-wrap items-center gap-1" aria-label="Conditions and effects" data-testid="gm-effects">
            {fig.concentration && <span className="rounded-full border border-arcane-400/70 px-2 py-0.5 text-arcane-200">◎ {fig.concentration}</span>}
            {(fig.effects ?? []).map((e) => (
              <span key={e.id} className="flex items-center gap-1 rounded-full border border-ink-500 px-2 py-0.5 text-marble-100" title={CONDITION_TEXT[e.key as ConditionId] ?? e.name}>
                {e.name}
                <button type="button" className="text-marble-500 hover:text-blood-400" aria-label={`Remove ${e.name}`} onClick={() => p.act({ action: 'condition', target: toSide(selected), effectId: e.id, add: false })}>×</button>
              </span>
            ))}
            <select aria-label="Add a condition" className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value="" onChange={(e) => e.target.value && p.act({ action: 'condition', target: toSide(selected), condition: e.target.value, add: true })}>
              <option value="">+ Condition…</option>
              {CONDITIONS.map((c) => <option key={c} value={c} title={CONDITION_TEXT[c]}>{c}</option>)}
            </select>
            <select aria-label="Attack roll" className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={p.adv} onChange={(e) => p.setAdv(e.target.value as '' | 'adv' | 'dis')} title="Applies to this creature's next attacks; effects and conditions are added automatically">
              <option value="">roll: automatic</option><option value="adv">roll with advantage</option><option value="dis">roll with disadvantage</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className="btn btn-ghost px-2 py-0.5" aria-pressed={p.mode === 'move'} disabled={p.busy || npc?.defeated} onClick={() => p.setMode(p.mode === 'move' ? null : 'move')} data-testid="gm-move">
              {p.mode === 'move' ? 'Click a hex…' : 'Move'}
            </button>
            {npc && (
              <select aria-label="NPC attack" className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={p.npcAttack} onChange={(e) => p.setNpcAttack(Number(e.target.value))}>
                {npcAttacks(npc).map((a, i) => <option key={i} value={i}>{a.kind === 'melee' ? '⚔' : a.kind === 'ranged' ? '🏹' : '✦'} {a.name} +{a.bonus} · {a.damage}{a.damageType ? ` ${a.damageType}` : ''} · {a.kind === 'melee' ? `reach ${a.reachFt}` : `range ${a.rangeFt}`} ft</option>)}
              </select>
            )}
            {npc?.buffs?.map((bf, i) => {
              const left = bf.uses ? bf.uses - (npc.areaUsed?.[bf.name] ?? 0) : null;
              return <button key={bf.name} type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.busy || left === 0 || !isTurn} title={`${bf.cost === 'bonus' ? 'Bonus action' : 'Action'}: allies within ${bf.radiusFt} ft${bf.toHit ? ` +${bf.toHit} to hit` : ''}${bf.ac ? ` +${bf.ac} AC` : ''}${bf.advantage ? ' advantage' : ''} until its next turn`} onClick={() => p.act({ action: 'npcBuff', id: npc.id, buff: i })}>📯 {bf.name}{left !== null ? ` (${left})` : ''}</button>;
            })}
            {npc?.areas?.map((a, i) => {
              const left = a.uses ? a.uses - (npc.areaUsed?.[a.name] ?? 0) : null;
              return <button key={a.name} type="button" className="btn btn-ghost px-2 py-0.5" aria-pressed={p.areaMode === i} disabled={p.busy || left === 0} title={`${a.sizeFt}-ft ${a.shape} · DC ${a.dc} ${a.save.toUpperCase()} · ${a.damage} ${a.damageType}`} onClick={() => p.setAreaMode(p.areaMode === i ? null : i)}>🔥 {a.name}{left !== null ? ` (${left})` : ''}</button>;
            })}
            {npc && (
              <>
            <button type="button" className="btn btn-gold px-2 py-0.5" aria-pressed={p.mode === 'attack'} disabled={p.busy || npc?.defeated || (selected.kind === 'pc' && !attacks.length)} onClick={() => p.setMode(p.mode === 'attack' ? null : 'attack')} data-testid="gm-attack">
              {p.mode === 'attack' ? 'Click the target…' : 'Attack'}
            </button>
            <select aria-label="Standard action" className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value="" disabled={p.busy || !encounter} onChange={(e) => e.target.value && p.act({ action: 'standard', actor: toSide(selected), act: e.target.value })}>
              <option value="">Action…</option>
              {STANDARD_ACTIONS.map((a) => <option key={a.id} value={a.id} title={a.text}>{a.label}</option>)}
            </select>
            <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.busy || !encounter} onClick={() => p.act({ action: 'standard', actor: toSide(selected), act: 'bonusOther' })}>Bonus action</button>
              </>
            )}
            {npc && [-10, -5, -1, 1, 5].map((d) => (
              <button key={d} type="button" className="btn btn-ghost px-1.5 py-0.5" disabled={p.busy} onClick={() => p.act({ action: 'enemyHp', id: npc.id, delta: d })}>{d > 0 ? `+${d}` : d} HP</button>
            ))}
            {npc && <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.busy} onClick={() => (p.act({ action: 'enemyRemove', id: npc.id }), p.setSelected(null))}>Remove</button>}
            {isTurn && encounter && <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.busy} onClick={() => p.act({ action: 'endTurn', encounterId: encounter.id, turnSerial: encounter.turnSerial ?? 0, actor })}>End turn</button>}
          </div>
          {p.mode === 'move' && <p className="text-gold-200">Click the destination hex. {selected.kind === 'pc' ? 'Characters move with their speed rules (the GM may move them out of turn).' : 'NPCs move freely.'} Leaving a hostile’s reach offers it an opportunity attack.</p>}
          {p.mode === 'attack' && <p className="text-gold-200">Click the target on the map (reach, range and line of sight are checked).</p>}
          {p.areaMode !== null && <p className="text-amber-200">Hover to see the area, right-click a hex to use it.</p>}
          {isTurn && p.mode === null && p.areaMode === null && <p className="text-marble-400">Hover a hex for the path, <b>right-click</b> a hex to move there, <b>right-click</b> a hostile to attack with the chosen attack.</p>}
        </div>
      )}
    </section>
  );
}
