import { describe, expect, it } from 'vitest';
import { folderNames, groupByFolder, sortMaps } from '../../src/lib/maps/folders';
import {
  mapPatch,
  newMapDraft,
  normalizeFolder,
  validateMapDraft,
} from '../../src/lib/maps/map-form';
import { makeSummary } from './fixtures';

describe('map creation form', () => {
  it('pre-fills the units from the game settings', () => {
    const draft = newMapDraft({ unit_label: 'm', unit_per_cell: 1.5, default_cell_px: 100 }, 'A');
    expect(draft).toMatchObject({
      folder: 'A',
      cell_px: '100',
      unit_label: 'm',
      unit_per_cell: '1.5',
      width: '30',
      height: '20',
    });
  });

  it('builds the POST body', () => {
    const draft = {
      ...newMapDraft(null),
      name: '  Crypte ',
      folder: ' Acte 1 // Crypte/ ',
      width: '400',
      height: '1',
      unit_per_cell: '1,5',
      kind: 'world',
    };
    expect(validateMapDraft(draft)).toEqual({
      ok: true,
      input: {
        name: 'Crypte',
        folder: 'Acte 1/Crypte',
        kind: 'world',
        width: 400,
        height: 1,
        cell_px: 70,
        unit_label: 'ft',
        unit_per_cell: 1.5,
      },
    });
  });

  it('checks the bounds of the contract', () => {
    const result = validateMapDraft({
      ...newMapDraft(null),
      name: ' ',
      folder: 'x'.repeat(192),
      width: '401',
      height: '0',
      cell_px: '12.5',
      unit_label: 'kilometres!',
      unit_per_cell: '0',
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'required',
        folder: 'too_long',
        width: 'too_large',
        height: 'too_small',
        cell_px: 'invalid',
        unit_label: 'too_long',
        unit_per_cell: 'too_small',
      },
    });
  });

  it('normalises folder paths and builds rename/move patches', () => {
    expect(normalizeFolder('')).toBeNull();
    expect(normalizeFolder(' / ')).toBeNull();
    expect(normalizeFolder('a/ b ')).toBe('a/b');
    const map = makeSummary({ name: 'A', folder: 'X' });
    expect(mapPatch(map, 'A', 'X')).toEqual({});
    expect(mapPatch(map, ' B ', '')).toEqual({ name: 'B', folder: null });
    expect(mapPatch(map, 'A', 'Y/Z')).toEqual({ folder: 'Y/Z' });
  });
});

describe('folders and sorting', () => {
  const maps = [
    makeSummary({
      id: '1',
      name: 'Taverne',
      folder: 'Acte 2',
      sort_order: 1,
      updated_at: '2026-10-01T00:00:00Z',
    }),
    makeSummary({
      id: '2',
      name: 'crypte 10',
      folder: 'Acte 1/Crypte',
      sort_order: 0,
      updated_at: '2026-10-03T00:00:00Z',
    }),
    makeSummary({
      id: '3',
      name: 'Crypte 2',
      folder: 'Acte 1/Crypte',
      sort_order: 2,
      updated_at: '2026-10-02T00:00:00Z',
    }),
    makeSummary({
      id: '4',
      name: 'Monde',
      folder: null,
      sort_order: 5,
      updated_at: '2026-09-01T00:00:00Z',
    }),
  ];

  it('groups by folder, root first', () => {
    const groups = groupByFolder(maps, 'manual');
    expect(groups.map((g) => [g.folder, g.path, g.maps.map((m) => m.id)])).toEqual([
      [null, [], ['4']],
      ['Acte 1/Crypte', ['Acte 1', 'Crypte'], ['2', '3']],
      ['Acte 2', ['Acte 2'], ['1']],
    ]);
  });

  it('sorts by order, natural name or last change', () => {
    expect(sortMaps(maps, 'name').map((m) => m.name)).toEqual([
      'Crypte 2',
      'crypte 10',
      'Monde',
      'Taverne',
    ]);
    expect(sortMaps(maps, 'updated')[0]!.id).toBe('2');
    expect(folderNames(maps)).toEqual(['Acte 1/Crypte', 'Acte 2']);
  });
});
