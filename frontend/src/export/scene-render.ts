/**
 * Canvas 2D drawing of the P5 scene in the PNG export (projet.md 14.1 order: objects, tokens,
 * lighting, fog; the grid is drawn above by renderer.ts), with the engine's look
 * (scene/style.ts, engine/scene/object-geometry.ts) in its player view.
 *
 * - Objects: walls (outline then colour, round caps, at least WALL_MIN_SCREEN_PX wide), doors
 *   (open leaves turned on their hinge, dashed doorway, lock mark), windows; a secret door is a
 *   plain stone wall. No light gizmos.
 * - Tokens: image stretched to the token box (rotated), or a disc of the ring colour with the
 *   initials; ring inside the box, thin dark outline.
 * - Lighting: lightmap of the band on a second surface: (1 − darkness) grey, plus each light
 *   additively ('lighter') as a radial gradient (full colour × mean intensity up to `radius`,
 *   black at `dim_radius`) filled inside its light polygon (VisionCore, computed once per
 *   export), multiplied by the ambient tint; the band is then multiplied by it. With a
 *   transparent background the lightmap takes the band's alpha first (transparent pixels stay
 *   transparent; half-transparent ones get slightly more opaque).
 * - Fog: unexplored sub-cells (4×4 per cell) in opaque black; explored areas are left as they
 *   are (no current vision in an export, so nothing is "explored but not visible").
 * Everything is a function of absolute image pixels, so bands and print pages join seamlessly.
 */
import type {
  CellRect,
  ChunkKey,
  DoorObject,
  MapObject,
  Polygon,
  WallObject,
  WindowObject,
} from '../editor/contracts';
import {
  doorShape,
  initials,
  polylineSegments,
  segmentMiddle,
  type Seg,
} from '../engine/scene/object-geometry';
import { FOG_SIDE, FOG_SUBCELLS } from '../formats/fog-codec';
import {
  DOOR_COLOR,
  DOOR_LOCKED_MARK,
  DOOR_THICKNESS,
  TOKEN_FONT_FAMILY,
  TOKEN_INITIALS_COLOR,
  TOKEN_INITIALS_SIZE,
  TOKEN_OUTLINE_COLOR,
  TOKEN_RING_WIDTH,
  WALL_COLORS,
  WALL_MIN_SCREEN_PX,
  WALL_OUTLINE,
  WINDOW_COLOR,
  WINDOW_THICKNESS,
} from '../scene/style';
import { ambientAt } from '../vision/ambient';
import { VisionCoreImpl } from '../vision/core';
import type { TokenImages } from './images';
import type { Ctx2D } from './renderer';
import type {
  SceneContentOptions,
  SnapshotLight,
  SnapshotScene,
  SnapshotToken,
} from './scene-snapshot';

/** Wall drawn for a secret door (same as the server PlayerFilter and the engine). */
const SECRET_AS_WALL = { kind: 'stone', thickness: 0.15 } as const;

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function cssColor(color: number): string {
  return `rgb(${(color >> 16) & 255} ${(color >> 8) & 255} ${color & 255})`;
}

function scaled(color: number, level: number): number {
  const k = Math.min(1, Math.max(0, level));
  return (
    (Math.round(((color >> 16) & 255) * k) << 16) |
    (Math.round(((color >> 8) & 255) * k) << 8) |
    Math.round((color & 255) * k)
  );
}

function boxOf(obj: MapObject): Box {
  const pts =
    obj.type === 'wall'
      ? obj.geometry.points
      : obj.type === 'light'
        ? [[obj.geometry.x, obj.geometry.y] as const]
        : [obj.geometry.a, obj.geometry.b];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  // Open doors swing out by their length.
  const pad = obj.type === 'door' ? Math.max(x1 - x0, y1 - y0) + 0.5 : 2;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

function polygonBox(p: Polygon): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    x0 = Math.min(x0, p[i]!);
    x1 = Math.max(x1, p[i]!);
    y0 = Math.min(y0, p[i + 1]!);
    y1 = Math.max(y1, p[i + 1]!);
  }
  return { x0, y0, x1, y1 };
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/** Dash pieces of a segment (dash, gap lengths in the segment's units). */
function dashes(s: Seg, dash: number, gap: number): Seg[] {
  const [ax, ay, bx, by] = s;
  const len = Math.hypot(bx - ax, by - ay);
  if (len === 0) return [];
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const out: Seg[] = [];
  for (let t = 0; t < len; t += dash + gap) {
    const e = Math.min(len, t + dash);
    out.push([ax + ux * t, ay + uy * t, ax + ux * e, ay + uy * e]);
  }
  return out;
}

