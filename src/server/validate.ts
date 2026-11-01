/**
 * Strict runtime validation of commands received from browsers.
 * Anything that does not match the expected shape exactly is rejected before
 * it reaches the game logic.
 */
import { CHARACTER_COMMANDS, type Command } from '../game/commands.js';
import { INVENTORY_LIMITS } from '../game/inventory.js';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[\w.-]+$/.test(v);
const isInt = (v: unknown, lim = 1000): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= lim;
const isAxial = (v: unknown): v is { q: number; r: number } => isObj(v) && isInt(v.q) && isInt(v.r);
/** Text field: string within the length limit (2× for safety; the rules trim to the exact limit). */
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max * 2;
const oneOf = <T extends string>(v: unknown, opts: readonly T[]): v is T => typeof v === 'string' && (opts as readonly string[]).includes(v);

export type ParseResult = { ok: true; command: Command } | { ok: false; error: string };

export function parseCommand(raw: unknown): ParseResult {
  const bad = (why: string): ParseResult => ({ ok: false, error: `Invalid command: ${why}.` });
  if (!isObj(raw) || typeof raw.type !== 'string') return bad('missing type');
  const c = raw;
  switch (c.type) {
    case 'move':
    case 'place':
      if (!isId(c.tokenId) || !isAxial(c.to)) return bad('tokenId/to');
      return { ok: true, command: { type: c.type, tokenId: c.tokenId, to: { q: c.to.q, r: c.to.r } } };
    case 'endDay':
    case 'advancePhase':
      return { ok: true, command: { type: c.type } };
    case 'setDay':
      if (!isInt(c.day) || (c.phase !== undefined && !oneOf(c.phase, ['day', 'night'] as const))) return bad('day');
      return { ok: true, command: { type: 'setDay', day: c.day, ...(c.phase ? { phase: c.phase as 'day' | 'night' } : {}) } };
    case 'adjustMovePoints':
    case 'adjustMaxMovePoints':
    case 'adjustVisionRadius':
    case 'adjustVisionBonus':
      if (!isId(c.tokenId) || !isInt(c.delta, 100)) return bad('tokenId/delta');
      return { ok: true, command: { type: c.type, tokenId: c.tokenId, delta: c.delta } };
    case 'toggleShare':
      if (!isId(c.tokenId)) return bad('tokenId');
      return { ok: true, command: { type: 'toggleShare', tokenId: c.tokenId } };
    case 'toggleController':
      if (!isId(c.tokenId) || !isId(c.controllerId)) return bad('tokenId/controllerId');
      return { ok: true, command: { type: 'toggleController', tokenId: c.tokenId, controllerId: c.controllerId } };
    case 'setTeamVisibility':
      if (!isId(c.teamId) || !oneOf(c.visibility, ['auto', 'hidden', 'revealed'] as const)) return bad('teamId/visibility');
      return { ok: true, command: { type: 'setTeamVisibility', teamId: c.teamId, visibility: c.visibility } };
    case 'setTeamStrategy':
      if (!isId(c.teamId) || !oneOf(c.strategy, ['manual', 'patrol', 'forage', 'flee', 'pursue', 'rest'] as const)) return bad('teamId/strategy');
      return { ok: true, command: { type: 'setTeamStrategy', teamId: c.teamId, strategy: c.strategy } };
    case 'setTracking':
      if (!isId(c.teamId) || !oneOf(c.mode, ['none', 'approx', 'exact'] as const)) return bad('teamId/mode');
      return { ok: true, command: { type: 'setTracking', teamId: c.teamId, mode: c.mode } };
    case 'setSiteVisibility':
      if (!isId(c.siteId) || !oneOf(c.visibility, ['public', 'onSight', 'hidden'] as const)) return bad('siteId/visibility');
      return { ok: true, command: { type: 'setSiteVisibility', siteId: c.siteId, visibility: c.visibility } };
    case 'triggerEvent':
      if (!isId(c.eventId)) return bad('eventId');
      return { ok: true, command: { type: 'triggerEvent', eventId: c.eventId } };
    case 'setShrink': {
      if (c.enabled !== undefined && typeof c.enabled !== 'boolean') return bad('enabled');
      if (c.mode !== undefined && !oneOf(c.mode, ['danger', 'closed'] as const)) return bad('mode');
      const cmd: Command = { type: 'setShrink' };
      if (c.enabled !== undefined) cmd.enabled = c.enabled as boolean;
      if (c.mode !== undefined) cmd.mode = c.mode as 'danger' | 'closed';
      return { ok: true, command: cmd };
    }
    case 'setWill': {
      if (!isId(c.tokenId)) return bad('tokenId');
      if (c.current !== undefined && !isInt(c.current)) return bad('current');
      if (c.max !== undefined && !isInt(c.max)) return bad('max');
      if (c.current === undefined && c.max === undefined) return bad('current/max');
      const cmd: Command = { type: 'setWill', tokenId: c.tokenId };
      if (c.current !== undefined) cmd.current = c.current as number;
      if (c.max !== undefined) cmd.max = c.max as number;
      return { ok: true, command: cmd };
    }
    case 'invAddItem':
    case 'invUpdateItem': {
      if (!isId(c.tokenId) || !isId(c.itemId)) return bad('tokenId/itemId');
      const out: Record<string, unknown> = { type: c.type, tokenId: c.tokenId, itemId: c.itemId };
      if (c.type === 'invUpdateItem') {
        if (!isInt(c.rev, 1_000_000_000)) return bad('rev');
        out.rev = c.rev;
      }
      if (c.type === 'invAddItem' || c.name !== undefined) {
        if (!isText(c.name, INVENTORY_LIMITS.name)) return bad('name');
        out.name = c.name;
      }
      if (c.quantity !== undefined) {
        if (!isInt(c.quantity, INVENTORY_LIMITS.quantity) || (c.quantity as number) < 0) return bad('quantity');
        out.quantity = c.quantity;
      }
      if (c.description !== undefined) {
        if (!isText(c.description, INVENTORY_LIMITS.description)) return bad('description');
        out.description = c.description;
      }
      if (c.notes !== undefined) {
        if (!isText(c.notes, INVENTORY_LIMITS.notes)) return bad('notes');
        out.notes = c.notes;
      }
      if (c.container !== undefined) {
        if (!isId(c.container)) return bad('container');
        out.container = c.container;
      }
      return { ok: true, command: out as Command };
    }
    case 'invRemoveItem':
      if (!isId(c.tokenId) || !isId(c.itemId) || !isInt(c.rev, 1_000_000_000)) return bad('tokenId/itemId/rev');
      return { ok: true, command: { type: 'invRemoveItem', tokenId: c.tokenId, itemId: c.itemId, rev: c.rev } };
    case 'invAddContainer':
    case 'invRenameContainer':
      if (!isId(c.tokenId) || !isId(c.containerId) || !isText(c.name, INVENTORY_LIMITS.containerName)) return bad('tokenId/containerId/name');
      return { ok: true, command: { type: c.type, tokenId: c.tokenId, containerId: c.containerId, name: c.name } };
    case 'invRemoveContainer':
      if (!isId(c.tokenId) || !isId(c.containerId)) return bad('tokenId/containerId');
      return { ok: true, command: { type: 'invRemoveContainer', tokenId: c.tokenId, containerId: c.containerId } };
    default:
      return bad(`unknown type "${String(c.type).slice(0, 32)}"`);
  }
}

/** Command types a player may ever send (own characters only). Everything else is GM-only. */
export const PLAYER_COMMANDS: ReadonlySet<Command['type']> = new Set(['move', ...CHARACTER_COMMANDS]);

export { isId, isObj, isInt };
