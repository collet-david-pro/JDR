/**
 * Model of the "Textures" tab (P8e2b): material, palette, size, seed, 3x3 tiling preview,
 * "save to my library" (PNG, source `generated`). Rendering runs on the main thread (about 20 ms
 * for 256 px); no debounce needed.
 */
import { PngEncoder } from '../../formats/png-encoder';
import {
  MATERIALS,
  PALETTES,
  TEXTURE_SIZES,
  renderTexture,
  type Material,
  type PaletteInfo,
} from '../../procgen/textures';
import type { Asset } from '../types';
import type { Translate } from '../translator';
import { randomSeed } from './seed';

export type TextureSize = (typeof TEXTURE_SIZES)[number];

export interface TexturePanelDeps {
  upload: (
    file: Blob,
    fileName: string,
    fields: { kind: 'texture'; name: string; source: 'generated' },
  ) => Promise<{ asset: Asset; duplicate: boolean }>;
  t: Translate;
}

export function palettesFor(material: Material): PaletteInfo[] {
  return Object.values(PALETTES).filter((p) => p.materials.includes(material));
}

/** RGBA -> PNG bytes (opaque: no alpha channel). */
export async function encodeTexturePng(rgba: Uint8ClampedArray, size: number): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const enc = new PngEncoder({ width: size, height: size, alpha: false }, (b) => {
    parts.push(b.slice());
  });
  await enc.begin();
  await enc.writeRows(rgba, size);
  await enc.end();
  return new Blob(parts, { type: 'image/png' });
}

export class TexturePanelModel {
  readonly materials = MATERIALS;
  readonly sizes = TEXTURE_SIZES;
  material = $state<Material>('stone');
  palette = $state('stone_grey');
  size = $state<TextureSize>(256);
  seed = $state(randomSeed());
  pixels = $state.raw<Uint8ClampedArray | null>(null);
  error = $state<string | null>(null);
  saving = $state(false);
  saved = $state.raw<{ asset: Asset; duplicate: boolean } | null>(null);

  constructor(private readonly deps: TexturePanelDeps) {
    this.palette = palettesFor(this.material)[0]?.id ?? this.palette;
  }

  get palettes(): PaletteInfo[] {
    return palettesFor(this.material);
  }

  setMaterial(material: Material): void {
    this.material = material;
    if (!palettesFor(material).some((p) => p.id === this.palette)) {
      this.palette = palettesFor(material)[0]?.id ?? this.palette;
    }
  }

  rollSeed(): void {
    this.seed = randomSeed();
  }

  /** Signature of the current request (a change clears the "saved" notice and re-renders). */
  key(): string {
    return `${this.material}|${this.palette}|${this.size}|${this.seed}`;
  }

  render(): void {
    this.saved = null;
    this.error = null;
    if (this.seed === '' || this.seed.length > 64) {
      this.pixels = null;
      return;
    }
    try {
      this.pixels = renderTexture({
        material: this.material,
        palette: this.palette,
        size: this.size,
        seed: this.seed,
      });
    } catch (error) {
      this.pixels = null;
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  /** Name of the asset: "<matière> <palette> <graine>". */
  assetName(): string {
    const palette = PALETTES[this.palette]?.name ?? this.palette;
    return `${this.deps.t(`procgen.materials.${this.material}`)} ${palette} ${this.seed}`;
  }

  /** Uploads the texture; throws the upload error (the panel shows it through the error translator). */
  async save(): Promise<Asset | null> {
    const pixels = this.pixels;
    if (pixels === null || this.saving) return null;
    this.saving = true;
    try {
      const name = this.assetName();
      const blob = await encodeTexturePng(pixels, this.size);
      const result = await this.deps.upload(blob, `${this.material}-${this.palette}.png`, {
        kind: 'texture',
        name,
        source: 'generated',
      });
      this.saved = result;
      return result.asset;
    } finally {
      this.saving = false;
    }
  }
}
