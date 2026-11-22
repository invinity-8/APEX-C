/**
 * APEX 2.11 – the Obelisk on the server (op `obelisk`). Players start a solo trial for their own character; the
 * server builds the fight with the same tools the GM uses (random encounter proposal → battle scene → enemies →
 * initiative → enemy AI) and moves the player there. The player's client then calls `tick`: the server checks the
 * outcome and, while the fight goes on, lets the enemy AI take one step. Scene actions that only the GM may take
 * (creating scenes, assigning players, placing and steering enemies) run as the campaign's GM profile – the player
 * never gets those rights for anything but their own trial.
 *
 * A trial does not touch campaign hit points, spell slots or timed effects: they are put back afterwards. A victory
 * opens two more tiers and drops loot; a death wipes the inventory (quest items and the Cube stay), alerts the GM and
 * waits for the player to accept the wipe.
 */
import type { AuthUser, Repo } from './repo.js';
import type { SceneResult } from './scenes.js';
import type { GameState, Token } from '../game/types.js';
import { emptyMap } from '../campaign/maps.js';
import { newHexScene } from '../campaign/hexScene.js';
import { sceneTemplate } from '../campaign/templates.js';
import { bestiary } from '../game/bestiary.js';
import { enemiesOf } from '../game/sceneCombat.js';
import { sheetLevel } from '../game/progression.js';
import { parseStoredSheet } from './sceneLocal.js';
import { placeArrivals, rememberCurrentVision, sceneTurnRequest } from './sceneTurns.js';
import {
  acceptWipe, afterClear, clampTier, emptyRecord, fightOutcome, freshSheet, MAX_KEYSTONES, OBELISK_MAX, obeliskLog, obeliskLoot, obeliskOf, obeliskProposal,
  recordDeath, recordOf, restoreLost, wipeInventory, type ObeliskRecord, type ObeliskRun, type ObeliskState, type SheetSnap,
} from '../game/obelisk.js';

const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x);
const rand32 = () => crypto.getRandomValues(new Uint32Array(1))[0];
const err = (status: number, error: string): SceneResult => ({ status, body: { error } });

/** The last outcome, shown to the player once. */
export interface ObeliskResult { outcome: 'victory' | 'defeat' | 'withdrawn' | 'recalled'; tier: number; at: string; loot?: string[]; lost?: number }
type RecordWithLast = ObeliskRecord & { last?: ObeliskResult };

/** The campaign's GM profile as an acting user (scene creation, assignment and the enemy AI need GM rights). */
async function gmActor(user: AuthUser, repo: Repo): Promise<AuthUser | null> {
  if (user.role === 'gm') return user;
  const gm = (await repo.profiles(user.campaignId)).find((p) => p.role === 'gm' && p.active);
  return gm ? { ...user, id: gm.userId, role: 'gm', profileKey: gm.key, displayName: gm.displayName, tokenIds: [] } : null;
}

/**
 * Optimistic state update of the Obelisk part (and the tokens `fn` touches – it clones them with `own`). `fn`
 * returns an error text to refuse. Retries when someone else wrote in between.
 */
async function update(repo: Repo, campaignId: string, by: string, fn: (s: GameState, ob: ObeliskState, own: (id: string) => Token) => string | void): Promise<{ ok: true; state: GameState } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const stored = await repo.loadState(campaignId);
    if (!stored) return { ok: false, error: 'The campaign has not been initialised yet.' };
    const s: GameState = { ...stored.state, tokens: { ...stored.state.tokens } };
    const ob: ObeliskState = structuredClone(obeliskOf(stored.state));
    const cloned = new Set<string>();
    const own = (id: string) => { if (!cloned.has(id)) { s.tokens[id] = structuredClone(s.tokens[id]); cloned.add(id); } return s.tokens[id]; };
    const refused = fn(s, ob, own);
    if (typeof refused === 'string') return { ok: false, error: refused };
    s.obelisk = ob;
    const v = await repo.saveState(campaignId, s, stored.version, by);
    if (v !== null) return { ok: true, state: s };
  }
  return { ok: false, error: 'The campaign changed at the same time. Please try again.' };
}

