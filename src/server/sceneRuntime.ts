import { parseMap, type SceneMap } from '../campaign/maps.js';
import { emptySheet } from '../game/sheet.js';
import { npcPassivePerception, pcPassivePerception } from '../game/perception.js';
import type { AuthUser, Repo } from './repo.js';
import type { SceneCategory, SceneResult } from './scenes.js';
import { carriedLights, clockFor, figuresFor, fogMap, motionShape, movementFor, parseStoredSheet, sheetOf, visionFor, withArrivalSlots, type SceneFigure, type SceneViewContext, type ViewerMovement } from './sceneLocal.js';
import { ENEMY_TEMPLATES, enemiesOf, torchesOf, type CombatLogEntry } from '../game/sceneCombat.js';
import { reactionsOf, type ReactionOffer } from '../game/sceneActions.js';
import { fogString, sceneVision } from '../campaign/hexVision.js';
import { hexKey, hexesInRange } from '../game/hex.js';
import type { SceneClockState } from '../game/types.js';
import { initiativeForArrivals, placeArrivals, rememberCurrentVision } from './sceneTurns.js';

export interface SceneSnapshot {
  viewer?: { tokenId: string; name: string; color: string };
  kind: 'arena' | 'sanctuary' | 'scene'; assignmentRevision: number;
  scene?: { id: string; name: string; category: SceneCategory; revision: number; map: Omit<SceneMap, 'gmNotes'> };
  spawn?: { x: number; y: number };
  motion?: import('./sceneMotion.js').MotionSnapshot;
  travel?: import('./sceneTravel.js').TravelSnapshot;
  /** Scene-local time and light (battle/region). */
  clock?: SceneClockState;
  /** Player fog per hex: 'v' visible, 'e' remembered, '.' unknown (terrain of unknown hexes is not sent). */
  fog?: string;
  /** The viewer's movement budget (turn / free / day). */
  movement?: ViewerMovement;
  /** Other characters and enemies the viewer can see (players: only visible hexes). */
  figures?: SceneFigure[];
  /** Open reaction prompts this viewer decides (GM: all; player: their characters'). */
  reactions?: ReactionOffer[];
  /** APEX 1.3: the viewer's own characters: effects, concentration and readied action. */
  self?: Record<string, { effects: Array<{ id: string; name: string; key: string; note?: string }>; concentration?: string; readied?: { trigger: string; attackIndex?: number } }>;
  /** GM focus: movement left per character. */
  pcMovement?: Record<string, ViewerMovement>;
  /** GM vision mode the fog was computed for ('all' = no fog). */
  view?: string;
  /** Recent attacks on this scene. */
  combatLog?: CombatLogEntry[];
  /** The viewer carries a light. */
  torch?: boolean;
}
export interface SceneAssignment { user_id: string; scene_id: string | null; revision: number; spawn_x: number | null; spawn_y: number | null }
export interface RuntimeScene { id: string; name: string; category: SceneCategory; revision: number; is_legacy_arena: boolean; is_draft: boolean; archived: boolean; published_metadata: unknown }
export interface SceneRuntime {
  assignments(campaignId: string): Promise<SceneAssignment[]>;
  assignment(campaignId: string, userId: string): Promise<SceneAssignment | null>;
  scene(campaignId: string, id: string): Promise<RuntimeScene | null>;
  transition(user: AuthUser, sceneId: string | null, targets: { userId: string; revision: number }[], requestId: string): Promise<{ ok: boolean; error?: string }>;
}
export function publicMap(value: unknown): Omit<SceneMap, 'gmNotes'> | null {
  const map = parseMap(value); if (!map) return null;
  const { gmNotes: _private, ...rest } = map;
  const nodes = map.nodes.filter(n => n.visible && n.kind !== 'spawn').map(({ generatedBy: _provenance, ...n }) => ({ ...n, targetScene: null }));
  const ids = new Set(nodes.map(n => n.id));
  return { ...rest, backgroundAsset: map.playerBackgroundAsset, revealBackground: false, nodes, routes: map.routes.filter(r => r.visible && ids.has(r.from) && ids.has(r.to)) };
}
export async function sceneSnapshot(user: AuthUser, runtime?: SceneRuntime, motionStore?: import('./sceneMotion.js').SceneMotion, travelStore?: import('./sceneTravel.js').SceneTravel, ctx?: SceneViewContext): Promise<SceneSnapshot> {
  if (!runtime) return { kind: 'arena', assignmentRevision: 0 };
  const a = await runtime.assignment(user.campaignId, user.id);
  // The migration explicitly backfills existing memberships. Missing/new assignments are safe Sanctuary.
  if (!a) return { kind: 'sanctuary', assignmentRevision: 0 };
  if (!a.scene_id) return { kind: 'sanctuary', assignmentRevision: a.revision };
  const s = await runtime.scene(user.campaignId, a.scene_id);
  if (!s || s.archived || s.is_draft) return { kind: 'sanctuary', assignmentRevision: a.revision };
  if (s.is_legacy_arena) return { kind: 'arena', assignmentRevision: a.revision };
  const map = publicMap(s.published_metadata);
  if (!map) return { kind: 'sanctuary', assignmentRevision: a.revision };
  const full = parseMap(s.published_metadata)!;
  const local = ctx && motionStore && (s.category === 'battle' || s.category === 'region') ? await motionStore.localSnapshot(user.campaignId, s.id, user.id, user.tokenIds) : null;
  const motion = local ? motionShape(local, ctx!.state, s.id) : await motionStore?.snapshot(user.campaignId, s.id, user.id, user.tokenIds);
  let extra: Pick<SceneSnapshot, 'clock' | 'fog' | 'movement' | 'figures' | 'combatLog' | 'torch' | 'reactions' | 'self'> = {};
  if (local && ctx?.state) {
    const clock = clockFor(ctx.state, s.id);
    const pcs = ctx.pcs ? await ctx.pcs(s.id, full) : [];
    const positions = user.tokenIds.map(id => pcs.find(p => p.tokenId === id) ?? local.tokens.find(t => t.tokenId === id) ?? (a.spawn_x !== null && a.spawn_y !== null ? { tokenId: id, x: a.spawn_x, y: a.spawn_y } : null)).filter((p): p is { tokenId: string; x: number; y: number } => !!p);
    if (motion) for (const p of positions) if (!motion.tokens.some(t => t.tokenId === p.tokenId)) motion.tokens.push({ tokenId: p.tokenId, x: p.x, y: p.y, version: 0, tacticalSpent: 0, regionSpent: 0 });
    extra = { clock, combatLog: (ctx.state.sceneCombatLog?.[s.id] ?? []).slice(-8), torch: user.tokenIds.some(id => torchesOf(ctx.state!, s.id).includes(id)) };
    let visible: Set<string> | null = null;
    if (full.hex) {
      // Server-side fog: unknown hexes are removed from the map before it leaves the server.
      visible = await visionFor(ctx, full, clock, positions, carriedLights(ctx.state, s.id, pcs));
      const fogged = fogMap(full, visible, local.seen);
      if (fogged) { map.hex = fogged.hex; extra.fog = fogged.fog; }
    }
    // Allies and enemies only where the player can see them.
    // hidden enemies are only seen when one of the viewer's characters notices them (passive Perception)
    let passive = 0;
    for (const id of user.tokenIds) passive = Math.max(passive, pcPassivePerception(await sheetOf(ctx, id)));
    extra.figures = figuresFor(ctx.state, s.id, full, pcs, user.tokenIds, visible, false, { side: 'party', passive });
    extra.reactions = reactionsOf(ctx.state, s.id).filter((r) => r.reactor.kind === 'pc' && user.tokenIds.includes(r.reactor.id));
    extra.self = Object.fromEntries(user.tokenIds.map((id) => {
      const fxl = (ctx.state!.sceneEffects?.[s.id]?.[`pc-${id}`] ?? []).map((e) => ({ id: e.id, name: e.name, key: e.key }));
      const c = ctx.state!.sceneConcentration?.[s.id]?.[`pc-${id}`];
      const r = ctx.state!.sceneReadied?.[s.id]?.[`pc-${id}`];
      return [id, { effects: fxl, ...(c ? { concentration: c.spell } : {}), ...(r ? { readied: { trigger: r.trigger, attackIndex: r.attackIndex } } : {}) }];
    }));
    const tokenId = user.tokenIds.find(id => ctx.state!.tokens[id]);
    if (tokenId) extra.movement = movementFor(ctx.state, s.id, s.category as 'battle' | 'region', tokenId, user.role === 'gm', await sheetOf(ctx, tokenId), local);
  }
  if (motion) {
    const known = motion.known.filter(n => n.kind !== 'spawn').map(n => ({ ...n, targetScene: null, discoverable: false }));
    map.nodes = [...known.filter(n => !map.nodes.some(current => current.id === n.id)), ...map.nodes];
    const ids = new Set(map.nodes.map(n => n.id));
    map.routes = (parseMap(s.published_metadata)?.routes ?? []).filter(r => r.visible && ids.has(r.from) && ids.has(r.to));
  }
  const travel = s.category === 'world' ? await travelStore?.snapshot(user, s.id) : undefined;
  if (travel) { const known = new Set(map.nodes.map(n => n.id)); if (!known.has(travel.partyNode ?? '')) travel.partyNode = null; travel.proposals = travel.proposals.filter(p => known.has(p.from_node) && known.has(p.to_node)); }
  return { kind: 'scene', assignmentRevision: a.revision, scene: { id: s.id, name: s.name, category: s.category, revision: s.revision, map }, motion, travel, ...extra, ...(a.spawn_x !== null && a.spawn_y !== null ? { spawn: { x: a.spawn_x, y: a.spawn_y } } : {}) };
}

