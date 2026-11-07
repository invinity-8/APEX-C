import type { SceneAnnouncement, SceneEncounterParticipant, GameState } from './types.js';

export type SceneOperationCommand =
  | { type: 'sceneAnnounce'; sceneId: string; publishedRevision: number; announcementId: string; title: string; text: string }
  | { type: 'sceneAnnouncementDismiss'; sceneId: string; publishedRevision: number; announcementId: string }
  | { type: 'sceneEncounterStart'; sceneId: string; publishedRevision: number; encounterId: string; title: string; participants: SceneEncounterParticipant[] }
  | { type: 'sceneEncounterAdd'; sceneId: string; publishedRevision: number; encounterId: string; expectedVersion: number; participant: SceneEncounterParticipant }
  | { type: 'sceneEncounterRemove'; sceneId: string; publishedRevision: number; encounterId: string; expectedVersion: number; participantId: string }
  | { type: 'sceneEncounterInitiative'; sceneId: string; publishedRevision: number; encounterId: string; expectedVersion: number; participantId: string; initiative: number }
  | { type: 'sceneEncounterVisibility'; sceneId: string; publishedRevision: number; encounterId: string; expectedVersion: number; participantId: string; visible: boolean }
  | { type: 'sceneEncounterAdvance'; sceneId: string; publishedRevision: number; encounterId: string; expectedVersion: number }
  | { type: 'sceneEncounterEnd'; sceneId: string; publishedRevision: number; encounterId: string; expectedVersion: number };

export const SCENE_OPERATION_COMMANDS = new Set<SceneOperationCommand['type']>([
  'sceneAnnounce', 'sceneAnnouncementDismiss', 'sceneEncounterStart', 'sceneEncounterAdd',
  'sceneEncounterRemove', 'sceneEncounterInitiative', 'sceneEncounterVisibility', 'sceneEncounterAdvance', 'sceneEncounterEnd',
]);

const MAX_ANNOUNCEMENTS = 100;
const MAX_PARTICIPANTS = 50;
const fail = (state: GameState, error: string) => ({ ok: false as const, state, error });
const orderParticipants = (rows: SceneEncounterParticipant[]) => [...rows].sort((a, b) => b.initiative - a.initiative || a.id.localeCompare(b.id));
const validParticipant = (p: SceneEncounterParticipant) => !!p && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 64
  && typeof p.name === 'string' && !!p.name.trim() && p.name.trim().length <= 80
  && Number.isInteger(p.initiative) && p.initiative >= -100 && p.initiative <= 1000
  && typeof p.visible === 'boolean' && (p.tokenId === undefined || typeof p.tokenId === 'string');