/** Sheet write with retries: `fn` gets the parsed sheet and returns the new one (or null to leave it). */
async function editSheet(repo: Repo, user: AuthUser, tokenId: string, fn: (s: ReturnType<typeof parseStoredSheet>) => ReturnType<typeof parseStoredSheet> | null): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await repo.loadSheet(user.campaignId, tokenId);
    const next = fn(parseStoredSheet(row?.data));
    if (!next) return true;
    if ((await repo.saveSheet(user.campaignId, tokenId, next, row?.version ?? 0, user.id)) !== null) return true;
  }
  return false;
}

const SCENE_KEYS = ['sceneEncounters', 'sceneClocks', 'sceneAi', 'sceneEnemies', 'sceneLights', 'sceneCombatLog', 'sceneFx', 'sceneAltitude', 'sceneReactions', 'sceneEffects', 'sceneConcentration', 'scenePendingHits', 'sceneReadied', 'scenePendingMoves'] as const;
/** Drops everything the trial's scene left in the shared state (enemies, effects, log …). */
function forgetScene(s: GameState, sceneId: string) {
  for (const k of SCENE_KEYS) {
    const m = s[k] as Record<string, unknown> | undefined;
    if (m && sceneId in m) { const { [sceneId]: _gone, ...rest } = m; (s as unknown as Record<string, unknown>)[k] = rest; }
  }
}

const publicRun = (r: ObeliskRun) => ({ id: r.id, tokenId: r.tokenId, tokenIds: r.tokenIds, tier: r.tier, sceneId: r.sceneId, startedAt: r.startedAt, name: r.name });
const playerRecord = (r: RecordWithLast) => ({ unlocked: r.unlocked, best: r.best, keystones: r.keystones, clears: r.clears, deaths: r.deaths, ...(r.wipe ? { wipe: r.wipe } : {}), ...(r.last ? { last: r.last } : {}) });

export async function obeliskRequest(user: AuthUser, method: string, body: unknown, repo: Repo): Promise<SceneResult> {
  if (method === 'GET') return status(user, repo);
  if (method !== 'POST') return err(405, 'Method not allowed.');
  const v = body as Record<string, unknown> | null;
  if (!v || typeof v.action !== 'string') return err(400, 'Invalid Obelisk action.');
  if (user.role === 'gm') return gmAction(user, repo, v);
  if (v.action === 'start') return start(user, repo, v);
  if (v.action === 'tick') return tick(user, repo);
  if (v.action === 'withdraw') return withdraw(user, repo);
  if (v.action === 'acceptWipe') {
    if (typeof v.tokenId !== 'string' || !user.tokenIds.includes(v.tokenId)) return err(403, 'This is not your character.');
    const r = await update(repo, user.campaignId, user.id, (_s, ob) => (acceptWipe(ob, v.tokenId as string) ? undefined : 'There is no inventory wipe to accept.'));
    return r.ok ? { status: 200, body: { ok: true, message: 'Inventory wipe accepted – the Obelisk awaits you again.' } } : err(409, r.error);
  }
  return err(400, 'Invalid Obelisk action.');
}

async function status(user: AuthUser, repo: Repo): Promise<SceneResult> {
  const stored = await repo.loadState(user.campaignId);
  if (!stored) return { status: 200, body: { characters: [], run: null, keystonesRequired: false } };
  const s = stored.state, ob = obeliskOf(s);
  const ids = user.role === 'gm' ? Object.values(s.tokens).filter((t) => t.kind === 'player').map((t) => t.id) : user.tokenIds.filter((id) => s.tokens[id]?.kind === 'player');
  const characters = await Promise.all(ids.slice(0, 40).map(async (id) => {
    const sheet = parseStoredSheet((await repo.loadSheet(user.campaignId, id).catch(() => null))?.data);
    const r = recordOf(s, id) as RecordWithLast;
    return { tokenId: id, name: s.tokens[id].name, level: sheetLevel(sheet), record: user.role === 'gm' ? r : playerRecord(r) };
  }));
  if (user.role === 'gm') return { status: 200, body: { keystonesRequired: !!ob.keystonesRequired, characters, runs: Object.values(ob.runs ?? {}).map(publicRun), alerts: ob.alerts ?? [], log: ob.log ?? [] } };
  const run = ob.runs?.[user.id];
  return { status: 200, body: { keystonesRequired: !!ob.keystonesRequired, characters, run: run ? publicRun(run) : null, max: OBELISK_MAX } };
}

