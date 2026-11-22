/**
 * APEX 2.12 – downtime on the server (op `downtime`). The GM sends the party to camp (on the road) or home (each to
 * their own hideout) and back; players shape their hideout and move items between their pack and their chest.
 * Scene creation and moving players run as the GM profile (the database only lets the GM assign scenes).
 */
import type { AuthUser, Repo } from './repo.js';
import type { SceneResult } from './scenes.js';
import type { GameState } from '../game/types.js';
import { emptyMap, parseMap, type SceneMap } from '../campaign/maps.js';
import { decodeTiles, hexAt, newHexScene, paintHexes, type HexPreset } from '../campaign/hexScene.js';
import { sceneTemplate } from '../campaign/templates.js';
import { distance, hexKey, hexesInRange } from '../game/hex.js';
import {
  CAMP_KEEP, DEFAULT_KEEP, HIDEOUT_PRESETS, campPresetFor, downtimeOf, emptyDowntime, isHideoutPreset, parseKeep, stashPut, stashTake, stashUnworn,
  type DowntimeState, type Hideout, type Keepsake,
} from '../game/downtime.js';
import { recallAllTrials, update } from './obelisk.js';
import { placeArrivals } from './sceneTurns.js';

const err = (status: number, error: string): SceneResult => ({ status, body: { error } });
const rand32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** Keepsakes around where the player arrives: the campfire close, the rest in a ring. */
export function stampKeepsakes(map: SceneMap, keep: Keepsake[]): SceneMap {
  const spawn = map.nodes.find((n) => n.kind === 'spawn');
  if (!spawn || !map.hex) return map;
  const c = hexAt(map, spawn);
  const inside = new Set(hexesInRange({ q: 0, r: 0 }, map.hex.radius).map(hexKey));
  const ring = (d: number) => hexesInRange(c, d).filter((h) => distance(h, c) === d && inside.has(hexKey(h))).sort((a, b) => Math.atan2(a.r + a.q / 2, a.q) - Math.atan2(b.r + b.q / 2, b.q));
  const r1 = ring(1), r2 = ring(2);
  let hex = map.hex;
  let i = 0;
  for (const k of keep) {
    const h = k === 'campfire' && r1.length ? r1[0] : r2[(i++ * 5) % Math.max(1, r2.length)];
    if (h) hex = paintHexes(hex, [hexKey(h)], k);
  }
  return { ...map, hex };
}

/** A new battle map of a land, with the keepsakes. */
function landMap(preset: HexPreset, radius: number, keep: Keepsake[]): SceneMap {
  const seed = rand32();
  const base = sceneTemplate('hex-battle', 'battle', seed) ?? emptyMap('battle');
  return stampKeepsakes(newHexScene(base, preset, radius, seed, 'battle'), keep);
}

async function createScene(repo: Repo, cid: string, name: string, map: SceneMap): Promise<string | null> {
  const created = await repo.sceneCatalog!.create(cid, { category: 'battle', name: name.slice(0, 120) });
  const scene = await repo.sceneCatalog!.update(cid, created.id, created.revision, { metadata: map, is_draft: false, published_metadata: map, published_revision: 1 });
  return scene?.id ?? null;
}
async function publish(repo: Repo, cid: string, sceneId: string, map: SceneMap): Promise<boolean> {
  const sc = await repo.sceneCatalog!.get(cid, sceneId);
  if (!sc) return false;
  return !!(await repo.sceneCatalog!.update(cid, sceneId, sc.revision, { metadata: map, published_metadata: map }));
}

async function players(repo: Repo, cid: string) {
  const [profiles, assignments, members] = await Promise.all([repo.profiles(cid), repo.sceneRuntime!.assignments(cid), repo.members(cid)]);
  // only players who have joined the campaign can be moved (the database checks the membership)
  return profiles.filter((p) => p.active && p.role === 'player' && members.some((m) => m.userId === p.userId && m.role === 'player')).map((p) => ({ p, a: assignments.find((x) => x.user_id === p.userId) ?? null }));
}

export async function downtimeRequest(user: AuthUser, method: string, body: unknown, repo: Repo): Promise<SceneResult> {
  if (!repo.sceneCatalog || !repo.sceneRuntime) return err(503, 'Scenes are unavailable.');
  const cid = user.campaignId;
  const stored = await repo.loadState(cid);
  if (!stored) return err(409, 'The campaign has not been initialised yet.');
  const dt = downtimeOf(stored.state);
  if (method === 'GET') {
    if (user.role === 'gm') {
      const list = await players(repo, cid);
      return { status: 200, body: { ...dt, presets: HIDEOUT_PRESETS, players: list.map(({ p, a }) => ({ userId: p.userId, name: p.displayName, tokenIds: p.tokenIds, sceneId: a?.scene_id ?? null })) } };
    }
    const own = dt.hideouts[user.id];
    const sc = own ? await repo.sceneCatalog.get(cid, own.sceneId) : null;
    return { status: 200, body: { active: dt.active, mode: dt.mode, presets: HIDEOUT_PRESETS, hideout: own ? { ...own, map: sc?.published_metadata ?? null } : null, obeliskOpen: dt.active || !!stored.state.obelisk?.anytime } };
  }
  if (method !== 'POST') return err(405, 'Method not allowed.');
  const v = body as Record<string, unknown> | null;
  if (!v || typeof v.action !== 'string') return err(400, 'Invalid downtime action.');
  return user.role === 'gm' ? gmAction(user, repo, v, stored.state) : playerAction(user, repo, v, stored.state);
}

