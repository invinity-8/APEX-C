/**
 * Strict runtime validation of commands received from browsers.
 * Anything that does not match the expected shape exactly is rejected before
 * it reaches the game logic.
 */
import { CHARACTER_COMMANDS, type Command } from '../game/commands.js';
import { INVENTORY_LIMITS } from '../game/inventory.js';
import { ITEM_RULE_LIMITS, MAX_ITEM_LEVEL } from '../game/items/rules.js';
import { CURRENCY_IDS, MAX_CURRENCY } from '../game/items/currency.js';
import { MAX_COUNT } from '../game/items/loot.js';
import { BODY_TYPES, MARKER_STYLES } from '../game/types.js';
import { parseBeast } from '../game/beasts.js';
import { TERRAIN_ORDER } from '../game/terrain.js';

type Obj = Record<string, unknown>;

import { EQUIP_SLOTS, ITEM_KINDS, WEAPON_PROPERTIES, type EquipSlot, type ItemEquip, type WeaponProperty } from '../game/equipment.js';

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
    case 'arsenalGenerate': {
      if (!isId(c.stagedId) || !isId(c.baseId) || !oneOf(c.rarity, ['normal', 'magic', 'rare'] as const) || !isInt(c.itemLevel, MAX_ITEM_LEVEL) || c.itemLevel < 1 || typeof c.identified !== 'boolean') return bad('arsenalGenerate');
      if (c.quantity !== undefined && (!isInt(c.quantity, 99) || c.quantity < 1)) return bad('quantity');
      if (c.count !== undefined && (!isInt(c.count, MAX_COUNT) || c.count < 1)) return bad('count');
      if (c.giveTo !== undefined && !isId(c.giveTo)) return bad('giveTo');
      // NOTE: never accept a client seed – the server injects it (api.ts).
      return {
        ok: true,
        command: { type: 'arsenalGenerate', stagedId: c.stagedId, baseId: c.baseId, rarity: c.rarity, itemLevel: c.itemLevel, identified: c.identified, ...(c.quantity !== undefined ? { quantity: c.quantity } : {}), ...(c.count !== undefined ? { count: c.count } : {}), ...(c.giveTo !== undefined ? { giveTo: c.giveTo } : {}) },
      };
    }
    case 'arsenalGive':
      if (!isId(c.stagedId) || !isId(c.tokenId)) return bad('arsenalGive');
      return { ok: true, command: { type: 'arsenalGive', stagedId: c.stagedId, tokenId: c.tokenId } };
    case 'arsenalDiscard':
      if (!isId(c.stagedId)) return bad('arsenalDiscard');
      return { ok: true, command: { type: 'arsenalDiscard', stagedId: c.stagedId } };
    case 'gmGrantCurrency':
      if (!isId(c.tokenId) || !oneOf(c.currency, CURRENCY_IDS) || !isInt(c.amount, MAX_CURRENCY) || c.amount === 0) return bad('gmGrantCurrency');
      return { ok: true, command: { type: 'gmGrantCurrency', tokenId: c.tokenId, currency: c.currency, amount: c.amount } };
    case 'gmRevokeItem':
      if (!isId(c.tokenId) || !isId(c.itemId) || (c.reason !== undefined && !isText(c.reason, 120))) return bad('gmRevokeItem');
      return { ok: true, command: { type: 'gmRevokeItem', tokenId: c.tokenId, itemId: c.itemId, ...(typeof c.reason === 'string' && c.reason.trim() ? { reason: c.reason.trim().slice(0, 120) } : {}) } };
    case 'gmSetItemLock':
      if (!isId(c.tokenId) || !isId(c.itemId) || typeof c.locked !== 'boolean') return bad('gmSetItemLock');
      return { ok: true, command: { type: 'gmSetItemLock', tokenId: c.tokenId, itemId: c.itemId, locked: c.locked } };
    case 'itemIdentify':
    case 'itemReroll':
    case 'itemSalvage':
      if (!isId(c.tokenId) || !isId(c.itemId) || !isInt(c.rev, 1e9)) return bad(c.type);
      return { ok: true, command: { type: c.type, tokenId: c.tokenId, itemId: c.itemId, rev: c.rev } };
    case 'itemAugment':
    case 'itemAscend':
    case 'itemActivate':
      if (!isId(c.tokenId) || !isId(c.itemId) || !isInt(c.rev, 1e9)) return bad(c.type);
      return { ok: true, command: { type: c.type, tokenId: c.tokenId, itemId: c.itemId, rev: c.rev } };
    case 'transmuteFragments':
      if (!isId(c.tokenId) || !isInt(c.sets, 500) || c.sets < 1 || !isInt(c.currencyRev, 1e9)) return bad('transmuteFragments');
      return { ok: true, command: { type: 'transmuteFragments', tokenId: c.tokenId, sets: c.sets, currencyRev: c.currencyRev } };
    case 'arsenalGenerateUnique':
      if (!isId(c.stagedId) || !isId(c.uniqueId) || (c.giveTo !== undefined && !isId(c.giveTo))) return bad('arsenalGenerateUnique');
      return { ok: true, command: { type: 'arsenalGenerateUnique', stagedId: c.stagedId, uniqueId: c.uniqueId, ...(c.giveTo !== undefined ? { giveTo: c.giveTo } : {}) } };
    case 'gmTimeTwist':
      if (!isId(c.tokenId) || !oneOf(c.action, ['resolve', 'cancel'] as const)) return bad('gmTimeTwist');
      return { ok: true, command: { type: 'gmTimeTwist', tokenId: c.tokenId, action: c.action } };
    case 'gmSetCubeAccess':
      if (!isId(c.tokenId) || typeof c.permanent !== 'boolean') return bad('gmSetCubeAccess');
      return { ok: true, command: { type: 'gmSetCubeAccess', tokenId: c.tokenId, permanent: c.permanent } };
    case 'gmRechargeItem':
      if (!isId(c.tokenId) || !isId(c.itemId)) return bad('gmRechargeItem');
      return { ok: true, command: { type: 'gmRechargeItem', tokenId: c.tokenId, itemId: c.itemId } };
    case 'combineFragments':
      if (!isId(c.tokenId) || !isInt(c.sets, 500) || c.sets < 1 || !isInt(c.currencyRev, 1e9)) return bad('combineFragments');
      return { ok: true, command: { type: 'combineFragments', tokenId: c.tokenId, sets: c.sets, currencyRev: c.currencyRev } };
    case 'setItemRules': {
      if (c.rules === null) return { ok: true, command: { type: 'setItemRules', rules: null } };
      if (!isObj(c.rules)) return bad('rules');
      const rules: Record<string, number> = {};
      for (const [k, v] of Object.entries(c.rules)) {
        if (!(k in ITEM_RULE_LIMITS) || !isInt(v, 1000)) return bad(`rules.${k}`);
        rules[k] = v;
      }
      return { ok: true, command: { type: 'setItemRules', rules } };
    }
    case 'setSneak':
      if (!isId(c.tokenId) || typeof c.on !== 'boolean') return bad('setSneak');
      return { ok: true, command: { type: 'setSneak', tokenId: c.tokenId, on: c.on } };
    case 'gmSetBeast': {
      const b = parseBeast(c.beast);
      if (typeof b === 'string') return bad(b);
      return { ok: true, command: { type: 'gmSetBeast', beast: b } };
    }
    case 'gmRemoveBeast':
      if (typeof c.beastId !== 'string' || !/^gm-[a-z0-9-]{1,40}$/.test(c.beastId)) return bad('beastId');
      return { ok: true, command: { type: 'gmRemoveBeast', beastId: c.beastId } };
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
    case 'decideEvent': {
      if (!isId(c.eventId) || !oneOf(c.decision, ['approve', 'reject', 'postpone'] as const)) return bad('eventId/decision');
      if (c.postpone !== undefined && !oneOf(c.postpone, ['nextPhase', 'nextDay'] as const)) return bad('postpone');
      const cmd: Record<string, unknown> = { type: 'decideEvent', eventId: c.eventId, decision: c.decision };
      if (c.postpone !== undefined) cmd.postpone = c.postpone;
      if (c.edits !== undefined) {
        if (!isObj(c.edits)) return bad('edits');
        const e = c.edits;
        if ((e.name !== undefined && !isText(e.name, 80)) || (e.description !== undefined && !isText(e.description, 1000)) || (e.announce !== undefined && typeof e.announce !== 'boolean')) return bad('edits');
        cmd.edits = { ...(e.name !== undefined ? { name: e.name } : {}), ...(e.description !== undefined ? { description: e.description } : {}), ...(e.announce !== undefined ? { announce: e.announce } : {}) };
      }
      return { ok: true, command: cmd as Command };
    }
    case 'createEvent': {
      if (!isId(c.eventId) || !isText(c.name, 80) || !isText(c.description, 1000) || typeof c.announce !== 'boolean') return bad('event');
      if (!Array.isArray(c.hexes) || c.hexes.length > 400 || !c.hexes.every((k) => typeof k === 'string' && /^-?\d{1,3},-?\d{1,3}$/.test(k))) return bad('hexes');
      if (!Array.isArray(c.effects) || !c.effects.length || c.effects.length > 5) return bad('effects');
      const effects: unknown[] = [];
      for (const e of c.effects) {
        if (!isObj(e)) return bad('effect');
        if (e.type === 'setTerrain' && oneOf(e.terrain, TERRAIN_ORDER)) effects.push({ type: 'setTerrain', terrain: e.terrain });
        else if (e.type === 'revealSite' && isId(e.siteId)) effects.push({ type: 'revealSite', siteId: e.siteId });
        else if (e.type === 'modifyMovePoints' && isInt(e.amount, 20)) effects.push({ type: 'modifyMovePoints', amount: e.amount });
        else return bad('effect');
      }
      return { ok: true, command: { type: 'createEvent', eventId: c.eventId, name: c.name, description: c.description, hexes: c.hexes as string[], effects, announce: c.announce } as Command };
    }
    case 'announce':
      if (!oneOf(c.category, ['general', 'warning', 'death', 'world', 'custom'] as const) || !isText(c.title, 80) || !c.title.trim() || !isText(c.text, 500)) return bad('announcement');
      return { ok: true, command: { type: 'announce', category: c.category, title: c.title, text: c.text } };
    case 'setShrink': {
      if (c.enabled !== undefined && typeof c.enabled !== 'boolean') return bad('enabled');
      if (c.mode !== undefined && !oneOf(c.mode, ['danger', 'closed'] as const)) return bad('mode');
      const cmd: Command = { type: 'setShrink' };
      if (c.enabled !== undefined) cmd.enabled = c.enabled as boolean;
      if (c.mode !== undefined) cmd.mode = c.mode as 'danger' | 'closed';
      return { ok: true, command: cmd };
    }
    case 'setAppearance': {
      if (!isId(c.tokenId)) return bad('tokenId');
      const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
      const out: Record<string, unknown> = { type: 'setAppearance', tokenId: c.tokenId };
      if (c.title !== undefined) {
        if (!isText(c.title, 60)) return bad('title');
        out.title = c.title;
      }
      if (c.name !== undefined) {
        if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 40) return bad('name');
        out.name = c.name;
      }
      if (c.bodyType !== undefined) {
        if (!oneOf(c.bodyType, BODY_TYPES)) return bad('bodyType');
        out.bodyType = c.bodyType;
      }
      if (c.color !== undefined) {
        if (!hex(c.color)) return bad('color');
        out.color = c.color;
      }
      if (c.accent !== undefined) {
        if (!hex(c.accent)) return bad('accent');
        out.accent = c.accent;
      }
      if (c.marker !== undefined) {
        if (!oneOf(c.marker, MARKER_STYLES)) return bad('marker');
        out.marker = c.marker;
      }
      if (c.initials !== undefined) {
        if (typeof c.initials !== 'string' || c.initials.length > 6) return bad('initials');
        out.initials = c.initials;
      }
      if (Object.keys(out).length === 2) return bad('nothing to change');
      return { ok: true, command: out as Command };
    }
    case 'gmRestoreCharacter': {
      if (!isId(c.tokenId)) return bad('tokenId');
      const out: Record<string, unknown> = { type: 'gmRestoreCharacter', tokenId: c.tokenId };
      if (c.identity !== undefined) {
        const i = c.identity;
        const hex = (v: unknown) => v === undefined || (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v));
        if (!isObj(i) || typeof i.name !== 'string' || !i.name.trim() || i.name.length > 40 || typeof i.title !== 'string' || i.title.length > 60 || !hex(i.color) || !hex(i.accent) || (i.marker !== undefined && !oneOf(i.marker, MARKER_STYLES)) || (i.initials !== undefined && (typeof i.initials !== 'string' || i.initials.length > 6)))
          return bad('identity');
        out.identity = { name: i.name, title: i.title, ...(i.color ? { color: i.color } : {}), ...(i.accent ? { accent: i.accent } : {}), ...(i.marker ? { marker: i.marker } : {}), ...(i.initials ? { initials: i.initials } : {}) };
      }
      if (c.equipment !== undefined) {
        const e = c.equipment;
        if (!isObj(e) || !isObj(e.slots) || (e.activeSet !== 1 && e.activeSet !== 2) || typeof e.resting !== 'boolean' || !Array.isArray(e.restingKeep)) return bad('equipment');
        const slots: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.slots)) {
          if (!oneOf(k, EQUIP_SLOTS) || !isId(v)) return bad('equipment.slots');
          slots[k] = v;
        }
        if (!e.restingKeep.every((x) => oneOf(x, EQUIP_SLOTS))) return bad('equipment.restingKeep');
        out.equipment = { slots, activeSet: e.activeSet, resting: e.resting, restingKeep: e.restingKeep as EquipSlot[] };
      }
      if (!out.identity && !out.equipment) return bad('nothing to restore');
      return { ok: true, command: out as Command };
    }
    case 'setWalkingSpeed':
      if (!isId(c.tokenId) || !isInt(c.speedFt, 200) || (c.speedFt as number) < 5) return bad('tokenId/speedFt');
      return { ok: true, command: { type: 'setWalkingSpeed', tokenId: c.tokenId, speedFt: c.speedFt as number } };
    case 'equipItem':
      if (!isId(c.tokenId) || !isId(c.itemId) || !oneOf(c.slot, EQUIP_SLOTS)) return bad('tokenId/itemId/slot');
      return { ok: true, command: { type: 'equipItem', tokenId: c.tokenId, itemId: c.itemId, slot: c.slot } };
    case 'unequipSlot':
      if (!isId(c.tokenId) || !oneOf(c.slot, EQUIP_SLOTS)) return bad('tokenId/slot');
      return { ok: true, command: { type: 'unequipSlot', tokenId: c.tokenId, slot: c.slot } };
    case 'setWeaponSet':
      if (!isId(c.tokenId) || (c.set !== 1 && c.set !== 2)) return bad('tokenId/set');
      return { ok: true, command: { type: 'setWeaponSet', tokenId: c.tokenId, set: c.set } };
    case 'setResting': {
      if (!isId(c.tokenId) || typeof c.resting !== 'boolean') return bad('tokenId/resting');
      if (c.keep !== undefined && (!Array.isArray(c.keep) || c.keep.length > EQUIP_SLOTS.length || !c.keep.every((k) => oneOf(k, EQUIP_SLOTS)))) return bad('keep');
      return { ok: true, command: { type: 'setResting', tokenId: c.tokenId, resting: c.resting, ...(c.keep ? { keep: c.keep as EquipSlot[] } : {}) } };
    }
    case 'setItemEquip': {
      if (!isId(c.tokenId) || !isId(c.itemId) || !isInt(c.rev, 1_000_000_000)) return bad('tokenId/itemId/rev');
      if (c.gmLocked !== undefined && typeof c.gmLocked !== 'boolean') return bad('gmLocked');
      if (c.equip === null) return { ok: true, command: { type: 'setItemEquip', tokenId: c.tokenId, itemId: c.itemId, rev: c.rev, equip: null } };
      const e = parseItemEquip(c.equip);
      if (!e) return bad('equip');
      return { ok: true, command: { type: 'setItemEquip', tokenId: c.tokenId, itemId: c.itemId, rev: c.rev, equip: e, ...(c.gmLocked !== undefined ? { gmLocked: c.gmLocked } : {}) } };
    }
    case 'setEquipConfig': {
      if (!isId(c.tokenId)) return bad('tokenId');
      const out: Record<string, unknown> = { type: 'setEquipConfig', tokenId: c.tokenId };
      if (c.unarmoredAbility !== undefined) {
        if (c.unarmoredAbility !== null && !oneOf(c.unarmoredAbility, ABILITIES)) return bad('unarmoredAbility');
        out.unarmoredAbility = c.unarmoredAbility;
      }
      if (c.acOther !== undefined) {
        if (!isInt(c.acOther, 20)) return bad('acOther');
        out.acOther = c.acOther;
      }
      if (c.acOtherLabel !== undefined) {
        if (!isText(c.acOtherLabel, 60)) return bad('acOtherLabel');
        out.acOtherLabel = c.acOtherLabel;
      }
      return { ok: true, command: out as Command };
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
      if (c.weightKg !== undefined) {
        if (typeof c.weightKg !== 'number' || !Number.isFinite(c.weightKg) || c.weightKg < 0 || c.weightKg > 2000) return bad('weightKg');
        out.weightKg = c.weightKg;
      }
      return { ok: true, command: out as Command };
    }
    case 'invMoveItem':
      if (!isId(c.tokenId) || !isId(c.itemId) || !isInt(c.rev, 1_000_000_000) || !isId(c.container)) return bad('tokenId/itemId/rev/container');
      if (c.beforeItemId !== undefined && c.beforeItemId !== null && !isId(c.beforeItemId)) return bad('beforeItemId');
      return { ok: true, command: { type: 'invMoveItem', tokenId: c.tokenId, itemId: c.itemId, rev: c.rev, container: c.container, ...(c.beforeItemId ? { beforeItemId: c.beforeItemId as string } : {}) } };
    case 'invSplitStack':
      if (!isId(c.tokenId) || !isId(c.itemId) || !isId(c.newItemId) || !isInt(c.rev, 1_000_000_000) || !isInt(c.quantity, INVENTORY_LIMITS.quantity)) return bad('split');
      return { ok: true, command: { type: 'invSplitStack', tokenId: c.tokenId, itemId: c.itemId, rev: c.rev, quantity: c.quantity, newItemId: c.newItemId } };
    case 'invMergeStack':
      if (!isId(c.tokenId) || !isId(c.itemId) || !isId(c.intoItemId) || !isInt(c.rev, 1_000_000_000) || !isInt(c.intoRev, 1_000_000_000)) return bad('merge');
      return { ok: true, command: { type: 'invMergeStack', tokenId: c.tokenId, itemId: c.itemId, rev: c.rev, intoItemId: c.intoItemId, intoRev: c.intoRev } };
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

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

