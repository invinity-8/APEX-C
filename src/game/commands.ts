/**
 * Commands: the ONLY way to change the game state.
 *
 * Every action (moving, advancing time, GM settings …) is a command.
 * executeCommand() checks permissions, applies the rules and returns a NEW
 * game state (the previous one is never mutated).
 *
 * In online mode the browser only sends commands to the server, which runs
 * exactly this function. Players therefore cannot cheat.
 */
import { equals, hexKey, hexesInRange, type Axial, type HexKey } from './hex.js';
import { addLog } from './log.js';
import { findPath, type BlockCheck, type TerrainLookup } from './movement.js';
import { advanceDay, advancePhase } from './day.js';
import { movePointsForSpeed } from './resources.js';
import { emptyEquipment, equipItem, reconcileEquipment, unequipSlot, type Ability, type EquipError, type EquipSlot, type ItemEquip } from './equipment.js';
import { addAnnouncement, applyEvent, eventEligible, postponeEvent, rejectEvent } from './events.js';
import { stringHash } from './rng.js';
import { TERRAIN } from './terrain.js';
import { T, fmt, phaseName } from './text.js';
import { groupOf, refreshAllKnowledge, revealFor, visibleFrom } from './visibility.js';
import { zoneStatus } from './zone.js';
import type { Actor, AnnouncementCategory, EventEffect, GameState, Item, MarkerStyle, Phase, SiteVisibility, TeamStrategy, TeamVisibility } from './types.js';
import { INVENTORY_LIMITS, canMerge, containerOfItem, isStackable, materializeInventory } from './inventory.js';

export { fmt };

export type Command =
  | { type: 'move'; tokenId: string; to: Axial }
  | { type: 'place'; tokenId: string; to: Axial }
  | { type: 'endDay' }
  | { type: 'advancePhase' }
  | { type: 'setDay'; day: number; phase?: Phase }
  | { type: 'adjustMovePoints'; tokenId: string; delta: number }
  | { type: 'adjustMaxMovePoints'; tokenId: string; delta: number }
  | { type: 'adjustVisionRadius'; tokenId: string; delta: number }
  | { type: 'adjustVisionBonus'; tokenId: string; delta: number }
  | { type: 'toggleShare'; tokenId: string }
  | { type: 'toggleController'; tokenId: string; controllerId: string }
  | { type: 'setTeamVisibility'; teamId: string; visibility: TeamVisibility }
  | { type: 'setTeamStrategy'; teamId: string; strategy: TeamStrategy }
  | { type: 'setTracking'; teamId: string; mode: 'none' | 'approx' | 'exact' }
  | { type: 'setSiteVisibility'; siteId: string; visibility: SiteVisibility }
  | { type: 'triggerEvent'; eventId: string }
  | { type: 'setShrink'; enabled?: boolean; mode?: 'danger' | 'closed' }
  // ---- APEX 0.4: GM event approval & announcements
  | {
      type: 'decideEvent';
      eventId: string;
      decision: 'approve' | 'reject' | 'postpone';
      postpone?: 'nextPhase' | 'nextDay';
      edits?: { name?: string; description?: string; announce?: boolean };
    }
  | { type: 'createEvent'; eventId: string; name: string; description: string; hexes: string[]; effects: EventEffect[]; announce: boolean }
  | { type: 'announce'; category: AnnouncementCategory; title: string; text: string }
  // ---- APEX 0.3: character resources & inventory (players: own character only)
  | { type: 'setWill'; tokenId: string; current?: number; max?: number }
  | { type: 'setAppearance'; tokenId: string; title?: string; color?: string; accent?: string; marker?: MarkerStyle; initials?: string }
  | { type: 'invAddItem'; tokenId: string; itemId: string; name: string; quantity?: number; description?: string; notes?: string; container?: string }
  | { type: 'invUpdateItem'; tokenId: string; itemId: string; rev: number; name?: string; quantity?: number; description?: string; notes?: string; container?: string }
  | { type: 'invRemoveItem'; tokenId: string; itemId: string; rev: number }
  | { type: 'invAddContainer'; tokenId: string; containerId: string; name: string }
  | { type: 'invRenameContainer'; tokenId: string; containerId: string; name: string }
  | { type: 'invRemoveContainer'; tokenId: string; containerId: string }
  // APEX 0.6 inventory usability: reorder / move between containers, split and merge stacks
  | { type: 'invMoveItem'; tokenId: string; itemId: string; rev: number; container: string; beforeItemId?: string | null }
  | { type: 'invSplitStack'; tokenId: string; itemId: string; rev: number; quantity: number; newItemId: string }
  | { type: 'invMergeStack'; tokenId: string; itemId: string; rev: number; intoItemId: string; intoRev: number }
  | { type: 'setWalkingSpeed'; tokenId: string; speedFt: number }
  // APEX 0.5 – equipment (items stay in the inventory; slots only reference them)
  | { type: 'equipItem'; tokenId: string; itemId: string; slot: EquipSlot }
  | { type: 'unequipSlot'; tokenId: string; slot: EquipSlot }
  | { type: 'setWeaponSet'; tokenId: string; set: 1 | 2 }
  | { type: 'setResting'; tokenId: string; resting: boolean; keep?: EquipSlot[] }
  | { type: 'setItemEquip'; tokenId: string; itemId: string; rev: number; equip: ItemEquip | null; gmLocked?: boolean }
  | { type: 'setEquipConfig'; tokenId: string; unarmoredAbility?: Ability | null; acOther?: number; acOtherLabel?: string };

