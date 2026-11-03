import { describe, expect, it } from 'vitest';
import { groupChronicle } from '../src/components/ActivityLog';
import type { LogEntry } from '../src/game/types';
import { defaultLayout, hideWidget, moveWidget, normalizeLayout, resetWidget, toggleCollapsed } from '../src/workspace/layout';

const widgets = ['a', 'b', 'chronicle', 'legend'].map((id) => ({ id }));
const defaults = defaultLayout({ right: ['a', 'b', 'legend'], bottom: ['chronicle'] }, ['legend']);

describe('workspace 0.7', () => {
  it('resets one widget to its default dock, position and collapsed state without touching the others', () => {
    let l = normalizeLayout(null, widgets, defaults);
    l = moveWidget(l, 'chronicle', 'left', 0, widgets);
    l = moveWidget(l, 'a', 'left', 1, widgets);
    l = toggleCollapsed(l, 'chronicle', true);
    l = resetWidget(l, 'chronicle', defaults);
    expect(l.docks.bottom).toEqual(['chronicle']);
    expect(l.collapsed).not.toContain('chronicle');
    expect(l.docks.left).toEqual(['a']); // the other moved widget stays where the user put it
    l = hideWidget(l, 'legend');
    l = resetWidget(l, 'legend', defaults);
    expect(l.docks.right).toEqual(['b', 'legend']);
    expect(l.collapsed).toContain('legend');
    expect(l.hidden).toEqual([]);
  });

  it('new widgets (Chronicle, Legend) join an old stored layout at their default place', () => {
    const old = { v: 1, docks: { left: [], right: ['b', 'a'], bottom: [] }, hidden: [], collapsed: [], size: { left: 340, right: 390, bottom: 220 } };
    const l = normalizeLayout(old, widgets, defaults);
    expect(l.docks.bottom).toEqual(['chronicle']);
    expect(l.docks.right).toContain('legend');
    expect(l.collapsed).toEqual([]); // an explicit stored collapsed list wins
  });

  it('groups the chronicle by day and night in chronological order', () => {
    const e = (id: number, day: number, phase: 'day' | 'night'): LogEntry => ({ id, day, phase, kind: 'system', text: `#${id}` }) as LogEntry;
    const g = groupChronicle([e(1, 1, 'day'), e(2, 1, 'day'), e(3, 1, 'night'), e(4, 2, 'day')]);
    expect(g.map((x) => `${x.phase}${x.day}:${x.entries.length}`)).toEqual(['day1:2', 'night1:1', 'day2:1']);
  });
});
