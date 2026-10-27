import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  cellCssPx,
  effectivePxPerMm,
  pxPerMmFromRuler,
  zoomFor,
} from '../../src/lib/displays/calibration';
import { frame, type FrameInput } from '../../src/lib/displays/framing';
import { orientation } from '../../src/lib/displays/orientation';
import { qrSvg } from '../../src/lib/displays/qr';
import { readAloudMs } from '../../src/lib/displays/read-aloud';
import type { DisplaySettings, Rotation } from '../../src/lib/displays/types';
import { tableViewers } from '../../src/lib/displays/viewers';
import { createSessionState } from '../../src/lib/sessions/state';
import { definition, placed, session, snapshot } from '../sessions/fixtures';

export const settings = (patch: Partial<DisplaySettings> = {}): DisplaySettings => ({
  diagonal_in: null,
  px_per_mm: null,
  mm_per_cell: 25,
  rotation: 0,
  mirror: false,
  show_tokens: true,
  follow_camera: true,
  view_lock: null,
  ...patch,
});

describe('calibration', () => {
  const full = { width: 1920, height: 1080 };

  it('derives px/mm from the diagonal of a 32 inch 1920x1080 screen', () => {
    const expected = Math.hypot(1920, 1080) / (32 * 25.4);
    const v = effectivePxPerMm(settings({ diagonal_in: 32 }), full);
    expect(v).toBeCloseTo(expected, 10);
    expect(v).toBeCloseTo(2.71, 2);
    expect(cellCssPx(v!, 25)).toBeCloseTo(67.76, 1);
  });

  it('prefers px_per_mm, and is unknown without a diagonal or a screen size', () => {
    expect(effectivePxPerMm(settings({ px_per_mm: 3, diagonal_in: 32 }), full)).toBe(3);
    expect(effectivePxPerMm(settings({ diagonal_in: 32 }), null)).toBeNull();
    expect(effectivePxPerMm(settings(), full)).toBeNull();
    expect(effectivePxPerMm(settings({ diagonal_in: 0 }), full)).toBeNull();
  });

  it('measures px/mm with the 100 mm ruler within 0.5 %', () => {
    const truth = Math.hypot(1920, 1080) / (32 * 25.4);
    const measured = pxPerMmFromRuler(271); // the line the user matched, 271 px (+/- 1 px)
    expect(Math.abs(measured! - truth) / truth).toBeLessThan(0.005);
    expect(pxPerMmFromRuler(250, 50)).toBe(5);
    expect(pxPerMmFromRuler(0)).toBeNull();
  });

  it('gives the zoom of a 25 mm cell and flags the engine bounds', () => {
    const z = zoomFor(70, 2.71, 25);
    expect(z.zoom).toBeCloseTo((2.71 * 25) / 70, 10);
    expect(z.outOfRange).toBeNull();
    const high = zoomFor(70, 100, 25);
    expect(high).toMatchObject({ zoom: MAX_ZOOM, outOfRange: 'high' });
    expect(high.raw).toBeGreaterThan(MAX_ZOOM);
    expect(zoomFor(70, 0.01, 25)).toMatchObject({ zoom: MIN_ZOOM, outOfRange: 'low' });
  });
});

describe('orientation', () => {
  const view = { width: 1920, height: 1080 };

  it('permutes width and height at 90 and 270 degrees only', () => {
    const rotations: Rotation[] = [0, 90, 180, 270];
    for (const rotation of rotations) {
      for (const mirror of [false, true]) {
        const o = orientation(view, { rotation, mirror });
        const swapped = rotation === 90 || rotation === 270;
        expect([o.width, o.height]).toEqual(swapped ? [1080, 1920] : [1920, 1080]);
        expect(o.transform.startsWith('translate(-50%, -50%)')).toBe(true);
        expect(o.transform.includes('scaleX(-1)')).toBe(mirror);
        expect(o.transform.includes(`rotate(${rotation}deg)`)).toBe(rotation !== 0);
      }
    }
  });

  it('mirrors on the screen, after the rotation', () => {
    expect(orientation(view, { rotation: 90, mirror: true }).transform).toBe(
      'translate(-50%, -50%) scaleX(-1) rotate(90deg)',
    );
    expect(orientation(view, { rotation: 0, mirror: false }).transform).toBe(
      'translate(-50%, -50%)',
    );
  });
});