/** Commands a player may send for their OWN character (besides 'move'). */
export const CHARACTER_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'setWill',
  'setAppearance',
  'invAddItem',
  'invUpdateItem',
  'invRemoveItem',
  'invAddContainer',
  'invRenameContainer',
  'invRemoveContainer',
  'invMoveItem',
  'invSplitStack',
  'invMergeStack',
  'equipItem',
  'unequipSlot',
  'setWeaponSet',
  'setResting',
  'setItemEquip',
  'setEquipConfig',
]);

/** May the actor edit this character's sheet resources and inventory? GM: all; player: only their own character. */
export function canEditCharacter(state: GameState, actor: Actor, tokenId: string): boolean {
  const t = state.tokens[tokenId];
  if (!t) return false;
  if (actor.role === 'gm') return true;
  return t.kind === 'player' && actor.tokenId === tokenId;
}

export type CommandResult =
  | { ok: true; state: GameState; message?: string }
  | { ok: false; state: GameState; error: string };

const fail = (state: GameState, error: string): CommandResult => ({ ok: false, state, error });

/** May this actor move the character? */
export function canControl(state: GameState, actor: Actor, tokenId: string): boolean {
  if (actor.role === 'gm') return true;
  const token = state.tokens[tokenId];
  if (!token || token.kind !== 'player') return false;
  return token.id === actor.tokenId || token.controllers.includes(actor.tokenId);
}

/** Which hexes does the actor know (players: explored or visible)? */
export function knownLookup(state: GameState, actor: Actor): TerrainLookup {
  if (actor.role === 'gm') return (k) => state.hexes[k]?.terrain;
  const known = new Set<HexKey>();
  for (const t of groupOf(state, actor.tokenId)) {
    Object.keys(state.knowledge[t.id]?.explored ?? {}).forEach((k) => known.add(k));
    visibleFrom(state, t).forEach((k) => known.add(k));
  }
  return (k) => (known.has(k) ? state.hexes[k]?.terrain : undefined);
}

export function zoneBlock(state: GameState): BlockCheck {
  return (k) => {
    const t = state.hexes[k];
    return t && zoneStatus(state.config, state.day, t) === 'closed' ? T.closedZoneShort : null;
  };
}

export type MoveCheck = { ok: true; path: Axial[]; cost: number } | { ok: false; reason: string };

