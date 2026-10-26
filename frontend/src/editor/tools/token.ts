/**
 * Token tool (K, projet.md 15.2): places the token definition chosen in the Tokens panel,
 * centred on its footprint (top-left cell under the pointer; a 2×2 token covers 2×2 cells).
 */
import type { MapPointerEvent, PlacedToken, TokenDefView } from '../contracts';
import { round3 } from '../model/scene-values';
import { command, uid } from './object-common';
import type { Tool, ToolContext, ToolResult } from './types';

/** Centre of a token of `def` whose top-left cell is (cx, cy), kept inside the map. */
export function tokenCentre(
  def: Pick<TokenDefView, 'sizeW' | 'sizeH'>,
  cx: number,
  cy: number,
  width: number,
  height: number,
): [number, number] {
  const w = Math.max(0.25, def.sizeW);
  const h = Math.max(0.25, def.sizeH);
  const x = Math.min(Math.max(0, cx), Math.max(0, width - Math.ceil(w)));
  const y = Math.min(Math.max(0, cy), Math.max(0, height - Math.ceil(h)));
  return [round3(Math.min(width, x + w / 2)), round3(Math.min(height, y + h / 2))];
}

export function createTokenTool(ctx: ToolContext): Tool {
  const def = (): TokenDefView | null => {
    const id = ctx.settings.tokenId;
    return id === null ? null : ctx.doc.tokenDef(id);
  };

  const footprint = (e: MapPointerEvent, d: TokenDefView): ToolResult => {
    const [x, y] = tokenCentre(d, e.cell.x, e.cell.y, ctx.doc.grid.width, ctx.doc.grid.height);
    return {
      overlay: { kind: 'area', x: x - d.sizeW / 2, y: y - d.sizeH / 2, w: d.sizeW, h: d.sizeH },
    };
  };

  return {
    id: 'token',
    shortcut: 'K',
    onPointer(e): ToolResult {
      const d = def();
      switch (e.type) {
        case 'move':
          return d === null ? { overlay: null } : footprint(e, d);
        case 'down': {
          if (e.button !== 0) return {};
          if (d === null) return { notice: { code: 'no_token' } };
          const [x, y] = tokenCentre(
            d,
            e.cell.x,
            e.cell.y,
            ctx.doc.grid.width,
            ctx.doc.grid.height,
          );
          const token: PlacedToken = {
            uid: uid(ctx),
            floor: ctx.doc.floor,
            token_id: d.id,
            x,
            y,
            rotation: 0,
            scale: 1,
            hidden: false,
            light_override: null,
            rev: 1,
          };
          return {
            command: command('editor.command.token', [{ type: 'maptoken.add', token }]),
            ...footprint(e, d),
          };
        }
        case 'up':
          return {};
        case 'leave':
          return { overlay: null };
      }
    },
    cancel: () => ({ overlay: null }),
    deactivate: () => ({ overlay: null }),
  };
}