export class ScenePainter {
  private readonly items: readonly { readonly obj: MapObject; readonly box: Box }[];
  private readonly lights: readonly {
    readonly light: SnapshotLight;
    readonly polygon: Polygon;
    readonly box: Box;
  }[];
  private readonly fog: ReadonlyMap<ChunkKey, Uint8Array>;
  private readonly darkness: number;
  private readonly tint: readonly [number, number, number];
  readonly drawTokens: boolean;
  readonly drawLighting: boolean;
  readonly drawFog: boolean;

  constructor(
    private readonly scene: SnapshotScene,
    private readonly extent: CellRect,
    private readonly ppc: number,
    content: SceneContentOptions,
    private readonly tokenImages: TokenImages | null,
  ) {
    this.items = scene.objects.map((obj) => ({ obj, box: boxOf(obj) }));
    this.drawTokens = content.tokens && scene.tokens.length > 0;
    this.drawFog = content.fog;
    this.fog = new Map(scene.fog);
    const ambient = ambientAt(scene.ambient);
    this.darkness = ambient.darkness;
    this.tint = ambient.tint;
    // Darkness 0: the lightmap is ≥ 1 everywhere and the tint is white ⇒ no change.
    this.drawLighting = content.lighting && ambient.darkness > 0;
    if (this.drawLighting && scene.lights.length > 0) {
      const core = new VisionCoreImpl();
      core.setScene({
        floor: scene.floor,
        width: scene.width,
        height: scene.height,
        objects: scene.occluders,
        viewer: 'player',
        revision: 1,
      });
      const polygons = core.compute(
        'light',
        scene.lights.map((l, i) => ({
          id: String(i),
          x: l.x,
          y: l.y,
          radius: l.dim,
          cone: l.cone,
        })),
      );
      this.lights = scene.lights.map((light, i) => {
        const polygon = polygons.get(String(i))!;
        return { light, polygon, box: polygonBox(polygon) };
      });
    } else {
      this.lights = [];
    }
  }

  /** Cells of the image region [x, x+w) × [y, y+h) (pixels of the whole export image). */
  private region(x: number, y: number, w: number, h: number, margin: number): Box {
    const { extent, ppc } = this;
    return {
      x0: extent.x + x / ppc - margin,
      y0: extent.y + y / ppc - margin,
      x1: extent.x + (x + w) / ppc + margin,
      y1: extent.y + (y + h) / ppc + margin,
    };
  }

  /** Map cells → canvas pixels, with the region's pixel offset (ox, oy). */
  private cellTransform(ctx: Ctx2D, ox: number, oy: number): void {
    const { extent, ppc } = this;
    ctx.setTransform(ppc, 0, 0, ppc, ox - extent.x * ppc, oy - extent.y * ppc);
  }

  /** Walls, doors and windows of the region (ox, oy: canvas = image pixel + offset). */
  objects(ctx: Ctx2D, x: number, y: number, w: number, h: number, ox: number, oy: number): void {
    const region = this.region(x, y, w, h, 1 + 8 / this.ppc);
    this.cellTransform(ctx, ox, oy);
    ctx.lineJoin = 'round';
    for (const { obj, box } of this.items) {
      if (!overlaps(box, region)) continue;
      if (obj.type === 'wall') this.wall(ctx, obj);
      else if (obj.type === 'door') this.door(ctx, obj);
      else if (obj.type === 'window') this.window(ctx, obj);
    }
    ctx.globalAlpha = 1;
  }

  private width(thickness: number): number {
    return Math.max(thickness, WALL_MIN_SCREEN_PX / this.ppc);
  }

  private stroke(
    ctx: Ctx2D,
    segs: readonly Seg[],
    width: number,
    color: number,
    alpha: number,
    cap: CanvasLineCap,
  ): void {
    if (segs.length === 0) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = cssColor(color);
    ctx.lineWidth = width;
    ctx.lineCap = cap;
    ctx.beginPath();
    for (const s of segs) {
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(s[2], s[3]);
    }
    ctx.stroke();
  }

  private solid(ctx: Ctx2D, segs: readonly Seg[], width: number, color: number): void {
    this.stroke(ctx, segs, width + 2 / this.ppc, WALL_OUTLINE, 1, 'round');
    this.stroke(ctx, segs, width, color, 1, 'round');
  }

  private dashed(
    ctx: Ctx2D,
    segs: readonly Seg[],
    width: number,
    color: number,
    alpha: number,
  ): void {
    const dash = Math.max(0.25, 6 / this.ppc);
    this.stroke(
      ctx,
      segs.flatMap((s) => dashes(s, dash, dash * 0.7)),
      width,
      color,
      alpha,
      'butt',
    );
  }

  private wall(ctx: Ctx2D, wall: WallObject): void {
    const segs = polylineSegments(wall.geometry.points, wall.geometry.closed);
    this.solid(ctx, segs, this.width(wall.props.thickness), WALL_COLORS[wall.props.kind]);
  }

