/**
 * Player combat controls on a battle map (APEX 1.1): turn economy (action, bonus action, reaction), a movement bar,
 * the standard actions (Dash, Disengage, Dodge …), a target menu when an enemy is clicked (weapon attacks with
 * range, spells with slot choice / upcasting) and the opportunity-attack prompt. The server checks every rule.
 */
import { useEffect, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import type { SceneSnapshot } from '../server/sceneRuntime';
import type { SceneEncounter } from '../game/types';
import type { CharacterSheet, SheetAttack } from '../game/sheet';
import { STANDARD_ACTIONS, budgetOf, characterLevel, ordinal, pcActor, planSpell, reactionUsed, spellSlots } from '../game/sceneActions';
import { parseRangeFt } from '../game/sceneCombat';
import { hexAt } from '../campaign/hexScene';
import { distance } from '../game/hex';
import { flanks } from '../game/combatEffects';
import { spellCount, spellEffectOf, supportive } from '../game/spellEffects';
import { battleFeatures } from '../game/classFeatures';
import { CONDITION_TEXT, type ConditionId } from '../game/combatEffects';
import { beastsFor } from '../game/beastCatalog';
import { formAllowed, wildShapeLevel } from '../game/abilities';

const beastOptions = (sheet: CharacterSheet | null) => { const lvl = sheet ? wildShapeLevel(sheet) ?? 0 : 0; return beastsFor(undefined).filter((b) => !formAllowed(b, lvl)); };
import { parseArea } from '../campaign/hexArea';
import { beastIcon } from './map/effectIcons';
import { TargetStrip } from './TargetStrip';

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
  /** APEX 1.9: the battle layout's hotbar slot over the map – the action bar renders there (portal). */
  barTarget?: HTMLElement | null;
  /** End this character's turn (shown as the big button in the action bar). */
  onEndTurn?: () => void;
  /** APEX 2.0: act on a figure from the target strip (same as right-clicking it on the map). */
  onTargetFigure?: (id: string) => void;
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
  const [bonus, setBonus] = useState(false);
  const [adv, setAdv] = useState<'' | 'adv' | 'dis'>('');
  const [smite, setSmite] = useState(0);
  const [readyTrigger, setReadyTrigger] = useState('');
  const me2 = snapshot.self?.[tokenId];
  const hidden = !!me2?.effects.some((e) => e.key === 'hidden');
  const rogue = !!sheet?.abilities.some((x) => /sneak attack/i.test(x.name));
  const [sneakOn, setSneakOn] = useState(true);
  const features = sheet ? battleFeatures(sheet) : [];
  const canSmite = !!sheet?.abilities.some((x) => /divine smite/i.test(x.name));
  const [slot, setSlot] = useState<Record<string, number>>({});
  const [spellOpen, setSpellOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const reactions = snapshot.reactions ?? [];
  const melee = p.attacks.map((a, i) => ({ a, i })).filter(({ a }) => !parseRangeFt(`${a.range} ${a.notes}`).rangeFt);
  const [reactWith, setReactWith] = useState(0);
  const slots = sheet ? spellSlots(sheet) : [];
  const beast = sheet?.wildShape;
  // no spellcasting in Wild Shape (until druid level 18)
  const spells = (beast ? [] : sheet?.spells ?? []).filter((s) => s.level === 0 || s.prepared).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const lvl = sheet ? characterLevel(sheet) : 1;
  const slotFor = (id: string, level: number) => slot[id] ?? (level === 0 ? 0 : slots.find((s) => s.level >= level && s.current > 0)?.level ?? level);
  const moveTotal = p.movement ? Math.max(p.movement.allowance, 1) : 0;
  const moveLeft = p.movement ? Math.max(0, p.movement.allowance - p.movement.spent) : 0;

  const friends = figures.filter((x) => (x.kind === 'pc' && x.tokenId !== tokenId) || (x.kind === 'enemy' && x.side === 'ally'));
  const actionCost = bonus ? 'bonus' : 'action';
  const hastedNow = !!me2?.effects.some((e) => e.key === 'haste') && !b.hasted;
  const spentCost = bonus ? !!b.bonus : !!b.action;
  /** Dash, Disengage, Hide, Use an Object: also possible with the extra action of Haste. */
  const spentHaste = bonus ? !!b.bonus : !!b.action && !hastedNow;
  const standard = (id: string) => p.act({ action: 'standard', actor: { kind: 'pc', tokenId }, act: id, viaBonus: bonus });
  const readySpellNow = p.ready?.kind === 'spell' ? spells.find((x) => x.id === (p.ready as { spellId: string }).spellId) : undefined;
  const defaultAttack = p.attacks.length ? 0 : -1;
  const castOn = (id: string, lv: number, t: { kind: 'pc'; tokenId: string } | { kind: 'npc'; id: string } | null) => p.act({ action: 'cast', tokenId, spellId: id, slotLevel: lv, ...(t ? { targets: [t] } : {}) });

  const spellRow = (id: string, withTarget: boolean) => {
    const s = spells.find((x) => x.id === id)!;
    const lv = slotFor(id, s.level);
    const plan = sheet ? planSpell(sheet, id, lv, lvl) : { error: 'No sheet.' };
    const range = 'error' in plan ? null : plan.rangeFt;
    const dist = withTarget && enemy ? feetTo(enemy) : null;
    const outOfRange = range !== null && dist !== null && dist > range;
    return (
      <li key={id} className="flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-1.5 py-1">
        <span className="min-w-[8rem] flex-1">
          <LevelBadge level={s.level} /> <b className="text-marble-50">{s.name}</b> <span className="text-marble-500">{s.range ? `${s.range}` : ''}{s.castingTime ? ` · ${s.castingTime}` : ''}</span>
          {'error' in plan ? <span className="block text-[10px] text-rose-300">{plan.error}</span> : <span className="block text-[10px] text-marble-300">{plan.mode === 'attack' ? 'Spell attack' : plan.mode === 'save' ? `${plan.save ?? ''} save` : 'Effect'}{plan.damage ? ` · ${plan.damage}` : ''}{outOfRange ? ` · out of range (${dist} ft)` : ''}</span>}
        </span>
        {s.level > 0 && <SlotSelect slots={slots} spellLevel={s.level} value={lv} onChange={(v) => setSlot({ ...slot, [id]: v })} label={`Slot for ${s.name}`} />}
        <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !canAct || 'error' in plan || outOfRange} onClick={() => { p.act({ action: 'cast', tokenId, spellId: id, slotLevel: lv, ...(withTarget && enemy ? { target: { kind: 'npc', id: enemy.id }, point: { x: enemy.x, y: enemy.y } } : {}) }); p.setTarget(null); setSpellOpen(false); }} data-testid="cast-spell">
          Cast{withTarget && enemy ? ` at ${enemy.name}` : ''}
        </button>
      </li>
    );
  };

  // ---- APEX 1.9 quick bar (Baldur's-Gate style): customizable slots, drag & drop from the panel, saved per character
  const allQuick: QuickItem[] = [
    ...p.attacks.map((_, i) => ({ k: 'attack', i }) as QuickItem),
    ...spells.map((sp) => ({ k: 'spell', id: sp.id }) as QuickItem),
    ...(['dash', 'disengage', 'dodge', 'hide', 'search', 'help', 'useObject'] as const).map((id) => ({ k: 'act', id }) as QuickItem),
    ...features.map((f) => ({ k: 'feature', id: f.id }) as QuickItem),
  ];
  const [quick, setQuickState] = useState<Array<QuickItem | null>>(() => loadQuick(tokenId));
  useEffect(() => setQuickState(loadQuick(tokenId)), [tokenId]);
  const setQuick = (items: Array<QuickItem | null>) => { setQuickState(items); try { localStorage.setItem(`apex.quickbar.${tokenId}`, JSON.stringify(items)); } catch { /* private mode */ } };
  // first use (nothing saved): attacks, the first spells, the common actions, features
  const shownQuick = quick.length ? quick : defaultQuick(allQuick);
  const quickView = (q: QuickItem): QuickView | null => {
    if (q.k === 'attack') {
      const a = p.attacks[q.i]; if (!a) return null;
      const r = parseRangeFt(`${a.range} ${a.notes}`);
      return { icon: r.rangeFt ? '🏹' : '⚔', label: a.name.replace(' (equipped)', '').replace(/ \((Shillelagh)\)/, ' ✦'), title: `${a.name} · ${a.bonus} · ${a.damage}`, cost: 'action', on: p.ready?.kind === 'attack' && p.ready.index === q.i, disabled: !canAct };
    }
    if (q.k === 'spell') {
      const sp = spells.find((x) => x.id === q.id); if (!sp) return null;
      const noSlot = sp.level > 0 && !slots.some((x) => x.level >= sp.level && x.current > 0);
      return { icon: supportive(sp) ? '✚' : '✦', label: sp.name, title: `${sp.name} · ${sp.level ? `${ordinal(sp.level)} level` : 'cantrip'} · ${sp.range}`, cost: /bonus/i.test(sp.castingTime) ? 'bonus' : /reaction/i.test(sp.castingTime) ? undefined : 'action', level: sp.level, on: p.ready?.kind === 'spell' && p.ready.spellId === sp.id, disabled: noSlot || !canAct, tone: supportive(sp) ? 'support' : 'spell' };
    }
    if (q.k === 'act') {
      const a = STANDARD_ACTIONS.find((x) => x.id === q.id);
      const label = q.id === 'hide' ? (hidden ? 'Unhide' : encounter ? 'Hide' : 'Sneak') : q.id === 'useObject' ? 'Object' : a?.label ?? q.id;
      const used = q.id === 'dodge' || q.id === 'help' || q.id === 'search' ? spentCost : spentHaste;
      const on = q.id === 'dash' ? !!b.dash : q.id === 'disengage' ? !!b.disengage : q.id === 'dodge' ? !!b.dodge : q.id === 'hide' ? hidden : false;
      return { icon: { dash: '🏃', disengage: '↩', dodge: '🛡', hide: '🥷', search: '🔎', help: '🤝', useObject: '🧪' }[q.id] ?? '•', label, title: a?.text ?? label, cost: encounter ? actionCost : undefined, on, disabled: p.pending || (!!encounter && (!p.myTurn || (q.id !== 'hide' || !hidden) && used)) };
    }
    const f = features.find((x) => x.id === q.id); if (!f) return null;
    return { icon: FEATURE_ICONS[f.id] ?? (f.id === 'wildShape' ? '🐾' : f.target === 'ally' ? '✚' : '★'), label: f.name, title: f.text, cost: f.cost === 'free' ? undefined : f.cost, badge: f.current ?? undefined, disabled: p.pending || !canAct || f.current === 0, tone: 'feature' };
  };
  const useQuick = (q: QuickItem) => {
    if (q.k === 'attack') return p.setReady(p.ready?.kind === 'attack' && p.ready.index === q.i ? null : { kind: 'attack', index: q.i });
    if (q.k === 'spell') { const sp = spells.find((x) => x.id === q.id); if (sp) p.setReady(p.ready?.kind === 'spell' && p.ready.spellId === sp.id ? null : { kind: 'spell', spellId: sp.id, slotLevel: slotFor(sp.id, sp.level) }); return; }
    if (q.k === 'act') {
      if (q.id === 'hide') return p.act({ action: 'hide', actor: { kind: 'pc', tokenId }, ...(hidden ? { off: true } : encounter ? { viaBonus: bonus } : {}) });
      return standard(q.id);
    }
    const f = features.find((x) => x.id === q.id);
    if (!f) return;
    // Wild Shape and features with a target are chosen in the panel
    if (f.id === 'wildShape' || f.target === 'ally') { document.querySelector('[data-testid="features"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    p.act({ action: 'feature', tokenId, feature: f.id });
  };
  const dragQuick = (q: QuickItem) => ({ draggable: true, onDragStart: (e: DragEvent) => { e.dataTransfer.setData(QUICK_MIME, JSON.stringify({ item: q })); e.dataTransfer.effectAllowed = 'copy'; } });

  const barNode = (
    <div className="battle-hotbar space-y-1.5 text-xs" data-testid="combat-bar">
      {reactions.filter((r) => r.kind === 'shield').map((r) => (
        <div key={r.id} role="alertdialog" aria-label="Shield" className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-400/70 bg-sky-500/15 px-2 py-1.5 text-sky-100" data-testid="shield-prompt">
          <span className="flex-1">🛡 <b>{r.target.name}</b> hits <b>{r.reactor.name}</b>. Cast <b>Shield</b> (reaction, +5 AC until your next turn – it may turn this hit into a miss)?</span>
          <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: true })}>Cast Shield</button>
          <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: false })}>Take the hit</button>
        </div>
      ))}
      {reactions.filter((r) => r.kind !== 'shield').map((r) => (
        <div key={r.id} role="alertdialog" aria-label="Opportunity attack" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/70 bg-amber-500/15 px-2 py-1.5 text-amber-100" data-testid="reaction-prompt">
          <span className="flex-1">⚡ <b>{r.target.name}</b> leaves the reach of <b>{r.reactor.name}</b>. Use your reaction for an opportunity attack?</span>
          {melee.length > 1 && <select aria-label="Opportunity attack with" className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={reactWith} onChange={(e) => setReactWith(Number(e.target.value))}>{melee.map(({ a, i }) => <option key={i} value={i}>{a.name}</option>)}</select>}
          <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !melee.length} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: true, attackIndex: melee.length > 1 ? reactWith : melee[0]?.i ?? 0 })}>Attack</button>
          <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending} onClick={() => p.act({ action: 'reaction', offerId: r.id, accept: false })}>Let them go</button>
        </div>
      ))}

      {readySpellNow && p.ready?.kind === 'spell' && (() => {
        const sp = readySpellNow;
        const lv = (p.ready as { slotLevel: number }).slotLevel;
        const area = parseArea(`${sp.range} ${sp.description}`);
        const def = spellEffectOf(sp);
        const help = supportive(sp);
        return (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-arcane-500/60 bg-arcane-500/10 px-2 py-1.5 text-arcane-300" data-testid="ready-spell-bar">
            <b className="text-marble-50">✦ {sp.name}</b>
            {sp.level > 0 && <SlotSelect slots={slots} spellLevel={sp.level} value={lv} onChange={(v) => p.setReady({ kind: 'spell', spellId: sp.id, slotLevel: v })} label="Slot level" />}
            <span className="text-marble-300">·</span>
            {(() => {
              if (area) return <span>{area.sizeFt}-ft {area.shape}: hover to see the area, right-click to cast there.</span>;
              if (def?.targeting === 'self' || (!def && /^self/i.test(sp.range.trim()))) return <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !canAct} onClick={() => { castOn(sp.id, lv, null); p.setReady(null); }}>Cast on yourself</button>;
              if (def && (def.targeting === 'enemy' || def.targeting === 'ally')) {
                const max = spellCount(def, sp.level, lv || sp.level, lvl);
                if (max === 1 && !def.projectiles && def.targeting === 'ally') return <span>right-click yourself or an ally – or <TargetPick self={tokenId} friends={friends} onPick={(t) => { castOn(sp.id, lv, t); p.setReady(null); }} disabled={p.pending || !canAct} /></span>;
                return (
                  <span data-testid="spell-targets">
                    right-click {def.targeting === 'ally' ? 'allies (or yourself)' : 'enemies'} to choose {max > 1 ? `up to ${max} targets${def.projectiles ? ` (${def.projectiles.label}s – the same target can be chosen again)` : ''}` : 'the target'}: <b className="text-marble-50">{p.spellTargets.map((t) => t.name).join(', ') || '–'}</b> ({p.spellTargets.length}/{max}){' '}
                    <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !canAct || !p.spellTargets.length} onClick={() => { p.act({ action: 'cast', tokenId, spellId: sp.id, slotLevel: lv, targets: p.spellTargets.map((t) => (t.kind === 'pc' ? { kind: 'pc', tokenId: t.tokenId } : { kind: 'npc', id: t.id })) }); p.setReady(null); }} data-testid="cast-targets">Cast</button>{' '}
                    <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => p.setSpellTargets([])}>Clear</button>
                  </span>
                );
              }
              if (help) return <span>right-click yourself or an ally – or <TargetPick self={tokenId} friends={friends} onPick={(t) => { castOn(sp.id, lv, t); p.setReady(null); }} disabled={p.pending || !canAct} /></span>;
              return <span>right-click an enemy to cast at it.</span>;
            })()}
            <button type="button" className="ml-auto text-marble-500 hover:text-gold-200" aria-label="Put the spell away" onClick={() => p.setReady(null)}>✕</button>
          </div>
        );
      })()}
      {p.onTargetFigure && (() => {
        // the target strip: what is in reach of the attack or spell in hand (allies for support spells)
        const atk = p.ready?.kind === 'attack' ? p.attacks[p.ready.index] : undefined;
        const r = atk ? parseRangeFt(`${atk.range} ${atk.notes}`) : null;
        const sp = readySpellNow;
        const plan = sp && sheet && p.ready?.kind === 'spell' ? planSpell(sheet, sp.id, p.ready.slotLevel, lvl) : null;
        const rangeFt = r ? r.longRangeFt ?? r.rangeFt ?? r.reachFt : plan && !('error' in plan) ? plan.rangeFt : null;
        const myAlt = snapshot.movement?.tokenId === tokenId ? snapshot.movement.alt ?? 0 : (snapshot.figures ?? []).find((f) => f.kind === 'pc' && f.tokenId === tokenId)?.alt ?? 0;
        return <TargetStrip snapshot={snapshot} from={me ?? null} fromAlt={myAlt} side={sp && supportive(sp) ? 'party' : 'hostile'} rangeFt={rangeFt} onPick={p.onTargetFigure!} label={sp && supportive(sp) ? 'Allies' : 'Targets'} />;
      })()}
      <div className="hotbar-frame">
        <div className="hotbar-economy">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {encounter ? <EconomyOrbs encounter={encounter} actor={actor} haste={!!me2?.effects.some((e) => e.key === 'haste')} /> : <span className="rounded-full border border-forest-400/60 px-2 py-0.5 text-forest-300">Free play – no initiative</span>}
        {p.movement && !p.free && (
          <span className="flex min-w-[11rem] flex-1 items-center gap-2" title={`${moveLeft} of ${p.movement.allowance} ft left${p.movement.dashed ? ' (Dash)' : ''}`}>
            <span aria-hidden className="text-base">👣</span>
            <span className="relative h-3 flex-1 overflow-hidden rounded-full border border-ink-600 bg-ink-800" role="meter" aria-label="Movement left" aria-valuemin={0} aria-valuemax={p.movement.allowance} aria-valuenow={moveLeft} data-testid="movement-bar">
              <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-500 to-gold-200 transition-[width] duration-300" style={{ width: `${(moveLeft / moveTotal) * 100}%` }} />
              {p.movement.dashed && <span className="absolute inset-y-0 border-l border-dashed border-sky-300" style={{ left: '50%' }} />}
            </span>
            <b className="tabular-nums text-marble-100">{Math.round(moveLeft)}<span className="text-marble-500"> / {Math.round(p.movement.allowance)} ft</span></b>
          </span>
        )}
        {slots.length > 0 && <SlotTracker slots={slots} />}
      </div>

        </div>
        <div className="flex items-end gap-2">
          <QuickBar items={shownQuick} setItems={setQuick} render={quickView} onUse={useQuick} />
          {p.onEndTurn && p.myTurn && <button type="button" className="hotbar-end" disabled={p.pending} onClick={p.onEndTurn} data-testid="end-turn-bar" title="End your turn">End<br />turn</button>}
        </div>
      </div>
    </div>
  );

  return (
    <>
    {p.barTarget ? createPortal(barNode, p.barTarget) : null}
    <section className="space-y-2 rounded-xl border border-gold-700/60 bg-gradient-to-b from-ink-900/95 to-ink-950/95 p-2.5 text-xs shadow-[0_6px_24px_rgba(0,0,0,0.45)]" aria-label="Combat actions" data-testid="player-combat">
      {!p.barTarget && barNode}
      {beast && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/60 bg-emerald-900/25 px-2 py-1.5 text-emerald-100" data-testid="wild-shape-banner">
          <span className="text-lg" aria-hidden>{beastIcon(beast.formName)}</span>
          <span className="flex-1"><b>Wild Shape: {beast.formName}</b> · {beast.hp}/{beast.maxHp} beast HP · beast attacks, AC and speed · no spellcasting. At 0 beast HP you revert; extra damage carries over.</span>
        </div>
      )}
      {(me2?.effects.length || me2?.concentration || me2?.readied) && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Your conditions and effects" data-testid="my-effects">
          {me2?.concentration && <span className="rounded-full border border-arcane-300/70 bg-arcane-500/15 px-2 py-0.5 text-arcane-300" title="A new concentration spell ends it; damage forces a Constitution save">◎ Concentrating: {me2.concentration}</span>}
          {me2?.effects.map((e) => <span key={e.id} className="rounded-full border border-ink-500 bg-ink-800/80 px-2 py-0.5 text-marble-100" title={CONDITION_TEXT[e.key as ConditionId] ?? e.name}>{e.name}</span>)}
          {me2?.effects.some((e) => e.key === 'prone') && <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending} onClick={() => p.act({ action: 'condition', target: { kind: 'pc', tokenId }, condition: 'prone', add: false })}>Stand up</button>}
          {me2?.readied && <span className="rounded-full border border-gold-500/70 px-2 py-0.5 text-gold-200">⏳ Readied: {me2.readied.trigger} – right-click the target when it happens</span>}
        </div>
      )}

      {/* action tiles */}
      <div className="flex flex-wrap items-stretch gap-1.5" role="group" aria-label="Standard actions">
        <Tile icon="⚔" label="Attack" cost="action" on={p.ready?.kind === 'attack'} disabled={!p.attacks.length || !canAct} title="Ready your first weapon – right-click an enemy to attack (walking into reach first)" onClick={() => p.setReady(p.ready?.kind === 'attack' ? null : { kind: 'attack', index: defaultAttack })} />
        <Tile icon="✦" label="Cast spell" cost="action" on={spellOpen} disabled={!(sheet?.spells.length) || !!beast} title={beast ? `No spellcasting in Wild Shape (${beast.formName})` : 'Open the spellbook'} onClick={() => setSpellOpen((v) => !v)} testid="open-spells" badge={spells.length || undefined} />
        {encounter && (['dash', 'disengage', 'dodge'] as const).map((id) => {
          const a = STANDARD_ACTIONS.find((x) => x.id === id)!;
          const active = id === 'dash' ? !!b.dash : id === 'disengage' ? !!b.disengage : !!b.dodge;
          return <Tile key={id} drag={dragQuick({ k: 'act', id })} icon={ACTION_ICONS[id]} label={a.label} cost={actionCost} on={active} disabled={p.pending || !p.myTurn || (id === 'dodge' ? spentCost : spentHaste)} title={a.text} onClick={() => standard(id)} testid={`act-${id}`} />;
        })}
        <Tile drag={dragQuick({ k: 'act', id: 'hide' })} icon="🥷" label={hidden ? 'Stop sneaking' : encounter ? 'Hide' : 'Sneak'} cost={encounter && !hidden ? actionCost : undefined} on={hidden} disabled={p.pending || (!!encounter && !hidden && !p.myTurn)} title={hidden ? 'Stop sneaking (you stay where you are)' : 'Stealth check; opponents notice you if their passive Perception reaches it. Attacking or casting reveals you.'} onClick={() => p.act({ action: 'hide', actor: { kind: 'pc', tokenId }, ...(hidden ? { off: true } : encounter ? { viaBonus: bonus } : {}) })} testid={encounter ? 'hide' : 'sneak'} />
        <Tile drag={dragQuick({ k: 'act', id: 'search' })} icon="🔎" label="Search" cost={encounter ? actionCost : undefined} disabled={p.pending || (!!encounter && (!p.myTurn || spentCost))} title="Wisdom (Perception) check against hidden creatures in sight" onClick={() => standard('search')} />
        {encounter && <>
          <Tile drag={dragQuick({ k: 'act', id: 'help' })} icon="🤝" label="Help" cost={actionCost} disabled={p.pending || !p.myTurn || spentCost} title={STANDARD_ACTIONS.find((x) => x.id === 'help')!.text} onClick={() => standard('help')} />
          <Tile drag={dragQuick({ k: 'act', id: 'useObject' })} icon="🧪" label="Use object" cost={actionCost} disabled={p.pending || !p.myTurn || spentHaste} title={STANDARD_ACTIONS.find((x) => x.id === 'useObject')!.text} onClick={() => standard('useObject')} />
          <Tile icon="⏳" label="Ready" cost="action" on={readyOpen} disabled={p.pending || !p.myTurn || !!b.action} title="Prepare the chosen attack with a trigger; it uses your reaction" onClick={() => setReadyOpen((v) => !v)} />
          <span className="mx-0.5 w-px self-stretch bg-ink-700" aria-hidden />
          <Tile icon="◆" label="Bonus mode" on={bonus} title="Take the next standard action as a bonus action (Cunning Action, off-hand attack …) – only if a feature allows it" onClick={() => setBonus((v) => !v)} />
          <Tile icon="✧" label="Other bonus" cost="bonus" disabled={p.pending || !p.myTurn || !!b.bonus} title="Mark the bonus action as used (feature, off-hand attack …)" onClick={() => p.act({ action: 'standard', actor: { kind: 'pc', tokenId }, act: 'bonusOther' })} />
        </>}
      </div>
      {readyOpen && encounter && p.myTurn && !b.action && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-gold-700/60 bg-ink-900/70 p-1.5" aria-label="Ready an action">
          <input className="w-64 rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5" placeholder="Trigger (e.g. when the orc opens the door)" value={readyTrigger} onChange={(e) => setReadyTrigger(e.target.value)} />
          <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !readyTrigger.trim() || p.ready?.kind !== 'attack'} title="Choose the attack in the hotbar first" onClick={() => { p.act({ action: 'ready', actor: { kind: 'pc', tokenId }, attackIndex: p.ready?.kind === 'attack' ? p.ready.index : 0, trigger: readyTrigger }); setReadyTrigger(''); setReadyOpen(false); }}>⏳ Ready {p.ready?.kind === 'attack' ? p.attacks[p.ready.index]?.name : 'the chosen attack'}</button>
        </div>
      )}

      {features.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Class features" data-testid="features">
          {features.map((f) => f.id === 'wildShape' ? (
            <select key={f.id} aria-label="Wild Shape" className="h-14 rounded-lg border border-emerald-600/60 bg-ink-900 px-2 text-emerald-200" value="" disabled={p.pending || !canAct || f.current === 0} onChange={(e) => e.target.value && p.act({ action: 'feature', tokenId, feature: 'wildShape', formId: e.target.value })}>
              <option value="">🐾 Wild Shape ({f.current ?? f.max} left)…</option>
              {beastOptions(sheet).map((b) => <option key={b.id} value={b.id}>{b.name} · CR {b.cr} · AC {b.ac} · {b.hp} HP</option>)}
            </select>
          ) : f.target === 'ally' ? (
            <select key={f.id} aria-label={f.name} className="h-14 rounded-lg border border-forest-400/60 bg-ink-900 px-2 text-forest-300" value="" title={f.text} disabled={p.pending || !canAct || f.current === 0} onChange={(e) => { if (!e.target.value) return; const [kind, id] = e.target.value.split(':'); p.act({ action: 'feature', tokenId, feature: f.id, target: kind === 'pc' ? { kind: 'pc', tokenId: id } : { kind: 'npc', id }, ...(f.id === 'layOnHands' ? { amount: Math.max(1, Number(window.prompt('Hit points to restore?', '5')) || 5) } : {}) }); }}>
              <option value="">✚ {f.name} ({f.current ?? f.max} left)…</option>
              {f.id === 'layOnHands' && <option value={`pc:${tokenId}`}>yourself</option>}
              {figures.filter((x) => x.kind === 'pc' || x.side === 'ally').map((x) => <option key={x.id} value={x.kind === 'pc' ? `pc:${x.tokenId}` : `npc:${x.id}`}>{x.name}</option>)}
            </select>
          ) : (
            <Tile key={f.id} drag={dragQuick({ k: 'feature', id: f.id })} icon={FEATURE_ICONS[f.id] ?? '★'} label={f.name} disabled={p.pending || !canAct || f.current === 0} title={f.text} onClick={() => p.act({ action: 'feature', tokenId, feature: f.id })} testid={`feature-${f.id}`} badge={f.current ?? undefined} tone="forest" />
          ))}
        </div>
      )}

      {/* hotbar: what is "in hand" – its range shows on the map, right-click uses it */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-ink-700 bg-ink-950/70 p-1.5" role="toolbar" aria-label="Ready an attack or spell" data-testid="ready-bar">
        <span className="pr-1 text-[10px] uppercase tracking-wider text-marble-500">In hand</span>
        {p.attacks.map((a, i) => {
          const r = parseRangeFt(`${a.range} ${a.notes}`);
          const on = p.ready?.kind === 'attack' && p.ready.index === i;
          return <button key={`a${i}`} type="button" {...dragQuick({ k: 'attack', i })} className={`rounded-md border px-2 py-1 transition ${on ? 'border-gold-400 bg-gold-400/20 text-gold-200 shadow-[0_0_8px_rgba(192,155,88,0.5)]' : 'border-ink-600 bg-ink-900 text-marble-100 hover:border-gold-500'}`} aria-pressed={on} title={`${a.bonus} · ${a.damage} · ${r.rangeFt ? `range ${r.rangeFt} ft` : `reach ${r.reachFt} ft`}`} onClick={() => p.setReady(on ? null : { kind: 'attack', index: i })}>{r.rangeFt ? '🏹' : '⚔'} {a.name.replace(' (equipped)', '')} <span className="text-[10px] text-marble-500">{a.bonus}</span></button>;
        })}
        {spells.map((sp) => {
          const on = p.ready?.kind === 'spell' && p.ready.spellId === sp.id;
          const help = supportive(sp);
          const noSlot = sp.level > 0 && !slots.some((x) => x.level >= sp.level && x.current > 0);
          return <button key={sp.id} type="button" {...dragQuick({ k: 'spell', id: sp.id })} className={`rounded-md border px-2 py-1 transition ${on ? 'border-arcane-300 bg-arcane-500/25 text-arcane-300 shadow-[0_0_8px_rgba(122,99,194,0.6)]' : `border-ink-600 bg-ink-900 hover:border-arcane-300/70 ${help ? 'text-forest-300' : 'text-marble-100'}`} ${noSlot ? 'opacity-40' : ''}`} aria-pressed={on} title={`${sp.level ? `${ordinal(sp.level)} level` : 'cantrip'} · ${sp.range}${help ? ' · support' : ''}${noSlot ? ' · no slot left' : ''}`} onClick={() => p.setReady(on ? null : { kind: 'spell', spellId: sp.id, slotLevel: slotFor(sp.id, sp.level) })} data-testid="ready-spell"><LevelBadge level={sp.level} /> {help ? '✚' : '✦'} {sp.name}</button>;
        })}
      </div>
      {!enemy && !p.ready && <p className="text-marble-500">Pick an attack or spell “in hand”, then right-click on the map (touch: tap to preview, press and hold to act). Right-click an enemy without one to see every option.</p>}

      {spellOpen && !enemy && (
        <Spellbook drag={(id) => dragQuick({ k: 'spell', id })} sheet={sheet} slots={slots} lvl={lvl} tokenId={tokenId} friends={friends} canAct={canAct} pending={p.pending} slotFor={slotFor}
          onReady={(id, lv) => { p.setReady({ kind: 'spell', spellId: id, slotLevel: lv }); setSpellOpen(false); }}
          onCast={(id, lv, t) => { castOn(id, lv, t); setSpellOpen(false); }} />
      )}

      {enemy && (
        <div className="space-y-1 rounded-lg border border-blood-400/60 bg-ink-900/90 p-2" role="dialog" aria-label={`Target ${enemy.name}`} data-testid="target-menu">
          <div className="flex items-center gap-2">
            <b className="font-display text-sm text-gold-200">🎯 {enemy.name}</b>
            <span className="text-marble-300">{feetTo(enemy) ?? '?'} ft away{enemy.condition === 'bloodied' ? ' · bloodied' : ''}</span>
            <button type="button" className="ml-auto text-marble-500 hover:text-gold-200" onClick={() => p.setTarget(null)} aria-label="Close target menu">✕</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-marble-300">
            <label>Roll <select aria-label="Advantage" className="rounded border border-ink-600 bg-ink-900 px-1" value={adv} onChange={(e) => setAdv(e.target.value as '' | 'adv' | 'dis')}><option value="">automatic</option><option value="adv">advantage (GM ruling)</option><option value="dis">disadvantage</option></select></label>
            {rogue && (
              <label title="Sneak Attack (once per turn, finesse or ranged weapon): with advantage – hidden, invisible, flanking, a prone/restrained target … – or an ally next to the target, and no disadvantage. The server checks it.">
                <input type="checkbox" checked={sneakOn} onChange={(e) => setSneakOn(e.target.checked)} /> Sneak Attack{(() => { const why = sneakHint(snapshot, tokenId, enemy, hidden, me2?.effects ?? []); return why ? <b className="ml-1 text-emerald-300">possible: {why}</b> : <span className="ml-1 text-marble-500">(no advantage / ally next to the target)</span>; })()}
              </label>
            )}
            {canSmite && <label title="Spent only on a hit">Divine Smite <select aria-label="Smite slot" className="rounded border border-ink-600 bg-ink-900 px-1" value={smite} onChange={(e) => setSmite(Number(e.target.value))}><option value={0}>no</option>{slots.filter((x) => x.current > 0).map((x) => <option key={x.level} value={x.level}>{ordinal(x.level)} slot</option>)}</select></label>}
            {me2?.readied && <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending} onClick={() => { p.act({ action: 'release', actor: { kind: 'pc', tokenId }, target: { kind: 'npc', id: enemy.id }, ...(adv ? { adv } : {}) }); p.setTarget(null); }} data-testid="release">⏳ Release readied attack (reaction)</button>}
          </div>
          {(feetTo(enemy) ?? 99) <= 5 && (
            <div className="flex flex-wrap items-center gap-1.5 text-marble-300" data-testid="shove">
              <span>Shove (replaces one attack):</span>
              <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending || !canAct} title="Athletics vs Athletics/Acrobatics – push 5 ft away (off a cliff: it falls)" onClick={() => { p.act({ action: 'shove', attacker: { kind: 'pc', tokenId }, target: { kind: 'npc', id: enemy.id }, mode: 'push' }); p.setTarget(null); }}>✋ Push 5 ft</button>
              <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={p.pending || !canAct} title="Athletics vs Athletics/Acrobatics – knock prone (in the air: it falls)" onClick={() => { p.act({ action: 'shove', attacker: { kind: 'pc', tokenId }, target: { kind: 'npc', id: enemy.id }, mode: 'prone' }); p.setTarget(null); }}>⤓ Knock prone</button>
            </div>
          )}
          <ul className="space-y-1" aria-label="Attacks">
            {p.attacks.map((a, i) => {
              const r = parseRangeFt(`${a.range} ${a.notes}`);
              const d = feetTo(enemy);
              const ok = d === null || d <= (r.longRangeFt ?? r.rangeFt ?? r.reachFt);
              return (
                <li key={i} className="flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-1.5 py-1">
                  <span className="flex-1"><b className="text-marble-50">{r.rangeFt ? '🏹' : '⚔'} {a.name}</b> <span className="text-marble-300">{a.bonus} · {a.damage} · {r.rangeFt ? `range ${r.rangeFt}${r.longRangeFt ? `/${r.longRangeFt}` : ''} ft` : `reach ${r.reachFt} ft`}</span>{!ok && <span className="block text-[10px] text-rose-300">out of {r.rangeFt ? 'range' : 'reach'}</span>}</span>
                  <button type="button" className="btn btn-gold px-2 py-0.5" disabled={p.pending || !canAct || !ok} onClick={() => { p.act({ action: 'strike', attacker: { kind: 'pc', tokenId }, target: { kind: 'npc', id: enemy.id }, attackIndex: i, bonus, ...(adv ? { adv } : {}), ...(smite ? { smite } : {}), ...(rogue && !sneakOn ? { sneak: false } : {}) }); p.setTarget(null); }} data-testid="attack-option">
                    Attack{bonus ? ' (bonus)' : ''}
                  </button>
                </li>
              );
            })}
          </ul>
          {spells.some((s) => !supportive(s)) && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-marble-500">Spells</p>
              <ul className="space-y-1" aria-label="Spells at target">{spells.filter((s) => !supportive(s)).map((s) => spellRow(s.id, true))}</ul>
            </>
          )}
          {b.attackAction && <p className="text-marble-300">Attack action: {b.attacks ?? 0} attack(s) made this turn.</p>}
        </div>
      )}
    </section>
    </>
  );
}

