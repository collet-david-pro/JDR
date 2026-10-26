/**
 * Viewers of the current view (pure): placed tokens of ViewOptions.viewers whose definition
 * has vision enabled. Each gets a vision polygon (radius vision.range) and, with darkvision, a
 * second polygon of radius min(dark, range) used for the "within `dark` cells" rule.
 */

import type { PlacedToken, Polygon, TokenDefView, VisibleScene } from '../../editor/contracts';
import type { VisionSource } from '../../vision';

export const DARK_SOURCE_PREFIX = 'dark:';

export interface ViewerInfo {
  readonly uid: string;
  readonly x: number;
  readonly y: number;
  readonly range: number;
  /** Darkvision radius, ≤ range. */
  readonly dark: number;
}

export class ViewerSet {
  private infos: readonly ViewerInfo[] = [];
  private polygons: ReadonlyMap<string, Polygon> = new Map();

  /** Viewer tokens that can see (missing tokens / no vision are skipped). */
  collect(
    uids: readonly string[],
    token: (uid: string) => PlacedToken | undefined,
    tokenDef: (id: string) => TokenDefView | null,
  ): ViewerInfo[] {
    const out: ViewerInfo[] = [];
    for (const uid of uids) {
      const t = token(uid);
      if (t === undefined) continue;
      const vision = tokenDef(t.token_id)?.vision;
      if (vision === undefined || !vision.enabled || !(vision.range > 0)) continue;
      const dark = Math.min(Math.max(0, vision.dark || 0), vision.range);
      out.push({ uid, x: t.x, y: t.y, range: vision.range, dark });
    }
    return out;
  }

  static sources(infos: readonly ViewerInfo[]): VisionSource[] {
    const out: VisionSource[] = [];
    for (const v of infos) {
      out.push({ id: v.uid, x: v.x, y: v.y, radius: v.range });
      if (v.dark > 0) out.push({ id: DARK_SOURCE_PREFIX + v.uid, x: v.x, y: v.y, radius: v.dark });
    }
    return out;
  }

  update(infos: readonly ViewerInfo[], polygons: ReadonlyMap<string, Polygon>): void {
    this.infos = infos;
    this.polygons = polygons;
  }

  visible(): VisibleScene['viewers'] {
    return this.infos.flatMap((v) => {
      const polygon = this.polygons.get(v.uid);
      return polygon === undefined ? [] : [{ uid: v.uid, x: v.x, y: v.y, polygon, dark: v.dark }];
    });
  }

  darkPolygons(): Polygon[] {
    return this.infos.flatMap((v) => {
      const p = v.dark > 0 ? this.polygons.get(DARK_SOURCE_PREFIX + v.uid) : undefined;
      return p === undefined ? [] : [p];
    });
  }

  clear(): void {
    this.infos = [];
    this.polygons = new Map();
  }
}
