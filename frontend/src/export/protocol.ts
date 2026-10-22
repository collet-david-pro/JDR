/**
 * Messages between the page and export.worker (projet.md 13.4: typed `{type, id, payload}`,
 * transferable buffers). Output bytes are sent per rendered band and acknowledged by the page
 * once written (back-pressure: the worker keeps at most MAX_UNACKED batches in flight).
 */
import type { ExportProgress } from './job';
import type { ExportOptions, MapSnapshot, SnapshotPaletteEntry } from './scene';

export const MAX_UNACKED = 2;

export type ToWorker =
  | { readonly type: 'probe'; readonly id: number }
  | {
      readonly type: 'start';
      readonly id: number;
      readonly payload: { readonly snapshot: MapSnapshot; readonly options: ExportOptions };
    }
  | { readonly type: 'ack'; readonly id: number; readonly payload: { readonly seq: number } };

export type FromWorker =
  | { readonly type: 'probe'; readonly id: number; readonly payload: { readonly ok: boolean } }
  | {
      readonly type: 'data';
      readonly id: number;
      readonly payload: { readonly seq: number; readonly chunks: readonly Uint8Array[] };
    }
  | { readonly type: 'progress'; readonly id: number; readonly payload: ExportProgress }
  | {
      readonly type: 'done';
      readonly id: number;
      readonly payload: {
        readonly files: number;
        readonly failed: readonly SnapshotPaletteEntry[];
      };
    }
  | {
      readonly type: 'error';
      readonly id: number;
      readonly payload: { readonly name: string; readonly message: string };
    };

/** True when OffscreenCanvas with a 2D context works in this global scope. */
export function canUseOffscreen2d(): boolean {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false;
    return new OffscreenCanvas(1, 1).getContext('2d') !== null;
  } catch {
    return false;
  }
}
