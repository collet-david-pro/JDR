/** Maps tab: sorting and grouping by folder ("Acte 1/Crypte", projet.md 7.2 maps.folder). */
import type { MapSummary } from '../types';

export const MAP_SORTS = ['manual', 'name', 'updated'] as const;
export type MapSort = (typeof MAP_SORTS)[number];

export interface MapFolderGroup {
  /** null = maps without a folder. */
  readonly folder: string | null;
  /** Path segments ("Acte 1", "Crypte"), for display. */
  readonly path: readonly string[];
  readonly maps: readonly MapSummary[];
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

export function isMapSort(value: string | null | undefined): value is MapSort {
  return value !== null && value !== undefined && (MAP_SORTS as readonly string[]).includes(value);
}

export function sortMaps(maps: readonly MapSummary[], sort: MapSort): MapSummary[] {
  const byName = (a: MapSummary, b: MapSummary): number => collator.compare(a.name, b.name);
  const list = [...maps];
  switch (sort) {
    case 'name':
      return list.sort((a, b) => byName(a, b) || a.id.localeCompare(b.id));
    case 'updated':
      return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || byName(a, b));
    case 'manual':
      return list.sort((a, b) => a.sort_order - b.sort_order || byName(a, b));
  }
}

/** Groups by folder: maps without folder first, then folders in natural order. */
export function groupByFolder(maps: readonly MapSummary[], sort: MapSort): MapFolderGroup[] {
  const groups = new Map<string | null, MapSummary[]>();
  for (const map of sortMaps(maps, sort)) {
    const folder = map.folder === null || map.folder.trim() === '' ? null : map.folder;
    let list = groups.get(folder);
    if (list === undefined) groups.set(folder, (list = []));
    list.push(map);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : collator.compare(a, b)))
    .map(([folder, list]) => ({
      folder,
      path: folder === null ? [] : folder.split('/').filter((p) => p !== ''),
      maps: list,
    }));
}

/** Distinct folders (suggestions of the folder field). */
export function folderNames(maps: readonly MapSummary[]): string[] {
  const set = new Set<string>();
  for (const m of maps) if (m.folder !== null && m.folder !== '') set.add(m.folder);
  return [...set].sort((a, b) => collator.compare(a, b));
}