/** Validates a move and explains in plain words why it is not possible. */
export function validateMove(state: GameState, actor: Actor, tokenId: string, to: Axial): MoveCheck {
  const token = state.tokens[tokenId];
  if (!token) return { ok: false, reason: T.noSuchToken };
  if (!canControl(state, actor, tokenId)) {
    return { ok: false, reason: T.notYourToken(token.name) };
  }
  const key = hexKey(to);
  const tile = state.hexes[key];
  if (!tile) return { ok: false, reason: T.outsideArena };
  if (equals(token.pos, to)) return { ok: false, reason: T.alreadyHere(token.name) };

  const lookup = knownLookup(state, actor);
  if (lookup(key) === undefined) {
    return { ok: false, reason: T.unexplored };
  }
  const def = TERRAIN[tile.terrain];
  if (def.cost === null) return { ok: false, reason: T.impassable(def.label) };
  if (zoneStatus(state.config, state.day, to) === 'closed') {
    return { ok: false, reason: T.closedZone };
  }

  const result = findPath(token.pos, to, lookup, zoneBlock(state));
  if (!result) {
    return {
      ok: false,
      reason: actor.role === 'gm' ? T.noPathGm : T.noPathPlayer,
    };
  }
  if (result.cost > token.movePoints + 1e-9) {
    return { ok: false, reason: T.notEnoughMp(result.cost, token.name, token.movePoints) };
  }
  return { ok: true, path: result.path, cost: result.cost };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Executes a command. The given state is never mutated. */
export function executeCommand(prev: GameState, actor: Actor, cmd: Command): CommandResult {
  const gmOnly = cmd.type !== 'move' && !CHARACTER_COMMANDS.has(cmd.type);
  if (gmOnly && actor.role !== 'gm') return fail(prev, T.gmOnly);
  if (CHARACTER_COMMANDS.has(cmd.type) && !canEditCharacter(prev, actor, (cmd as { tokenId: string }).tokenId)) {
    return fail(prev, prev.tokens[(cmd as { tokenId: string }).tokenId] ? T.notYourCharacter : T.noSuchToken);
  }
  if (cmd.type.startsWith('inv')) return executeInventory(prev, cmd as InventoryCommand);
  if (EQUIPMENT_COMMANDS.has(cmd.type)) return executeEquipment(prev, actor, cmd as EquipmentCommand);

  const state: GameState = structuredClone(prev);

  switch (cmd.type) {
    case 'move': {
      const check = validateMove(state, actor, cmd.tokenId, cmd.to);
      if (!check.ok) return fail(prev, check.reason);
      const token = state.tokens[cmd.tokenId];
      // Move step by step so that terrain along the way is revealed too.
      for (const step of check.path) {
        token.pos = { ...step };
        revealFor(state, token.id);
      }
      token.movePoints = Math.max(0, token.movePoints - check.cost);
      addLog(
        state,
        'move',
        T.logMove(token.name, check.path.length, check.cost, token.movePoints),
        token.kind === 'player' ? 'all' : 'gm',
      );
      break;
    }
    case 'place': {
      const token = state.tokens[cmd.tokenId];
      if (!token) return fail(prev, T.noSuchToken);
      if (!state.hexes[hexKey(cmd.to)]) return fail(prev, T.outsideArena);
      token.pos = { ...cmd.to };
      addLog(state, 'gm', T.logPlace(token.name, cmd.to.q, cmd.to.r), 'gm');
      break;
    }
    case 'endDay':
      advanceDay(state);
      break;
    case 'advancePhase':
      advancePhase(state);
      break;
    case 'setWalkingSpeed': {
      // Daily movement from walking speed (resources.ts). Changing the speed adjusts the MAXIMUM only: the
      // current points never go up (no refill by editing the speed) – they are restored at dawn as always.
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, T.noSuchToken);
      t.speedFt = clamp(Math.round(cmd.speedFt), 5, 200);
      t.maxMovePoints = movePointsForSpeed(t.speedFt);
      t.movePoints = Math.min(t.movePoints, t.maxMovePoints);
      addLog(state, 'gm', `${t.name}: walking speed ${t.speedFt} ft → ${t.maxMovePoints} movement points per day.`, 'gm');
      break;
    }
    case 'setDay':
      // Correction tool: changes only the clock, without dawn/nightfall effects.
      state.day = clamp(Math.round(cmd.day), 1, 999);
      if (cmd.phase) state.phase = cmd.phase;
      addLog(state, 'gm', T.logSetDay(phaseName(state.phase, state.day)), 'gm');
      break;
    case 'adjustMovePoints': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, T.noSuchToken);
      t.movePoints = clamp(t.movePoints + cmd.delta, 0, 99);
      break;
    }
    case 'adjustMaxMovePoints': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, T.noSuchToken);
      t.maxMovePoints = clamp(t.maxMovePoints + cmd.delta, 0, 99);
      break;
    }
    case 'adjustVisionRadius': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, T.noSuchToken);
      t.visionRadius = clamp(t.visionRadius + cmd.delta, 0, 12);
      break;
    }
    case 'adjustVisionBonus': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, T.noSuchToken);
      t.visionBonus = clamp(t.visionBonus + cmd.delta, -t.visionRadius, 12);
      break;
    }
    case 'toggleShare': {
      const t = state.tokens[cmd.tokenId];
      if (!t || t.kind !== 'player') return fail(prev, T.onlyPlayersShare);
      t.sharesWithParty = !t.sharesWithParty;
      break;
    }
    case 'toggleController': {
      const t = state.tokens[cmd.tokenId];
      if (!t || t.kind !== 'player') return fail(prev, T.onlyPlayersControllers);
      if (cmd.controllerId === t.id) return fail(prev, T.controlsItself);
      if (state.tokens[cmd.controllerId]?.kind !== 'player') return fail(prev, T.noSuchToken);
      t.controllers = t.controllers.includes(cmd.controllerId)
        ? t.controllers.filter((c) => c !== cmd.controllerId)
        : [...t.controllers, cmd.controllerId];
      break;
    }
    case 'setTeamVisibility': {
      const team = state.teams[cmd.teamId];
      if (!team) return fail(prev, T.noSuchTeam);
      team.visibility = cmd.visibility;
      addLog(state, 'gm', T.logTeamVisibility(team.name, cmd.visibility), 'gm');
      break;
    }
    case 'setTeamStrategy': {
      const team = state.teams[cmd.teamId];
      if (!team) return fail(prev, T.noSuchTeam);
      team.strategy = cmd.strategy;
      break;
    }
    case 'setTracking': {
      const team = state.teams[cmd.teamId];
      if (!team) return fail(prev, T.noSuchTeam);
      if (cmd.mode === 'none') {
        team.tracking = null;
        addLog(state, 'gm', T.logTrackLost(team.name), 'gm');
        break;
      }
      const leader = Object.values(state.tokens).find((t) => t.teamId === team.id);
      if (!leader) return fail(prev, T.teamNotOnMap);
      let pos = { ...leader.pos };
      let radius = 0;
      if (cmd.mode === 'approx') {
        // Approximate marker: random but reproducible, within 2 hexes of the true position.
        radius = 2;
        const options = hexesInRange(leader.pos, radius).filter((h) => state.hexes[hexKey(h)]);
        pos = options[stringHash(`${team.id}:${state.day}`) % options.length];
      }
      team.tracking = { mode: cmd.mode, pos, radius, day: state.day };
      addLog(
        state,
        'event',
        cmd.mode === 'exact'
          ? T.logTrackExact(team.name)
          : T.logTrackApprox(team.name),
      );
      break;
    }
    case 'setSiteVisibility': {
      const site = state.sites[cmd.siteId];
      if (!site) return fail(prev, T.noSuchSite);
      site.visibility = cmd.visibility;
      if (cmd.visibility === 'public') addLog(state, 'event', T.logSitePublic(site.name));
      break;
    }
    case 'triggerEvent':
      // Manual trigger = GM approval of an eligible event (same validation as an automatic event).
      if (!state.events[cmd.eventId]) return fail(prev, T.noSuchEvent);
      if (!applyEvent(state, cmd.eventId)) return fail(prev, T.eventNotEligible);
      break;
    case 'decideEvent': {
      const ev = state.events[cmd.eventId];
      if (!ev) return fail(prev, T.noSuchEvent);
      if (!eventEligible(ev)) return fail(prev, T.eventNotEligible);
      if (cmd.edits) {
        if (cmd.edits.name !== undefined && cmd.edits.name.trim()) ev.name = cmd.edits.name.trim().slice(0, 80);
        if (cmd.edits.description !== undefined) ev.description = cmd.edits.description.trim().slice(0, 1000);
        if (cmd.edits.announce !== undefined) ev.announce = cmd.edits.announce;
      }
      const ok =
        cmd.decision === 'approve' ? applyEvent(state, ev.id) : cmd.decision === 'reject' ? rejectEvent(state, ev.id) : postponeEvent(state, ev.id, cmd.postpone ?? 'nextPhase');
      if (!ok) return fail(prev, T.eventNotEligible);
      break;
    }
    case 'createEvent': {
      if (state.events[cmd.eventId]) return fail(prev, T.eventExists);
      const hexes = [...new Set(cmd.hexes)].filter((k) => state.hexes[k]);
      for (const e of cmd.effects) if (e.type === 'revealSite' && !state.sites[e.siteId]) return fail(prev, T.noSuchSite);
      state.events[cmd.eventId] = {
        id: cmd.eventId,
        name: cmd.name.trim().slice(0, 80) || 'Custom event',
        description: cmd.description.trim().slice(0, 1000),
        trigger: { type: 'manual' },
        hexes,
        effects: cmd.effects,
        status: 'pending',
        announce: cmd.announce,
        source: 'custom',
      };
      addLog(state, 'gm', T.logEventCreated(state.events[cmd.eventId].name), 'gm');
      break;
    }
    case 'announce':
      addAnnouncement(state, { category: cmd.category, title: cmd.title, text: cmd.text });
      addLog(state, 'event', `📣 ${cmd.title.trim().slice(0, 80)}${cmd.text.trim() ? ` – ${cmd.text.trim().slice(0, 200)}` : ''}`);
      return { ok: true, state };
    case 'setShrink':
      if (cmd.enabled !== undefined) state.config.shrink.enabled = cmd.enabled;
      if (cmd.mode !== undefined) state.config.shrink.mode = cmd.mode;
      break;
    case 'setWill': {
      const t = state.tokens[cmd.tokenId];
      if (cmd.max !== undefined && actor.role !== 'gm') return fail(prev, T.willMaxGmOnly);
      if (cmd.max !== undefined) t.will.max = clamp(Math.round(cmd.max), 0, 999);
      if (cmd.current !== undefined) t.will.current = clamp(Math.round(cmd.current), 0, t.will.max);
      else t.will.current = Math.min(t.will.current, t.will.max);
      break;
    }
    case 'setAppearance': {
      // Cosmetic only: tag, colours, marker shape, initials. Never touches rules or permissions.
      const t = state.tokens[cmd.tokenId];
      if (cmd.title !== undefined) t.title = cmd.title.trim().slice(0, 40) || t.title;
      if (cmd.color !== undefined) t.color = cmd.color.toLowerCase();
      if (cmd.accent !== undefined) t.accent = cmd.accent.toLowerCase();
      if (cmd.marker !== undefined) t.marker = cmd.marker;
      if (cmd.initials !== undefined && cmd.initials.trim()) t.initials = cmd.initials.trim().slice(0, 3);
      return { ok: true, state }; // no knowledge refresh needed
    }
    default:
      return fail(prev, T.gmOnly);
  }

  refreshAllKnowledge(state);
  return { ok: true, state };
}