async function gmAction(gm: AuthUser, repo: Repo, v: Record<string, unknown>, state: GameState): Promise<SceneResult> {
  const cid = gm.campaignId, rt = repo.sceneRuntime!;
  const dt = downtimeOf(state);
  if (v.action === 'start') {
    if (v.mode !== 'road' && v.mode !== 'home') return err(400, 'Choose on the road or at home.');
    if (dt.active) return err(409, 'Downtime is already running – end it first.');
    const list = await players(repo, cid);
    if (!list.length) return err(409, 'No active player profiles.');
    const from: Record<string, string | null> = Object.fromEntries(list.map(({ p, a }) => [p.userId, a?.scene_id ?? null]));
    const next: DowntimeState = { ...emptyDowntime(), hideouts: { ...dt.hideouts }, active: true, mode: v.mode, since: new Date().toISOString(), from };
    const failed: string[] = [];
    if (v.mode === 'road') {
      // the land the party stopped in: the scene most of them stand on
      const counts = new Map<string, number>();
      for (const { a } of list) if (a?.scene_id) counts.set(a.scene_id, (counts.get(a.scene_id) ?? 0) + 1);
      const here = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
      const cur = here ? await rt.scene(cid, here) : null;
      const curMap = cur ? parseMap(cur.published_metadata) : null;
      const preset = curMap?.hex ? campPresetFor([...decodeTiles(curMap.hex).values()].map((t) => t.id)) : 'forest';
      const label = HIDEOUT_PRESETS.find((p) => p.id === preset)?.label ?? 'Wilds';
      const campId = await createScene(repo, cid, `Camp · ${label}`, landMap(preset, 9, CAMP_KEEP));
      if (!campId) return err(409, 'The camp could not be made.');
      next.campSceneId = campId;
      const moved = await rt.transition(gm, campId, list.map(({ p, a }) => ({ userId: p.userId, revision: a?.revision ?? 0 })), crypto.randomUUID());
      if (!moved.ok) return err(409, moved.error ?? 'The party could not be moved to the camp.');
      await placeArrivals(gm, repo, campId).catch(() => undefined);
    } else {
      for (const { p, a } of list) {
        let h = next.hideouts[p.userId];
        if (!h || !(await rt.scene(cid, h.sceneId))) {
          const preset: HexPreset = h?.preset ?? 'forest', keep = h?.keep ?? DEFAULT_KEEP;
          const id = await createScene(repo, cid, `Hideout · ${p.displayName}`, landMap(preset, 8, keep));
          if (!id) { failed.push(p.displayName); continue; }
          h = { sceneId: id, preset, keep, name: `Hideout · ${p.displayName}` };
          next.hideouts[p.userId] = h;
        }
        const moved = await rt.transition(gm, h.sceneId, [{ userId: p.userId, revision: a?.revision ?? 0 }], crypto.randomUUID());
        if (!moved.ok) failed.push(p.displayName);
        else await placeArrivals(gm, repo, h.sceneId).catch(() => undefined);
      }
    }
    const saved = await update(repo, cid, gm.id, (s) => { s.downtime = next; });
    if (!saved.ok) return err(409, saved.error);
    const where = v.mode === 'road' ? 'The party makes camp.' : 'Everyone travels home to their hideout.';
    return { status: 200, body: { ok: true, message: failed.length ? `${where} Not moved: ${failed.join(', ')}.` : where } };
  }
  if (v.action === 'end') {
    if (!dt.active) return err(409, 'There is no downtime to end.');
    if (v.sceneId !== undefined && v.sceneId !== null && (typeof v.sceneId !== 'string' || !(await rt.scene(cid, v.sceneId)))) return err(400, 'Unknown scene.');
    await recallAllTrials(gm, repo);
    const list = await players(repo, cid);
    const away = new Set([dt.campSceneId, ...Object.values(dt.hideouts).map((h) => h.sceneId)].filter(Boolean) as string[]);
    for (const { p, a } of list) {
      if (!a || !a.scene_id || !away.has(a.scene_id)) continue; // the GM moved them meanwhile
      const target = v.sceneId !== undefined ? (v.sceneId as string | null) : dt.from[p.userId] ?? null;
      const sc = target ? await rt.scene(cid, target) : null;
      const dest = sc && !sc.archived && !sc.is_draft ? sc.id : null;
      const moved = await rt.transition(gm, dest, [{ userId: p.userId, revision: a.revision }], crypto.randomUUID());
      if (moved.ok && dest) await placeArrivals(gm, repo, dest).catch(() => undefined);
    }
    if (dt.campSceneId) { const sc = await repo.sceneCatalog!.get(cid, dt.campSceneId); if (sc && !sc.archived) await repo.sceneCatalog!.update(cid, sc.id, sc.revision, { archived: true }).catch(() => null); }
    const saved = await update(repo, cid, gm.id, (s) => { s.downtime = { ...downtimeOf(s), active: false, from: {}, campSceneId: undefined }; });
    return saved.ok ? { status: 200, body: { ok: true, message: 'Downtime ends – back to the adventure.' } } : err(409, saved.error);
  }
  return err(400, 'Invalid downtime action.');
}

