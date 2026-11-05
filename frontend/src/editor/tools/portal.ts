/**
 * Portal tool (P9a2): one click puts an icon (portal, door, stairs, ladder, trapdoor) that leads to a
 * position of a map of the game; the link is required. Centre snapped to the half-cell grid (Alt: free).
 */
import type { PortalObject, Point } from '../contracts';
import { round3 } from '../model/scene-values';
import { clampPoint, snapToGrid } from './geometry';
import { command, lockedLayer, uid } from './object-common';
import type { Tool, ToolContext, ToolResult } from './types';

/** Creates the portal tool. */
export function createPortalTool(ctx: ToolContext): Tool {
  const centre = (world: { x: number; y: number }, alt: boolean): Point => {
    const raw: Point = [world.x, world.y];
    const { width, height } = ctx.doc.grid;
    return clampPoint(alt ? raw : snapToGrid(raw), width, height);
  };

  return {
    id: 'portal',
    shortcut: '',
    onPointer(e): ToolResult {
      switch (e.type) {
        case 'move': {
          const p = centre(e.world, e.mods.alt);
          return { overlay: { kind: 'rect', x: p[0] - 0.4, y: p[1] - 0.4, w: 0.8, h: 0.8 } };
        }
        case 'down': {
          if (e.button !== 0) return {};
          const locked = lockedLayer(ctx, 'props');
          if (locked !== null) return { notice: locked };
          const link = ctx.settings.portalLink;
          if (link === null || link.map_id === null) return { notice: { code: 'link_required' } };
          const p = centre(e.world, e.mods.alt);
          const label = ctx.settings.portalLabel.trim();
          const portal: PortalObject = {
            uid: uid(ctx),
            floor: ctx.doc.floor,
            type: 'portal',
            layer: 'props',
            geometry: { x: round3(p[0]), y: round3(p[1]) },
            props: {
              icon: ctx.settings.portalIcon,
              color: ctx.settings.portalColor,
              ...(label !== '' ? { label: label.slice(0, 60) } : {}),
              link,
            },
            visibility: 'all',
            locked: false,
            sort_order: 0,
            rev: 1,
          };
          return {
            command: command('editor.command.portal', [{ type: 'object.add', object: portal }]),
          };
        }
        case 'up':
          return {};
        case 'leave':
          return { overlay: null };
      }
    },
    cancel() {
      return { overlay: null };
    },
    deactivate() {
      return { overlay: null };
    },
  };
}