type InventoryCommand = Extract<Command, { type: 'invAddItem' | 'invUpdateItem' | 'invRemoveItem' | 'invAddContainer' | 'invRenameContainer' | 'invRemoveContainer' | 'invMoveItem' | 'invSplitStack' | 'invMergeStack' }>;

/**
 * Inventory changes. They only touch one character's inventory (no knowledge refresh, no log:
 * inventories are private to the owner and the GM).
 */
function executeInventory(prev: GameState, cmd: InventoryCommand): CommandResult {
  const state = cloneOneToken(prev, cmd.tokenId);
  const t = state.tokens[cmd.tokenId];
  materializeInventory(t);
  const containers = t.containers!;
  const L = INVENTORY_LIMITS;
  const text = (v: string | undefined, max: number) => (v === undefined ? undefined : v.trim().slice(0, max));
  const findItem = (id: string, rev: number): Item | string => {
    const item = t.inventory.find((i) => i.id === id);
    if (!item) return T.itemGone;
    if ((item.rev ?? 0) !== rev) return T.itemChanged(item.name);
    return item;
  };
  const checkContainer = (id: string | undefined) => id === undefined || containers.some((c) => c.id === id);

  switch (cmd.type) {
    case 'invAddItem': {
      const name = text(cmd.name, L.name);
      if (!name) return fail(prev, T.itemNameRequired);
      if (t.inventory.length >= L.items) return fail(prev, T.inventoryFull);
      if (t.inventory.some((i) => i.id === cmd.itemId)) return fail(prev, T.itemExists);
      if (!checkContainer(cmd.container)) return fail(prev, T.noSuchContainer);
      t.inventory.push({
        id: cmd.itemId,
        name,
        kind: 'misc',
        description: text(cmd.description, L.description) ?? '',
        quantity: clamp(Math.round(cmd.quantity ?? 1), 0, L.quantity),
        notes: text(cmd.notes, L.notes) || undefined,
        container: cmd.container ?? containers[0].id,
        rev: 0,
      });
      break;
    }
    case 'invUpdateItem': {
      const item = findItem(cmd.itemId, cmd.rev);
      if (typeof item === 'string') return fail(prev, item);
      if (cmd.name !== undefined) {
        const name = text(cmd.name, L.name);
        if (!name) return fail(prev, T.itemNameRequired);
        item.name = name;
      }
      if (!checkContainer(cmd.container)) return fail(prev, T.noSuchContainer);
      if (cmd.container !== undefined) item.container = cmd.container;
      if (cmd.quantity !== undefined) item.quantity = clamp(Math.round(cmd.quantity), 0, L.quantity);
      if (cmd.description !== undefined) item.description = text(cmd.description, L.description) ?? '';
      if (cmd.notes !== undefined) item.notes = text(cmd.notes, L.notes) || undefined;
      item.rev = (item.rev ?? 0) + 1;
      break;
    }
    case 'invRemoveItem': {
      const item = findItem(cmd.itemId, cmd.rev);
      if (typeof item === 'string') return fail(prev, item);
      t.inventory = t.inventory.filter((i) => i !== item);
      reconcileEquipment(t); // a removed item can no longer be equipped anywhere
      break;
    }
    case 'invAddContainer': {
      const name = text(cmd.name, L.containerName);
      if (!name) return fail(prev, T.containerNameRequired);
      if (containers.length >= L.containers) return fail(prev, T.tooManyContainers);
      if (containers.some((c) => c.id === cmd.containerId)) return fail(prev, T.containerExists);
      containers.push({ id: cmd.containerId, name });
      break;
    }
    case 'invRenameContainer': {
      const c = containers.find((x) => x.id === cmd.containerId);
      if (!c) return fail(prev, T.noSuchContainer);
      const name = text(cmd.name, L.containerName);
      if (!name) return fail(prev, T.containerNameRequired);
      c.name = name;
      break;
    }
    case 'invMoveItem': {
      // Reorder inside a container or move to another one; the inventory array order IS the display order.
      const item = findItem(cmd.itemId, cmd.rev);
      if (typeof item === 'string') return fail(prev, item);
      if (!checkContainer(cmd.container)) return fail(prev, T.noSuchContainer);
      const rest = t.inventory.filter((i) => i !== item);
      let at = rest.length;
      if (cmd.beforeItemId) {
        const j = rest.findIndex((i) => i.id === cmd.beforeItemId);
        if (j < 0) return fail(prev, T.itemGone);
        at = j;
      } else {
        // append after the last item of the target container
        for (let j = rest.length - 1; j >= 0; j--) if (containerOfItem(rest[j], containers) === cmd.container) {
          at = j + 1;
          break;
        }
      }
      item.container = cmd.container;
      item.rev = (item.rev ?? 0) + 1;
      rest.splice(at, 0, item);
      t.inventory = rest;
      break;
    }
    case 'invSplitStack': {
      const item = findItem(cmd.itemId, cmd.rev);
      if (typeof item === 'string') return fail(prev, item);
      const q = Math.round(cmd.quantity);
      if (q < 1 || q >= item.quantity) return fail(prev, 'Choose a quantity between 1 and one less than the stack size.');
      if (t.inventory.some((i) => i.id === cmd.newItemId)) return fail(prev, T.itemExists);
      if (t.inventory.length >= L.items) return fail(prev, T.inventoryFull);
      if (!isStackable(item)) return fail(prev, 'Only plain stackable items can be split.');
      item.quantity -= q;
      item.rev = (item.rev ?? 0) + 1;
      const copy: Item = { ...structuredClone(item), id: cmd.newItemId, quantity: q, rev: 0 };
      t.inventory.splice(t.inventory.indexOf(item) + 1, 0, copy);
      break;
    }
    case 'invMergeStack': {
      const item = findItem(cmd.itemId, cmd.rev);
      if (typeof item === 'string') return fail(prev, item);
      const into = findItem(cmd.intoItemId, cmd.intoRev);
      if (typeof into === 'string') return fail(prev, into);
      if (item === into) return fail(prev, 'An item cannot be merged into itself.');
      if (!canMerge(item, into)) return fail(prev, 'Only identical plain items can be merged.');
      into.quantity = clamp(into.quantity + item.quantity, 0, L.quantity);
      into.rev = (into.rev ?? 0) + 1;
      t.inventory = t.inventory.filter((i) => i !== item);
      reconcileEquipment(t);
      break;
    }
    case 'invRemoveContainer': {
      if (!containers.some((c) => c.id === cmd.containerId)) return fail(prev, T.noSuchContainer);
      if (t.inventory.some((i) => i.container === cmd.containerId)) return fail(prev, T.containerNotEmpty);
      if (containers.length <= 1) return fail(prev, T.lastContainer);
      t.containers = containers.filter((c) => c.id !== cmd.containerId);
      break;
    }
  }
  return { ok: true, state };
}

