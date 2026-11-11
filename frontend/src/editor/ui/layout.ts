/**
 * Editor layout: tool groups of the left bar and tabs of the right column. The tab follows what
 * the GM is doing (painting shows the palette, placing a token the tokens, selecting an object its
 * properties); a tab chosen by hand stays until the next tool or selection change.
 */
import type { ObjectSelection, ToolId } from '../tools/types';

export type PanelTab =
  'properties' | 'palette' | 'layers' | 'tokens' | 'notes' | 'ambient' | 'history' | 'generate';

/** Tabs always offered, in display order; "history" and "generate" only while open. */
export const BASE_TABS: readonly PanelTab[] = [
  'properties',
  'palette',
  'layers',
  'tokens',
  'notes',
  'ambient',
];

export type ToolGroupId = 'navigate' | 'terrain' | 'structure' | 'place' | 'story' | 'table';

/** Tools of the left bar by group, in display order (keyboard order follows it). */
export const TOOL_GROUPS: readonly {
  readonly id: ToolGroupId;
  readonly tools: readonly ToolId[];
}[] = [
  { id: 'navigate', tools: ['select', 'hand', 'ruler', 'pipette'] },
  { id: 'terrain', tools: ['brush', 'eraser', 'fill', 'shape'] },
  { id: 'structure', tools: ['wall', 'door', 'light'] },
  { id: 'place', tools: ['token', 'image', 'scatter', 'stairs', 'portal'] },
  { id: 'story', tools: ['pin', 'zone', 'trap', 'secret', 'text'] },
  { id: 'table', tools: ['fog'] },
];

/** Groups the given tools; a tool missing from TOOL_GROUPS goes to the last group. */
export function groupTools<T extends { readonly id: ToolId }>(
  tools: readonly T[],
): { readonly id: ToolGroupId; readonly tools: readonly T[] }[] {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const placed = new Set<ToolId>();
  const groups = TOOL_GROUPS.map((group) => {
    const list: T[] = [];
    for (const id of group.tools) {
      const tool = byId.get(id);
      if (tool !== undefined) {
        list.push(tool);
        placed.add(id);
      }
    }
    return { id: group.id, tools: list };
  });
  const rest = tools.filter((tool) => !placed.has(tool.id));
  if (rest.length > 0)
    groups[groups.length - 1] = {
      id: groups[groups.length - 1]!.id,
      tools: [...groups[groups.length - 1]!.tools, ...rest],
    };
  return groups.filter((group) => group.tools.length > 0);
}

/** Tab shown when this tool is chosen; null keeps the current tab. */
export function tabForTool(tool: ToolId): PanelTab | null {
  switch (tool) {
    case 'brush':
    case 'eraser':
    case 'fill':
    case 'shape':
    case 'pipette':
      return 'palette';
    case 'token':
      return 'tokens';
    case 'pin':
      return 'notes';
    case 'select':
      return 'properties';
    default:
      return null;
  }
}

/** Tab shown when the object selection changes; null keeps the current tab. */
export function tabForSelection(selection: ObjectSelection): PanelTab | null {
  return selection.objects.length > 0 || selection.tokens.length > 0 ? 'properties' : null;
}

/** Tabs to show: the base ones, then history and generate while their panel is open. */
export function visibleTabs(historyOpen: boolean, generateOpen: boolean): PanelTab[] {
  const tabs = [...BASE_TABS];
  if (historyOpen) tabs.push('history');
  if (generateOpen) tabs.push('generate');
  return tabs;
}
