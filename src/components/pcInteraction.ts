/**
 * Map interaction for a character on a battle map (APEX 1.4) – shared by the player's own view and the GM acting
 * for a character: path preview, line of sight / range, area preview, and the right-click rules:
 *  - right-click an empty hex: move there (or cast the readied area spell there);
 *  - right-click a creature with a readied multi-target / buff / healing spell: choose it as a target;
 *  - right-click an enemy with a readied ATTACK (the default attack): attack at once when in reach/range, otherwise
 *    walk the cheapest path to a free hex in reach (if the movement left allows it) and attack;
 *  - right-click an enemy without a readied attack: open the target menu (all attacks and spells).
 */
import type { SceneSnapshot } from '../server/sceneRuntime';
import type { MapIntent, MapMenuItem, SceneInteraction } from './SceneSurface';
import type { CharacterSheet, SheetAttack } from '../game/sheet';
import type { ReadyAction } from './PlayerCombat';
import { areaHexes, parseArea } from '../campaign/hexArea';
import { hexAt, hexCentre, hexMovementCost, pathChecks, tileLookup } from '../campaign/hexScene';
import { distance, hexKey, hexesInRange, parseKey } from '../game/hex';
import { parseRangeFt } from '../game/sceneCombat';
import { budgetOf, characterLevel, spellRangeFt } from '../game/sceneActions';
import { spellCount, spellEffectOf, spellHealing, supportive } from '../game/spellEffects';

/** Attack roll, saving throw or damage: a spell for enemies, not friends (unless the table says otherwise). */
export const harmful = (spell: { name: string; description: string; level: number }) => !supportive(spell) && /spell attack|saving throw|\bdamage\b/i.test(spell.description);

export type SpellTarget = { kind: 'pc'; tokenId: string; name: string } | { kind: 'npc'; id: string; name: string };

/** Free hex in reach of `target` with the cheapest path from `from` within `budget` feet (null: none). */
export function approachHex(map: NonNullable<SceneSnapshot['scene']>['map'], from: { x: number; y: number }, target: { x: number; y: number }, reachFt: number, occupied: Set<string>, budget: number | null): { x: number; y: number; cost: number } | null {
  if (!map.hex) return null;
  const look = tileLookup(map);
  const t = hexAt(map, target);
  let best: { x: number; y: number; cost: number } | null = null;
  for (const h of hexesInRange(t, Math.max(1, Math.round(reachFt / 5)))) {
    const k = hexKey(h);
    if ((h.q === t.q && h.r === t.r) || occupied.has(k) || look(k)?.cost == null) continue;
    const p = hexCentre(map, h);
    const r = hexMovementCost(map, from, p);
    if (!r.ok || (budget !== null && r.cost > budget + 1e-9)) continue;
    if (!best || r.cost < best.cost) best = { x: p.x, y: p.y, cost: r.cost };
  }
  return best;
}

export interface PcInteractionInput {
  snapshot: SceneSnapshot;
  tokenId: string;
  name: string;
  sheet: CharacterSheet | null;
  attacks: SheetAttack[];
  acting: boolean;
  canMove: boolean;
  /** Feet left this turn (null = free movement). */
  remaining: number | null;
  ready: ReadyAction;
  setReady: (r: ReadyAction) => void;
  setSpellTargets: (f: (list: SpellTarget[]) => SpellTarget[]) => void;
  /** POST scene-turn (scene id added by the caller). */
  act: (input: Record<string, unknown>) => Promise<boolean> | void;
  /** Move the character; resolves to true when it arrived (not paused by an opportunity attack). */
  /** `alt`: altitude in feet above the destination's ground (flying, APEX 1.9). */
  move: (x: number, y: number, alt?: number) => Promise<boolean>;
  openTargetMenu: (enemyId: string) => void;
  notify: (text: string) => void;
  focusKey?: string | null;
  /** APEX 2.5 – a Dash still possible this turn: as the action and/or as a bonus action (Cunning Action), and the speed it adds. */
  dash?: { action: boolean; bonus: boolean; speedFt: number } | null;
}