async function start(user: AuthUser, repo: Repo, v: Record<string, unknown>): Promise<SceneResult> {
  if (user.role !== 'player') return err(403, 'Only players enter the Obelisk.');
  if (typeof v.tokenId !== 'string' || !user.tokenIds.includes(v.tokenId)) return err(403, 'This is not your character.');
  if (!Number.isSafeInteger(v.tier)) return err(400, 'Choose a tier.');
  const tier = clampTier(v.tier as number);
  if (!repo.sceneCatalog || !repo.sceneRuntime) return err(503, 'Scenes are unavailable.');
  const stored = await repo.loadState(user.campaignId);
  if (!stored) return err(409, 'The campaign has not been initialised yet.');
  const state = stored.state, ob = obeliskOf(state), token = state.tokens[v.tokenId];
  if (!token || token.kind !== 'player') return err(404, 'Character not found.');
  if (ob.runs?.[user.id]) return err(409, 'A trial is already running.');
  const rec = recordOf(state, token.id);
  if (rec.wipe) return err(409, 'Accept the inventory wipe first.');
  if (tier > rec.unlocked) return err(403, 'This tier is still sealed. Clear a lower one first.');
  if (ob.keystonesRequired && rec.keystones < 1) return err(409, 'The Obelisk asks for a keystone. Ask your GM for one.');
  const gm = await gmActor(user, repo);
  if (!gm) return err(503, 'The campaign has no active GM profile.');
  const a = await repo.sceneRuntime.assignment(user.campaignId, user.id);
  const prevSceneId = a?.scene_id ?? null;
  const tokens = user.tokenIds.filter((id) => state.tokens[id]?.kind === 'player');
  if (prevSceneId) {
    const e = state.sceneEncounters?.[prevSceneId];
    if (e?.status === 'active' && e.participants.some((p) => tokens.some((id) => p.tokenId === id || p.id === `pc-${id}`))) return err(409, 'Finish the fight you are in first.');
  }
  const sheets = await Promise.all(tokens.map(async (id) => parseStoredSheet((await repo.loadSheet(user.campaignId, id))?.data)));
  if (sheets.some((s) => !s.hitPoints || s.hitPoints.max <= 0)) return err(409, 'Your character sheet needs hit points before you can enter the Obelisk.');

  // ---- the fight: proposal → scene → enemies → AI
  const seed = rand32();
  const proposal = obeliskProposal(tier, tokens.length, seed, bestiary(state));
  const name = `Obelisk · Tier ${tier} · ${token.name}`.slice(0, 120);
  const created = await repo.sceneCatalog.create(user.campaignId, { category: 'battle', name });
  const base = sceneTemplate('hex-battle', 'battle', seed) ?? emptyMap('battle');
  const map = newHexScene(base, proposal.site, proposal.radius, (seed ^ 0x5bd1e995) >>> 0, 'battle');
  const scene = await repo.sceneCatalog.update(user.campaignId, created.id, created.revision, { metadata: map, is_draft: false, published_metadata: map, published_revision: 1 });
  if (!scene) return err(409, 'The trial could not be prepared. Please try again.');
  const sceneId = scene.id;
  const scrap = async () => { const s2 = await repo.sceneCatalog!.get(user.campaignId, sceneId); if (s2) await repo.sceneCatalog!.update(user.campaignId, sceneId, s2.revision, { archived: true }).catch(() => null); };
  const placed = await sceneTurnRequest(gm, 'POST', { sceneId, action: 'encounter', op: 'apply', situation: proposal.situation, seed, entries: proposal.plan.entries.map((e) => ({ templateId: e.templateId, side: 'enemy' })) }, repo);
  if (placed.status !== 200) { await scrap(); return err(409, (placed.body as { error?: string }).error ?? 'The enemies could not be placed.'); }
  await sceneTurnRequest(gm, 'POST', { sceneId, action: 'ai', on: true }, repo);
  // the Obelisk's creatures fight until they fall (a lone foe would otherwise break and run at once)
  await update(repo, user.campaignId, gm.id, (s) => { s.sceneEnemies = { ...(s.sceneEnemies ?? {}), [sceneId]: (s.sceneEnemies?.[sceneId] ?? []).map((e) => ({ ...e, fearless: true })) }; });

  // ---- the run (and the keystone) before the player moves: a failed move takes it back
  const run: ObeliskRun = { id: crypto.randomUUID(), userId: user.id, tokenId: token.id, tokenIds: tokens, tier, sceneId, prevSceneId, startedAt: new Date().toISOString(), name: proposal.name, snapshot: {} };
  sheets.forEach((sh, i) => { const snap: SheetSnap = { hitPoints: sh.hitPoints, resources: sh.resources, spellEffects: sh.spellEffects, ...(sh.wildShape ? { wildShape: sh.wildShape } : {}) }; run.snapshot[tokens[i]] = structuredClone(snap); });
  const saved = await update(repo, user.campaignId, user.id, (_s, o) => {
    if (o.runs?.[user.id]) return 'A trial is already running.';
    const r = { ...emptyRecord(), ...(o.records[token.id] ?? {}) };
    if (o.keystonesRequired) { if (r.keystones < 1) return 'The Obelisk asks for a keystone.'; r.keystones -= 1; }
    o.records[token.id] = r;
    o.runs = { ...(o.runs ?? {}), [user.id]: run };
    obeliskLog(o, run.startedAt, `${token.name} enters the Obelisk – tier ${tier} (${proposal.name}).`);
  });
  if (!saved.ok) { await scrap(); return err(409, saved.error); }
  // full strength for the trial (the campaign values come back afterwards)
  for (const id of tokens) await editSheet(repo, user, id, (s) => { const f = freshSheet(s); const { wildShape: _w, ...rest } = f; return { ...rest, spellEffects: [] }; });
  const moved = await repo.sceneRuntime.transition(gm, sceneId, [{ userId: user.id, revision: a?.revision ?? 0 }], crypto.randomUUID());
  if (!moved.ok) {
    await finish(gm, repo, run, 'recalled', false);
    return err(409, moved.error ?? 'You could not be moved to the Obelisk.');
  }
  await placeArrivals(gm, repo, sceneId).catch(() => undefined);
  // a fresh fight: everybody rolls – the hero and every enemy on the map
  const rolled = await sceneTurnRequest(gm, 'POST', { sceneId, action: 'startInitiative' }, repo).catch(() => null);
  const init = (rolled?.body as { message?: string } | undefined)?.message;
  await rememberCurrentVision(gm, repo, sceneId).catch(() => undefined);
  return { status: 200, body: { ok: true, run: publicRun(run), message: `The Obelisk awakens: ${proposal.name}. ${init ?? ''}`.trim() } };
}