async function playerAction(user: AuthUser, repo: Repo, v: Record<string, unknown>, state: GameState): Promise<SceneResult> {
  const cid = user.campaignId;
  const dt = downtimeOf(state);
  // ---- the chest
  if (v.action === 'stashPut' || v.action === 'stashTake' || v.action === 'stashUnworn') {
    if (typeof v.tokenId !== 'string' || !user.tokenIds.includes(v.tokenId)) return err(403, 'This is not your character.');
    if (!dt.active && !state.obelisk?.anytime) return err(409, 'Your chest is at your camp or home – it opens during downtime.');
    if (v.action !== 'stashUnworn' && typeof v.itemId !== 'string') return err(400, 'Choose an item.');
    let n = 0;
    const r = await update(repo, cid, user.id, (_s, _ob, own) => {
      const t = own(v.tokenId as string);
      if (!t) return 'Character not found.';
      if (v.action === 'stashUnworn') { n = stashUnworn(t, new Set(Object.values(t.equipment?.slots ?? {}).filter(Boolean) as string[])); return; }
      return (v.action === 'stashPut' ? stashPut(t, v.itemId as string) : stashTake(t, v.itemId as string)) ?? undefined;
    });
    if (!r.ok) return err(409, r.error);
    return { status: 200, body: { ok: true, message: v.action === 'stashUnworn' ? `${n} item${n === 1 ? '' : 's'} put in the chest.` : v.action === 'stashPut' ? 'Put in the chest.' : 'Taken from the chest.' } };
  }
  // ---- the hideout (the player's own place)
  const own: Hideout | undefined = dt.hideouts[user.id];
  if (v.action === 'preset' || v.action === 'keep') {
    const preset = v.action === 'preset' ? v.preset : own?.preset ?? 'forest';
    const keep = v.action === 'keep' ? parseKeep(v.keep) : own?.keep ?? DEFAULT_KEEP;
    if (!isHideoutPreset(preset) || !keep) return err(400, 'Invalid hideout.');
    let sceneId = own?.sceneId && (await repo.sceneRuntime!.scene(cid, own.sceneId)) ? own.sceneId : null;
    let map: SceneMap;
    if (v.action === 'keep' && sceneId) {
      // the keepsakes move, the land stays as the player shaped it
      const sc = await repo.sceneCatalog!.get(cid, sceneId);
      const cur = parseMap(sc?.published_metadata) ?? landMap(preset, 8, []);
      map = stampKeepsakes(cur, keep);
    } else map = landMap(preset, 8, keep);
    if (sceneId) { if (!(await publish(repo, cid, sceneId, map))) return err(409, 'The hideout changed meanwhile. Try again.'); }
    else { sceneId = await createScene(repo, cid, `Hideout · ${user.displayName}`, map); if (!sceneId) return err(409, 'The hideout could not be made.'); }
    const h: Hideout = { sceneId, preset, keep, name: own?.name ?? `Hideout · ${user.displayName}` };
    const r = await update(repo, cid, user.id, (s) => { const d = downtimeOf(s); s.downtime = { ...d, hideouts: { ...d.hideouts, [user.id]: h } }; });
    return r.ok ? { status: 200, body: { ok: true, message: v.action === 'preset' ? 'Your hideout has a new land.' : 'Your hideout is arranged.' } } : err(409, r.error);
  }
  if (v.action === 'save') {
    if (!own) return err(409, 'Choose a land for your hideout first.');
    const map = parseMap(v.map);
    if (!map?.hex || map.unit !== 'feet') return err(400, 'Invalid hideout map.');
    const sc = await repo.sceneCatalog!.get(cid, own.sceneId);
    const before = parseMap(sc?.published_metadata);
    // the player shapes the land and its lights and labels – no enemies, no hidden GM notes, the arrival stays
    const spawn = map.nodes.find((n) => n.kind === 'spawn') ?? before?.nodes.find((n) => n.kind === 'spawn');
    if (!spawn) return err(400, 'The hideout needs an arrival point.');
    const clean: SceneMap = { ...map, gmNotes: '', nodes: [...map.nodes.filter((n) => n.kind !== 'enemies' && n.kind !== 'spawn'), spawn], backgroundAsset: null, playerBackgroundAsset: null };
    return (await publish(repo, cid, own.sceneId, clean)) ? { status: 200, body: { ok: true, message: 'Hideout saved.' } } : err(409, 'The hideout changed meanwhile. Reload it.');
  }
  return err(400, 'Invalid downtime action.');
}
