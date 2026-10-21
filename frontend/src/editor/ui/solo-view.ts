/**
 * MapView given to the engine: the document, with an optional "solo" layer (projet.md 15.2).
 * Solo is a display preference of this editor session, not a map change: it is neither saved
 * nor undoable, so it lives here rather than in a map.meta op.
 */
import type {
  CellValue,
  ChunkKey,
  ChunksChangedEvent,
  GridSpec,
  GridTheme,
  LayerDef,
  LayerId,
  MapView,
  PaletteEntry,
  TileLayerId,
} from '../contracts';

export class SoloView implements MapView {
  private soloId: LayerId | null = null;
  private cachedFor: readonly LayerDef[] | null = null;
  private cachedSolo: LayerId | null = null;
  private cached: readonly LayerDef[] = [];
  private readonly metaListeners = new Set<() => void>();

  constructor(private readonly view: MapView) {}

  get solo(): LayerId | null {
    return this.soloId;
  }

  /** Shows only this layer (null: every layer per its own visibility). */
  setSolo(id: LayerId | null): void {
    if (id === this.soloId) return;
    this.soloId = id;
    for (const l of [...this.metaListeners]) l();
  }

  get grid(): GridSpec {
    return this.view.grid;
  }
  get theme(): GridTheme {
    return this.view.theme;
  }
  get revision(): number {
    return this.view.revision;
  }
  get palette(): readonly (PaletteEntry | null)[] {
    return this.view.palette;
  }

  get layers(): readonly LayerDef[] {
    const source = this.view.layers;
    if (this.soloId === null) return source;
    if (this.cachedFor !== source || this.cachedSolo !== this.soloId) {
      const solo = this.soloId;
      this.cached = source.map((l) =>
        l.visible === (l.id === solo) ? l : { ...l, visible: l.id === solo },
      );
      this.cachedFor = source;
      this.cachedSolo = solo;
    }
    return this.cached;
  }

  getCell(layer: TileLayerId, x: number, y: number): CellValue {
    return this.view.getCell(layer, x, y);
  }
  chunkKeys(layer: TileLayerId): readonly ChunkKey[] {
    return this.view.chunkKeys(layer);
  }
  chunkCells(layer: TileLayerId, key: ChunkKey): Uint16Array | null {
    return this.view.chunkCells(layer, key);
  }
  onChunksChanged(listener: (event: ChunksChangedEvent) => void): () => void {
    return this.view.onChunksChanged(listener);
  }
  onMetaChanged(listener: () => void): () => void {
    this.metaListeners.add(listener);
    const off = this.view.onMetaChanged(listener);
    return () => {
      this.metaListeners.delete(listener);
      off();
    };
  }
}
