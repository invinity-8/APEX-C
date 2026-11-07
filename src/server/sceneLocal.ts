/**
 * Scene-local view and movement rules (server only). Shared by the player snapshot, the GM focus and
 * scene movement so that what a player sees and what the server accepts always agree.
 */
import { hexAt, tileSetOf } from '../campaign/hexScene.js';
import { darkvisionFeet, fogString, maskTerrain, sceneVision, type Viewer } from '../campaign/hexVision.js';
import type { SceneMap } from '../campaign/maps.js';
import { hexKey, type HexKey } from '../game/hex.js';
import { characterMovementLoad } from '../game/items/weight.js';
import { emptySheet, parseSheet, type CharacterSheet } from '../game/sheet.js';
import { activeEncounter, clockOf, epochAllowance, movementEpoch, type MovementMode } from '../game/sceneTurns.js';
import type { GameState, SceneClockState } from '../game/types.js';
import type { LocalMotionSnapshot, MotionSnapshot } from './sceneMotion.js';

export interface SceneViewContext {
  state: GameState | null;
  loadSheet: (tokenId: string) => Promise<CharacterSheet | null>;
}

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
  return { speedFt: Math.max(0, Math.min(token.speedFt ?? 30, load.speedFt)), overloaded: load.load.state === 'over' };
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
    allowance: epochAllowance(e.mode, speedFt),
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
export async function visionFor(ctx: SceneViewContext, map: SceneMap, clock: SceneClockState, positions: Array<{ tokenId: string; x: number; y: number }>): Promise<Set<HexKey>> {
  const viewers: Viewer[] = [];
  for (const p of positions) viewers.push({ at: p, darkvisionFt: sheetDarkvision(await sheetOf(ctx, p.tokenId)) });
  return sceneVision(map, clock, viewers);
}

/** Player map: terrain masked to visible + remembered hexes, and the fog string for the renderer. */
export function fogMap(map: SceneMap, visible: Set<HexKey>, seen: string[]): { hex: NonNullable<SceneMap['hex']>; fog: string } | null {
  if (!map.hex) return null;
  const explored = new Set<HexKey>([...seen, ...visible]);
  const fog = fogString(map.hex.radius, visible, explored);
  return { hex: { ...map.hex, terrain: maskTerrain(map.hex.terrain, fog) }, fog };
}

export const clockFor = (state: GameState | null, sceneId: string) => clockOf(state ?? {}, sceneId);
export const isHexBattle = (map: SceneMap) => tileSetOf(map.hex) === 'battle';
export const hexKeyAt = (map: SceneMap, p: { x: number; y: number }) => hexKey(hexAt(map, p));
export const parseStoredSheet = (data: unknown) => { const p = parseSheet(data ?? emptySheet()); return p.ok ? p.sheet : emptySheet(); };
