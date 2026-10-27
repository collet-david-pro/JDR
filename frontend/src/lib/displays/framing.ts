/**
 * Framing of a projection screen (D9), pure.
 *
 * Centre, first that applies: `view_lock` > the GM's last camera (when `follow_camera`) > centre
 * of the visible viewers of the floor > centre of the map. A lock or a camera that points to
 * another floor than the session's current one is skipped. Floor: always the session's current
 * floor.
 *
 * Zoom: when the scale of the screen is known (px/mm) the cell has the size `px/mm × mm_per_cell`
 * and the zoom of the GM (lock or camera) is ignored; otherwise the zoom of the lock / camera
 * used for the centre; otherwise the map is fitted in the viewport (and centred).
 */
import type { PlacedToken } from '../../editor/contracts';
import type { SessionCamera } from '../sessions/types';
import { MAX_ZOOM, MIN_ZOOM, effectivePxPerMm, zoomFor, type ScreenSize } from './calibration';
import type { DisplaySettings } from './types';

export interface FrameMap {
  /** Size of the map in cells and of a cell in map pixels (`grid.cellPx`). */
  readonly width: number;
  readonly height: number;
  readonly cellPx: number;
}

export interface FrameInput {
  readonly settings: DisplaySettings;
  /** Current floor of the session. */
  readonly floorId: string | null;
  /** Last camera of the GM (`session.camera`, moved by `camera.moved`). */
  readonly camera: SessionCamera | null;
  /** Visible viewers (see viewers.ts). */
  readonly viewers: readonly Pick<PlacedToken, 'x' | 'y' | 'floor'>[];
  readonly map: FrameMap;
  /** Render area after the orientation, CSS px. */
  readonly viewport: ScreenSize;
  /** Physical screen in CSS px (for the diagonal); null: unknown. */
  readonly screen: ScreenSize | null;
}

export type FrameSource = 'lock' | 'camera' | 'viewers' | 'map';

export interface Frame {
  /** Centre in cells, zoom for CameraState (px of screen per `cellPx`). */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly floor: string | null;
  /** Where the centre comes from. */
  readonly source: FrameSource;
  /** The zoom comes from the scale of the screen / from the GM / from fitting the map. */
  readonly zoomSource: 'scale' | 'lock' | 'camera' | 'fit';
  /** The calibrated zoom had to be bounded (the cell cannot get its size). */
  readonly outOfRange: 'low' | 'high' | null;
}

const onFloor = (floorId: string | null, target: string | null): boolean =>
  target === null || floorId === null || target === floorId;

function viewersCentre(
  viewers: FrameInput['viewers'],
  floorId: string | null,
): { x: number; y: number } | null {
  const here = viewers.filter((v) => floorId === null || v.floor === floorId);
  if (here.length === 0) return null;
  const xs = here.map((v) => v.x);
  const ys = here.map((v) => v.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/** Zoom that fits the whole map in the viewport. */
export function fitZoom(map: FrameMap, viewport: ScreenSize): number {
  const w = map.width * map.cellPx;
  const h = map.height * map.cellPx;
  if (w <= 0 || h <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(viewport.width / w, viewport.height / h)));
}

export function frame(input: FrameInput): Frame {
  const { settings, map } = input;
  const lock = settings.view_lock;
  const lockOk = lock !== null && onFloor(input.floorId, lock.floor_id);
  const camera = settings.follow_camera ? input.camera : null;
  const cameraOk = camera !== null && onFloor(input.floorId, camera.floor_id);
  const mapCentre = { x: map.width / 2, y: map.height / 2 };

  let source: FrameSource;
  let centre: { x: number; y: number };
  let gmZoom: number | null = null;
  let gmSource: 'lock' | 'camera' = 'lock';
  if (lockOk && lock !== null) {
    source = 'lock';
    centre = lock;
    gmZoom = lock.zoom;
  } else if (cameraOk && camera !== null) {
    source = 'camera';
    centre = camera;
    gmZoom = camera.zoom;
    gmSource = 'camera';
  } else {
    const viewers = viewersCentre(input.viewers, input.floorId);
    source = viewers === null ? 'map' : 'viewers';
    centre = viewers ?? mapCentre;
  }

  const pxPerMm = effectivePxPerMm(settings, input.screen);
  if (pxPerMm !== null) {
    const z = zoomFor(map.cellPx, pxPerMm, settings.mm_per_cell);
    return {
      x: centre.x,
      y: centre.y,
      zoom: z.zoom,
      floor: input.floorId,
      source,
      zoomSource: 'scale',
      outOfRange: z.outOfRange,
    };
  }
  if (gmZoom !== null) {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gmZoom));
    return { ...base(input, centre, source), zoom, zoomSource: gmSource, outOfRange: null };
  }
  return {
    ...base(input, mapCentre, 'map'),
    zoom: fitZoom(map, input.viewport),
    zoomSource: 'fit',
    outOfRange: null,
  };
}

function base(input: FrameInput, c: { x: number; y: number }, source: FrameSource) {
  return { x: c.x, y: c.y, floor: input.floorId, source };
}
