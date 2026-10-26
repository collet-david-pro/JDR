/**
 * Message handler of vision.worker, kept apart from the worker global so it can be tested in
 * the same thread. Results are copies of the cached polygons (their buffers are transferred,
 * which detaches them on this side).
 */
import { VisionCoreImpl } from './core';
import type { FromVisionWorker, ToVisionWorker } from './protocol';

export type PostFromWorker = (message: FromVisionWorker, transfer: Transferable[]) => void;

export function createVisionHost(post: PostFromWorker): (message: ToVisionWorker) => void {
  const core = new VisionCoreImpl();
  return (message) => {
    try {
      if (message.type === 'scene') {
        core.setScene(message.payload);
        return;
      }
      const result = core.compute(message.payload.kind, message.payload.sources);
      const ids: string[] = [];
      const polygons: Float32Array[] = [];
      for (const [id, polygon] of result) {
        ids.push(id);
        polygons.push(polygon.slice());
      }
      post(
        { type: 'result', id: message.id, payload: { ids, polygons } },
        polygons.map((p) => p.buffer as ArrayBuffer),
      );
    } catch (error) {
      post(
        {
          type: 'error',
          id: message.id,
          payload: { message: error instanceof Error ? error.message : String(error) },
        },
        [],
      );
    }
  };
}