/** Mutations for Map-scoped narrative and initiative controls. Scene revision/assignment checks live in the API. */
export function executeSceneOperation(prev: GameState, cmd: SceneOperationCommand) {
  if (cmd.type === 'sceneAnnounce') {
    if (!cmd.title.trim() || !cmd.text.trim()) return fail(prev, 'Add a title and message before announcing.');
    if ((prev.sceneAnnouncements ?? []).some(a => a.id === cmd.announcementId)) return fail(prev, 'This announcement was already sent.');
    const state = structuredClone(prev);
    const row: SceneAnnouncement = { id: cmd.announcementId, sceneId: cmd.sceneId, title: cmd.title.trim().slice(0, 120), text: cmd.text.trim().slice(0, 1000), createdAt: new Date().toISOString() };
    state.sceneAnnouncements = [...(state.sceneAnnouncements ?? []), row].slice(-MAX_ANNOUNCEMENTS);
    return { ok: true as const, state };
  }
  if (cmd.type === 'sceneAnnouncementDismiss') {
    const current = prev.sceneAnnouncements ?? [];
    if (!current.some(a => a.sceneId === cmd.sceneId && a.id === cmd.announcementId)) return fail(prev, 'This scene announcement no longer exists.');
    const state = structuredClone(prev);
    state.sceneAnnouncements = current.filter(a => !(a.sceneId === cmd.sceneId && a.id === cmd.announcementId));
    return { ok: true as const, state };
  }
  if (cmd.type === 'sceneEncounterStart') {
    const participants = cmd.participants;
    if (!cmd.title.trim() || cmd.title.trim().length > 120 || !participants.length || participants.length > MAX_PARTICIPANTS
      || participants.some(p => !validParticipant(p)) || new Set(participants.map(p => p.id)).size !== participants.length
      || participants.some(p => p.tokenId && (prev.tokens[p.tokenId]?.kind !== 'player' || p.id !== `pc-${p.tokenId}`))) {
      return fail(prev, 'Provide a title and unique valid player or NPC participants.');
    }
    if (prev.sceneEncounters?.[cmd.sceneId]?.status === 'active') return fail(prev, 'End the current encounter before starting another.');
    const state = structuredClone(prev);
    state.sceneEncounters = { ...(state.sceneEncounters ?? {}), [cmd.sceneId]: {
      id: cmd.encounterId, sceneId: cmd.sceneId, title: cmd.title.trim(), round: 1, turnIndex: 0, version: 1,
      status: 'active', participants: orderParticipants(participants.map(p => ({ ...p, name: p.name.trim() }))),
    } };
    return { ok: true as const, state };
  }

  const current = prev.sceneEncounters?.[cmd.sceneId];
  if (!current || current.id !== cmd.encounterId || current.status !== 'active') return fail(prev, 'This scene encounter is no longer active.');
  if (current.version !== cmd.expectedVersion) return fail(prev, 'The encounter changed. Refresh before acting.');
  const state = structuredClone(prev);
  const encounter = state.sceneEncounters![cmd.sceneId];
  const activeId = encounter.participants[encounter.turnIndex]?.id;
  if (cmd.type === 'sceneEncounterAdd') {
    if (!validParticipant(cmd.participant) || encounter.participants.length >= MAX_PARTICIPANTS || encounter.participants.some(p => p.id === cmd.participant.id)
      || (cmd.participant.tokenId && (state.tokens[cmd.participant.tokenId]?.kind !== 'player' || cmd.participant.id !== `pc-${cmd.participant.tokenId}`))) return fail(prev, 'The participant is invalid or already in this encounter.');
    encounter.participants = orderParticipants([...encounter.participants, { ...cmd.participant, name: cmd.participant.name.trim() }]);
    encounter.turnIndex = Math.max(0, encounter.participants.findIndex(p => p.id === activeId));
  } else if (cmd.type === 'sceneEncounterRemove') {
    if (!encounter.participants.some(p => p.id === cmd.participantId)) return fail(prev, 'Participant not found.');
    encounter.participants = encounter.participants.filter(p => p.id !== cmd.participantId);
    encounter.turnIndex = Math.max(0, encounter.participants.findIndex(p => p.id === activeId));
    if (!encounter.participants.length) encounter.turnIndex = 0;
  } else if (cmd.type === 'sceneEncounterInitiative') {
    if (!Number.isInteger(cmd.initiative) || cmd.initiative < -100 || cmd.initiative > 1000) return fail(prev, 'Initiative must be between -100 and 1000.');
    const participant = encounter.participants.find(p => p.id === cmd.participantId);
    if (!participant) return fail(prev, 'Participant not found.');
    participant.initiative = cmd.initiative;
    encounter.participants = orderParticipants(encounter.participants);
    encounter.turnIndex = Math.max(0, encounter.participants.findIndex(p => p.id === activeId));
  } else if (cmd.type === 'sceneEncounterVisibility') {
    const participant = encounter.participants.find(p => p.id === cmd.participantId);
    if (!participant || participant.tokenId) return fail(prev, 'Only NPC visibility can be changed here.');
    participant.visible = cmd.visible;
  } else if (cmd.type === 'sceneEncounterAdvance') {
    if (!encounter.participants.length) return fail(prev, 'Add a participant before advancing the turn.');
    encounter.turnIndex++;
    if (encounter.turnIndex >= encounter.participants.length) { encounter.turnIndex = 0; encounter.round++; }
  } else if (cmd.type === 'sceneEncounterEnd') {
    encounter.status = 'ended';
  }
  encounter.version++;
  return { ok: true as const, state };
}