const ACTION_ICONS: Record<string, string> = { dash: '🏃', disengage: '↩', dodge: '🛡' };
const FEATURE_ICONS: Record<string, string> = { actionSurge: '⚡', secondWind: '❤', rage: '😤', bardicInspiration: '🎵', revertShape: '🐾' };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

/** One big action button (icon, label, cost marker: ● action, ◆ bonus action). */
function Tile({ icon, label, cost, on, disabled, title, onClick, testid, badge, tone, drag }: { icon: string; label: string; cost?: 'action' | 'bonus'; on?: boolean; disabled?: boolean; title?: string; onClick: () => void; testid?: string; badge?: number; tone?: 'forest'; drag?: { draggable: boolean; onDragStart: (e: DragEvent) => void } }) {
  return (
    <button type="button" title={title} disabled={disabled} aria-pressed={on} onClick={onClick} data-testid={testid} {...drag}
      className={`relative flex h-14 w-[4.6rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 text-center text-[10px] leading-tight transition disabled:cursor-not-allowed disabled:opacity-35 ${on ? 'border-gold-400 bg-gold-400/20 text-gold-200 shadow-[0_0_10px_rgba(192,155,88,0.45)]' : tone === 'forest' ? 'border-forest-400/60 bg-forest-700/30 text-forest-300 hover:border-forest-300' : 'border-ink-600 bg-ink-850 text-marble-100 hover:border-gold-500 hover:bg-ink-800'}`}>
      <span className="text-lg leading-none" aria-hidden>{icon}</span>
      <span className="line-clamp-2">{label}</span>
      {cost && <span aria-hidden className={`absolute left-1 top-1 h-2 w-2 ${cost === 'action' ? 'rounded-full bg-emerald-400' : 'rotate-45 bg-amber-400'}`} />}
      {badge !== undefined && <span className="absolute right-1 top-0.5 rounded-full bg-ink-950/90 px-1 text-[9px] text-gold-200">{badge}</span>}
    </button>
  );
}