  private door(ctx: Ctx2D, door: DoorObject): void {
    const { a, b } = door.geometry;
    const ab: Seg = [a[0], a[1], b[0], b[1]];
    if (door.props.secret) {
      this.solid(ctx, [ab], this.width(SECRET_AS_WALL.thickness), WALL_COLORS[SECRET_AS_WALL.kind]);
      return;
    }
    const shape = doorShape(door);
    const width = this.width(DOOR_THICKNESS);
    if (shape.gap !== null) {
      this.dashed(ctx, [shape.gap], Math.max(1.5 / this.ppc, width / 3), DOOR_COLOR, 0.6);
    }
    this.solid(ctx, [shape.leaf], width, DOOR_COLOR);
    if (door.props.locked) {
      const [mx, my] = segmentMiddle(ab);
      const s = Math.max(0.2, 6 / this.ppc);
      ctx.globalAlpha = 1;
      ctx.fillStyle = cssColor(DOOR_LOCKED_MARK);
      ctx.beginPath();
      ctx.rect(mx - s / 2, my - s / 2, s, s);
      ctx.fill();
      ctx.strokeStyle = cssColor(WALL_OUTLINE);
      ctx.lineWidth = 1 / this.ppc;
      ctx.stroke();
    }
  }

  private window(ctx: Ctx2D, win: WindowObject): void {
    const { a, b } = win.geometry;
    const seg: Seg = [a[0], a[1], b[0], b[1]];
    const width = this.width(WINDOW_THICKNESS);
    if (win.props.kind === 'opening') {
      this.dashed(ctx, [seg], width, WINDOW_COLOR, 0.7);
      return;
    }
    this.solid(ctx, [seg], width, WINDOW_COLOR);
    if (win.props.kind !== 'bars') return;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len <= 0) return;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    const half = width * 1.6;
    const step = Math.max(0.25, 5 / this.ppc);
    const bars: Seg[] = [];
    for (let t = step / 2; t < len; t += step) {
      const x = a[0] + ux * t;
      const y = a[1] + uy * t;
      bars.push([x - uy * half, y + ux * half, x + uy * half, y - ux * half]);
    }
    this.stroke(ctx, bars, Math.max(1 / this.ppc, width / 2), WALL_OUTLINE, 0.9, 'butt');
  }

  /** Placed tokens of the region. */
  tokens(ctx: Ctx2D, x: number, y: number, w: number, h: number, ox: number, oy: number): void {
    if (!this.drawTokens) return;
    const region = this.region(x, y, w, h, 0);
    const { extent, ppc } = this;
    for (const t of this.scene.tokens) {
      const r = Math.hypot(t.w, t.h) / 2 + 1;
      if (t.x + r < region.x0 || t.x - r > region.x1 || t.y + r < region.y0 || t.y - r > region.y1)
        continue;
      const rot = (((t.rotation % 360) + 360) % 360) * (Math.PI / 180);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const e = ox + (t.x - extent.x) * ppc;
      const f = oy + (t.y - extent.y) * ppc;
      // Token space in cells (rotated around its centre).
      const cells = (): void => ctx.setTransform(ppc * cos, ppc * sin, -ppc * sin, ppc * cos, e, f);
      this.token(ctx, t, cells, () => ctx.setTransform(cos, sin, -sin, cos, e, f));
    }
    ctx.globalAlpha = 1;
  }

  private token(ctx: Ctx2D, t: SnapshotToken, cells: () => void, pixels: () => void): void {
    const { ppc } = this;
    const image = t.image === null ? null : (this.tokenImages?.get(t.image) ?? null);
    cells();
    ctx.globalAlpha = 1;
    if (image !== null) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(image.image, 0, 0, image.width, image.height, -t.w / 2, -t.h / 2, t.w, t.h);
    } else {
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = cssColor(t.ring);
      ctx.beginPath();
      ctx.ellipse(0, 0, t.w / 2, t.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      const text = initials(t.name) || '?';
      pixels();
      ctx.globalAlpha = 1;
      ctx.fillStyle = cssColor(TOKEN_INITIALS_COLOR);
      ctx.font = `700 ${Math.max(1, Math.min(t.w, t.h) * TOKEN_INITIALS_SIZE * ppc)}px ${TOKEN_FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 0);
      cells();
    }
    const ringPx = Math.max(1, TOKEN_RING_WIDTH * (Math.min(t.w, t.h) / 2) * ppc);
    const ring = ringPx / ppc;
    const outline = Math.max(1, ringPx / 4) / ppc;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssColor(t.ring);
    ctx.lineWidth = ring;
    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      Math.max(0, (t.w - ring) / 2),
      Math.max(0, (t.h - ring) / 2),
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = cssColor(TOKEN_OUTLINE_COLOR);
    ctx.lineWidth = outline;
    ctx.beginPath();
    ctx.ellipse(0, 0, (t.w + outline) / 2, (t.h + outline) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Multiplies the region (w × h pixels at dx, dy of ctx) by the lightmap, built on `light`
   * (a surface of at least w × h pixels).
   */
  lighting(
    ctx: Ctx2D,
    light: Ctx2D,
    x: number,
    y: number,
    w: number,
    h: number,
    dx: number,
    dy: number,
    transparent: boolean,
  ): void {
    if (!this.drawLighting) return;
    const { extent, ppc } = this;
    light.setTransform(1, 0, 0, 1, 0, 0);
    light.globalAlpha = 1;
    light.globalCompositeOperation = 'source-over';
    const grey = Math.round((1 - this.darkness) * 255);
    light.fillStyle = cssColor(grey * 0x010101);
    light.fillRect(0, 0, w, h);
    light.globalCompositeOperation = 'lighter';
    light.setTransform(ppc, 0, 0, ppc, -x - extent.x * ppc, -y - extent.y * ppc);
    const region = this.region(x, y, w, h, 0);
    for (const { light: l, polygon, box } of this.lights) {
      if (polygon.length < 6 || !overlaps(box, region)) continue;
      const color = cssColor(scaled(l.color, l.level));
      const g = light.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.dim);
      g.addColorStop(0, color);
      g.addColorStop(Math.min(1, l.radius / l.dim), color);
      g.addColorStop(1, 'rgb(0 0 0)');
      light.fillStyle = g;
      light.beginPath();
      light.moveTo(polygon[0]!, polygon[1]!);
      for (let i = 2; i + 1 < polygon.length; i += 2) light.lineTo(polygon[i]!, polygon[i + 1]!);
      light.closePath();
      light.fill();
    }
    light.setTransform(1, 0, 0, 1, 0, 0);
    const [tr, tg, tb] = this.tint;
    if (tr < 1 || tg < 1 || tb < 1) {
      light.globalCompositeOperation = 'multiply';
      light.fillStyle = cssColor(
        (Math.round(tr * 255) << 16) | (Math.round(tg * 255) << 8) | Math.round(tb * 255),
      );
      light.fillRect(0, 0, w, h);
    }
    if (transparent) {
      light.globalCompositeOperation = 'destination-in';
      light.drawImage(ctx.canvas as CanvasImageSource, dx, dy, w, h, 0, 0, w, h);
    }
    light.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(light.canvas as CanvasImageSource, 0, 0, w, h, dx, dy, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  private explored(sx: number, sy: number): boolean {
    const key = `${Math.floor(sx / FOG_SIDE)}:${Math.floor(sy / FOG_SIDE)}` as ChunkKey;
    const bits = this.fog.get(key);
    if (bits === undefined) return false;
    const i =
      (sy - Math.floor(sy / FOG_SIDE) * FOG_SIDE) * FOG_SIDE +
      (sx - Math.floor(sx / FOG_SIDE) * FOG_SIDE);
    return (bits[i >> 3]! & (0x80 >> (i & 7))) !== 0;
  }

  /** Unexplored sub-cells of the region in black (each pixel takes the sub-cell of its centre). */
  fogLayer(ctx: Ctx2D, x: number, y: number, w: number, h: number, ox: number, oy: number): void {
    if (!this.drawFog) return;
    const { extent, ppc } = this;
    const sub = (v: number): number => Math.floor(v * FOG_SUBCELLS);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000000';
    const subPx = ppc / FOG_SUBCELLS;
    /** First image column whose centre lies at or after sub-cell column sx. */
    const colStart = (sx: number): number => Math.ceil((sx / FOG_SUBCELLS - extent.x) * ppc - 0.5);
    let py = y;
    while (py < y + h) {
      const sy = sub(extent.y + (py + 0.5) / ppc);
      let py1 = py + 1;
      while (py1 < y + h && sub(extent.y + (py1 + 0.5) / ppc) === sy) py1++;
      let run = -1;
      const flush = (end: number): void => {
        if (run >= 0 && end > run) ctx.fillRect(run + ox, py + oy, end - run, py1 - py);
        run = -1;
      };
      if (subPx >= 1) {
        const sx0 = sub(extent.x + (x + 0.5) / ppc);
        const sx1 = sub(extent.x + (x + w - 0.5) / ppc);
        for (let sx = sx0; sx <= sx1; sx++) {
          const c0 = Math.max(x, colStart(sx));
          if (this.explored(sx, sy)) flush(c0);
          else if (run < 0) run = c0;
        }
      } else {
        for (let px = x; px < x + w; px++) {
          if (this.explored(sub(extent.x + (px + 0.5) / ppc), sy)) flush(px);
          else if (run < 0) run = px;
        }
      }
      flush(x + w);
      py = py1;
    }
  }
}