/** One beat of a trial: the outcome, or one step of the enemy AI. */
async function tick(user: AuthUser, repo: Repo): Promise<SceneResult> {
  const stored = await repo.loadState(user.campaignId);
  const run = stored ? obeliskOf(stored.state).runs?.[user.id] : undefined;
  if (!stored || !run) return { status: 200, body: { run: null } };
  const gm = await gmActor(user, repo);
  if (!gm || !repo.sceneRuntime) return err(503, 'The campaign has no active GM profile.');
  const a = await repo.sceneRuntime.assignment(user.campaignId, user.id);
  if (a?.scene_id !== run.sceneId) return finish(gm, repo, run, 'recalled', false);
  const heroes = await Promise.all(run.tokenIds.map(async (id) => { const sh = parseStoredSheet((await repo.loadSheet(user.campaignId, id))?.data); return { current: sh.hitPoints?.current ?? 0, wildShape: !!sh.wildShape }; }));
  const outcome = fightOutcome({ foes: enemiesOf(stored.state, run.sceneId), heroes });
  if (outcome) return finish(gm, repo, run, outcome, true);
  // the fight goes on: initiative must run, then the AI takes a step
  if (stored.state.sceneEncounters?.[run.sceneId]?.status !== 'active') await sceneTurnRequest(gm, 'POST', { sceneId: run.sceneId, action: 'startInitiative' }, repo);
  if (!stored.state.sceneAi?.[run.sceneId]?.on) await sceneTurnRequest(gm, 'POST', { sceneId: run.sceneId, action: 'ai', on: true }, repo);
  const r = await sceneTurnRequest(gm, 'POST', { sceneId: run.sceneId, action: 'aiStep' }, repo);
  const b = (r.body ?? {}) as { message?: string; ai?: { idle?: boolean; wait?: boolean; step?: string; done?: boolean } };
  // the hidden morale rolls stay with the GM
  return { status: 200, body: { run: publicRun(run), ...(b.message ? { message: b.message } : {}), ai: b.ai ? { idle: !!b.ai.idle, wait: !!b.ai.wait, step: b.ai.step, done: !!b.ai.done } : { idle: true } } };
}

