/**
 * Camera of the player view: centring on the player's token and following the GM's camera
 * (`session.camera`, cells and zoom like the engine camera). Moving the view by hand stops the
 * following.
 */
import type { CameraState } from '../../../editor/contracts';
import type { SessionCamera } from '../types';

export interface CameraHost {
  get(): CameraState;
  set(state: Partial<CameraState>): void;
  fit(): void;
}

const EPS_CELLS = 0.01;
const EPS_ZOOM = 0.005;

function same(a: CameraState, b: CameraState): boolean {
  return (
    Math.abs(a.x - b.x) < EPS_CELLS &&
    Math.abs(a.y - b.y) < EPS_CELLS &&
    Math.abs(a.zoom - b.zoom) < EPS_ZOOM * Math.max(1, b.zoom)
  );
}

export class CameraFollow {
  private following: boolean;
  private applied: CameraState | null = null;

  constructor(
    private readonly camera: CameraHost,
    initial: boolean,
    private readonly onChange: (following: boolean) => void = () => undefined,
  ) {
    this.following = initial;
  }

  get enabled(): boolean {
    return this.following;
  }

  setEnabled(on: boolean): void {
    if (this.following === on) return;
    this.following = on;
    this.onChange(on);
  }

  /** Sets the camera ourselves (not a user move). */
  private put(state: Partial<CameraState>): void {
    this.camera.set(state);
    const now = this.camera.get();
    this.applied = { x: state.x ?? now.x, y: state.y ?? now.y, zoom: state.zoom ?? now.zoom };
  }

  /** The GM's camera changed (or is being followed for the first time). */
  apply(camera: SessionCamera | null, floor: string | null): void {
    if (!this.following || camera === null) return;
    if (camera.floor_id !== null && floor !== null && camera.floor_id !== floor) return;
    this.put({ x: camera.x, y: camera.y, zoom: camera.zoom });
  }

  /** Centres on a point (cells), or fits the map when there is none. */
  center(point: { x: number; y: number } | null, minZoom = 1): void {
    if (point === null) {
      this.camera.fit();
      this.applied = null;
      return;
    }
    this.put({ x: point.x, y: point.y, zoom: Math.max(minZoom, this.camera.get().zoom) });
  }

  /** The engine camera moved: a move we did not make stops the following. */
  moved(state: CameraState): void {
    if (!this.following) return;
    if (this.applied !== null && same(state, this.applied)) return;
    this.setEnabled(false);
  }
}
