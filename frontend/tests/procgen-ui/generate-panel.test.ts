import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellRect } from '../../src/editor/contracts';
import { PendingOpsError } from '../../src/editor/versions/versions.svelte';
import {
  GeneratePanelModel,
  missingPackKeys,
  paramsFromStored,
  presetParams,
  type GeneratePanelDeps,
} from '../../src/lib/procgen/generate-panel.svelte';
import {
  GenCancelledError,
  type GenClient,
  type GenOutcome,
  type GenRequest,
} from '../../src/lib/procgen/gen-client';
import { GENERATOR_INFO } from '../../src/procgen/generators';
import type { GenResult } from '../../src/procgen/types';

function resultOf(request: GenRequest): GenResult {
  const params = request.params as { width: number; height: number };
  return {
    generator: request.generator,
    gen_version: request.gen_version,
    seed: request.seed,
    width: params.width,
    height: params.height,
    floors: [
      {
        ground: [{ x: 0, y: 0, key: 'floor.stone' }],
        terrain: [],
        decor: [{ x: 1, y: 1, key: 'decor.barrel' }],
        walls: [],
        doors: [],
        windows: [],
        lights: [],
        rooms: [],
        entrance: null,
        exit: null,
      },
    ],
    stats: {},
  };
}

interface Pending {
  request: GenRequest;
  resolve(): void;
  cancelled: boolean;
}

/** Fake worker client: every run waits for `resolve()`; `cancel()` rejects it. */
function fakeClient(mode: 'worker' | 'main' = 'worker') {
  const runs: Pending[] = [];
  const client: GenClient = {
    mode,
    run(request) {
      let done!: (o: GenOutcome) => void;
      let fail!: (e: unknown) => void;
      const promise = new Promise<GenOutcome>((res, rej) => {
        done = res;
        fail = rej;
      });
      const pending: Pending = {
        request,
        cancelled: false,
        resolve: () =>
          done({ result: resultOf(request), fingerprint: `fp-${runs.indexOf(pending)}`, ms: 5 }),
      };
      runs.push(pending);
      return {
        promise,
        cancel: () => {
          pending.cancelled = true;
          fail(new GenCancelledError());
        },
      };
    },
    dispose: vi.fn(),
  };
  return { client, runs };
}

const PACK = { assets: { 'floor.stone': { asset_id: '1', url: 'u', name: 'Pierre' } } };

