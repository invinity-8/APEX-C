/**
 * Scene-local view and movement rules (server only). Shared by the player snapshot, the GM focus and
 * scene movement so that what a player sees and what the server accepts always agree.
 */
import { npcPassivePerception } from '../game/perception.js';
import type { FigureLook } from '../game/figure.js';
import { hexAt, hexCentre, spawnSlots, tileSetOf } from '../campaign/hexScene.js';
import { CARRIED_LIGHT_FT, enemiesOf, npcReach, torchesOf } from '../game/sceneCombat.js';
import { darkvisionFeet, fogString, maskTerrain, sceneVision, type CarriedLight, type Viewer } from '../campaign/hexVision.js';
import type { SceneMap } from '../campaign/maps.js';
import { hexKey, type HexKey } from '../game/hex.js';
import { characterMovementLoad } from '../game/items/weight.js';
import { emptySheet, parseSheet, type CharacterSheet } from '../game/sheet.js';
import { budgetOf, pcActor } from '../game/sceneActions.js';
import { statBlock } from '../game/bestiary.js';
import { effectiveSpeed, effectsOf, speedZero, type EffectMods } from '../game/combatEffects.js';
import { altitudeOf, pcSpeeds } from '../game/altitude.js';
import { findBeast } from '../game/beastCatalog.js';
import { activeEncounter, clockOf, epochAllowance, movementEpoch, type MovementMode } from '../game/sceneTurns.js';
import type { GameState, SceneClockState } from '../game/types.js';
import type { LocalMotionSnapshot, MotionSnapshot } from './sceneMotion.js';

export interface SceneViewContext {
  state: GameState | null;
  loadSheet: (tokenId: string) => Promise<CharacterSheet | null>;
  /** Player characters on a scene with positions (stored, else their arrival slot). */
  pcs?: (sceneId: string, map: SceneMap) => Promise<PcPosition[]>;
}
export interface PcPosition { tokenId: string; userId: string; x: number; y: number; stored: boolean }

/** A figure a viewer may see on the map: another character or an enemy. */
export type FigureBuild = 'humanoid' | 'beast' | 'flyer' | 'undead' | 'spider';
/** Body shape of a creature for its 3D miniature (from the stat block type). */
export const buildOf = (type: string, flyFt?: number): FigureBuild => /undead/i.test(type) ? 'undead' : flyFt ? 'flyer' : /spider|insect|vermin/i.test(type) ? 'spider' : /beast|monstrosity/i.test(type) ? 'beast' : 'humanoid';
export interface SceneFigure { id: string; kind: 'pc' | 'enemy'; elite?: boolean; /** Conditions and buffs (name, key). */ effects?: Array<{ id: string; name: string; key: string; mods?: EffectMods; /** Hidden: the Stealth total. */ value?: number }>; /** APEX 2.4 – enemies: passive Perception and darkvision (sneak warnings). */ perception?: number; darkvisionFt?: number; concentration?: string; /** APEX 1.9: altitude above the ground (feet). */ alt?: number; /** APEX 2.0: size and body shape for the 3D miniature. */ size?: string; build?: FigureBuild; /** APEX 2.1: a chosen low-poly look, else the creature kind the automatic look is picked from. */ look?: FigureLook; breed?: string; creature?: { kind: string; tint?: string; variant?: 'male' | 'female' | 'young' }; /** NPCs: 'ally' fights with the party. */ side?: 'enemy' | 'ally'; reachFt?: number; tokenId?: string; name: string; color: string; icon?: string; x: number; y: number; condition: 'healthy' | 'bloodied' | 'down'; hp?: number; maxHp?: number; tempHp?: number; ac?: number; torch?: boolean }