describe('framing', () => {
  const map = { width: 40, height: 30, cellPx: 70 };
  const viewport = { width: 1920, height: 1080 };
  const base = (patch: Partial<FrameInput> = {}): FrameInput => ({
    settings: settings(),
    floorId: '35',
    camera: null,
    viewers: [],
    map,
    viewport,
    screen: null,
    ...patch,
  });
  const camera = { x: 10, y: 12, zoom: 2, floor_id: '35', follow: true };
  const viewers = [
    { x: 4, y: 6, floor: '35' },
    { x: 8, y: 10, floor: '35' },
    { x: 30, y: 30, floor: '36' },
  ];

  it('prefers the view lock, then the GM camera, then the viewers, then the map', () => {
    const lock = { x: 1, y: 2, zoom: 3, floor_id: '35' };
    expect(frame(base({ settings: settings({ view_lock: lock }), camera, viewers }))).toMatchObject(
      { x: 1, y: 2, zoom: 3, source: 'lock', zoomSource: 'lock' },
    );
    expect(frame(base({ camera, viewers }))).toMatchObject({
      x: 10,
      y: 12,
      zoom: 2,
      source: 'camera',
      zoomSource: 'camera',
    });
    // the viewers only matter once the scale is known (otherwise the map is fitted and centred)
    const calibrated = settings({ px_per_mm: 2.7 });
    expect(frame(base({ settings: calibrated, viewers }))).toMatchObject({
      x: 6,
      y: 8,
      source: 'viewers',
      zoomSource: 'scale',
    });
    expect(frame(base())).toMatchObject({ x: 20, y: 15, source: 'map', zoomSource: 'fit' });
  });

  it('ignores the camera when the screen does not follow it', () => {
    const r = frame(base({ settings: settings({ follow_camera: false }), camera }));
    expect(r.source).toBe('map');
  });

  it('ignores a lock or a camera of another floor and keeps the current floor', () => {
    const lock = { x: 1, y: 2, zoom: 3, floor_id: '99' };
    const r = frame(
      base({
        settings: settings({ view_lock: lock }),
        camera: { ...camera, floor_id: '98' },
        viewers,
      }),
    );
    expect(r.source).toBe('map');
    expect(r.floor).toBe('35');
    const calibrated = frame(
      base({ settings: settings({ view_lock: lock, px_per_mm: 2.7 }), viewers }),
    );
    expect(calibrated.source).toBe('viewers');
  });

  it('ignores the GM zoom once the scale of the screen is known', () => {
    const calibrated = settings({ diagonal_in: 32 });
    const screen = { width: 1920, height: 1080 };
    const r = frame(base({ settings: calibrated, camera, screen }));
    const expected = ((Math.hypot(1920, 1080) / (32 * 25.4)) * 25) / 70;
    expect(r.zoom).toBeCloseTo(expected, 10);
    expect(r).toMatchObject({ x: 10, y: 12, zoomSource: 'scale', outOfRange: null });
    // ...also with a lock, and a bounded zoom is flagged
    const lock = { x: 1, y: 1, zoom: 5, floor_id: null };
    const huge = frame(
      base({ settings: settings({ px_per_mm: 100, view_lock: lock }), camera, screen }),
    );
    expect(huge).toMatchObject({ zoom: MAX_ZOOM, outOfRange: 'high', x: 1, y: 1 });
  });

  it('fits the whole map when nothing gives the scale', () => {
    const r = frame(base());
    expect(r.zoom).toBeCloseTo(Math.min(1920 / (40 * 70), 1080 / (30 * 70)), 10);
  });
});

describe('table viewers (D5)', () => {
  const state = (assignments: { token_id: string; user_id: string }[], hidden = false) => {
    const snap = snapshot('player', {
      session: session('player', { assignments }),
      tokens: [
        { ...definition('21'), kind: 'npc' },
        { ...definition('22'), kind: 'pc' },
        { ...definition('23'), kind: 'monster' },
      ],
    });
    const s = createSessionState(snap, 'display:1');
    return {
      ...s,
      tokens: {
        a: placed('a', '21'),
        b: placed('b', '22'),
        c: placed('c', '23'),
        d: { ...placed('d', '22'), hidden },
      },
    };
  };

  it('takes assigned definitions and unassigned PCs, never the other tokens', () => {
    const s = state([{ token_id: '21', user_id: '7' }]);
    expect(tableViewers(s)).toEqual(['a', 'b', 'd']);
  });

  it('leaves the hidden tokens out and follows the assignments', () => {
    expect(tableViewers(state([], true))).toEqual(['b']);
    const s = state([{ token_id: '23', user_id: '7' }]);
    expect(tableViewers(s)).toEqual(['b', 'c', 'd']);
  });

  it('can be limited to a floor', () => {
    const s = state([]);
    expect(tableViewers(s, '35')).toEqual(['b', 'd']);
    expect(tableViewers(s, '999')).toEqual([]);
  });
});

describe('read aloud duration (D11)', () => {
  it('is 15 s + 60 ms per character, between 15 s and 120 s', () => {
    expect(readAloudMs('', '')).toBe(15_000);
    expect(readAloudMs('Title', 'x'.repeat(95))).toBe(15_000 + 6_000);
    expect(readAloudMs('t', 'x'.repeat(5000))).toBe(120_000);
  });
});

describe('qr', () => {
  it('draws the modules of the code as a currentColor path with a quiet zone', () => {
    const url = 'https://jdr.example/display?code=K7F2-QM9X';
    const svg = qrSvg(url);
    const { size, data } = encode(url, { ecc: 'M', border: 0 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toContain(url);
    // The runs of the path cover exactly the dark modules.
    const path = /d="([^"]+)"/.exec(svg)![1]!;
    const dark = [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)].reduce(
      (n, m) => n + Number(m[3]),
      0,
    );
    expect(dark).toBe(data.flat().filter(Boolean).length);
    for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      const [x, y, w] = [Number(m[1]) - 4, Number(m[2]) - 4, Number(m[3])];
      for (let i = 0; i < w; i++) expect(data[y]![x + i]).toBe(true);
    }
    expect(qrSvg(url, { margin: 0 })).toContain(`viewBox="0 0 ${size} ${size}"`);
  });
});