/** Strict validation of manually defined equipment properties (no unknown keys, bounded values). */
export function parseItemEquip(v: unknown): ItemEquip | null {
  if (!isObj(v) || !oneOf(v.kind, ITEM_KINDS)) return null;
  const out: ItemEquip = { kind: v.kind };
  const allowedKeys = new Set(['kind', 'armorType', 'armorBase', 'acBonus', 'attackBonus', 'damage', 'damageType', 'properties', 'proficient', 'gmLocked']);
  if (Object.keys(v).some((k) => !allowedKeys.has(k))) return null;
  if (v.armorType !== undefined) {
    if (!oneOf(v.armorType, ['light', 'medium', 'heavy'] as const)) return null;
    out.armorType = v.armorType;
  }
  if (v.armorBase !== undefined) {
    if (!isInt(v.armorBase, 30) || (v.armorBase as number) < 0) return null;
    out.armorBase = v.armorBase as number;
  }
  for (const k of ['acBonus', 'attackBonus'] as const) {
    if (v[k] === undefined) continue;
    if (!isInt(v[k], 10)) return null;
    out[k] = v[k] as number;
  }
  if (v.damage !== undefined) {
    if (typeof v.damage !== 'string' || !/^(\d{1,2}d(4|6|8|10|12|20)(\s*\+\s*\d{1,2}d(4|6|8|10|12|20))?|\d{1,2})$/i.test(v.damage.trim())) return null;
    out.damage = v.damage.trim().toLowerCase();
  }
  if (v.damageType !== undefined) {
    if (!isText(v.damageType, 30)) return null;
    out.damageType = v.damageType.trim();
  }
  if (v.properties !== undefined) {
    if (!Array.isArray(v.properties) || v.properties.length > 10 || !v.properties.every((p) => oneOf(p, WEAPON_PROPERTIES))) return null;
    out.properties = [...new Set(v.properties as WeaponProperty[])];
  }
  if (v.proficient !== undefined) {
    if (typeof v.proficient !== 'boolean') return null;
    out.proficient = v.proficient;
  }
  return out;
}