/** Arrival slots for characters without a stored position (no two on the same hex). */
export function withArrivalSlots(map: SceneMap, spawn: { x: number; y: number } | null, rows: Array<{ tokenId: string; userId: string; stored?: { x: number; y: number } }>, blocked: Array<{ x: number; y: number }>): PcPosition[] {
  const taken = new Set([...rows.filter((r) => r.stored).map((r) => hexKeyAt(map, r.stored!)), ...blocked.map((b) => hexKeyAt(map, b))]);
  const free = spawn && map.hex ? spawnSlots(map, spawn).map((h) => hexCentre(map, h)).filter((p) => !taken.has(hexKeyAt(map, p))) : [];
  return [...rows].sort((a, b) => a.tokenId.localeCompare(b.tokenId)).map((r) => {
    if (r.stored) return { tokenId: r.tokenId, userId: r.userId, ...r.stored, stored: true };
    const slot = free.shift() ?? spawn ?? { x: 0, y: 0 };
    return { tokenId: r.tokenId, userId: r.userId, x: slot.x, y: slot.y, stored: false };
  });
}

/**
 * `notice`: who looks (side and best passive Perception). Hidden creatures of the OTHER side stay invisible unless
 * that passive Perception reaches their Stealth total. Without `notice` (GM full view) everything is shown.
 */
export function figuresFor(state: GameState, sceneId: string, map: SceneMap, pcs: PcPosition[], exclude: string[], visible: Set<HexKey> | null, gm: boolean, notice?: { side: 'party' | 'enemy'; passive: number }): SceneFigure[] {
  const torches = new Set(torchesOf(state, sceneId));
  const condition = (hp: number, max: number): SceneFigure['condition'] => (hp <= 0 ? 'down' : hp * 2 <= max ? 'bloodied' : 'healthy');
  const noticed = (actor: string, side: 'party' | 'enemy') => {
    if (!notice || notice.side === side) return true;
    const h = (state.sceneEffects?.[sceneId]?.[actor] ?? []).find((e) => e.key === 'hidden');
    return !h || notice.passive >= (h.value ?? 0);
  };
  const seen = (p: { x: number; y: number }) => !visible || visible.has(hexKeyAt(map, p));
  const fx = (actor: string) => {
    const list = (state.sceneEffects?.[sceneId]?.[actor] ?? []).map((e) => ({ id: e.id, name: e.name, key: e.key, mods: e.mods, ...(e.key === 'hidden' && typeof e.value === 'number' ? { value: e.value } : {}) }));
    const c = state.sceneConcentration?.[sceneId]?.[actor];
    const alt = altitudeOf(state, sceneId, actor);
    return { ...(list.length ? { effects: list } : {}), ...(c ? { concentration: c.spell } : {}), ...(alt ? { alt } : {}) };
  };
  const out: SceneFigure[] = [];
  for (const p of pcs) {
    const t = state.tokens[p.tokenId];
    if (!t || exclude.includes(p.tokenId) || !seen(p) || !noticed(`pc-${p.tokenId}`, 'party')) continue;
    out.push({ id: `pc-${p.tokenId}`, kind: 'pc', tokenId: p.tokenId, name: t.name, color: t.color, x: p.x, y: p.y, condition: 'healthy', torch: torches.has(p.tokenId), ...fx(`pc-${p.tokenId}`) });
  }
  for (const e of enemiesOf(state, sceneId)) {
    if (!seen(e) || !noticed(`npc-${e.id}`, e.side === 'ally' ? 'party' : 'enemy')) continue;
    const block = statBlock(state, e.templateId);
    out.push({ ...fx(`npc-${e.id}`), id: e.id, kind: 'enemy', side: e.side ?? 'enemy', ...(e.elite ? { elite: true } : {}), ...(block ? { size: block.size, build: buildOf(`${block.type} ${block.name}`, e.flyFt), ...(e.look ?? block.look ? { look: e.look ?? block.look } : { breed: `${block.name} ${block.type}`.slice(0, 60), ...(block.creature ? { creature: block.creature } : {}) }) } : {}), reachFt: npcReach(e), perception: npcPassivePerception(state, e), ...((e.darkvisionFt ?? block?.darkvisionFt) ? { darkvisionFt: e.darkvisionFt ?? block?.darkvisionFt } : {}), name: e.name, color: e.color, icon: e.icon, x: e.x, y: e.y, condition: condition(e.hp, e.maxHp), ...(gm ? { hp: e.hp, maxHp: e.maxHp, ac: e.ac, ...(e.tempHp ? { tempHp: e.tempHp } : {}) } : {}) });
  }
  return out;
}