function makeModel(overrides: Partial<GeneratePanelDeps> = {}) {
  const { client, runs } = fakeClient();
  const calls: string[] = [];
  let selection: readonly CellRect[] = [];
  const deps: GeneratePanelDeps = {
    mapId: '7',
    gameId: '3',
    grid: { width: 60, height: 50 },
    client,
    maps: {
      create: vi.fn(async () => ({ id: '99' })),
      update: vi.fn(async () => {
        calls.push('update');
      }),
      createVersion: vi.fn(async () => {
        calls.push('snapshot');
      }),
    },
    getSelection: () => selection,
    zoneOf: (rect) => ({ width: rect.w, height: rect.h, openings: [[0, 0]] }),
    isEmpty: () => false,
    apply: vi.fn(() => {
      calls.push('apply');
      return { missing: [], cells: 1, objects: 0 };
    }),
    loadPack: async () => PACK as never,
    settle: async () => true,
    stash: vi.fn(),
    navigate: vi.fn(),
    t: (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
    debounceMs: 300,
    ...overrides,
  };
  const model = new GeneratePanelModel(deps);
  return {
    model,
    deps,
    runs,
    calls,
    select: (s: readonly CellRect[]) => (selection = s),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('presets and parameters', () => {
  it('a preset replaces the parameters; moving a slider makes it "Personnalisé"', () => {
    const { model } = makeModel();
    model.setPreset('small_crypt');
    expect(model.preset).toBe('small_crypt');
    expect(model.params['rooms']).toBe(6);
    expect(model.params['theme']).toBe('crypt');
    // the size of the preset goes to the new-map size, never to the parameters
    expect(model.params['width']).toBeUndefined();
    expect(model.newWidth).toBe(30);
    model.setParam('rooms', 9);
    expect(model.preset).toBe('');
    expect(model.params['rooms']).toBe(9);
  });

  it('changing the generator resets preset, parameters, version and default size', () => {
    const { model } = makeModel();
    model.setPreset('small_crypt');
    model.setGenerator('village');
    expect(model.preset).toBe('');
    expect(model.genVersion).toBe(GENERATOR_INFO.village.version);
    expect(model.params).toEqual(presetParams('village', ''));
    expect(model.newWidth).toBe(GENERATOR_INFO.village.defaults['width']);
  });

  it('merges stored parameters onto the defaults and ignores invalid values', () => {
    const p = paramsFromStored('dungeon', { rooms: 20, theme: 'nope', loops: 'x', stale: 1 });
    expect(p['rooms']).toBe(20);
    expect(p['theme']).toBe(GENERATOR_INFO.dungeon.defaults['theme']);
    expect(p['loops']).toBe(GENERATOR_INFO.dungeon.defaults['loops']);
    expect(p['stale']).toBeUndefined();
  });

  it('opens pre-filled from maps.generation (regeneration)', () => {
    const { model } = makeModel({
      generation: {
        generator: 'cave',
        gen_version: 1,
        seed: 'abc',
        params: { fill: 0.5, theme: 'lava' },
      },
    });
    expect(model.generator).toBe('cave');
    expect(model.seed).toBe('abc');
    expect(model.params['fill']).toBe(0.5);
    expect(model.params['theme']).toBe('lava');
    expect(model.params['iterations']).toBe(GENERATOR_INFO.cave.defaults['iterations']);
  });

  it('the dice changes the seed; the seed is limited to 64 characters', () => {
    const { model } = makeModel();
    const before = model.seed;
    model.rollSeed();
    expect(model.seed).not.toBe(before);
    model.setSeed('x'.repeat(80));
    expect(model.seed).toHaveLength(64);
    model.setSeed('  ');
    expect(model.seedValid).toBe(false);
    expect(model.canApply).toBe(false);
  });
});

describe('target', () => {
  it('"Sélection" needs a selection and a generator with a zone', () => {
    const { model, select } = makeModel();
    expect(model.selectionAllowed).toBe(false);
    model.setTarget('selection');
    expect(model.effectiveTarget).toBe('map');
    select([{ x: 4, y: 5, w: 20, h: 10 }]);
    expect(model.selectionAllowed).toBe(true);
    expect(model.effectiveTarget).toBe('selection');
    expect(model.size).toEqual({ width: 20, height: 10 });
    model.setGenerator('outdoor'); // no zone
    expect(model.selectionAllowed).toBe(false);
    expect(model.size).toEqual({ width: 60, height: 50 });
  });

  it('the size of the current map is the grid; a selection is clipped to the grid', () => {
    const { model, select } = makeModel();
    expect(model.size).toEqual({ width: 60, height: 50 });
    select([{ x: -5, y: 40, w: 20, h: 30 }]);
    expect(model.selectionRect).toEqual({ x: 0, y: 40, w: 15, h: 10 });
  });

  it('a zone under 8 cells blocks Apply and explains', async () => {
    const { model, select, runs } = makeModel();
    select([{ x: 0, y: 0, w: 5, h: 20 }]);
    model.setTarget('selection');
    expect(model.zoneTooSmall).toBe(true);
    expect(model.canApply).toBe(false);
    model.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(model.status).toBe('error');
    expect(model.errorCode).toBe('zone_too_small');
    expect(runs).toHaveLength(0);
  });
});

describe('preview run', () => {
  it('starts 300 ms after the last change and cancels the previous run', async () => {
    const { model, runs } = makeModel();
    model.schedule();
    await vi.advanceTimersByTimeAsync(299);
    expect(runs).toHaveLength(0);
    model.schedule(); // a change restarts the delay
    await vi.advanceTimersByTimeAsync(299);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toHaveLength(1);
    expect(model.status).toBe('running');
    model.setSeed('autre');
    model.schedule(); // cancels the run in progress at once
    expect(runs[0]!.cancelled).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(runs).toHaveLength(2);
    runs[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(model.status).toBe('ready');
    expect(model.outcome?.fingerprint).toBe('fp-1');
    expect(model.previewIsCurrent).toBe(true);
    expect(runs[1]!.request.params).toMatchObject({ width: 60, height: 50 });
  });

  it('"Annuler" applies nothing and clears the progress', async () => {
    const { model, runs, deps } = makeModel();
    model.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(model.running).toBe(true);
    model.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs[0]!.cancelled).toBe(true);
    expect(model.running).toBe(false);
    expect(model.status).toBe('idle');
    expect(model.errorCode).toBeNull();
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it('passes the zone of a selection to the generator', async () => {
    const { model, select, runs } = makeModel();
    select([{ x: 10, y: 10, w: 20, h: 12 }]);
    model.setTarget('selection');
    model.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(runs[0]!.request.zone).toEqual({ width: 20, height: 12, openings: [[0, 0]] });
  });

  it('a generator error is shown, with the failed state', async () => {
    const { model, deps } = makeModel();
    deps.client.run = () => ({ promise: Promise.reject(new Error('boom')), cancel() {} });
    model.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(model.status).toBe('error');
    expect(model.errorCode).toBe('failed');
    expect(model.errorMessage).toBe('boom');
  });

  it('lists the pack keys without asset after the family fallback', () => {
    const missing = missingPackKeys(
      resultOf({
        generator: 'dungeon',
        gen_version: 1,
        seed: 's',
        params: { width: 3, height: 3 },
      }),
      PACK,
    );
    expect(missing).toEqual(['decor.barrel']);
  });
});

describe('apply', () => {
  async function ready(m: ReturnType<typeof makeModel>): Promise<void> {
    m.model.schedule();
    await vi.advanceTimersByTimeAsync(300);
    m.runs[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }

  it('current map: snapshot, then application, then PATCH generation; the preview is reused', async () => {
    const m = makeModel();
    await ready(m);
    expect(m.model.needsConfirm()).toBe(true);
    const done = await m.model.apply();
    expect(done).toMatchObject({ kind: 'applied', target: 'map' });
    expect(m.calls).toEqual(['snapshot', 'apply', 'update']);
    expect(m.runs).toHaveLength(1); // no second computation
    expect(m.deps.maps.createVersion).toHaveBeenCalledWith(
      '7',
      expect.stringContaining('editor.generate.snapshot_label'),
      'pre_generate',
    );
    const patch = vi.mocked(m.deps.maps.update).mock.calls[0]!;
    expect(patch[0]).toBe('7');
    expect(patch[1].generation).toMatchObject({
      generator: 'dungeon',
      gen_version: GENERATOR_INFO.dungeon.version,
      seed: m.model.seed,
      params: { width: 60, height: 50 },
    });
    expect(vi.mocked(m.deps.apply).mock.calls[0]![0]).toMatchObject({ target: 'map' });
  });

  it('an empty map: no confirmation, no snapshot', async () => {
    const m = makeModel({ isEmpty: () => true });
    await ready(m);
    expect(m.model.needsConfirm()).toBe(false);
    await m.model.apply();
    expect(m.calls).toEqual(['apply', 'update']);
  });

  it('runs a new generation when the settings changed since the preview', async () => {
    const m = makeModel({ isEmpty: () => true });
    await ready(m);
    m.model.setParam('rooms', 40);
    expect(m.model.previewIsCurrent).toBe(false);
    const pending = m.model.apply();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.runs).toHaveLength(2);
    m.runs[1]!.resolve();
    expect(await pending).toMatchObject({ kind: 'applied' });
  });

  it('cancelling the run started by Apply applies nothing', async () => {
    const m = makeModel({ isEmpty: () => true });
    const pending = m.model.apply();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.model.running).toBe(true);
    m.model.cancel();
    expect(await pending).toBeNull();
    expect(m.calls).toEqual([]);
    expect(m.model.busy).toBeNull();
  });

  it('a selection: rect given, snapshot only when the zone is not empty, no generation stored', async () => {
    const m = makeModel({ isEmpty: (rect) => rect === null });
    m.select([{ x: 4, y: 6, w: 20, h: 20 }]);
    m.model.setTarget('selection');
    await ready(m);
    await m.model.apply();
    expect(m.calls).toEqual(['snapshot', 'apply']);
    expect(vi.mocked(m.deps.apply).mock.calls[0]![0]).toMatchObject({
      target: 'selection',
      rect: { x: 4, y: 6, w: 20, h: 20 },
    });
    expect(m.deps.maps.update).not.toHaveBeenCalled();

    const empty = makeModel({ isEmpty: () => true });
    empty.select([{ x: 4, y: 6, w: 20, h: 20 }]);
    empty.model.setTarget('selection');
    await ready(empty);
    await empty.model.apply();
    expect(empty.calls).toEqual(['apply']);
  });

  it('pending operations that cannot be saved stop before any change', async () => {
    const m = makeModel({ settle: async () => false });
    await ready(m);
    await expect(m.model.apply()).rejects.toBeInstanceOf(PendingOpsError);
    expect(m.calls).toEqual([]);
    expect(m.model.busy).toBeNull();
  });

  it('new map: creates the map, stashes the generation and navigates', async () => {
    const m = makeModel();
    m.model.setTarget('new');
    m.model.newName = '  Grotte  ';
    m.model.newWidth = 40;
    m.model.newHeight = 45;
    expect(m.model.needsConfirm()).toBe(false);
    m.model.schedule();
    await vi.advanceTimersByTimeAsync(300);
    m.runs[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(await m.model.apply()).toEqual({ kind: 'created', mapId: '99' });
    expect(m.deps.maps.create).toHaveBeenCalledWith('3', { name: 'Grotte', width: 40, height: 45 });
    const stash = vi.mocked(m.deps.stash).mock.calls[0]!;
    expect(stash[0]).toBe('99');
    expect(stash[1].params).toMatchObject({ width: 40, height: 45 });
    expect(stash[1].fingerprint).toBe('fp-0');
    expect(m.deps.navigate).toHaveBeenCalledWith('/games/3/maps/99/edit');
    expect(m.deps.apply).not.toHaveBeenCalled();
  });

  it('new map: a blank name or an out-of-range size cannot be applied', () => {
    const { model } = makeModel();
    model.setTarget('new');
    model.newName = ' ';
    expect(model.canApply).toBe(false);
    model.newName = 'ok';
    model.newWidth = 5;
    expect(model.canApply).toBe(false);
    model.newWidth = 60;
    expect(model.canApply).toBe(true);
  });

  it('dispose cancels the run and releases the worker', async () => {
    const m = makeModel();
    m.model.schedule();
    await vi.advanceTimersByTimeAsync(300);
    m.model.dispose();
    expect(m.runs[0]!.cancelled).toBe(true);
    expect(m.deps.client.dispose).toHaveBeenCalled();
    m.model.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(m.runs).toHaveLength(1);
  });
});