// ---------------------------------------------------------------- APEX 0.5 equipment

const EQUIPMENT_COMMANDS: ReadonlySet<Command['type']> = new Set(['equipItem', 'unequipSlot', 'setWeaponSet', 'setResting', 'setItemEquip', 'setEquipConfig']);
type EquipmentCommand = Extract<Command, { type: 'equipItem' | 'unequipSlot' | 'setWeaponSet' | 'setResting' | 'setItemEquip' | 'setEquipConfig' }>;

const EQUIP_ERROR: Record<EquipError, string> = {
  noSuchItem: 'This item is no longer in the inventory.',
  noEquipProps: 'Define the item’s equipment properties first (kind, armour or weapon values).',
  wrongSlot: 'This item does not fit that equipment slot.',
  twoHandedOff: 'A two-handed weapon needs both hands – the off hand stays empty.',
  gmLocked: 'The Game Master has locked this item’s properties.',
};

/** Equipment changes: private to the owner and the GM (no log, no knowledge refresh). */
function executeEquipment(prev: GameState, actor: Actor, cmd: EquipmentCommand): CommandResult {
  const state = cloneOneToken(prev, cmd.tokenId);
  const t = state.tokens[cmd.tokenId];
  if (t.kind !== 'player') return fail(prev, T.noSuchToken);
  const eq = () => (t.equipment ??= emptyEquipment());
  switch (cmd.type) {
    case 'equipItem': {
      const err = equipItem(t, cmd.itemId, cmd.slot);
      if (err) return fail(prev, EQUIP_ERROR[err]);
      break;
    }
    case 'unequipSlot':
      unequipSlot(t, cmd.slot);
      break;
    case 'setWeaponSet':
      eq().activeSet = cmd.set;
      break;
    case 'setResting':
      // Only changes which equipment counts – never heals or grants rest benefits.
      eq().resting = cmd.resting;
      if (cmd.keep) eq().restingKeep = [...new Set(cmd.keep)];
      break;
    case 'setItemEquip': {
      const item = t.inventory.find((i) => i.id === cmd.itemId);
      if (!item) return fail(prev, T.itemGone);
      if ((item.rev ?? 0) !== cmd.rev) return fail(prev, T.itemChanged(item.name));
      const locked = !!item.equip?.gmLocked;
      if (locked && actor.role !== 'gm') return fail(prev, EQUIP_ERROR.gmLocked);
      if (cmd.equip === null) delete item.equip;
      else item.equip = { ...cmd.equip, gmLocked: actor.role === 'gm' ? !!cmd.gmLocked : locked };
      item.rev = (item.rev ?? 0) + 1;
      reconcileEquipment(t); // a changed kind may no longer fit its slot
      break;
    }
    case 'setEquipConfig': {
      const e = eq();
      if (cmd.unarmoredAbility !== undefined) e.unarmoredAbility = cmd.unarmoredAbility;
      if (cmd.acOther !== undefined) e.acOther = cmd.acOther;
      if (cmd.acOtherLabel !== undefined) e.acOtherLabel = cmd.acOtherLabel.trim().slice(0, 60) || undefined;
      break;
    }
  }
  return { ok: true, state };
}

/**
 * Character-only commands touch exactly one token: copy that token deeply and share everything else (hexes,
 * knowledge …) with the previous state. Safe because every command clones before it mutates; it turns a
 * ~27 ms full-state clone on a radius-78 world into well under a millisecond.
 */
function cloneOneToken(prev: GameState, tokenId: string): GameState {
  return { ...prev, tokens: { ...prev.tokens, [tokenId]: structuredClone(prev.tokens[tokenId]) } };
}