/** Carried lights of the characters on the scene. */
export const carriedLights = (state: GameState, sceneId: string, pcs: PcPosition[]) => { const on = new Set(torchesOf(state, sceneId)); return pcs.filter((p) => on.has(p.tokenId)).map((p) => ({ x: p.x, y: p.y, ft: CARRIED_LIGHT_FT })); };

export interface ViewerMovement {
  tokenId: string;
  mode: MovementMode;
  epoch: string;
  canMove: boolean;
  reason?: string;
  /** Allowed this turn/day in feet (battle) or miles (region); unlimited outside initiative. */
  allowance: number;
  spent: number;
  unit: 'feet' | 'miles';
  overloaded: boolean;
  dashed?: boolean;
  /** APEX 1.9 – flying / climbing speed (ft), current altitude, and the allowance while flying. */
  fly?: number;
  climb?: number;
  alt?: number;
  flyAllowance?: number;
}

export const sheetOf = async (ctx: SceneViewContext, tokenId: string) => (await ctx.loadSheet(tokenId)) ?? emptySheet();

/** Darkvision from the character sheet ("Vision / senses": "Darkvision 60 ft."). */
export function sheetDarkvision(sheet: CharacterSheet): number {
  const texts = [...sheet.combat.map((c) => `${c.label} ${c.value}`), ...sheet.abilities.map((a) => `${a.name} ${a.text.slice(0, 200)}`)];
  return Math.max(0, ...texts.map(darkvisionFeet));
}

/** Character speed for scene movement: sheet/items encumbrance only – the Arena's sneaking and MP do not apply. */
export function sceneSpeed(state: GameState, tokenId: string, sheet: CharacterSheet): { speedFt: number; overloaded: boolean } {
  const token = state.tokens[tokenId];
  if (!token) return { speedFt: 0, overloaded: false };
  const load = characterMovementLoad(state, token, sheet);
  // Wild Shape: the beast's walking speed (equipment merged into the form – no encumbrance)
  const beast = sheet.wildShape ? findBeast(state.customBeasts, sheet.wildShape.formId) : undefined;
  if (beast) return { speedFt: beast.speed.walk, overloaded: false };
  return { speedFt: Math.max(0, load.speedFt), overloaded: load.load.state === 'over' }; // item speed and encumbrance count
}

/** Flying and climbing of a character on a scene (speeds, altitude, the allowance while flying). */
export function flightOf(state: GameState, sceneId: string, tokenId: string, sheet: CharacterSheet, mode: MovementMode): Pick<ViewerMovement, 'fly' | 'climb' | 'alt' | 'flyAllowance'> {
  const beast = sheet.wildShape ? findBeast(state.customBeasts, sheet.wildShape.formId) : undefined;
  const sp = pcSpeeds(sheet, beast ?? null, effectsOf(state, sceneId, pcActor(tokenId)));
  const alt = altitudeOf(state, sceneId, pcActor(tokenId));
  if (!sp.fly && !sp.climb && !alt) return {};
  const dash = mode === 'turn' && budgetOf(activeEncounter(state, sceneId), pcActor(tokenId)).dash ? 2 : 1;
  return { ...(sp.fly ? { fly: sp.fly, flyAllowance: speedZero(state, sceneId, pcActor(tokenId)) ? 0 : epochAllowance(mode, effectiveSpeed(state, sceneId, pcActor(tokenId), sp.fly)) * dash } : {}), ...(sp.climb ? { climb: sp.climb } : {}), ...(alt ? { alt } : {}) };
}

