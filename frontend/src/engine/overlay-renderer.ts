/**
 * Edit overlay (projet.md 14.1 item 12), drawn in screen space above everything: brush /
 * eraser cell preview, shape rectangle, dashed selection, ruler with its label, and the P5
 * overlays (overlay-scene.ts). A `group` draws its items in order.
 */

import type { CameraState, GridSpec, Overlay, SceneView } from '../editor/contracts';
import { worldToScreen, type Viewport } from './camera';
import { cellRuns, normalizeRect, rectDashes, type CellRun } from './overlay-geometry';
import { drawSceneOverlay, isSceneOverlay } from './overlay-scene';
import { Container, Graphics, Text } from './pixi';

const ACCENT = 0x2f80ed;
const ERASE = 0xe5484d;
const DARK = 0x111418;
const LIGHT = 0xffffff;

export class OverlayRenderer {
  readonly root = new Container();
  private readonly gfx = new Graphics();
  private readonly labelBg = new Graphics();
  private label: Text | null = null;
  private overlay: Overlay | null = null;
  private readonly runs = new Map<Overlay, CellRun[]>();
  private scene: SceneView | null = null;

  constructor() {
    this.root.addChild(this.gfx, this.labelBg);
  }

  set(overlay: Overlay | null): void {
    this.overlay = overlay;
    this.runs.clear();
    const collect = (o: Overlay, depth: number): void => {
      if (o.kind === 'cells') this.runs.set(o, cellRuns(o.cells));
      else if (o.kind === 'group' && depth < 8) for (const i of o.items) collect(i, depth + 1);
    };
    if (overlay !== null) collect(overlay, 0);
  }

  /** Scene read by the `objects` overlay (selected objects / tokens). */
  setScene(scene: SceneView | null): void {
    this.scene = scene;
  }

  draw(camera: CameraState, viewport: Viewport, grid: GridSpec | null, dpr: number): void {
    const g = this.gfx;
    g.clear();
    this.labelBg.clear();
    if (this.label !== null) this.label.visible = false;
    const o = this.overlay;
    if (o === null || grid === null) return;
    const cellPx = grid.cellPx;
    const toScreen = (x: number, y: number): { x: number; y: number } =>
      worldToScreen(camera, viewport, cellPx, x, y);
    this.drawOne(o, camera, viewport, cellPx, dpr, toScreen, 0);
  }

  private drawOne(
    o: Overlay,
    camera: CameraState,
    viewport: Viewport,
    cellPx: number,
    dpr: number,
    toScreen: (x: number, y: number) => { x: number; y: number },
    depth: number,
  ): void {
    const g = this.gfx;
    if (isSceneOverlay(o)) {
      drawSceneOverlay(g, o, toScreen, this.scene);
      return;
    }
    switch (o.kind) {
      case 'group':
        if (depth >= 8) break;
        for (const item of o.items) {
          this.drawOne(item, camera, viewport, cellPx, dpr, toScreen, depth + 1);
        }
        break;
      case 'cells': {
        const size = cellPx * camera.zoom;
        let any = false;
        for (const run of this.runs.get(o) ?? []) {
          const p = toScreen(run.x, run.y);
          const w = run.w * size;
          if (p.x > viewport.width || p.y > viewport.height || p.x + w < 0 || p.y + size < 0) {
            continue;
          }
          g.rect(p.x, p.y, w, size);
          any = true;
        }
        if (any) g.fill({ color: o.erase === true ? ERASE : ACCENT, alpha: 0.38 });
        break;
      }
      case 'rect': {
        const r = normalizeRect(o.x, o.y, o.w, o.h);
        const a = toScreen(r.x, r.y);
        const b = toScreen(r.x + r.w, r.y + r.h);
        g.rect(a.x, a.y, b.x - a.x, b.y - a.y)
          .fill({ color: ACCENT, alpha: 0.14 })
          .stroke({ width: 1.5, color: ACCENT, alpha: 0.95, alignment: 0.5 });
        break;
      }
      case 'selection': {
        // Union of rectangles: each one outlined (overlaps stay readable at these alphas).
        const boxes = o.rects.map((rect) => {
          const r = normalizeRect(rect.x, rect.y, rect.w, rect.h);
          const a = toScreen(r.x, r.y);
          const b = toScreen(r.x + r.w, r.y + r.h);
          return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
        });
        if (boxes.length === 0) break;
        for (const b of boxes) g.rect(b.x, b.y, b.w, b.h);
        g.fill({ color: ACCENT, alpha: 0.08 });
        for (const b of boxes) g.rect(b.x, b.y, b.w, b.h);
        g.stroke({ width: 1.5, color: DARK, alpha: 0.85, alignment: 0.5 });
        for (const b of boxes) {
          for (const [x0, y0, x1, y1] of rectDashes(b.x, b.y, b.w, b.h, 6, 4)) {
            g.moveTo(x0, y0).lineTo(x1, y1);
          }
        }
        g.stroke({ width: 1.5, color: LIGHT, alpha: 1, cap: 'butt' });
        break;
      }
      case 'ruler': {
        const a = toScreen(o.from[0], o.from[1]);
        const b = toScreen(o.to[0], o.to[1]);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4, color: DARK, alpha: 0.45 });
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: LIGHT, alpha: 1 });
        for (const p of [a, b]) {
          g.circle(p.x, p.y, 4).fill({ color: ACCENT }).stroke({ width: 1.5, color: LIGHT });
        }
        this.drawLabel(o.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 16, dpr);
        break;
      }
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.label = null;
  }

  private drawLabel(text: string, cx: number, cy: number, dpr: number): void {
    if (text === '') return;
    let label = this.label;
    if (label === null) {
      label = new Text({
        text,
        resolution: dpr,
        style: {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          fontSize: 13,
          fontWeight: '600',
          fill: LIGHT,
        },
      });
      label.anchor.set(0.5);
      this.label = label;
      this.root.addChild(label);
    }
    if (label.text !== text) label.text = text;
    if (label.resolution !== dpr) label.resolution = dpr;
    label.visible = true;
    label.position.set(Math.round(cx), Math.round(cy));
    const padX = 6;
    const padY = 3;
    const w = label.width + 2 * padX;
    const h = label.height + 2 * padY;
    this.labelBg
      .roundRect(Math.round(cx - w / 2), Math.round(cy - h / 2), w, h, 4)
      .fill({ color: DARK, alpha: 0.82 });
  }
}