/** Game state + sheet loader for scene-local rules (vision, darkvision, speed, initiative). */
export async function sceneContext(repo: Repo, campaignId: string, state?: import('../game/types.js').GameState | null): Promise<SceneViewContext> {
  const s = state === undefined ? (await repo.loadState(campaignId))?.state ?? null : state;
  return {
    state: s,
    loadSheet: async (tokenId) => { const row = await repo.loadSheet(campaignId, tokenId); return row ? parseStoredSheet(row.data) : null; },
    pcs: async (sceneId, map) => {
      if (!repo.sceneRuntime) return [];
      const [assignments, profiles] = await Promise.all([repo.sceneRuntime.assignments(campaignId), repo.profiles(campaignId)]);
      const rows = assignments.filter(a => a.scene_id === sceneId).flatMap(a => {
        const p = profiles.find(x => x.userId === a.user_id && x.active && x.role === 'player');
        return p ? p.tokenIds.filter(id => !!s?.tokens[id]).map(id => ({ tokenId: id, userId: p.userId })) : [];
      });
      const local = rows.length && repo.sceneMotion ? await repo.sceneMotion.localSnapshot(campaignId, sceneId, rows[0].userId, rows.map(r => r.tokenId)) : { tokens: [] as Array<{ tokenId: string; x: number; y: number }> };
      const spawn = map.nodes.find(n => n.kind === 'spawn') ?? null;
      const stored = (id: string) => { const t = local.tokens.find(x => x.tokenId === id); return t ? { x: t.x, y: t.y } : undefined; };
      return withArrivalSlots(map, spawn, rows.map(r => ({ ...r, stored: stored(r.tokenId) })), s ? enemiesOf(s, sceneId).filter(e => !e.defeated) : []);
    },
  };
}