/** APEX 2.5 – which Dash is still possible this turn (initiative only): the action, a bonus action with Cunning Action. */
export function dashOptions(encounter: Parameters<typeof budgetOf>[0], actor: string, movement: { allowance: number; dashed?: boolean } | null | undefined, sheet: CharacterSheet | null, myTurn: boolean): PcInteractionInput['dash'] {
  if (!encounter || !myTurn || !movement || movement.dashed) return null;
  const b = budgetOf(encounter, actor);
  if (b.dash) return null;
  const cunning = !!sheet?.abilities.some((a) => /cunning action/i.test(a.name));
  return { action: !b.action, bonus: cunning && !b.bonus, speedFt: movement.allowance };
}

/** APEX 2.5 – the last step of a path that the movement left still pays for. */
export function farthestStep(steps: Array<{ x: number; y: number; cost: number }>, budget: number) {
  let best: { x: number; y: number; cost: number } | null = null;
  for (const s of steps) if (s.cost <= budget + 1e-9) best = s;
  return best;
}

/**
 * APEX 2.5 – right-click on a hex beyond the movement left: offer Dash (action / bonus action) when it gets there,
 * and “as far as possible”. The first item is what a second right-click does.
 */
export function moveMenu(steps: Array<{ x: number; y: number; cost: number }>, cost: number, remaining: number, dash: PcInteractionInput['dash'], go: (x: number, y: number) => void, dashThen: (viaBonus: boolean, x: number, y: number) => void, dest: { x: number; y: number }): MapMenuItem[] {
  const items: MapMenuItem[] = [];
  const far = farthestStep(steps, remaining);
  const reach = dash ? remaining + dash.speedFt : remaining;
  const farDash = farthestStep(steps, reach);
  if (dash?.bonus) items.push(cost <= reach ? { icon: '💨', label: `Dash as a bonus action and go there (${cost} ft)`, run: () => dashThen(true, dest.x, dest.y) } : farDash ? { icon: '💨', label: `Dash as a bonus action, as far as possible (${farDash.cost} ft)`, run: () => dashThen(true, farDash.x, farDash.y) } : null as never);
  if (dash?.action) items.push(cost <= reach ? { icon: '💨', label: `Dash (action) and go there (${cost} ft)`, run: () => dashThen(false, dest.x, dest.y) } : farDash ? { icon: '💨', label: `Dash (action), as far as possible (${farDash.cost} ft)`, run: () => dashThen(false, farDash.x, farDash.y) } : null as never);
  if (far && far.cost > 0) items.push({ icon: '👣', label: `Go as far as possible without Dash (${far.cost} ft)`, run: () => go(far.x, far.y) });
  return items.filter(Boolean);
}

