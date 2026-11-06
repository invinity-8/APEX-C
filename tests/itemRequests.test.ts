import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { parseCommand } from '../src/server/validate';

const P = { role: 'player' as const, tokenId: 'sinna' };
const GM = { role: 'gm' as const };
const request = { type: 'invRequestItem', tokenId: 'sinna', requestId: 'req-shell', name: 'Seashell', quantity: 2, description: 'Pale shell from the beach.', notes: 'A tiny blue mark.' } as const;

describe('player narrative item approval', () => {
  it('keeps new items out of inventory until GM approval; approval is idempotent', () => {
    let state = createDemoState({ radius: 4, seed: 2 });
    const result = executeCommand(state, P, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    expect(state.tokens.sinna.inventory.some(i => i.id === 'req-req-shell')).toBe(false);
    expect(state.tokens.sinna.itemRequests?.[0]).toMatchObject({ status: 'pending', name: 'Seashell' });

    const reviewed = executeCommand(state, GM, { type: 'gmReviewItemRequest', tokenId: 'sinna', requestId: 'req-shell', decision: 'approve', edits: { name: 'Blue-marked seashell', quantity: 3 } });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    state = reviewed.state;
    expect(state.tokens.sinna.inventory.filter(i => i.id === 'req-req-shell')).toHaveLength(1);
    expect(state.tokens.sinna.inventory.find(i => i.id === 'req-req-shell')).toMatchObject({ name: 'Blue-marked seashell', kind: 'misc', quantity: 3, description: 'Pale shell from the beach.', notes: 'A tiny blue mark.' });
    const retry = executeCommand(state, GM, { type: 'gmReviewItemRequest', tokenId: 'sinna', requestId: 'req-shell', decision: 'approve' });
    expect(retry).toMatchObject({ ok: true, state });
  });

  it('rejects duplicate requests, hides requests from other players, and prevents direct inventory bypass', () => {
    const state = createDemoState({ radius: 4, seed: 2 });
    const result = executeCommand(state, P, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(executeCommand(result.state, P, request).ok).toBe(false);
    expect(executeCommand(result.state, P, { type: 'invAddItem', tokenId: 'sinna', itemId: 'free', name: 'Free item' }).ok).toBe(false);
    expect(executeCommand(result.state, { role: 'player', tokenId: 'aster' }, { type: 'gmReviewItemRequest', tokenId: 'sinna', requestId: 'req-shell', decision: 'approve' }).ok).toBe(false);
    expect(JSON.stringify(result.state.tokens.aster.itemRequests ?? [])).toBe('[]');
  });

  it('accepts only narrative fields from the browser payload', () => {
    const parsed = parseCommand({ ...request, equip: { kind: 'weapon', damage: '99d99' }, mods: [{ modId: 'to-hit', tier: 10, value: 100 }] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.command).toEqual(request);
  });

  it('lets the GM reject a draft without creating an inventory item', () => {
    const submitted = executeCommand(createDemoState({ radius: 4, seed: 2 }), P, request);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const rejected = executeCommand(submitted.state, GM, { type: 'gmReviewItemRequest', tokenId: 'sinna', requestId: 'req-shell', decision: 'reject' });
    expect(rejected.ok).toBe(true);
    if (rejected.ok) {
      expect(rejected.state.tokens.sinna.itemRequests?.[0]?.status).toBe('rejected');
      expect(rejected.state.tokens.sinna.inventory.some(i => i.id === 'req-req-shell')).toBe(false);
    }
  });
});

