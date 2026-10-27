/**
 * "Broadcast my camera" (D10): every camera movement of the GM engine is sent as `camera.set`
 * (follow on), at most MAX_PER_SECOND times per second; the last position is always sent (the
 * pending state is flushed after the interval).
 */
import type { SessionAction } from '../types';

export const MAX_PER_SECOND = 4;
export const MIN_INTERVAL_MS = 1000 / MAX_PER_SECOND;

export interface CameraLike {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export function cameraAction(camera: CameraLike, floor: string | null): SessionAction {
  return {
    type: 'camera.set',
    x: camera.x,
    y: camera.y,
    zoom: Math.min(8, Math.max(0.1, camera.zoom)),
    ...(floor === null ? {} : { floor_id: floor }),
    follow: true,
  };
}

export interface BroadcasterOptions {
  readonly send: (actions: SessionAction[]) => void;
  readonly now?: () => number;
}

export class CameraBroadcaster {
  private last = Number.NEGATIVE_INFINITY;
  private pending: SessionAction | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly o: BroadcasterOptions) {
    this.now = o.now ?? Date.now;
  }

  /** A camera state (or the current one, when the broadcast starts). */
  push(camera: CameraLike, floor: string | null): void {
    this.pending = cameraAction(camera, floor);
    if (this.timer !== null) return;
    const wait = this.last + MIN_INTERVAL_MS - this.now();
    if (wait <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const action = this.pending;
    this.pending = null;
    if (action === null) return;
    this.last = this.now();
    this.o.send([action]);
  }

  /** Stops without sending what is pending. */
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

export interface BroadcastEngine {
  readonly camera: { get(): CameraLike };
  onCamera(listener: (camera: CameraLike) => void): () => void;
}

/** Starts the broadcast on an engine (sends the current camera at once); returns the stop. */
export function startCameraBroadcast(
  engine: BroadcastEngine,
  floor: () => string | null,
  send: (actions: SessionAction[]) => void,
  now?: () => number,
): () => void {
  const broadcaster = new CameraBroadcaster({ send, ...(now === undefined ? {} : { now }) });
  broadcaster.push(engine.camera.get(), floor());
  const off = engine.onCamera((camera) => broadcaster.push(camera, floor()));
  return () => {
    off();
    broadcaster.dispose();
  };
}