export function movementFor(state: GameState, sceneId: string, category: 'battle' | 'region', tokenId: string, gm: boolean, sheet: CharacterSheet, local: LocalMotionSnapshot): ViewerMovement {
  const e = movementEpoch(state, sceneId, category, tokenId, gm);
  const { speedFt, overloaded } = sceneSpeed(state, tokenId, sheet);
  const row = local.tokens.find((t) => t.tokenId === tokenId);
  return {
    tokenId,
    mode: e.mode,
    epoch: e.epoch,
    canMove: e.canMove && !overloaded,
    reason: overloaded ? 'Over carrying capacity – reduce the carried load before moving.' : e.reason,
    // Dash: extra movement equal to the speed for this turn
    // grappled / restrained / paralyzed …: speed 0
    allowance: speedZero(state, sceneId, pcActor(tokenId)) ? 0 : epochAllowance(e.mode, e.mode === 'turn' ? effectiveSpeed(state, sceneId, pcActor(tokenId), speedFt) : speedFt) * (e.mode === 'turn' && budgetOf(activeEncounter(state, sceneId), pcActor(tokenId)).dash ? 2 : 1),
    dashed: e.mode === 'turn' && !!budgetOf(activeEncounter(state, sceneId), pcActor(tokenId)).dash,
    ...flightOf(state, sceneId, tokenId, sheet, e.mode),
    spent: row && row.epoch === e.epoch ? row.spent : 0,
    unit: category === 'battle' ? 'feet' : 'miles',
    overloaded,
  };
}

/** Old (campaign-wide) motion shape kept for the UI: positions and known markers. */
export function motionShape(local: LocalMotionSnapshot, state: GameState | null, sceneId: string): MotionSnapshot {
  return {
    tokens: local.tokens.map((t) => ({ tokenId: t.tokenId, x: t.x, y: t.y, version: t.version, tacticalSpent: 0, regionSpent: 0 })),
    round: state ? (activeEncounter(state, sceneId)?.round ?? 0) : 0,
    hour: 0,
    known: local.known,
    budgets: {},
  };
}

/** Vision of the given characters (positions from the ledger, else the assignment spawn). */
export async function visionFor(ctx: SceneViewContext, map: SceneMap, clock: SceneClockState, positions: Array<{ tokenId: string; x: number; y: number }>, carried: CarriedLight[] = [], sceneId?: string): Promise<Set<HexKey>> {
  const viewers: Viewer[] = [];
  for (const p of positions) {
    const altFt = sceneId && ctx.state ? altitudeOf(ctx.state, sceneId, `pc-${p.tokenId}`) : 0;
    viewers.push({ at: p, darkvisionFt: sheetDarkvision(await sheetOf(ctx, p.tokenId)), ...(altFt ? { altFt } : {}) });
  }
  return sceneVision(map, clock, viewers, carried);
}

/** Player map: terrain masked to visible + remembered hexes, and the fog string for the renderer. */
export function fogMap(map: SceneMap, visible: Set<HexKey>, seen: string[]): { hex: NonNullable<SceneMap['hex']>; fog: string } | null {
  if (!map.hex) return null;
  const explored = new Set<HexKey>([...seen, ...visible]);
  const fog = fogString(map.hex.radius, visible, explored);
  const heights = map.hex.heights ? map.hex.heights.split('').map((c, i) => (fog[i] === '.' ? '0' : c)).join('') : undefined; // unknown hexes reveal no relief
  return { hex: { ...map.hex, terrain: maskTerrain(map.hex.terrain, fog), ...(heights ? { heights } : {}) }, fog };
}

export const clockFor = (state: GameState | null, sceneId: string) => clockOf(state ?? {}, sceneId);
export const isHexBattle = (map: SceneMap) => tileSetOf(map.hex) === 'battle';
export const hexKeyAt = (map: SceneMap, p: { x: number; y: number }) => hexKey(hexAt(map, p));
export const parseStoredSheet = (data: unknown) => { const p = parseSheet(data ?? emptySheet()); return p.ok ? p.sheet : emptySheet(); };
