import { describe, expect, it } from 'vitest';
import { defaultLayout, hideWidget, moveWidget, normalizeLayout, nudgeWidget, resizeDock, toggleCollapsed, type WidgetMeta } from '../src/workspace/layout';

const GM: WidgetMeta[] = ['gm-tools', 'party-health', 'events', 'world', 'players', 'selection'].map((id) => ({ id }));
const PLAYER: WidgetMeta[] = ['my-character', 'selection', 'intel'].map((id) => ({ id }));
const gmDefaults = defaultLayout({ right: ['gm-tools', 'party-health', 'selection', 'events'], left: [] }, ['events'], ['world', 'players']);

describe('workspace layout', () => {
  it('default GM layout: GM Tools at the top of the right dock', () => {
    const l = normalizeLayout(null, GM, gmDefaults);
    expect(l.docks.right[0]).toBe('gm-tools');
    expect(l.hidden).toEqual(['world', 'players']);
    expect(l.collapsed).toEqual(['events']);
  });

  it('moves widgets between docks and reorders without duplicating', () => {
    let l = normalizeLayout(null, GM, gmDefaults);
    l = moveWidget(l, 'events', 'left', 0, GM);
    expect(l.docks.left).toEqual(['events']);
    expect(l.docks.right).not.toContain('events');
    l = moveWidget(l, 'gm-tools', 'right', 99, GM);
    expect(l.docks.right.at(-1)).toBe('gm-tools');
    l = nudgeWidget(l, 'gm-tools', -1, GM);
    expect(l.docks.right.at(-2)).toBe('gm-tools');
    l = moveWidget(l, 'party-health', 'right', 2, GM); // reorder within the same dock
    const all = [...l.docks.left, ...l.docks.right, ...l.docks.bottom, ...l.hidden];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(GM.map((w) => w.id).sort());
  });

  it('hide and restore never lose a widget; collapse toggles', () => {
    let l = normalizeLayout(null, GM, gmDefaults);
    l = hideWidget(l, 'party-health');
    expect(l.hidden).toContain('party-health');
    l = moveWidget(l, 'party-health', 'bottom', 0, GM);
    expect(l.docks.bottom).toEqual(['party-health']);
    expect(l.hidden).not.toContain('party-health');
    expect(toggleCollapsed(l, 'selection').collapsed).toContain('selection');
  });

  it('a player cannot unlock GM widgets by editing the stored layout', () => {
    const forged = { docks: { left: ['world', 'players'], right: ['gm-tools', 'my-character'], bottom: [] }, hidden: ['events'], collapsed: [] };
    const l = normalizeLayout(forged, PLAYER, defaultLayout({ right: ['my-character', 'selection', 'intel'] }));
    const all = [...l.docks.left, ...l.docks.right, ...l.docks.bottom, ...l.hidden];
    expect(all.sort()).toEqual(['intel', 'my-character', 'selection']);
  });

  it('respects allowed docks and clamps sizes', () => {
    const metas: WidgetMeta[] = [{ id: 'a', docks: ['right'] }, { id: 'b' }];
    const l = normalizeLayout(null, metas, defaultLayout({ right: ['a', 'b'] }));
    expect(moveWidget(l, 'a', 'left', 0, metas)).toBe(l);
    expect(resizeDock(l, 'right', 9999).size.right).toBe(560);
    expect(normalizeLayout({ size: { left: -5 } }, metas, defaultLayout({ right: ['a'] })).size.left).toBe(260);
  });
});
