import { createFillTool } from './fill';
import { createPaintTool } from './paint';
import { createHandTool, createPipetteTool, createRulerTool } from './pick';
import { createSelectTool, type SelectTool } from './select';
import { createShapeTool } from './shape';
import type { Tool, ToolContext, ToolId } from './types';

export type ToolSet = Readonly<Record<Exclude<ToolId, 'select'>, Tool>> & {
  readonly select: SelectTool;
};

/** All P4a tools sharing one context. */
export function createTools(ctx: ToolContext): ToolSet {
  return {
    select: createSelectTool(ctx),
    hand: createHandTool(),
    brush: createPaintTool(ctx, 'brush'),
    eraser: createPaintTool(ctx, 'eraser'),
    fill: createFillTool(ctx),
    shape: createShapeTool(ctx),
    pipette: createPipetteTool(ctx),
    ruler: createRulerTool(ctx),
  };
}

export * from './types';
export { clampBrushSize } from './common';
export { floodRegion } from './fill';
export { brushFootprint, ellipseCells, lineCells, rectCells } from './raster';
export { cellDistance, defaultFormatDistance } from './pick';
export { clipRect, selectionOverlay, unionRects, type SelectTool } from './select';
export { shapeCells } from './shape';