/** The player leaves a trial – only while every hero still stands strong (above half their hit points). */
async function withdraw(user: AuthUser, repo: Repo): Promise<SceneResult> {
  const stored = await repo.loadState(user.campaignId);
  const run = stored ? obeliskOf(stored.state).runs?.[user.id] : undefined;
  if (!run) return err(409, 'You are not in a trial.');
  const gm = await gmActor(user, repo);
  if (!gm) return err(503, 'The campaign has no active GM profile.');
  for (const id of run.tokenIds) {
    const hp = parseStoredSheet((await repo.loadSheet(user.campaignId, id))?.data).hitPoints;
    if (hp && hp.current * 2 <= hp.max) return err(409, 'Too late to withdraw – the Obelisk only lets go of those who still stand strong (above half their hit points).');
  }
  return finish(gm, repo, run, 'withdrawn', true);
}

/**
 * Ends a trial: initiative off, campaign values back on the sheets, the reward or the wipe, the player back where
 * they were (when the trial still holds them), the scene archived and forgotten.
 */
async function finish(gm: AuthUser, repo: Repo, run: ObeliskRun, how: 'victory' | 'defeat' | 'withdrawn' | 'recalled', moveBack: boolean): Promise<SceneResult> {
  const cid = gm.campaignId, at = new Date().toISOString();
  await sceneTurnRequest(gm, 'POST', { sceneId: run.sceneId, action: 'endInitiative' }, repo).catch(() => undefined);
  for (const id of run.tokenIds) {
    const snap = run.snapshot[id];
    if (snap) await editSheet(repo, gm, id, (s) => { const { wildShape: _w, ...rest } = s; return { ...rest, ...structuredClone(snap) }; });
  }
  let loot: string[] = [], lost = 0, text = '';
  const day = (await repo.loadState(cid))?.state.day ?? 1;
  const seed = rand32();
  const done = await update(repo, cid, gm.id, (s, ob, own) => {
    if (ob.runs?.[run.userId]?.id !== run.id) return 'This trial has already ended.';
    const { [run.userId]: _ended, ...runs } = ob.runs ?? {};
    ob.runs = runs;
    loot = []; lost = 0;
    const lead = s.tokens[run.tokenId];
    const leadName = lead?.name ?? 'A hero';
    if (how === 'victory') {
      ob.records[run.tokenId] = afterClear({ ...emptyRecord(), ...(ob.records[run.tokenId] ?? {}) }, run.tier);
      run.tokenIds.forEach((id, i) => { if (s.tokens[id]) loot.push(...obeliskLoot(own(id), run.tier, (seed + i * 0x85ebca6b) >>> 0, day, `${run.id}${i}`)); });
      text = `${leadName} clears tier ${run.tier} of the Obelisk${loot.length ? ` – loot: ${loot.join(', ')}` : ''}.`;
    } else if (how === 'defeat') {
      for (const id of run.tokenIds) {
        if (!s.tokens[id]) continue;
        const t = own(id);
        const items = wipeInventory(t);
        lost += items.length;
        recordDeath(ob, t, run.tier, items, at, crypto.randomUUID());
      }
      text = `${leadName} falls at tier ${run.tier} of the Obelisk – the inventory is lost (${lost} item${lost === 1 ? '' : 's'}).`;
    } else text = how === 'withdrawn' ? `${leadName} withdraws from tier ${run.tier} of the Obelisk.` : `${leadName} is called back from tier ${run.tier} of the Obelisk.`;
    const r = (ob.records[run.tokenId] ?? emptyRecord()) as RecordWithLast;
    ob.records[run.tokenId] = { ...r, last: { outcome: how, tier: run.tier, at, ...(loot.length ? { loot } : {}), ...(how === 'defeat' ? { lost } : {}) } } as RecordWithLast;
    obeliskLog(ob, at, text);
    forgetScene(s, run.sceneId);
  });
  if (!done.ok) return err(409, done.error);
  // back where the player was – unless someone else (the GM) has moved them already
  if (repo.sceneRuntime) {
    const a = await repo.sceneRuntime.assignment(cid, run.userId);
    if (a?.scene_id === run.sceneId) {
      const prev = run.prevSceneId ? await repo.sceneRuntime.scene(cid, run.prevSceneId) : null;
      const target = prev && !prev.archived && !prev.is_draft ? prev.id : null;
      let back = await repo.sceneRuntime.transition(gm, target, [{ userId: run.userId, revision: a.revision }], crypto.randomUUID());
      if (!back.ok && target) back = await repo.sceneRuntime.transition(gm, null, [{ userId: run.userId, revision: a.revision }], crypto.randomUUID());
      if (back.ok && target && moveBack) await placeArrivals(gm, repo, target).catch(() => undefined);
    }
  }
  const sc = await repo.sceneCatalog?.get(cid, run.sceneId);
  if (sc && !sc.archived) await repo.sceneCatalog!.update(cid, run.sceneId, sc.revision, { archived: true }).catch(() => null);
  return { status: 200, body: { ok: true, run: null, outcome: how, tier: run.tier, ...(loot.length ? { loot } : {}), ...(how === 'defeat' ? { lost } : {}), message: text } };
}

