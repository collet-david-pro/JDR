/**
 * Read-only MapView of one floor of a MapDocument (the ghost floor drawn under the shown one).
 * Layers, palette, theme and grid are those of the document.
 */
import type {
  CellValue,
  ChunkKey,
  ChunksChangedEvent,
  GridSpec,
  GridTheme,
  LayerDef,
  MapView,
  PaletteEntry,
  TileLayerId,
} from '../contracts';
import type { MapDocument } from './MapDocument';

/** Read-only view of a single floor exposed through the MapView interface. */
export class FloorView implements MapView {
  constructor(
    private readonly doc: MapDocument,
    /** Floor uid. */
    readonly floor: string,
  ) {}

  get grid(): GridSpec {
    return this.doc.grid;
  }
  get layers(): readonly LayerDef[] {
    return this.doc.layers;
  }
  get theme(): GridTheme {
    return this.doc.theme;
  }
  get revision(): number {
    return this.doc.revision;
  }
  get palette(): readonly (PaletteEntry | null)[] {
    return this.doc.palette;
  }
  getCell(layer: TileLayerId, x: number, y: number): CellValue {
    return this.doc.getCell(layer, x, y, this.floor);
  }
  chunkKeys(layer: TileLayerId): readonly ChunkKey[] {
    return this.doc.chunkKeysOf(this.floor, layer);
  }
  chunkCells(layer: TileLayerId, key: ChunkKey): Uint16Array | null {
    return this.doc.chunkCellsOf(this.floor, layer, key);
  }
  onChunksChanged(listener: (event: ChunksChangedEvent) => void): () => void {
    return this.doc.onFloorChunksChanged((floor, event) => {
      if (floor === this.floor) listener(event);
    });
  }
  onMetaChanged(listener: () => void): () => void {
    return this.doc.onMetaChanged(listener);
  }
}
