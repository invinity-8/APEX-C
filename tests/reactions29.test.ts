/** APEX 2.9: reaction settings per character – always / ask / never / only with spell slots. */
import { describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { executeCommand } from '../src/game/commands';
import { offerFor, parseReactionPref } from '../src/game/reactionPrefs';
import { enemiesOf } from '../src/game/sceneCombat';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload } from '../src/server/protocol';
import type { SceneSnapshot } from '../src/server/sceneRuntime';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

describe('reaction settings', () => {
  it('modes: ask, always, never, only with one or two slots', () => {
    expect(offerFor(undefined, 'opportunity')).toBe('ask');
    expect(offerFor({ opportunity: 'auto' }, 'opportunity')).toBe('auto');
    expect(offerFor({ opportunity: 'never' }, 'opportunity')).toBe('skip');
    expect(offerFor({ shield: 'askIfSlot' }, 'shield', 0)).toBe('skip');
    expect(offerFor({ shield: 'askIfSlot' }, 'shield', 1)).toBe('ask');
    expect(offerFor({ shield: 'askIf2Slots' }, 'shield', 1)).toBe('skip');
    expect(offerFor({ shield: 'askIf2Slots' }, 'shield', 2)).toBe('ask');
    expect(parseReactionPref('opportunity', 'askIfSlot')).toBeNull(); // slot conditions only for spells
    expect(parseReactionPref('shield', 'askIf2Slots')).toEqual({ kind: 'shield', mode: 'askIf2Slots' });
  });
  it('a player sets them for their own character only; "ask" clears the setting', () => {
    const s = createDemoState({ radius: 8, seed: 1 });
    const mine = Object.values(s.tokens).find((t) => t.kind === 'player')!;
    const other = Object.values(s.tokens).find((t) => t.kind === 'player' && t.id !== mine.id)!;
    const r = executeCommand(s, { role: 'player', tokenId: mine.id }, { type: 'setReactionPref', tokenId: mine.id, kind: 'shield', mode: 'askIf2Slots' });
    expect(r.ok && r.state.tokens[mine.id].reactionPrefs).toEqual({ shield: 'askIf2Slots' });
    expect(executeCommand(s, { role: 'player', tokenId: mine.id }, { type: 'setReactionPref', tokenId: other.id, kind: 'shield', mode: 'never' }).ok).toBe(false);
    const back = r.ok ? executeCommand(r.state, { role: 'gm' }, { type: 'setReactionPref', tokenId: mine.id, kind: 'shield', mode: 'ask' }) : r;
    expect(back.ok && back.state.tokens[mine.id].reactionPrefs).toBeUndefined();
  });
});

describe('API: "never" leaves the opportunity attack out', () => {
  it('ask: the goblin’s move pauses for Sinna; never: it walks on', async () => {
    const cid = 'campaign-react29';
    resetSchemaCache(); const repo = new MemoryRepo(); const cookies: Record<string, string> = {};
    const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
      handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.25', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' }); seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah']) { await activate(repo, cid, key, `${key}-test-password`); cookies[key] = (await request(key, 'login', { profile: key, password: `${key}-test-password` })).cookies![0].split(';')[0]; }
    const created = (await request('gm', 'scenes', { name: 'Fight', category: 'battle', template: 'hex-battle' })).body as { scene: SceneDefinition };
    const meta = created.scene.metadata as unknown as SceneMap;
    const m: SceneMap = { ...meta, hex: { ...meta.hex!, terrain: 'S'.repeat(meta.hex!.terrain.length) } };
    const scene = ((await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: m })).body as { scene: SceneDefinition }).scene;
    const user = repo.profileList.find((p) => p.key === 'hannah')!;
    const ps = ((await request('gm', 'scene-runtime')).body as { players: Array<{ userId: string; revision: number }> }).players;
    await request('gm', 'scene-runtime', { sceneId: scene.id, targets: [ps.find((p) => p.userId === user.userId)!], requestId: crypto.randomUUID() });
    const sinna = user.tokenIds[0];
    const me = ((await request('hannah', 'state')).body as PlayerPayload).scene!.motion!.tokens.find((t) => t.tokenId === sinna)!;
    const step = Math.sqrt(3) * 30;
    const turn = (body: Record<string, unknown>, who = 'gm') => request(who, 'scene-turn', { sceneId: scene.id, ...body });
    expect((await turn({ action: 'enemyAdd', templateId: 'goblin', x: me.x + step, y: me.y })).status).toBe(200);
    expect((await turn({ action: 'startInitiative' })).status).toBe(200);
    const st = () => repo.states.get(cid)!.state;
    const goblin = enemiesOf(st(), scene.id)[0];
    const goblinsTurn = () => { const e = st().sceneEncounters![scene.id]; e.turnIndex = e.participants.findIndex((p) => p.id === `npc-${goblin.id}`); e.turnSerial = (e.turnSerial ?? 0) + 1; e.economy = {}; e.reactions = {}; };
    const offers = async () => ((await request('gm', 'scene-runtime', undefined, { focus: scene.id })).body as SceneSnapshot).reactions ?? [];
    // ask (default): the move stops and Sinna is offered an opportunity attack
    goblinsTurn();
    expect((await turn({ action: 'enemyMove', id: goblin.id, x: me.x + 4 * step, y: me.y })).status).toBe(200);
    expect((await offers()).map((o) => o.reactor.name)).toEqual(['Sinna']);
    await turn({ action: 'reaction', offerId: (await offers())[0].id, accept: false }, 'hannah');
    // back next to Sinna; she says "never": the goblin walks away without a pause
    const g = enemiesOf(st(), scene.id)[0]; Object.assign(g, { x: me.x + step, y: me.y });
    const cmd = await request('hannah', 'command', { campaignId: cid, requestId: crypto.randomUUID(), command: { type: 'setReactionPref', tokenId: sinna, kind: 'opportunity', mode: 'never' } });
    expect(cmd.status, JSON.stringify(cmd.body)).toBe(200);
    expect(st().tokens[sinna].reactionPrefs).toEqual({ opportunity: 'never' });
    goblinsTurn();
    expect((await turn({ action: 'enemyMove', id: goblin.id, x: me.x + 4 * step, y: me.y })).status).toBe(200);
    expect(await offers()).toEqual([]);
    expect(Math.round(enemiesOf(st(), scene.id)[0].x)).toBe(Math.round(me.x + 4 * step));
  });
});
