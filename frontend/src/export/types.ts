import type { CellRect, MapView } from '../editor/contracts';

/**
 * What the editor hands to the PNG export dialog (contract P4c lot 2 ⇄ lot 3).
 * `selection` / `viewport` are null when there is no selection / no visible area.
 */
export interface ExportSource {
  readonly view: MapView;
  readonly name: string;
  readonly selection: CellRect | null;
  readonly viewport: CellRect | null;
}
