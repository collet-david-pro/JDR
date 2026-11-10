import { describe, expect, it } from 'vitest';
import { EMPTY_OBJECT_SELECTION, type ToolId } from '../../src/editor/tools/types';
import {
  TOOL_GROUPS,
  groupTools,
  tabForSelection,
  tabForTool,
  visibleTabs,
} from '../../src/editor/ui/layout';

const ALL_TOOLS: ToolId[] = [
  'select',
  'hand',
  'brush',
  'eraser',
  'fill',
  'shape',
  'wall',
  'door',
  'light',
  'token',
  'image',
  'stairs',
  'portal',
  'pin',
  'zone',
  'trap',
  'secret',
  'fog',
  'pipette',
  'ruler',
];

describe('editor layout', () => {
  it('puts every tool in exactly one group, in group order', () => {
    const grouped = TOOL_GROUPS.flatMap((g) => g.tools);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ALL_TOOLS].sort());
    const groups = groupTools(ALL_TOOLS.map((id) => ({ id })));
    expect(groups.flatMap((g) => g.tools.map((tool) => tool.id))).toEqual(grouped);
  });

  it('keeps an unknown tool in the last group and drops empty groups', () => {
    const groups = groupTools([{ id: 'wall' }, { id: 'mystery' as ToolId }]);
    expect(groups.map((g) => g.id)).toEqual(['structure', 'table']);
    expect(groups[1]!.tools.map((tool) => tool.id)).toEqual(['mystery']);
  });

  it('shows the panel that goes with the tool', () => {
    for (const tool of ['brush', 'eraser', 'fill', 'shape', 'pipette'] as const) {
      expect(tabForTool(tool)).toBe('palette');
    }
    expect(tabForTool('token')).toBe('tokens');
    expect(tabForTool('pin')).toBe('notes');
    expect(tabForTool('select')).toBe('properties');
    expect(tabForTool('wall')).toBeNull();
    expect(tabForTool('hand')).toBeNull();
  });

  it('shows the properties when something is selected', () => {
    expect(tabForSelection(EMPTY_OBJECT_SELECTION)).toBeNull();
    expect(tabForSelection({ objects: ['w1'], tokens: [] })).toBe('properties');
    expect(tabForSelection({ objects: [], tokens: ['t1'] })).toBe('properties');
  });

  it('adds history and generate only while open', () => {
    expect(visibleTabs(false, false)).toEqual([
      'properties',
      'palette',
      'layers',
      'tokens',
      'notes',
      'ambient',
    ]);
    expect(visibleTabs(true, true).slice(-2)).toEqual(['history', 'generate']);
  });
});
