import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../src/editor/contracts';
import type { TextObject } from '../../src/editor/contracts-text';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { normalizeObject } from '../../src/editor/model/scene-values';
import { createTextTool } from '../../src/editor/tools/text';
import { textCorners, textDistance } from '../../src/editor/text-geometry';
import { textOutlineColor } from '../../src/editor/text-style';
import { MAP_THEMES } from '../../src/formats/map-document';
import { GRID_THEME_IDS, GRID_THEMES, gridTheme } from '../../src/engine/grid-themes';
import { gridStrokes } from '../../src/engine/grid-lines';
import { gridLinePlan } from '../../src/export/cell-render';
import schema from '../../src/formats/map.schema.json';
import { ev, grid, palette, settings } from '../editor/helpers';

const text = (over: Partial<TextObject['props']> = {}, x = 5, y = 5): TextObject => ({
  uid: 't1',
  floor: 'ground',
  type: 'text',
  layer: 'labels',
  visibility: 'all',
  locked: false,
  sort_order: 0,
  rev: 1,
  geometry: { x, y },
  props: { text: 'Auberge', size: 1, color: '#112233', font: 'sans', rotation: 0, ...over },
});

describe('grid themes (l17)', () => {
  it('the engine, the document format and the schema list the same themes', () => {
    expect([...GRID_THEME_IDS].sort()).toEqual([...MAP_THEMES].sort());
    expect((schema.properties.theme as { enum: string[] }).enum.sort()).toEqual(
      [...MAP_THEMES].sort(),
    );
    for (const id of GRID_THEME_IDS) expect(gridTheme(id)).toBe(GRID_THEMES[id]);
    expect(gridTheme('unknown')).toBe(GRID_THEMES.parchment);
  });

  const input = {
    xs: [10, 20, 30, 40, 50, 60],
    ys: [10, 20, 30],
    xStart: 3,
    yStart: 1,
    th: 1,
    clip: { x: 0, y: 0, w: 100, h: 50 },
    major: 0,
  };

  it('lines: one rectangle per line, major lines get a thicker one', () => {
    const plain = gridStrokes({ ...input, style: 'lines' });
    expect(plain.base).toHaveLength(9);
    expect(plain.strong).toHaveLength(0);
    // xs indices 3..8 -> 5 is x = 30; ys indices 1..3 -> none
    const strong = gridStrokes({ ...input, style: 'lines', major: 5 });
    expect(strong.strong).toEqual([{ x: 29, y: 0, w: 2, h: 50 }]);
  });

  it('dots and crosses: marks at the intersections only', () => {
    const dots = gridStrokes({ ...input, style: 'dots' });
    expect(dots.base).toHaveLength(18);
    expect(dots.base[0]).toEqual({ x: 9, y: 9, w: 3, h: 3 });
    const crosses = gridStrokes({ ...input, style: 'crosses' });
    expect(crosses.base).toHaveLength(36);
  });

  it('falls back to lines when there are too many intersections', () => {
    const many = Array.from({ length: 300 }, (_, i) => i * 2);
    expect(gridStrokes({ ...input, xs: many, ys: many, style: 'dots' }).base).toHaveLength(600);
  });

  it('the export plan carries the style of the theme', () => {
    const g = { width: 40, height: 30, cellPx: 70, unitLabel: '', unitPerCell: 1 };
    const plan = gridLinePlan({ x: 3, y: 2, w: 20, h: 10 }, g, 70, GRID_THEMES.major5);
    expect(plan).toMatchObject({ style: 'lines', major: 5, xStart: 3, yStart: 2 });
    expect(gridLinePlan({ x: 0, y: 0, w: 5, h: 5 }, g, 70, GRID_THEMES.dots)?.style).toBe('dots');
  });
});

describe('text objects (l17)', () => {
  const bounds = { width: 20, height: 20 };

  it('normalizes the props like the server', () => {
    const o = normalizeObject(text({ text: '  Auberge  ', color: '#AABBCC' }) as MapObject, bounds);
    expect(o.props).toMatchObject({ text: 'Auberge', color: '#aabbcc' });
  });

  it('refuses invalid content, size, colour, font, rotation', () => {
    for (const bad of [
      { text: '' },
      { text: 'a'.repeat(201) },
      { text: 'a\nb' },
      { size: 11 },
      { size: 0.1 },
      { color: 'red' },
      { font: 'comic' as never },
      { rotation: 361 },
    ]) {
      expect(() => normalizeObject(text(bad) as MapObject, bounds)).toThrow();
    }
  });

  it('box, corners and distance follow the rotation', () => {
    const o = text({ text: 'abcd', size: 1 });
    expect(textDistance(o, [5, 5])).toBe(0);
    expect(textDistance(o, [5, 7])).toBeCloseTo(1.5);
    const turned = text({ text: 'abcd', size: 1, rotation: 90 });
    expect(textDistance(turned, [5, 6])).toBe(0);
    expect(textCorners(turned)).toHaveLength(4);
  });

  it('outline colour contrasts with the text colour', () => {
    expect(textOutlineColor('#ffffff')).toBe('#000000');
    expect(textOutlineColor('#101010')).toBe('#ffffff');
  });

  it('the tool adds a text at the clicked point, and refuses an empty content', () => {
    const doc = new MapDocument({ grid: grid(20, 20), palette: palette(4), floor: 'ground' });
    const s = settings({ textContent: ' Auberge ', textSize: 2, textColor: '#aa0000' } as never);
    const ctx = { doc, settings: s, rng: () => 0.5, newUid: () => 'new1' } as never;
    const tool = createTextTool(ctx);
    const r = tool.onPointer(ev('down', 3.2, 4.7));
    const op = r.command?.ops[0];
    expect(op?.type).toBe('object.add');
    expect(op?.type === 'object.add' ? op.object : null).toMatchObject({
      type: 'text',
      layer: 'labels',
      visibility: 'all',
      props: { text: 'Auberge', size: 2, color: '#aa0000', font: 'sans' },
    });
    const empty = createTextTool({ ...(ctx as object), settings: settings() } as never);
    expect(empty.onPointer(ev('down', 1, 1)).notice?.code).toBe('no_text');
  });
});