export async function runtimeRequest(user: AuthUser, method: string, query: Record<string, string | undefined>, body: unknown, repo: Repo): Promise<SceneResult> {
  if (!repo.sceneRuntime) return { status: 503, body: { error: 'Scene runtime unavailable.' } };
  if (method === 'GET') {
    if (user.role !== 'gm') return { status: 200, body: await sceneSnapshot(user, repo.sceneRuntime, repo.sceneMotion, repo.sceneTravel, await sceneContext(repo, user.campaignId)) };
    const profiles = (await repo.profiles(user.campaignId)).filter(p => p.active && p.role === 'player');
    if (query.focus) {
      if (!/^[0-9a-f-]{36}$/i.test(query.focus)) return { status: 400, body: { error: 'Invalid focus scene.' } };
      const focus = await repo.sceneRuntime.scene(user.campaignId, query.focus);
      // GM focus always uses the published revision. A private draft cannot accidentally
      // become live to players just because the GM opens the Map page.
      if (!focus || focus.is_legacy_arena || focus.archived || focus.is_draft) return { status: 404, body: { error: 'Published scene not found.' } };
      const map = parseMap(focus.published_metadata);
      if (!map) return { status: 404, body: { error: 'Published scene is unavailable.' } };
      const [assignments, profiles, stored] = await Promise.all([
        repo.sceneRuntime.assignments(user.campaignId),
        repo.profiles(user.campaignId),
        repo.loadState(user.campaignId),
      ]);
      const assignedProfiles = profiles.filter(p => p.active && p.role === 'player' && assignments.some(a => a.user_id === p.userId && a.scene_id === focus.id));
      const tokenIds = [...new Set(assignedProfiles.flatMap(p => p.tokenIds))].filter(id => !!stored?.state.tokens[id]).slice(0, 100);
      const local = tokenIds.length && repo.sceneMotion && (focus.category === 'battle' || focus.category === 'region')
        ? await repo.sceneMotion.localSnapshot(user.campaignId, focus.id, user.id, tokenIds) : null;
      const motion = local ? motionShape(local, stored?.state ?? null, focus.id) : tokenIds.length && repo.sceneMotion
        ? await repo.sceneMotion.snapshot(user.campaignId, focus.id, user.id, tokenIds)
        : undefined;
      const focusMap = { ...map, playerBackgroundAsset: map.backgroundAsset ?? map.playerBackgroundAsset };
      return { status: 200, body: {
        kind: 'scene', assignmentRevision: 0,
        scene: { id: focus.id, name: focus.name, category: focus.category, revision: focus.revision, map: focusMap },
        ...(motion ? { motion } : {}),
        clock: clockFor(stored?.state ?? null, focus.id),
        ...(stored && (focus.category === 'battle' || focus.category === 'region') ? await (async () => {
          const ctx = await sceneContext(repo, user.campaignId, stored.state);
          const pcs = await ctx.pcs!(focus.id, map);
          // GM vision modes: everything, the party's combined sight, the enemies' combined sight, or one figure's sight
          const view = typeof query.view === 'string' ? query.view.slice(0, 80) : 'all';
          let visible: Set<string> | null = null;
          let fog: string | undefined;
          if (map.hex && view !== 'all') {
            const npcs = enemiesOf(stored.state, focus.id).filter((e) => !e.defeated);
            const pcViewers = pcs.map((p) => ({ tokenId: p.tokenId, x: p.x, y: p.y }));
            const npcViewers = (side: 'enemy' | 'ally' | null, id?: string) => npcs.filter((e) => (id ? e.id === id : (e.side ?? 'enemy') === side)).map((e) => ({ at: { x: e.x, y: e.y }, darkvisionFt: e.darkvisionFt ?? ENEMY_TEMPLATES.find((t) => t.id === e.templateId)?.darkvisionFt ?? 0 }));
            const clock = clockFor(stored.state, focus.id);
            const lights = carriedLights(stored.state, focus.id, pcs);
            const partySight = async () => new Set([...await visionFor(ctx, map, clock, pcViewers, lights), ...sceneVision(map, clock, npcViewers('ally'), lights)]);
            const all = new Set(hexesInRange({ q: 0, r: 0 }, map.hex.radius).map(hexKey));
            // one figure: bright = it sees, grey = its side sees (could call out), dark = nobody on its side sees
            let side: Set<string> = all;
            if (view === 'party') visible = await partySight();
            else if (view === 'enemies') visible = sceneVision(map, clock, npcViewers('enemy'), lights);
            else if (view.startsWith('pc-')) { visible = await visionFor(ctx, map, clock, pcViewers.filter((p) => `pc-${p.tokenId}` === view), lights); side = await partySight(); }
            else {
              visible = sceneVision(map, clock, npcViewers(null, view), lights);
              const me = npcs.find((e) => e.id === view);
              side = me?.side === 'ally' ? await partySight() : sceneVision(map, clock, npcViewers('enemy'), lights);
            }
            fog = fogString(map.hex.radius, visible, side);
          }
          // group / figure views: hidden creatures of the other side only when the viewers notice them
          let notice: { side: 'party' | 'enemy'; passive: number } | undefined;
          if (view !== 'all') {
            const npcList = enemiesOf(stored.state, focus.id).filter((e) => !e.defeated);
            const pcPassive = async (ids: string[]) => { let m = 0; for (const id of ids) m = Math.max(m, pcPassivePerception(await sheetOf(ctx, id).catch(() => emptySheet()))); return m; };
            const npcPassive = (list: typeof npcList) => Math.max(0, ...list.map((e) => npcPassivePerception(stored.state, e)));
            if (view === 'party') notice = { side: 'party', passive: Math.max(await pcPassive(pcs.map((p) => p.tokenId)), npcPassive(npcList.filter((e) => e.side === 'ally'))) };
            else if (view === 'enemies') notice = { side: 'enemy', passive: npcPassive(npcList.filter((e) => (e.side ?? 'enemy') === 'enemy')) };
            else if (view.startsWith('pc-')) notice = { side: 'party', passive: await pcPassive([view.slice(3)]) };
            else { const me = npcList.find((e) => e.id === view); if (me) notice = { side: me.side === 'ally' ? 'party' : 'enemy', passive: npcPassivePerception(stored.state, me) }; }
          }
          const figures = figuresFor(stored.state, focus.id, map, pcs, [], visible, true, notice);
          // movement left of every character (GM acts for characters: reach area and budget)
          let pcMovement: Record<string, ViewerMovement> = {};
          try {
            if (local) pcMovement = Object.fromEntries(await Promise.all(pcs.map(async (p) => [p.tokenId, movementFor(stored.state, focus.id, focus.category as 'battle' | 'region', p.tokenId, true, await sheetOf(ctx, p.tokenId).catch(() => emptySheet()), local)] as const)));
          } catch { pcMovement = {}; }
          return { figures, ...(fog ? { fog, view } : {}), combatLog: (stored.state.sceneCombatLog?.[focus.id] ?? []).slice(-12), reactions: reactionsOf(stored.state, focus.id), pcMovement };
        })() : {}),
      } };
    }
    if (query.player) {
      const p = profiles.find(p => p.userId === query.player);
      if (!p) return { status: 404, body: { error: 'Player not found.' } };
      const snapshot = await sceneSnapshot({ ...user, id: p.userId, role: 'player', tokenIds: p.tokenIds }, repo.sceneRuntime, repo.sceneMotion, repo.sceneTravel, await sceneContext(repo, user.campaignId));
      const state = await repo.loadState(user.campaignId);
      const character = state?.state.tokens[p.tokenIds[0]];
      if (character) snapshot.viewer = { tokenId: character.id, name: character.name, color: character.color };
      return { status: 200, body: snapshot };
    }
    const [assignments, members] = await Promise.all([repo.sceneRuntime.assignments(user.campaignId), repo.members(user.campaignId)]);
    // Only campaign members can be assigned (apex_assign_scene joins apex_campaign_members). A player
    // profile that never signed in is listed, but marked so the GM is not offered a transfer that must fail.
    const players = profiles.slice(0, 100).map(p => { const a = assignments.find(a => a.user_id === p.userId); return { userId: p.userId, name: p.displayName, tokenIds: p.tokenIds, sceneId: a?.scene_id ?? null, revision: a?.revision ?? 0, inheritedArena: false, joined: members.some(m => m.userId === p.userId && m.role === 'player') }; });
    return { status: 200, body: { players } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can assign scenes.' } };
  const v = body as Record<string, unknown> | null;
  const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  if (!v || (v.sceneId !== null && !uuid(v.sceneId)) || !uuid(v.requestId) || !Array.isArray(v.targets) || !v.targets.length || v.targets.length > 100) return { status: 400, body: { error: 'Invalid transition.' } };
  const targets: { userId: string; revision: number }[] = [];
  for (const item of v.targets) {
    if (!item || typeof item !== 'object' || !uuid(item.userId) || !Number.isSafeInteger(item.revision) || item.revision < 0 || targets.some(t => t.userId === item.userId)) return { status: 400, body: { error: 'Invalid target revision.' } };
    targets.push({ userId: item.userId, revision: item.revision });
  }
  const result = await repo.sceneRuntime.transition(user, v.sceneId as string | null, targets, v.requestId);
  // Arriving on a battle map starts (or joins) initiative: order is rolled on the server.
  let initiative: string | undefined;
  if (result.ok && typeof v.sceneId === 'string') {
    const destination = await repo.sceneRuntime.scene(user.campaignId, v.sceneId);
    const crowded = destination && (destination.category === 'battle' || destination.category === 'region') ? await placeArrivals(user, repo, destination.id).catch(() => undefined) : undefined;
    if (destination?.category === 'battle' && !destination.is_legacy_arena) initiative = await initiativeForArrivals(user, repo, destination.id, targets.map(t => t.userId)).catch(() => 'Initiative could not be rolled – start it in Scene tools.');
    if (crowded) initiative = [initiative, crowded].filter(Boolean).join(' ');
    if (destination && (destination.category === 'battle' || destination.category === 'region')) await rememberCurrentVision(user, repo, destination.id).catch(() => undefined);
  }
  return { status: result.ok ? 200 : 409, body: { ...result, ...(initiative ? { initiative } : {}) } };
}
