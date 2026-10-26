/**
 * Asynchronous vision service (contract VisionService, ./types.ts): vision.worker when module
 * workers are available, same-thread core otherwise (tests, old browsers) or as soon as the
 * worker fails (load error, crash, message error): pending requests are then answered by the
 * local core, so every compute() resolves.
 *
 * The scene is only posted when its occluders change (walls / doors / windows compared by
 * identity, plus floor, size and viewer): a token move bumps SceneView.sceneRevision but costs
 * no structured clone of the walls nor any rebuild in the worker.
 */
import type { MapObject, Polygon } from '../editor/contracts';
import { VisionCoreImpl, isOccluderObject } from './core';
import type { FromVisionWorker, ToVisionWorker } from './protocol';
import type { VisionScene, VisionService, VisionSource } from './types';

/** What the service needs of a Worker (tests inject a fake). */
export interface VisionWorkerLike {
  postMessage(message: ToVisionWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<FromVisionWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  terminate(): void;
}

export interface VisionServiceOptions {
  /** false = same-thread core (tests). Default: worker when available. */
  readonly worker?: boolean;
  /** Worker factory (tests); default: src/workers/vision.worker.ts as a module worker. */
  readonly createWorker?: () => VisionWorkerLike | null;
}

function defaultWorker(): VisionWorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('../workers/vision.worker.ts', import.meta.url), {
      type: 'module',
      name: 'vision',
    }) as unknown as VisionWorkerLike;
  } catch {
    return null;
  }
}

interface Pending {
  readonly kind: 'vision' | 'light';
  readonly sources: readonly VisionSource[];
  readonly resolve: (result: ReadonlyMap<string, Polygon>) => void;
}

export interface VisionServiceImpl extends VisionService {
  /** 'worker' while the worker is used, 'local' after a fallback (diagnostics, tests). */
  readonly mode: 'worker' | 'local';
}

export function createVisionService(options: VisionServiceOptions = {}): VisionServiceImpl {
  let worker: VisionWorkerLike | null =
    options.worker === false ? null : (options.createWorker ?? defaultWorker)();
  let local: VisionCoreImpl | null = null;
  let scene: VisionScene | null = null;
  let posted: { scene: VisionScene; occluders: MapObject[] } | null = null;
  let destroyed = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const localCore = (): VisionCoreImpl => {
    if (local === null) {
      local = new VisionCoreImpl();
      if (scene !== null) local.setScene(scene);
    }
    return local;
  };

  const fallBack = (): void => {
    if (worker !== null) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    const waiting = [...pending.values()];
    pending.clear();
    for (const p of waiting) p.resolve(localCore().compute(p.kind, p.sources));
  };

  const postScene = (w: VisionWorkerLike, next: VisionScene): void => {
    const occluders = next.objects.filter(isOccluderObject);
    const prev = posted;
    if (
      prev !== null &&
      prev.scene.floor === next.floor &&
      prev.scene.width === next.width &&
      prev.scene.height === next.height &&
      prev.scene.viewer === next.viewer &&
      prev.occluders.length === occluders.length &&
      prev.occluders.every((o, i) => o === occluders[i])
    ) {
      return;
    }
    posted = { scene: next, occluders };
    w.postMessage({ type: 'scene', id: nextId++, payload: { ...next, objects: occluders } });
  };

  if (worker !== null) {
    const w = worker;
    w.onmessage = (event) => {
      const m = event.data;
      const p = pending.get(m.id);
      if (p === undefined) return;
      pending.delete(m.id);
      if (m.type === 'error') {
        p.resolve(localCore().compute(p.kind, p.sources));
        return;
      }
      const out = new Map<string, Polygon>();
      m.payload.ids.forEach((id, i) => out.set(id, m.payload.polygons[i]!));
      p.resolve(out);
    };
    w.onerror = (event) => {
      event.preventDefault?.();
      fallBack();
    };
    w.onmessageerror = () => fallBack();
  }

  return {
    get mode() {
      return worker === null ? 'local' : 'worker';
    },
    setScene(next) {
      scene = next;
      local?.setScene(next);
      if (worker === null) return;
      try {
        postScene(worker, next);
      } catch {
        fallBack();
      }
    },
    compute(kind, sources) {
      if (destroyed) return Promise.resolve(new Map());
      if (worker === null) return Promise.resolve(localCore().compute(kind, sources));
      const w = worker;
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, { kind, sources, resolve });
        try {
          w.postMessage({ type: 'compute', id, payload: { kind, sources } });
        } catch {
          fallBack();
        }
      });
    },
    destroy() {
      destroyed = true;
      if (worker !== null) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
        worker = null;
      }
      for (const p of pending.values()) p.resolve(new Map());
      pending.clear();
      local = null;
    },
  };
}