async function gmAction(user: AuthUser, repo: Repo, v: Record<string, unknown>): Promise<SceneResult> {
  const say = (r: Awaited<ReturnType<typeof update>>, message: string): SceneResult => (r.ok ? { status: 200, body: { ok: true, message } } : err(409, r.error));
  const player = (s: GameState, id: unknown) => (typeof id === 'string' && s.tokens[id]?.kind === 'player' ? s.tokens[id] : null);
  switch (v.action) {
    case 'required':
      if (typeof v.on !== 'boolean') return err(400, 'Invalid setting.');
      return say(await update(repo, user.campaignId, user.id, (_s, ob) => { ob.keystonesRequired = v.on as boolean; }), v.on ? 'A trial now costs one keystone.' : 'Trials are free – keystones are kept as a resource.');
    case 'keystones': {
      if (!Number.isSafeInteger(v.delta) || Math.abs(v.delta as number) > MAX_KEYSTONES) return err(400, 'Invalid amount.');
      let name = '';
      const r = await update(repo, user.campaignId, user.id, (s, ob) => {
        const t = player(s, v.tokenId); if (!t) return 'Character not found.';
        name = t.name;
        const rec = { ...emptyRecord(), ...(ob.records[t.id] ?? {}) };
        ob.records[t.id] = { ...rec, keystones: Math.max(0, Math.min(MAX_KEYSTONES, rec.keystones + (v.delta as number))) };
      });
      return say(r, `${name}: ${(v.delta as number) >= 0 ? '+' : ''}${v.delta} keystone${Math.abs(v.delta as number) === 1 ? '' : 's'}.`);
    }
    case 'unlock': {
      if (!Number.isSafeInteger(v.unlocked)) return err(400, 'Invalid tier.');
      const r = await update(repo, user.campaignId, user.id, (s, ob) => {
        const t = player(s, v.tokenId); if (!t) return 'Character not found.';
        ob.records[t.id] = { ...emptyRecord(), ...(ob.records[t.id] ?? {}), unlocked: clampTier(v.unlocked as number) };
      });
      return say(r, `Tiers up to ${clampTier(v.unlocked as number)} are open.`);
    }
    case 'restore': {
      if (!uuid(v.lossId) || (v.itemId !== null && typeof v.itemId !== 'string')) return err(400, 'Invalid item.');
      let name = '';
      const r = await update(repo, user.campaignId, user.id, (s, ob, own) => {
        const t = player(s, v.tokenId); if (!t) return 'Character not found.';
        name = t.name;
        return restoreLost(ob, own(t.id), v.lossId as string, v.itemId as string | null) ?? undefined;
      });
      return say(r, v.itemId ? `Item given back to ${name}.` : `Everything given back to ${name}.`);
    }
    case 'dismiss':
      return say(await update(repo, user.campaignId, user.id, (_s, ob) => { ob.alerts = typeof v.id === 'string' ? (ob.alerts ?? []).filter((x) => x.id !== v.id) : []; }), 'Alert dismissed.');
    case 'end': {
      const stored = await repo.loadState(user.campaignId);
      const run = stored && typeof v.userId === 'string' ? obeliskOf(stored.state).runs?.[v.userId] : undefined;
      if (!run) return err(404, 'No such trial.');
      return finish(user, repo, run, 'recalled', true);
    }
  }
  return err(400, 'Invalid Obelisk action.');
}
