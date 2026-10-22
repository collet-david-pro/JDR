/** Tile palette of the editor: assets picked in the library ⇒ palette entries (projet.md 15.2). */
import type { PaletteEntry } from '../contracts';
import type { AssetInfo } from '../model/MapDocument';
import { variantFrameCount } from '../../engine/cell-transform';

/** What the editor needs from a library asset (lib/types.ts Asset). */
export interface TileAsset {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Signed URLs (projet.md 9.3). */
  readonly urls: { readonly full: string; readonly thumb: string };
}

export interface PaletteItem {
  readonly index: number;
  readonly assetId: string;
  readonly name: string;
  /** Thumbnail to show in the panel (signed thumb URL, else the full image, else none). */
  readonly thumb: string | null;
  /** Variant frames of the image (strip of N square frames), 1 otherwise. */
  readonly frames: number;
}

interface Known {
  readonly name: string;
  readonly full: string;
  readonly thumb: string;
  readonly frames: number;
}

/** Asset details that palette entries do not carry (thumbnail, variant frames). */
export class PaletteCatalog {
  private readonly known = new Map<string, Known>();

  remember(asset: TileAsset): void {
    this.known.set(asset.id, {
      name: asset.name,
      full: asset.urls.full,
      thumb: asset.urls.thumb,
      frames: variantFrameCount(asset.width, asset.height),
    });
  }

  /** Palette entry loaded with the map (signed URLs; variant frames unknown ⇒ 1). */
  rememberEntry(
    assetId: string,
    info: { name: string; full: string | null; thumb: string | null },
  ): void {
    if (this.known.has(assetId)) return;
    const full = info.full ?? info.thumb ?? '';
    this.known.set(assetId, {
      name: info.name,
      full,
      thumb: info.thumb ?? full,
      frames: 1,
    });
  }

  /** For MapDocumentInit.resolveAsset. */
  resolve(assetId: string): AssetInfo | null {
    const k = this.known.get(assetId);
    return k === undefined ? null : { url: k.full === '' ? null : k.full, name: k.name };
  }

  frames(assetId: string): number {
    return this.known.get(assetId)?.frames ?? 1;
  }

  items(palette: readonly (PaletteEntry | null)[]): PaletteItem[] {
    const out: PaletteItem[] = [];
    palette.forEach((entry, index) => {
      if (entry === null || index === 0) return;
      const k = this.known.get(entry.assetId);
      out.push({
        index,
        assetId: entry.assetId,
        name: entry.name,
        thumb: k !== undefined && k.thumb !== '' ? k.thumb : entry.url,
        frames: k?.frames ?? 1,
      });
    });
    return out;
  }
}
