import { createDoorTool } from './door';
import { createFillTool } from './fill';
import { createFogTool } from './fog';
import { createLightTool } from './light';
import { createPaintTool } from './paint';
import { createHandTool, createPipetteTool, createRulerTool } from './pick';
import { createSelectTool, type SelectTool } from './select';
import { createShapeTool } from './shape';
import { createTokenTool } from './token';
import type { Tool, ToolContext, ToolId } from './types';
import { createWallTool } from './wall';

export type ToolSet = Readonly<Record<Exclude<ToolId, 'select'>, Tool>> & {
  readonly select: SelectTool;
};

/** All tools sharing one context (P4 tile tools, P5 object tools); order = tool bar order. */
export function createTools(ctx: ToolContext): ToolSet {
  return {
    select: createSelectTool(ctx),
    hand: createHandTool(),
    brush: createPaintTool(ctx, 'brush'),
    eraser: createPaintTool(ctx, 'eraser'),
    fill: createFillTool(ctx),
    shape: createShapeTool(ctx),
    wall: createWallTool(ctx),
    door: createDoorTool(ctx),
    light: createLightTool(ctx),
    token: createTokenTool(ctx),
    fog: createFogTool(ctx),
    pipette: createPipetteTool(ctx),
    ruler: createRulerTool(ctx),
  };
}

export * from './types';
export { clampBrushSize } from './common';
export { floodRegion } from './fill';
export { brushFootprint, ellipseCells, lineCells, rectCells } from './raster';
export { cellDistance, defaultFormatDistance } from './pick';
export {
  clipRect,
  fullSelectionOverlay,
  selectionOverlay,
  unionRects,
  type SelectTool,
} from './select';
export { shapeCells } from './shape';
export { LIGHT_PRESETS, LIGHT_PRESET_IDS } from './object-common';