export function pcInteraction(i: PcInteractionInput): SceneInteraction {
  const map = i.snapshot.scene?.map;
  const pos = i.snapshot.motion?.tokens.find((t) => t.tokenId === i.tokenId) ?? i.snapshot.figures?.find((f) => f.kind === 'pc' && f.tokenId === i.tokenId) ?? i.snapshot.spawn ?? null;
  if (!map?.hex || !pos) return {};
  const readySpell = i.ready?.kind === 'spell' && i.sheet ? i.sheet.spells.find((x) => x.id === (i.ready as { spellId: string }).spellId) : undefined;
  const readyArea = readySpell ? parseArea(`${readySpell.range} ${readySpell.description}`) : null;
  const readyAttack = i.ready?.kind === 'attack' ? i.attacks[i.ready.index] : undefined;
  const atkRange = readyAttack ? parseRangeFt(`${readyAttack.range} ${readyAttack.notes}`) : null;
  const readyRange = atkRange ? atkRange.rangeFt ?? atkRange.reachFt : readySpell ? spellRangeFt(readySpell.range) : null;
  const figures = i.snapshot.figures ?? [];
  const figOf = (id: string) => figures.find((x) => (x.kind === 'pc' ? x.tokenId === id : x.id === id));
  // APEX 1.9: flying while in the air, climbing with a climb speed (the player's own movement or the GM's view of it)
  const mv = i.snapshot.movement?.tokenId === i.tokenId ? i.snapshot.movement : i.snapshot.pcMovement?.[i.tokenId];
  const moveMode = { ...(mv?.fly && (mv.alt ?? 0) > 0 ? { fly: true } : { athletics: true }), ...(mv?.climb ? { climb: true } : {}) };
  const me = hexKey(hexAt(map, pos));
  const figAt = (k: string) => figures.find((x) => x.condition !== 'down' && hexKey(hexAt(map, x)) === k && !(x.kind === 'pc' && x.tokenId === i.tokenId));
  const remaining = i.remaining;
  const pathTo = (p: { x: number; y: number }) => hexMovementCost(map, pos, p, moveMode);
  const dashThen = (viaBonus: boolean, x: number, y: number) => { void Promise.resolve(i.act({ action: 'standard', actor: { kind: 'pc', tokenId: i.tokenId }, act: 'dash', ...(viaBonus ? { viaBonus: true } : {}) })).then((ok) => { if (ok !== false) void i.move(x, y); }); };
  /** What a right-click on this hex does now (shown at the pointer). */
  const intentAt = (k: string): MapIntent | null => {
    if (!i.acting) return null;
    const f = figAt(k);
    if (k === me) return readySpell && i.ready?.kind === 'spell' && !harmful(readySpell) ? { icon: '✨', label: `${readySpell.name} on yourself`, tone: 'spell' } : null;
    if (f) {
      if (readyArea && readySpell) return { icon: '✨', label: `${readySpell.name} here`, tone: 'spell' };
      const friendly = f.kind === 'pc' || f.side === 'ally';
      if (readySpell) return friendly && harmful(readySpell) ? { icon: '⛔', label: `${readySpell.name} would harm ${f.name}`, tone: 'bad' } : !friendly || !harmful(readySpell) ? { icon: '✨', label: `${readySpell.name} → ${f.name}`, tone: 'spell' } : null;
      if (friendly) return null;
      if (readyAttack && atkRange) {
        const dist = distance(hexAt(map, pos), hexAt(map, f)) * 5;
        const ranged = !!atkRange.rangeFt;
        if (dist <= (atkRange.longRangeFt ?? atkRange.rangeFt ?? atkRange.reachFt)) return { icon: ranged ? '🏹' : '🗡️', label: `${readyAttack.name} → ${f.name}${atkRange.rangeFt && dist > atkRange.rangeFt ? ' (long range: disadvantage)' : ''}`, tone: 'attack' };
        if (ranged) return { icon: '⛔', label: `${f.name} is out of range (${dist} ft)`, tone: 'bad' };
        return { icon: '👣🗡️', label: `Walk up and ${readyAttack.name} → ${f.name}`, tone: 'attack' };
      }
      return { icon: '☰', label: `Choose an action against ${f.name}`, tone: 'menu' };
    }
    if (readyArea && readySpell) return { icon: '✨', label: `${readySpell.name} here`, tone: 'spell' };
    if (!i.canMove) return null;
    const r = pathTo(hexCentre(map, parseKey(k)));
    if (!r.ok) return { icon: '⛔', label: r.error.includes('cannot be entered') ? r.error : 'No way there', tone: 'bad' };
    // APEX 2.6 – a climb or a jump on the way: say which Athletics check it takes
    const checks = pathChecks(map, r.path, hexAt(map, pos), moveMode);
    if (typeof checks === 'string') return { icon: '⛔', label: checks, tone: 'bad' };
    const extra = checks.length ? ` – Athletics ${checks.map((c) => `${c.kind === 'climb' ? 'climb' : 'jump'} ${c.ft} ft DC ${c.dc}`).join(', ')}` : '';
    const icon = checks.some((c) => c.kind === 'jump') ? '🤸' : checks.length ? '🧗' : '👣';
    if (remaining === null || r.cost <= remaining + 1e-9) return { icon, label: `Move ${r.cost} ft${extra}`, tone: 'move' };
    if (i.dash && (i.dash.action || i.dash.bonus) && r.cost <= remaining + i.dash.speedFt + 1e-9) return { icon: '💨', label: `${r.cost} ft – needs a Dash (right-click to choose)`, tone: 'dash' };
    return { icon: '👣', label: `${r.cost} ft – too far: as far as possible`, tone: 'bad' };
  };
  return {
    moveMode,
    intentAt,
    pathDash: i.dash && (i.dash.action || i.dash.bonus) ? i.dash.speedFt : 0,
    menuAt: (k, p) => {
      if (!i.acting || !i.canMove || readyArea || remaining === null || figAt(k)) return null;
      const r = pathTo(p);
      if (!r.ok || r.cost <= remaining + 1e-9) return null;
      return moveMenu(r.steps, r.cost, remaining, i.dash ?? null, (x, y) => void i.move(x, y, p.alt), dashThen, p);
    },
    reachFrom: pos,
    pathFrom: i.acting && i.canMove && !readyArea ? pos : null,
    pathBudget: i.remaining,
    lineFrom: i.acting && readyRange && readyRange > 10 && !readyArea ? pos : null,
    lineRangeFt: readyRange,
    sightFrom: i.acting && !readyArea ? pos : null,
    sightSide: 'hostile',
    areaAt: i.acting && readyArea ? (pt) => areaHexes(map, pos, pt, readyArea) : null,
    focus: i.focusKey ? { key: i.focusKey, x: pos.x, y: pos.y } : null,
    onTokenContext: (id) => {
      const f = figOf(id);
      const isMe = id === i.tokenId;
      // an area spell in hand: right-clicking a creature aims the area at its hex (Fireball on the orc)
      if (readyArea && readySpell && i.ready?.kind === 'spell' && f && !isMe) {
        if (!i.acting) return;
        void i.act({ action: 'cast', tokenId: i.tokenId, spellId: readySpell.id, slotLevel: i.ready.slotLevel, point: { x: f.x, y: f.y } });
        i.setReady(null);
        return;
      }
      // a readied healing spell: the right-clicked creature is healed
      if (readySpell && i.ready?.kind === 'spell' && spellHealing(readySpell, i.ready.slotLevel || readySpell.level)) {
        const t = isMe ? { kind: 'pc', tokenId: i.tokenId } : f ? (f.kind === 'pc' ? { kind: 'pc', tokenId: f.tokenId } : { kind: 'npc', id: f.id }) : null;
        if (t) { void i.act({ action: 'cast', tokenId: i.tokenId, spellId: readySpell.id, slotLevel: i.ready.slotLevel, targets: [t] }); i.setReady(null); }
        return;
      }
      // a readied targeted spell (Bless, Scorching Ray …): collect targets
      const def = readySpell ? spellEffectOf(readySpell) : undefined;
      if (readySpell && def && !readyArea && (def.targeting === 'enemy' || def.targeting === 'ally') && i.sheet) {
        const max = spellCount(def, readySpell.level, i.ready?.kind === 'spell' ? i.ready.slotLevel || readySpell.level : readySpell.level, characterLevel(i.sheet));
        const t: SpellTarget | null = isMe ? { kind: 'pc', tokenId: i.tokenId, name: i.name } : f ? (f.kind === 'pc' ? { kind: 'pc', tokenId: f.tokenId!, name: f.name } : { kind: 'npc', id: f.id, name: f.name }) : null;
        if (!t) return;
        // a single target: cast at once (Mage Armor on an ally, Hold Person on an enemy)
        if (max === 1 && !def.projectiles && i.ready?.kind === 'spell') { void i.act({ action: 'cast', tokenId: i.tokenId, spellId: readySpell.id, slotLevel: i.ready.slotLevel, targets: [t.kind === 'pc' ? { kind: 'pc', tokenId: t.tokenId } : { kind: 'npc', id: t.id }] }); i.setReady(null); i.setSpellTargets(() => []); return; }
        i.setSpellTargets((list) => (list.length >= max ? list : [...list, t]));
        return;
      }
      // a spell on yourself (Shield, False Life, Divine Favor): right-click your own figure
      if (readySpell && i.ready?.kind === 'spell' && isMe && (def?.targeting === 'self' || /^self/i.test(readySpell.range.trim()))) { void i.act({ action: 'cast', tokenId: i.tokenId, spellId: readySpell.id, slotLevel: i.ready.slotLevel }); i.setReady(null); return; }
      // other spells on a friend (yourself, a character, an allied NPC): only when the spell isn't harmful
      const friendly = isMe || (f && (f.kind === 'pc' || f.side === 'ally'));
      if (readySpell && i.ready?.kind === 'spell' && !readyArea && friendly) {
        if (harmful(readySpell)) { i.notify(`${readySpell.name} harms its target – right-click an enemy.`); return; }
        const t = isMe ? { kind: 'pc', tokenId: i.tokenId } : f!.kind === 'pc' ? { kind: 'pc', tokenId: f!.tokenId } : { kind: 'npc', id: f!.id };
        void i.act({ action: 'cast', tokenId: i.tokenId, spellId: readySpell.id, slotLevel: i.ready.slotLevel, targets: [t] });
        i.setReady(null);
        return;
      }
      if (!f || f.kind !== 'enemy' || f.side === 'ally' || f.condition === 'down') return;
      // other readied spells (Fire Bolt, Ray of Frost …): cast at the enemy
      if (readySpell && i.ready?.kind === 'spell' && !readyArea) {
        void i.act({ action: 'cast', tokenId: i.tokenId, spellId: readySpell.id, slotLevel: i.ready.slotLevel, targets: [{ kind: 'npc', id: f.id }] });
        return;
      }
      // the default attack: attack, walking into reach first if needed
      if (readyAttack && i.ready?.kind === 'attack' && atkRange && i.acting) {
        const attackIndex = i.ready.index;
        const strike = () => i.act({ action: 'strike', attacker: { kind: 'pc', tokenId: i.tokenId }, target: { kind: 'npc', id: f.id }, attackIndex });
        const dist = distance(hexAt(map, pos), hexAt(map, f)) * 5;
        if (dist <= (atkRange.longRangeFt ?? atkRange.rangeFt ?? atkRange.reachFt)) { void strike(); return; }
        if (atkRange.rangeFt) { i.notify(`${f.name} is ${dist} ft away – beyond ${readyAttack.name}'s range.`); return; }
        const occupied = new Set(figures.filter((x) => !(x.kind === 'pc' && x.tokenId === i.tokenId) && x.condition !== 'down').map((x) => hexKey(hexAt(map, x))));
        const spot = i.canMove ? approachHex(map, pos, f, atkRange.reachFt, occupied, i.remaining) : null;
        if (!spot) { i.notify(`${f.name} cannot be reached with the movement left this turn.`); return; }
        void i.move(spot.x, spot.y).then((arrived) => { if (arrived) void strike(); });
        return;
      }
      i.openTargetMenu(f.id);
    },
    onHexContext: (_k, p) => {
      if (!i.acting) return;
      if (readyArea && readySpell && i.ready?.kind === 'spell') { void i.act({ action: 'cast', tokenId: i.tokenId, spellId: readySpell.id, slotLevel: i.ready.slotLevel, point: p }); i.setReady(null); return; }
      if (i.canMove) void i.move(p.x, p.y, (p as { alt?: number }).alt);
    },
  };
}
