/**
 * User-facing strings produced by the game logic (logs, errors, notifications).
 * Kept in one place so that the rules stay free of prose and a future
 * localisation only needs to replace this module.
 */
import type { Phase } from './types.js';

/** Formats movement points: 1, 0.5, 2.5 … */
export const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const phaseName = (phase: Phase, day: number): string => `${phase === 'day' ? 'Day' : 'Night'} ${day}`;

export const T = {
  // ---------- generic errors ----------
  gmOnly: 'Only the Game Master can do that.',
  noSuchToken: 'This character does not exist.',
  notYourCharacter: 'You can only change your own character.',
  willMaxGmOnly: 'Only the Game Master can change maximum Will.',
  itemGone: 'This item no longer exists – it was removed on another device.',
  itemChanged: (name: string) => `“${name}” was changed on another device in the meantime. The latest version is shown now – please make your change again.`,
  itemNameRequired: 'Please enter a name or description for the item.',
  itemQuantityFixed: 'The quantity of a generated (magic/rare) item cannot be changed.',
  itemExists: 'This item was already added.',
  inventoryFull: 'The inventory is full (300 entries).',
  noSuchContainer: 'This container does not exist (any more).',
  containerNameRequired: 'Please enter a name for the container.',
  containerExists: 'A container with this id already exists.',
  tooManyContainers: 'Too many containers (maximum 30).',
  containerNotEmpty: 'Only empty containers can be deleted. Move or remove its items first.',
  lastContainer: 'At least one container must remain.',
  noSuchTeam: 'This team does not exist.',
  noSuchSite: 'This site does not exist.',
  noSuchEvent: 'This event does not exist.',
  outsideArena: 'That hex lies outside the arena.',
  eventDone: 'This event has already been triggered.',
  eventNotEligible: 'This event has already been applied or rejected.',
  eventExists: 'An event with this id already exists.',
  logEventCreated: (name: string) => `✎ Custom event created: “${name}” (not triggered).`,
  logEventAwaiting: (name: string) => `⚡ Event due: “${name}” – waiting for your approval (nothing has happened yet).`,
  logEventRejected: (name: string) => `✕ Event rejected: “${name}” – no effects.`,
  logEventPostponed: (name: string) => `⏸ Event postponed: “${name}”.`,
  onlyPlayersShare: 'Only player characters can share knowledge.',
  onlyPlayersControllers: 'Only player characters have control permissions.',
  controlsItself: 'A character always controls itself.',
  teamNotOnMap: 'This team has no character on the map.',
  invalidCommand: 'Invalid command.',

  // ---------- movement ----------
  notYourToken: (name: string) => `You may not move ${name} – only characters assigned to you.`,
  alreadyHere: (name: string) => `${name} is already standing here.`,
  unexplored: 'Unexplored terrain – scout the area first.',
  impassable: (label: string) => `${label} is impassable.`,
  closedZone: 'That hex lies inside the closed zone of the shrinking arena.',
  closedZoneShort: 'Closed zone',
  noPathGm: 'There is no walkable path there. (Tip: use "Free placement".)',
  noPathPlayer: 'There is no known walkable path there.',
  notEnoughMp: (cost: number, name: string, mp: number) =>
    `Not enough movement points: the path costs ${fmt(cost)} MP, ${name} has ${fmt(mp)} MP left.`,

  // ---------- reach explanations (UI preview) ----------
  reachOutside: 'Outside the known world',
  reachCurrent: 'Current position',
  reachUnexplored: 'Unexplored – scout first',
  reachImpassable: (label: string) => `${label}: impassable`,
  reachNoPath: 'No known path there',
  reachTooExpensive: (cost: number, mp: number) => `Costs ${fmt(cost)} MP – only ${fmt(mp)} MP left`,

  // ---------- logs ----------
  logMove: (name: string, steps: number, cost: number, rest: number) =>
    `${name} travels ${steps} ${plural(steps, 'hex', 'hexes')} (−${fmt(cost)} MP, ${fmt(rest)} left).`,
  logPlace: (name: string, q: number, r: number) => `GM places ${name} at (${q}|${r}).`,
  logSetDay: (label: string) => `GM sets the arena clock to ${label}.`,
  logTeamVisibility: (team: string, v: string) => `Visibility of ${team}: ${v}.`,
  logTrackLost: (team: string) => `The trail of ${team} has been lost.`,
  logTrackExact: (team: string) => `🔴 The party has picked up the trail of ${team} – exact position marked.`,
  logTrackApprox: (team: string) => `🔴 The party senses ${team} – somewhere within the marked area.`,
  logSitePublic: (site: string) => `📜 A new site becomes known: ${site}.`,
  logDawn: (day: number) => `☀ Day ${day} dawns. All movement points are restored.`,
  logNightfall: (day: number) => `🌙 Night ${day} falls. Vision is reduced until dawn.`,
  // Player-facing shrink messages never mention ring numbers (they would reveal the arena size).
  logShrink: (closed: boolean) => `🜂 The arena contracts: its outer reaches are now ${closed ? 'sealed off' : 'a death zone'}.`,
  logShrinkWarning: '⚠ The Gamemakers warn: the arena will contract again soon.',
  logShrinkGm: (ring: number) => `Shrink step: safe within ring ${ring}.`,
  logShrinkWarningGm: (ring: number) => `Next shrink step: safe within ring ${ring}.`,
  logDeathZone: (name: string, consequence: string) => `☠ ${name} is inside the death zone! ${consequence}`,
  logEvent: (name: string, description: string, terrainNote?: string) => `⚡ ${name}: ${description}${terrainNote ? ` (${terrainNote})` : ''}`,
  eventTerrainNote: (count: number, label: string) => `${count} ${plural(count, 'hex', 'hexes')} → ${label}`,
  logArenaOpen: 'The gates of the arena close. Day 1 begins at the Aquila Aurea.',
  logArenaCreated: (radius: number, hexes: number, seed: number) => `Arena generated: radius ${radius}, ${hexes} hexes, seed ${seed}.`,
} as const;