/** Action ●, bonus action ◆, reaction ↺ – lit while available. */
function EconomyOrbs({ encounter, actor, haste }: { encounter: SceneEncounter; actor: string; haste?: boolean }) {
  const b = budgetOf(encounter, actor);
  const orb = (id: string, label: string, used: boolean, shape: string, color: string, title: string) => (
    <span key={id} title={`${label}: ${used ? 'used' : 'available'} – ${title}`} data-used={used} data-testid={`eco-${id}`} className={`flex items-center gap-1 ${used ? 'text-marble-500' : 'text-marble-100'}`}>
      <span aria-hidden className={`flex h-5 w-5 items-center justify-center text-[11px] ${shape} ${used ? 'border border-ink-600 bg-ink-800 text-ink-500' : color}`}>{id === 'reaction' ? '↺' : ''}</span>
      <span className={used ? 'line-through' : ''}>{label}</span>
    </span>
  );
  return (
    <span className="flex flex-wrap items-center gap-3" aria-label="Turn economy">
      {orb('action', 'Action', !!b.action, 'rounded-full', 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]', b.attackAction ? `Attack action · ${b.attacks ?? 0} attack(s) made` : b.last ? `used: ${b.last}` : 'one per turn')}
      {orb('bonus-action', 'Bonus', !!b.bonus, 'rotate-45 rounded-[3px] scale-75', 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]', 'one per turn')}
      {orb('reaction', 'Reaction', reactionUsed(encounter, actor), 'rounded-full', 'bg-arcane-500 text-white shadow-[0_0_8px_rgba(122,99,194,0.8)]', 'refreshes at the start of your turn')}
      {haste && orb('haste', 'Haste', !!b.hasted, 'rounded-full', 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]', 'one extra action: one weapon attack, Dash, Disengage, Hide or Use an Object')}
      {b.dash && <span className="rounded-full border border-sky-500/60 px-2 py-0.5 text-[11px] text-sky-200">Dashing</span>}
      {b.disengage && <span className="rounded-full border border-sky-500/60 px-2 py-0.5 text-[11px] text-sky-200">Disengaged</span>}
      {b.dodge && <span className="rounded-full border border-sky-500/60 px-2 py-0.5 text-[11px] text-sky-200">Dodging</span>}
    </span>
  );
}

type Slot = ReturnType<typeof spellSlots>[number];
/** Spell slots per level as pips: filled = left, hollow = spent. */
function SlotTracker({ slots }: { slots: Slot[] }) {
  return (
    <span className="flex flex-wrap items-center gap-2" aria-label="Spell slots" data-testid="slot-tracker">
      {slots.map((s) => {
        const max = Math.max(s.max ?? s.current, s.current);
        return (
          <span key={s.level} className="flex items-center gap-1 rounded-md border border-arcane-500/40 bg-arcane-500/10 px-1.5 py-0.5" title={`${ordinal(s.level)}-level slots: ${s.current} of ${max} left`}>
            <span className="font-display text-[10px] text-arcane-300">{ROMAN[s.level] ?? s.level}</span>
            {Array.from({ length: Math.min(max, 9) }, (_, i) => <span key={i} aria-hidden className={`h-2 w-2 rotate-45 ${i < s.current ? 'bg-arcane-300 shadow-[0_0_5px_rgba(185,168,227,0.8)]' : 'border border-arcane-500/60'}`} />)}
          </span>
        );
      })}
    </span>
  );
}

function LevelBadge({ level }: { level: number }) {
  return <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 font-display text-[9px] ${level ? 'bg-arcane-500/40 text-arcane-300' : 'bg-ink-700 text-marble-300'}`} title={level ? `${ordinal(level)} level` : 'cantrip'}>{level ? ROMAN[level] : '∞'}</span>;
}

function SlotSelect({ slots, spellLevel, value, onChange, label }: { slots: Slot[]; spellLevel: number; value: number; onChange: (v: number) => void; label: string }) {
  return (
    <select aria-label={label} className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {slots.filter((x) => x.level >= spellLevel).map((x) => <option key={x.level} value={x.level} disabled={x.current < 1}>{ordinal(x.level)} slot ({x.current}{x.max !== null ? `/${x.max}` : ''}){x.level > spellLevel ? ' – upcast' : ''}</option>)}
    </select>
  );
}

type Friend = NonNullable<SceneSnapshot['figures']>[number];
type CastTarget = { kind: 'pc'; tokenId: string } | { kind: 'npc'; id: string };
/** "Cast on …" – yourself or an ally. */
function TargetPick({ self, friends, onPick, disabled }: { self: string; friends: Friend[]; onPick: (t: CastTarget) => void; disabled?: boolean }) {
  return (
    <select aria-label="Cast on" className="rounded border border-forest-400/60 bg-ink-900 px-1 py-0.5 text-forest-300" value="" disabled={disabled} onChange={(e) => { const v = e.target.value; if (!v) return; const [kind, id] = v.split(':'); onPick(kind === 'pc' ? { kind: 'pc', tokenId: id } : { kind: 'npc', id }); }} data-testid="cast-on">
      <option value="">cast on…</option>
      <option value={`pc:${self}`}>yourself</option>
      {friends.map((f) => <option key={f.id} value={f.kind === 'pc' ? `pc:${f.tokenId}` : `npc:${f.id}`}>{f.name}</option>)}
    </select>
  );
}

/** Spellbook: a tab per spell level with its slots, spell cards with tags, Ready and (support spells) Cast on …. */
function Spellbook({ drag, sheet, slots, lvl, tokenId, friends, canAct, pending, slotFor, onReady, onCast }: { drag: (id: string) => { draggable: boolean; onDragStart: (e: DragEvent) => void }; sheet: CharacterSheet | null; slots: Slot[]; lvl: number; tokenId: string; friends: Friend[]; canAct: boolean; pending: boolean; slotFor: (id: string, level: number) => number; onReady: (id: string, lv: number) => void; onCast: (id: string, lv: number, t: CastTarget | null) => void }) {
  const all = sheet?.spells ?? [];
  const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((l) => all.some((x) => x.level === l));
  const [tab, setTab] = useState(levels[0] ?? 0);
  const [onlyReady, setOnlyReady] = useState(false);
  const list = all.filter((x) => x.level === tab && (!onlyReady || x.level === 0 || x.prepared)).sort((a, b) => Number(b.prepared) - Number(a.prepared) || a.name.localeCompare(b.name));
  return (
    <div className="rounded-lg border border-arcane-500/50 bg-ink-950/90 p-2" aria-label="Spellbook" data-testid="spellbook">
      <div className="mb-2 flex flex-wrap items-center gap-1" role="tablist">
        {levels.map((l) => {
          const s = slots.find((x) => x.level === l);
          return (
            <button key={l} type="button" role="tab" aria-selected={tab === l} onClick={() => setTab(l)} className={`rounded-md border px-2 py-1 ${tab === l ? 'border-arcane-300 bg-arcane-500/25 text-marble-50' : 'border-ink-600 text-marble-300 hover:border-arcane-300/60'}`}>
              <span className="font-display">{l === 0 ? 'Cantrips' : `Level ${ROMAN[l]}`}</span>
              {l > 0 && <span className="ml-1 text-[10px] text-arcane-300">{s ? `${s.current}/${s.max ?? s.current}` : '0'}</span>}
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-1 text-marble-300"><input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} /> prepared only</label>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {list.map((x) => {
          const lv = slotFor(x.id, x.level);
          const plan = sheet ? planSpell(sheet, x.id, lv, lvl) : null;
          const usable = x.level === 0 || x.prepared;
          const area = parseArea(`${x.range} ${x.description}`);
          const help = supportive(x);
          const def = spellEffectOf(x);
          const heal = /regains? .*hit points/i.test(x.description);
          const tags = [
            plan && !('error' in plan) && plan.mode === 'attack' ? 'Attack' : '',
            plan && !('error' in plan) && plan.mode === 'save' ? `${(plan.save ?? '').slice(0, 3).toUpperCase()} save` : '',
            heal ? 'Heal' : help ? 'Buff' : '',
            area ? `${area.sizeFt}-ft ${area.shape}` : '',
            x.concentration ? 'Concentration' : '',
            /bonus/i.test(x.castingTime) ? 'Bonus action' : /reaction/i.test(x.castingTime) ? 'Reaction' : '',
          ].filter(Boolean);
          const noSlot = x.level > 0 && !slots.some((s) => s.level >= x.level && s.current > 0);
          return (
            <li key={x.id} {...(x.level === 0 || x.prepared ? drag(x.id) : {})} className={`rounded-md border px-2 py-1.5 ${usable ? (help ? 'border-forest-400/50 bg-forest-700/15' : 'border-ink-600 bg-ink-900/70') : 'border-ink-800 opacity-55'}`}>
              <div className="flex items-start gap-1.5">
                <LevelBadge level={x.level} />
                <div className="min-w-0 flex-1">
                  <b className="text-marble-50">{x.name}</b>
                  <div className="text-[10px] text-marble-500">{x.castingTime || '1 action'} · {x.range || '—'}{plan && !('error' in plan) && plan.damage ? ` · ${plan.damage}` : ''}{!usable ? ' · not prepared' : ''}{noSlot && usable ? ' · no slot left' : ''}</div>
                </div>
              </div>
              {tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{tags.map((t) => <span key={t} className={`rounded-full px-1.5 text-[9px] ${t === 'Heal' || t === 'Buff' ? 'bg-forest-500/40 text-forest-300' : t === 'Attack' ? 'bg-blood-600/40 text-blood-400' : 'bg-ink-700 text-marble-300'}`}>{t}</span>)}</div>}
              {usable && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => onReady(x.id, lv)} title="Take it in hand: range on the map, right-click to cast">In hand</button>
                  {(def?.targeting === 'self' || (!def && /^self/i.test(x.range.trim()) && !area)) && <button type="button" className="btn btn-gold px-2 py-0.5" disabled={pending || !canAct || noSlot} onClick={() => onCast(x.id, lv, null)}>Cast on yourself</button>}
                  {help && def?.targeting !== 'self' && !(def && spellCount(def, x.level, lv || x.level, lvl) > 1) && <TargetPick self={tokenId} friends={friends} disabled={pending || !canAct || noSlot} onPick={(t) => onCast(x.id, lv, t)} />}
                </div>
              )}
              {x.description && <details><summary className="cursor-pointer text-[10px] text-marble-500">Description</summary><p className="whitespace-pre-wrap text-[11px] text-marble-300">{x.description}</p></details>}
            </li>
          );
        })}
        {!list.length && <li className="text-marble-500">No spells on this level{onlyReady ? ' prepared' : ''}.</li>}
      </ul>
    </div>
  );
}

/** Why Sneak Attack may apply against this target (client hint; the server decides). */
function sneakHint(snapshot: SceneSnapshot, tokenId: string, enemy: NonNullable<SceneSnapshot['figures']>[number], hidden: boolean, mine: Array<{ key: string }>): string | null {
  const map = snapshot.scene?.map;
  const me = snapshot.motion?.tokens.find((t) => t.tokenId === tokenId);
  const why: string[] = [];
  if (hidden) why.push('you are hidden');
  if (mine.some((e) => e.key === 'invisible')) why.push('you are invisible');
  if ((enemy.effects ?? []).some((e) => ['restrained', 'paralyzed', 'stunned', 'unconscious', 'blinded', 'faerie-fire'].includes(e.key))) why.push('the target is helpless or outlined');
  if (map?.hex && me) {
    const t = hexAt(map, enemy);
    const allies = (snapshot.figures ?? []).filter((f) => (f.kind === 'pc' && f.tokenId !== tokenId) || (f.kind === 'enemy' && f.side === 'ally'));
    if (allies.some((f) => distance(hexAt(map, f), t) === 1)) why.push('an ally is next to the target');
    if (allies.some((f) => flanks(hexAt(map, me), t, hexAt(map, f)))) why.push('flanking');
  }
  return why.length ? why.join(', ') : null;
}

// ---------------------------------------------------------------- quick bar (APEX 1.9)

export type QuickItem = { k: 'attack'; i: number } | { k: 'spell'; id: string } | { k: 'act'; id: string } | { k: 'feature'; id: string };
type QuickView = { icon: string; label: string; title: string; cost?: 'action' | 'bonus'; level?: number; on?: boolean; disabled?: boolean; badge?: number; tone?: 'spell' | 'support' | 'feature' };
const QUICK_MIME = 'application/x-apex-quick';
const QUICK_SLOTS = 14;
function loadQuick(tokenId: string): Array<QuickItem | null> {
  try { const v = JSON.parse(localStorage.getItem(`apex.quickbar.${tokenId}`) ?? '[]'); return Array.isArray(v) ? v.slice(0, QUICK_SLOTS) : []; } catch { return []; }
}
function defaultQuick(all: QuickItem[]): Array<QuickItem | null> {
  const pick = [...all.filter((q) => q.k === 'attack').slice(0, 2), ...all.filter((q) => q.k === 'spell').slice(0, 5), ...all.filter((q) => q.k === 'act' && ['dash', 'disengage', 'dodge', 'hide'].includes(q.id)), ...all.filter((q) => q.k === 'feature').slice(0, 3)];
  return Array.from({ length: QUICK_SLOTS }, (_, i) => pick[i] ?? null);
}
const sameQuick = (a: QuickItem | null, b: QuickItem | null) => !!a && !!b && a.k === b.k && (a.k === 'attack' ? a.i === (b as { i: number }).i : (a as { id: string }).id === (b as { id: string }).id);

/** The hotbar: square slots; drag items from the panel onto a slot, drag slots to reorder, right-click a slot to empty it. */
function QuickBar({ items, setItems, render, onUse }: { items: Array<QuickItem | null>; setItems: (v: Array<QuickItem | null>) => void; render: (q: QuickItem) => QuickView | null; onUse: (q: QuickItem) => void }) {
  const [over, setOver] = useState<number | null>(null);
  const slots = Array.from({ length: QUICK_SLOTS }, (_, i) => items[i] ?? null);
  // keys 1–9 use the first nine slots (not while typing)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const q = slots[Number(e.key) - 1];
      const v = q ? render(q) : null;
      if (q && v && !v.disabled) { e.preventDefault(); onUse(q); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const drop = (i: number, e: DragEvent) => {
    e.preventDefault(); setOver(null);
    let data: { item: QuickItem; from?: number };
    try { data = JSON.parse(e.dataTransfer.getData(QUICK_MIME)); } catch { return; }
    const next = [...slots];
    if (data.from !== undefined) { next[data.from] = next[i]; next[i] = data.item; } // swap within the bar
    else { const dup = next.findIndex((x) => sameQuick(x, data.item)); if (dup >= 0) next[dup] = null; next[i] = data.item; }
    setItems(next);
  };
  return (
    <div className="hotbar-slots" role="toolbar" aria-label="Quick bar – drag actions, attacks and spells here" data-testid="quick-bar">
      {slots.map((q, i) => {
        const v = q ? render(q) : null;
        return (
          <button key={i} type="button" className={`hotbar-slot${v?.on ? ' is-on' : ''}${over === i ? ' is-over' : ''}${v?.tone ? ` tone-${v.tone}` : ''}`} disabled={!v || v.disabled} title={v ? `${v.title}\n(drag to move, right-click to remove)` : 'Empty – drag an action, attack or spell from the panel here'}
            aria-pressed={v?.on} aria-label={v?.label ?? `Empty slot ${i + 1}`} data-testid={v ? 'quick-slot' : 'quick-empty'}
            draggable={!!v} onDragStart={(e) => { if (q) { e.dataTransfer.setData(QUICK_MIME, JSON.stringify({ item: q, from: i })); e.dataTransfer.effectAllowed = 'move'; } }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(QUICK_MIME)) { e.preventDefault(); setOver(i); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(i, e)}
            onClick={() => q && onUse(q)} onContextMenu={(e) => { e.preventDefault(); if (q) { const next = [...slots]; next[i] = null; setItems(next); } }}>
            {v && <>
              <span className="hotbar-icon" aria-hidden>{v.icon}</span>
              <span className="hotbar-label">{v.label}</span>
              {v.cost && <span aria-hidden className={`hotbar-cost ${v.cost}`} />}
              {v.level !== undefined && <span className="hotbar-level">{v.level ? ROMAN[v.level] : '∞'}</span>}
              {v.badge !== undefined && <span className="hotbar-badge">{v.badge}</span>}
            </>}
            {i < 9 && <kbd className="hotbar-key" aria-hidden>{i + 1}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
