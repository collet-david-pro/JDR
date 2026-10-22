import type { MapDetail, MapSummary } from '../../src/lib/types';

export function makeSummary(overrides: Partial<MapSummary> = {}): MapSummary {
  return {
    id: '11',
    game_id: '7',
    name: 'Crypte',
    folder: null,
    sort_order: 0,
    kind: 'battle',
    grid: { width: 40, height: 30 },
    thumb_url: null,
    revision: 0,
    updated_at: '2026-10-22T10:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

export function makeMap(overrides: Partial<MapDetail> = {}): MapDetail {
  return {
    ...makeSummary(),
    grid: {
      type: 'square',
      cell_px: 70,
      width: 40,
      height: 30,
      unit_label: 'ft',
      unit_per_cell: 5,
    },
    theme: 'parchment',
    ambient: {
      darkness: 0,
      tint: null,
      time_of_day: null,
      weather: { type: 'none', intensity: 0 },
    },
    palette: [null],
    layers: [
      { id: 'ground', kind: 'tiles', visible: true, locked: false, opacity: 1 },
      { id: 'terrain', kind: 'tiles', visible: true, locked: false, opacity: 1 },
      { id: 'decor', kind: 'tiles', visible: true, locked: false, opacity: 1 },
      { id: 'walls', kind: 'objects', visible: true, locked: false, opacity: 1 },
      { id: 'gm', kind: 'objects', visible: true, locked: false, opacity: 1, gm_only: true },
    ],
    floors: [{ id: '91', level: 0, name: 'Rez-de-chaussée', sort_order: 0 }],
    format_version: 1,
    objects: [],
    notes: [],
    tokens_placed: [],
    ...overrides,
  };
}
