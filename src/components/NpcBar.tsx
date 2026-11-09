/**
 * The GM's action bar for the selected enemy or ally (APEX 2.0), over the bottom edge of the map like the players'
 * bar: action economy, its attacks (the chosen one is the default for right-clicks), area abilities, war cries,
 * Dash / Disengage / Dodge / Hide, the target strip and End turn.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { SceneSnapshot } from '../server/sceneRuntime';
import type { SceneEncounter } from '../game/types';
import type { SceneEnemy } from '../game/sceneCombat';
import { npcAttacks } from '../game/sceneCombat';
import { budgetOf, isActiveActor, reactionUsed } from '../game/sceneActions';
import { TargetStrip } from './TargetStrip';

export function NpcBar({ target, snapshot, encounter, npc, busy, act, attack, setAttack, areaMode, setAreaMode, onTarget }: {
  target: HTMLElement | null; snapshot: SceneSnapshot; encounter: SceneEncounter | null; npc: SceneEnemy; busy: boolean;
  act: (input: Record<string, unknown>) => void; attack: number; setAttack: (i: number) => void; areaMode: number | null; setAreaMode: (i: number | null) => void; onTarget: (id: string) => void;
}) {
  const [shove, setShove] = useState<'push' | 'prone' | null>(null);
  if (!target) return null;
  const actor = `npc-${npc.id}`;
  const b = budgetOf(encounter, actor);
  const myTurn = !encounter || isActiveActor(encounter, actor);
  const attacks = npcAttacks(npc);
  const fig = (snapshot.figures ?? []).find((f) => f.kind === 'enemy' && f.id === npc.id);
  const chosen = attacks[attack];
  const rangeFt = chosen ? (chosen.kind === 'melee' ? chosen.reachFt : chosen.longRangeFt ?? chosen.rangeFt ?? chosen.reachFt) : null;
  const slot = (key: string, icon: string, label: string, opts: { on?: boolean; disabled?: boolean; title?: string; onClick: () => void; badge?: string | number; cost?: 'action' | 'bonus'; tone?: string }) => (
    <button key={key} type="button" className={`hotbar-slot${opts.on ? ' is-on' : ''}${opts.tone ? ` tone-${opts.tone}` : ''}`} disabled={busy || opts.disabled} title={opts.title} aria-pressed={opts.on} onClick={opts.onClick} data-testid="npc-slot">
      <span className="hotbar-icon" aria-hidden>{icon}</span>
      <span className="hotbar-label">{label}</span>
      {opts.cost && <span aria-hidden className={`hotbar-cost ${opts.cost}`} />}
      {opts.badge !== undefined && <span className="hotbar-badge">{opts.badge}</span>}
    </button>
  );
  const orb = (label: string, used: boolean, cls: string) => <span className={`flex items-center gap-1 ${used ? 'text-marble-500 line-through' : 'text-marble-100'}`}><span aria-hidden className={`inline-block h-4 w-4 ${cls} ${used ? 'bg-ink-700' : ''}`} />{label}</span>;
  const node = (
    <div className="battle-hotbar space-y-1.5 text-xs" data-testid="npc-bar">
      {fig && <TargetStrip snapshot={snapshot} from={fig} fromAlt={fig.alt ?? 0} side={npc.side === 'ally' ? 'hostile' : 'party'} rangeFt={shove ? 5 : rangeFt} label={shove ? (shove === 'push' ? 'Shove: push' : 'Shove: prone') : 'Targets'} onPick={(id) => {
        if (!shove) return onTarget(id);
        const f = (snapshot.figures ?? []).find((x) => (x.kind === 'pc' ? x.tokenId === id : x.id === id));
        act({ action: 'shove', attacker: { kind: 'npc', id: npc.id }, target: f?.kind === 'pc' ? { kind: 'pc', tokenId: id } : { kind: 'npc', id }, mode: shove });
        setShove(null);
      }} />}
      <div className="hotbar-frame">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <b className="font-display text-gold-200">{npc.name}</b>
          <span className="text-marble-300">AC {npc.ac} · {npc.hp}/{npc.maxHp} HP{npc.tempHp ? ` +${npc.tempHp}` : ''} · {npc.speedFt} ft{npc.flyFt ? ` · fly ${npc.flyFt}` : ''}</span>
          {encounter && <>
            {orb('Action', !!b.action, 'rounded-full bg-emerald-500')}
            {orb('Bonus', !!b.bonus, 'rotate-45 scale-75 bg-amber-400')}
            {orb('Reaction', reactionUsed(encounter, actor), 'rounded-full bg-arcane-500')}
            <span className="text-marble-300">moved {b.moved ?? 0} ft</span>
          </>}
          {!myTurn && <span className="text-amber-300">not its turn</span>}
        </div>
        <div className="flex items-end gap-2">
          <div className="hotbar-slots">
            {attacks.map((a, i) => slot(`a${i}`, a.kind === 'melee' ? '⚔' : '🏹', a.name, { on: attack === i && areaMode === null, cost: 'action', title: `${a.name} +${a.bonus} · ${a.damage} ${a.damageType} · ${a.kind === 'melee' ? `reach ${a.reachFt} ft` : `range ${a.rangeFt}/${a.longRangeFt} ft`} – right-click a target (or pick it above)`, onClick: () => { setAttack(i); setAreaMode(null); } }))}
            {(npc.areas ?? []).map((a, i) => { const left = a.uses ? a.uses - (npc.areaUsed?.[a.name] ?? 0) : undefined; return slot(`ar${i}`, '🔥', a.name, { on: areaMode === i, cost: 'action', badge: left, disabled: left === 0 || !myTurn, tone: 'spell', title: `${a.sizeFt}-ft ${a.shape} · DC ${a.dc} ${a.save.toUpperCase()} · ${a.damage} ${a.damageType} – hover the map, right-click to use`, onClick: () => setAreaMode(areaMode === i ? null : i) }); })}
            {(npc.buffs ?? []).map((bf, i) => slot(`b${i}`, '📯', bf.name, { cost: bf.cost === 'bonus' ? 'bonus' : 'action', disabled: !myTurn, tone: 'feature', title: `allies within ${bf.radiusFt} ft`, onClick: () => act({ action: 'npcBuff', id: npc.id, buff: i }) }))}
            {(['dash', 'disengage', 'dodge'] as const).map((id) => slot(id, id === 'dash' ? '🏃' : id === 'disengage' ? '↩' : '🛡', id[0].toUpperCase() + id.slice(1), { cost: 'action', on: id === 'dash' ? !!b.dash : id === 'disengage' ? !!b.disengage : !!b.dodge, disabled: !encounter || !myTurn || !!b.action, onClick: () => act({ action: 'standard', actor: { kind: 'npc', id: npc.id }, act: id }) }))}
            {slot('push', '✋', 'Shove push', { on: shove === 'push', cost: 'action', disabled: !myTurn, title: 'Then pick the target in the strip above: Athletics contest, push 5 ft (off an edge: it falls)', onClick: () => setShove(shove === 'push' ? null : 'push') })}
            {slot('prone', '⤓', 'Shove prone', { on: shove === 'prone', cost: 'action', disabled: !myTurn, title: 'Then pick the target in the strip above: Athletics contest, knock prone', onClick: () => setShove(shove === 'prone' ? null : 'prone') })}
            {slot('hide', '🥷', 'Hide', { cost: 'action', disabled: !!encounter && !myTurn, onClick: () => act({ action: 'hide', actor: { kind: 'npc', id: npc.id } }) })}
          </div>
          {encounter && myTurn && <button type="button" className="hotbar-end" disabled={busy} onClick={() => act({ action: 'endTurn', encounterId: encounter.id, turnSerial: encounter.turnSerial ?? 0, actor })} data-testid="npc-end-turn">End<br />turn</button>}
        </div>
      </div>
    </div>
  );
  return createPortal(node, target);
}
