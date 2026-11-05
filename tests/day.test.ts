import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/game/commands';
import { createDemoState } from '../src/data/demo';
import { zoneStatus } from '../src/game/zone';
import { buildPlayerView } from '../src/game/visibility';
import { migrateState } from '../src/game/migrate';
import { flatState } from './helpers';

const GM = { role: 'gm' } as const;

describe('Day & night cycle', () => {
  it('runs Day 1 → Night 1 → Day 2 → Night 2 → Day 3', () => {
    let s = flatState();
    const seen: string[] = [`${s.phase} ${s.day}`];
    for (let i = 0; i < 4; i++) {
      s = executeCommand(s, GM, { type: 'advancePhase' }).state;
      seen.push(`${s.phase} ${s.day}`);
    }
    expect(seen).toEqual(['day 1', 'night 1', 'day 2', 'night 2', 'day 3']);
  });

  it('movement points are restored at dawn only, not at nightfall', () => {
    let s = flatState();
    s = executeCommand(s, GM, { type: 'move', tokenId: 'sinna', to: { q: 3, r: 0 } }).state;
    expect(s.tokens.sinna.movePoints).toBe(5);
    s = executeCommand(s, GM, { type: 'advancePhase' }).state; // Night 1
    expect(s.tokens.sinna.movePoints).toBe(5);
    s = executeCommand(s, GM, { type: 'advancePhase' }).state; // Day 2
    expect(s.tokens.sinna.movePoints).toBe(8);
    expect(s.log.some((e) => e.kind === 'day' && e.text.includes('Day 2') && e.phase === 'day')).toBe(true);
    expect(s.log.some((e) => e.text.includes('Night 1') && e.phase === 'night')).toBe(true);
  });

  it('"end day" skips to the next dawn (through the night)', () => {
    let s = flatState();
    s = executeCommand(s, GM, { type: 'endDay' }).state;
    expect(s.day).toBe(2);
    expect(s.phase).toBe('day');
  });

  it('night reduces vision by one (but never below 1)', () => {
    let s = flatState(8);
    for (const t of Object.values(s.tokens)) t.sharesWithParty = false;
    const dayVisible = buildPlayerView(s, 'sinna').hexes.filter((h) => h.fog === 'visible').length;
    expect(dayVisible).toBe(19); // radius 2
    s = executeCommand(s, GM, { type: 'advancePhase' }).state;
    const nightVisible = buildPlayerView(s, 'sinna').hexes.filter((h) => h.fog === 'visible').length;
    expect(nightVisible).toBe(7); // radius 1
    expect(buildPlayerView(s, 'sinna').phase).toBe('night');
  });

  it('the temporary vision bonus expires at dawn', () => {
    let s = flatState();
    s = executeCommand(s, GM, { type: 'adjustVisionBonus', tokenId: 'elwin', delta: 2 }).state;
    s = executeCommand(s, GM, { type: 'advancePhase' }).state;
    expect(s.tokens.elwin.visionBonus).toBe(2); // still active during the night
    s = executeCommand(s, GM, { type: 'advancePhase' }).state;
    expect(s.tokens.elwin.visionBonus).toBe(0);
  });

  it('day-bound events become due at dawn but wait for GM approval (no effect before)', () => {
    let s = createDemoState({ radius: 12 });
    const floodKey = s.events.flood.hexes[0];
    const terrainBefore = s.hexes[floodKey].terrain;
    expect(terrainBefore).not.toBe('water');
    s = executeCommand(s, GM, { type: 'advancePhase' }).state; // Night 1
    expect(s.events.flood.status).toBe('pending');
    s = executeCommand(s, GM, { type: 'advancePhase' }).state; // Day 2
    expect(s.events.flood.status).toBe('awaiting');
    expect(s.events.flood.dueAt).toEqual({ day: 2, phase: 'day' });
    expect(s.hexes[floodKey].terrain).toBe(terrainBefore); // NOT applied
    expect(buildPlayerView(s, 'sinna').log.some((l) => /Aqueduct/.test(l.text))).toBe(false); // players learn nothing yet
    // the GM approves → applied exactly once
    s = executeCommand(s, GM, { type: 'decideEvent', eventId: 'flood', decision: 'approve' }).state;
    expect(s.events.flood.status).toBe('done');
    expect(s.hexes[floodKey].terrain).toBe('water');
    expect(executeCommand(s, GM, { type: 'decideEvent', eventId: 'flood', decision: 'approve' }).ok).toBe(false);
    // the next dawn event is again only prepared
    s = executeCommand(s, GM, { type: 'endDay' }).state; // Day 3
    expect(s.events.reveal?.status ?? Object.values(s.events).find((e) => e.effects.some((x) => x.type === 'revealSite'))?.status).toBe('awaiting');
    expect(s.sites['donum-imperatoris'].visibility).not.toBe('public');
  });

  it('phase-bound events become due when that phase begins; rejected events never apply', () => {
    let s = flatState();
    s.events.willstorm.trigger = { type: 'phase', day: 1, phase: 'night' };
    s = executeCommand(s, GM, { type: 'advancePhase' }).state;
    expect(s.events.willstorm.status).toBe('awaiting');
    expect(s.tokens.sinna.movePoints).toBe(8);
    s = executeCommand(s, GM, { type: 'decideEvent', eventId: 'willstorm', decision: 'reject' }).state;
    expect(s.events.willstorm.status).toBe('rejected');
    expect(s.tokens.sinna.movePoints).toBe(8);
    expect(executeCommand(s, GM, { type: 'triggerEvent', eventId: 'willstorm' }).ok).toBe(false);
    // advancing time does not regenerate it
    s = executeCommand(s, GM, { type: 'advancePhase' }).state;
    expect(s.events.willstorm.status).toBe('rejected');
  });

  it('postponed events become due again at the next phase; awaiting events survive phase changes', () => {
    let s = flatState();
    s.events.willstorm.trigger = { type: 'phase', day: 1, phase: 'night' };
    s = executeCommand(s, GM, { type: 'advancePhase' }).state; // Night 1 – awaiting
    s = executeCommand(s, GM, { type: 'decideEvent', eventId: 'willstorm', decision: 'postpone', postpone: 'nextPhase' }).state;
    expect(s.events.willstorm).toMatchObject({ status: 'postponed', postponedTo: { day: 2, phase: 'day' } });
    s = executeCommand(s, GM, { type: 'advancePhase' }).state; // Day 2
    expect(s.events.willstorm.status).toBe('awaiting');
    s = executeCommand(s, GM, { type: 'advancePhase' }).state; // Night 2 – still awaiting, not applied, not duplicated
    expect(s.events.willstorm.status).toBe('awaiting');
    expect(s.log.filter((l) => /Event due: “Willstorm|Event due/.test(l.text) && /willstorm/i.test(l.text)).length).toBeLessThanOrEqual(2);
    s = executeCommand(s, GM, { type: 'decideEvent', eventId: 'willstorm', decision: 'approve', edits: { name: 'Storm of Wills' } }).state;
    expect(s.events.willstorm).toMatchObject({ status: 'done', name: 'Storm of Wills' });
  });

  it('manual events can be triggered exactly once', () => {
    let s = createDemoState({ radius: 12 });
    const r1 = executeCommand(s, GM, { type: 'triggerEvent', eventId: 'willstorm' });
    expect(r1.ok).toBe(true);
    expect(r1.state.tokens.sinna.movePoints).toBe(6);
    s = r1.state;
    expect(executeCommand(s, GM, { type: 'triggerEvent', eventId: 'willstorm' }).ok).toBe(false);
  });

  it('the arena shrinks from the configured day on', () => {
    const s = createDemoState({ radius: 12 });
    const edge = { q: 12, r: 0 };
    expect(zoneStatus(s.config, 3, edge)).toBe('safe');
    expect(zoneStatus(s.config, 4, edge)).toBe('warning');
    expect(zoneStatus(s.config, 5, edge)).toBe('danger');
    expect(zoneStatus(s.config, 6, { q: 11, r: 0 })).toBe('warning');
    expect(zoneStatus(s.config, 7, { q: 11, r: 0 })).toBe('danger');
    expect(zoneStatus(s.config, 99, { q: 0, r: 0 })).toBe('safe');
  });

  it('shrinking is announced once per step – nightfall never shrinks the arena', () => {
    let s = createDemoState({ radius: 12 });
    let shrinkLogs = 0;
    for (let i = 0; i < 10; i++) {
      const before = s.log.length;
      s = executeCommand(s, GM, { type: 'advancePhase' }).state;
      const fresh = s.log.slice(before).filter((e) => e.text.includes('arena contracts'));
      if (s.phase === 'night') expect(fresh).toHaveLength(0);
      shrinkLogs += fresh.length;
    }
    // Day 5 is the first shrink step (Day 6 has none, interval 2).
    expect(s.day).toBe(6);
    expect(shrinkLogs).toBe(1);
  });

  it('the closed zone blocks movement into it', () => {
    const s = flatState(6);
    s.config.shrink = { ...s.config.shrink, enabled: true, startDay: 1, mode: 'closed' };
    s.tokens.sinna.pos = { q: 3, r: 0 };
    const res = executeCommand(s, GM, { type: 'move', tokenId: 'sinna', to: { q: 6, r: 0 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/closed zone/);
  });

  it('v0.1 save games are upgraded with a day phase', () => {
    const s = flatState() as unknown as Record<string, unknown>;
    const v1 = { ...structuredClone(s), version: 1 } as Record<string, unknown>;
    delete v1.phase;
    delete (v1.config as Record<string, unknown>).phases;
    const up = migrateState(v1);
    expect(up.version).toBe(3);
    expect(up.phase).toBe('day');
    expect(up.config.phases.night.visionModifier).toBe(-1);
  });
});

describe('legacy Willpower (APEX 0.7)', () => {
  it('v2 saves lose token.will and will-vessel fields; everything else stays', () => {
    const s = flatState() as unknown as Record<string, unknown>;
    const v2 = { ...structuredClone(s), version: 2 } as unknown as { tokens: Record<string, Record<string, unknown>> };
    const t = Object.values(v2.tokens)[0];
    t.will = { current: 3, max: 5 };
    t.inventory = [{ id: 'v', name: 'Voluntas Vial', kind: 'will-vessel', description: 'old', quantity: 1, willCharge: 2, willCapacity: 5, notes: 'mine' }];
    const up = migrateState(v2);
    const tok = Object.values(up.tokens)[0] as unknown as Record<string, unknown>;
    expect(up.version).toBe(3);
    expect('will' in tok).toBe(false);
    expect(up.tokens[String(tok.id)].inventory[0]).toEqual({ id: 'v', name: 'Voluntas Vial', kind: 'misc', description: 'old', quantity: 1, notes: 'mine', weightKg: 0 }); // 'Vial' → SRD vial (0 lb) – rough weight back-fill
  });
});
