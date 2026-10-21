/** Pipette (I), ruler (M) and hand (H). */
import type { GridSpec, TileLayerId } from '../contracts';
import { TILE_LAYERS } from '../../formats/chunk-codec';
import type { Tool, ToolContext, ToolResult } from './types';

/** Pipette: tile of the active layer under the cursor, else of the topmost visible tile layer. */
export function createPipetteTool(ctx: ToolContext): Tool {
  return {
    id: 'pipette',
    shortcut: 'I',
    onPointer(e): ToolResult {
      if (e.type !== 'down' || e.button !== 0) return {};
      const { x, y } = e.cell;
      const order: TileLayerId[] = [
        ctx.settings.layer,
        ...[...TILE_LAYERS].reverse().filter((l) => l !== ctx.settings.layer),
      ];
      for (const layer of order) {
        const def = ctx.doc.layers.find((l) => l.id === layer);
        if (layer !== ctx.settings.layer && def?.visible === false) continue;
        const cell = ctx.doc.getCell(layer, x, y);
        if (cell.index !== 0) return { picked: cell, pickedLayer: layer };
      }
      return {};
    },
    cancel: () => ({}),
    deactivate: () => ({}),
  };
}

/** Euclidean distance in cells. */
export function cellDistance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

let numberFormat: Intl.NumberFormat | null = null;

/** Default ruler label: distance × unitPerCell, at most one decimal, then the unit label. */
export function defaultFormatDistance(distanceCells: number, grid: GridSpec): string {
  numberFormat ??= new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const value = numberFormat.format(distanceCells * grid.unitPerCell);
  return grid.unitLabel === '' ? value : `${value} ${grid.unitLabel}`;
}

/**
 * Ruler: drag to measure; the measure stays displayed until the next press or Escape.
 * Ends snap to cell centres (Alt: free). No game rule is applied (projet.md 15.2).
 */
export function createRulerTool(ctx: ToolContext): Tool {
  let from: readonly [number, number] | null = null;
  let dragging = false;
  const point = (e: { world: { x: number; y: number }; mods: { alt: boolean } }) =>
    e.mods.alt
      ? ([e.world.x, e.world.y] as const)
      : ([Math.floor(e.world.x) + 0.5, Math.floor(e.world.y) + 0.5] as const);
  const overlay = (to: readonly [number, number]): ToolResult => {
    if (from === null) return {};
    const format = ctx.formatDistance ?? defaultFormatDistance;
    return {
      overlay: { kind: 'ruler', from, to, label: format(cellDistance(from, to), ctx.doc.grid) },
    };
  };
  return {
    id: 'ruler',
    shortcut: 'M',
    onPointer(e) {
      switch (e.type) {
        case 'down':
          if (e.button !== 0) return {};
          from = point(e);
          dragging = true;
          return overlay(from);
        case 'move':
          return dragging ? overlay(point(e)) : {};
        case 'up':
          if (!dragging) return {};
          dragging = false;
          return overlay(point(e));
        case 'leave':
          return {};
      }
    },
    cancel() {
      from = null;
      dragging = false;
      return { overlay: null };
    },
    deactivate() {
      return this.cancel();
    },
  };
}

/** Hand: no map effect; the page enables SceneEngineApi.setPanMode while it is active. */
export function createHandTool(): Tool {
  return {
    id: 'hand',
    shortcut: 'H',
    onPointer: () => ({}),
    cancel: () => ({}),
    deactivate: () => ({}),
  };
}
