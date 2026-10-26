/**
 * Messages between the page and vision.worker (projet.md 13.4: typed `{type, id, payload}`,
 * transferable buffers). Polygons come back as Float32Arrays whose buffers are transferred.
 */
import type { VisionScene, VisionSource } from './types';

export type ToVisionWorker =
  | { readonly type: 'scene'; readonly id: number; readonly payload: VisionScene }
  | {
      readonly type: 'compute';
      readonly id: number;
      readonly payload: {
        readonly kind: 'vision' | 'light';
        readonly sources: readonly VisionSource[];
      };
    };

export type FromVisionWorker =
  | {
      readonly type: 'result';
      readonly id: number;
      readonly payload: { readonly ids: readonly string[]; readonly polygons: Float32Array[] };
    }
  | { readonly type: 'error'; readonly id: number; readonly payload: { readonly message: string } };
