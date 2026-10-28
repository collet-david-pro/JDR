/**
 * Model of the "Générer" panel (P8e2b, D11-D14): generator, preset, parameters, seed, target,
 * debounced preview run (300 ms, the previous run is cancelled), and the Apply sequence
 *   [settle] -> pre_generate snapshot -> applyGeneration -> PATCH generation.
 * No DOM here: the component only renders it. All services are injected (tests).
 */
import type { CellRect } from '../../editor/contracts';
import { PendingOpsError } from '../../editor/versions/versions.svelte';
import { GENERATOR_IDS, GENERATOR_INFO } from '../../procgen/generators';
import type { GenResult, GeneratorId, PackKey } from '../../procgen/types';
import type { MapGeneration } from '../types';
import type { Translate } from '../translator';
import type { ApplyInput, ApplyReport } from './apply';
import { GenCancelledError, type GenClient, type GenOutcome, type GenProgress } from './gen-client';
import type { GenRequest } from './gen-protocol';
import {
  defaultParams,
  missingPackKeys,
  paramsFromStored,
  presetParams,
  type ParamValue,
  type ParamValues,
} from './generate-params';
import type { Pack } from './pack';
import { randomSeed } from './seed';
import type { GenZone } from './zone-from-map';

export type GenTarget = 'new' | 'map' | 'selection';
export type RunStatus = 'idle' | 'running' | 'ready' | 'error';
export type ApplyOutcome =
  | { kind: 'applied'; report: ApplyReport; target: 'map' | 'selection' }
  | { kind: 'created'; mapId: string };

export { missingPackKeys, paramsFromStored, presetParams, defaultParams } from './generate-params';
export type { ParamValue, ParamValues } from './generate-params';

export const PREVIEW_DELAY_MS = 300;
/** Smallest side (cells) of a zone for the zone generators (error `zone_too_small`). */
export const MIN_ZONE_SIDE = 8;
export const SEED_MAX_LENGTH = 64;

export interface GeneratePanelDeps {
  mapId: string;
  gameId: string;
  /** Grid of the edited map. */
  grid: { readonly width: number; readonly height: number };
  /** maps.generation of the edited map (the panel opens pre-filled), if any. */
  generation?: MapGeneration | null | undefined;
  client: GenClient;
  maps: {
    create(
      gameId: string,
      input: { name: string; width: number; height: number },
    ): Promise<{
      id: string;
    }>;
    update(id: string, patch: { generation: MapGeneration | null }): Promise<unknown>;
    createVersion(id: string, label: string | null, kind: 'pre_generate'): Promise<unknown>;
  };
  /** Selection of the editor (reactive when read through $state). */
  getSelection: () => readonly CellRect[];
  zoneOf: (rect: CellRect) => GenZone;
  /** Nothing to lose in the target (whole floor when `rect` is null, else the rectangle). */
  isEmpty: (rect: CellRect | null) => boolean;
  apply: (input: ApplyInput) => ApplyReport;
  loadPack: () => Promise<Pack>;
  /** Sends the pending operations; false when some are still unconfirmed. */
  settle: () => Promise<boolean>;
  stash: (
    mapId: string,
    payload: { result: GenResult; params: Record<string, unknown>; fingerprint?: string },
  ) => void;
  navigate: (path: string) => void;
  t: Translate;
  debounceMs?: number;
}

export class GeneratePanelModel {
  generator = $state<GeneratorId>('dungeon');
  genVersion = $state(GENERATOR_INFO.dungeon.version);
  /** Preset id, '' = "Personnalisé". */
  preset = $state('');
  params = $state<ParamValues>(defaultParams('dungeon'));
  seed = $state('');
  target = $state<GenTarget>('map');
  newName = $state('');
  newWidth = $state(60);
  newHeight = $state(60);

  status = $state<RunStatus>('idle');
  progress = $state.raw<GenProgress | null>(null);
  outcome = $state.raw<GenOutcome | null>(null);
  /** Key of the request that produced `outcome`. */
  outcomeKey = $state<string | null>(null);
  errorCode = $state<'zone_too_small' | 'failed' | null>(null);
  errorMessage = $state('');
  missing = $state.raw<PackKey[]>([]);
  busy = $state<'apply' | null>(null);
  /** A preview run is waiting for the debounce delay. */
  waiting = $state(false);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelRun: (() => void) | null = null;
  private runToken = 0;
  private disposed = false;

  constructor(private readonly deps: GeneratePanelDeps) {
    this.seed = randomSeed();
    this.newName = deps.t('editor.generate.new_map_default');
    this.applySize('dungeon');
    const stored = deps.generation;
    if (stored != null && stored.generator in GENERATOR_INFO) {
      const generator = stored.generator as GeneratorId;
      this.generator = generator;
      this.genVersion = stored.gen_version;
      this.params = paramsFromStored(generator, stored.params);
      this.seed = stored.seed;
      this.applySize(generator);
    }
  }

  // ---- derived values -----------------------------------------------------------------------
  get info() {
    return GENERATOR_INFO[this.generator];
  }

  get generators(): readonly GeneratorId[] {
    return GENERATOR_IDS;
  }

  /** Selection rectangle clipped to the grid, or null. */
  get selectionRect(): CellRect | null {
    const sel = this.deps.getSelection();
    if (sel.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of sel) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    const g = this.deps.grid;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(g.width, x1);
    y1 = Math.min(g.height, y1);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /** "Sélection" needs a selection and a generator that can fill a zone. */
  get selectionAllowed(): boolean {
    return this.info.zone && this.selectionRect !== null;
  }

  /** Target actually used: the selection target falls back to the map when it is unavailable. */
  get effectiveTarget(): GenTarget {
    return this.target === 'selection' && !this.selectionAllowed ? 'map' : this.target;
  }

  /** Size (cells) of what will be generated. */
  get size(): { width: number; height: number } {
    const target = this.effectiveTarget;
    if (target === 'new') return { width: this.newWidth, height: this.newHeight };
    if (target === 'selection') {
      const rect = this.selectionRect;
      if (rect !== null) return { width: rect.w, height: rect.h };
    }
    return { width: this.deps.grid.width, height: this.deps.grid.height };
  }

  get zoneTooSmall(): boolean {
    if (this.effectiveTarget !== 'selection') return false;
    const { width, height } = this.size;
    return width < MIN_ZONE_SIDE || height < MIN_ZONE_SIDE;
  }

  get running(): boolean {
    return this.status === 'running';
  }

  get mode(): 'worker' | 'main' {
    return this.deps.client.mode;
  }

  /** Same generator, version, parameters, seed, size and zone as the preview outcome. */
  get previewIsCurrent(): boolean {
    return this.outcome !== null && this.outcomeKey === this.key();
  }

  get seedValid(): boolean {
    return this.seed.trim() !== '' && this.seed.length <= SEED_MAX_LENGTH;
  }

  get canApply(): boolean {
    if (this.busy !== null || this.zoneTooSmall || !this.seedValid) return false;
    if (this.effectiveTarget === 'new') return this.newName.trim() !== '' && this.sizeValid;
    return true;
  }

  get sizeValid(): boolean {
    const { min, max } = this.info.size;
    const ok = (v: number): boolean => Number.isInteger(v) && v >= min && v <= max;
    return this.effectiveTarget !== 'new' || (ok(this.newWidth) && ok(this.newHeight));
  }

  /** Whether Apply must ask for confirmation (something would be replaced). */
  needsConfirm(): boolean {
    const target = this.effectiveTarget;
    if (target === 'new') return false;
    return !this.deps.isEmpty(target === 'selection' ? this.selectionRect : null);
  }

  /** Reactive signature of the request: any change schedules a new preview. */
  key(): string {
    const target = this.effectiveTarget;
    const zone = target === 'selection' ? this.zonePart() : null;
    const { width, height } = this.size;
    return JSON.stringify([
      this.generator,
      this.genVersion,
      this.seed,
      Object.keys(this.params)
        .sort()
        .map((k) => [k, this.params[k]]),
      target === 'selection' ? null : [width, height],
      zone,
    ]);
  }

  private zonePart(): unknown {
    const rect = this.selectionRect;
    if (rect === null) return null;
    const zone = this.deps.zoneOf(rect);
    return [rect.x, rect.y, zone.width, zone.height, zone.openings];
  }

  // ---- edits --------------------------------------------------------------------------------
  private applySize(generator: GeneratorId): void {
    const d = GENERATOR_INFO[generator].defaults;
    this.newWidth = Number(d['width'] ?? 60);
    this.newHeight = Number(d['height'] ?? 60);
  }

  setGenerator(generator: GeneratorId): void {
    this.generator = generator;
    this.genVersion = GENERATOR_INFO[generator].version;
    this.preset = '';
    this.params = defaultParams(generator);
    this.applySize(generator);
  }

  setPreset(preset: string): void {
    this.preset = preset;
    if (preset === '') return;
    this.params = presetParams(this.generator, preset);
    const p = this.info.presets[preset];
    if (typeof p?.['width'] === 'number') this.newWidth = p['width'];
    if (typeof p?.['height'] === 'number') this.newHeight = p['height'];
  }

  /** Any slider / select / switch change makes the preset "Personnalisé". */
  setParam(key: string, value: ParamValue): void {
    this.params = { ...this.params, [key]: value };
    this.preset = '';
  }

  setSeed(seed: string): void {
    this.seed = seed.slice(0, SEED_MAX_LENGTH);
  }

  rollSeed(): void {
    this.seed = randomSeed();
  }

  setTarget(target: GenTarget): void {
    this.target = target;
  }

  // ---- runs ---------------------------------------------------------------------------------
  /** Preview run after the debounce delay; cancels the run in progress at once. */
  schedule(): void {
    if (this.disposed) return;
    this.clearTimer();
    this.cancelCurrent();
    this.waiting = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.waiting = false;
      void this.runPreview();
    }, this.deps.debounceMs ?? PREVIEW_DELAY_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.waiting = false;
  }

  private cancelCurrent(): void {
    this.cancelRun?.();
    this.cancelRun = null;
  }

  /** "Annuler": nothing is applied, the progress disappears (outcome of a previous run kept). */
  cancel(): void {
    this.clearTimer();
    this.cancelCurrent();
    this.runToken++;
    if (this.status === 'running') this.status = this.outcome === null ? 'idle' : 'ready';
    this.progress = null;
  }

  private request(): { request: GenRequest; key: string } | null {
    const target = this.effectiveTarget;
    const { width, height } = this.size;
    const request: GenRequest = {
      generator: this.generator,
      gen_version: this.genVersion,
      seed: this.seed,
      params: { ...this.params, width, height },
    };
    if (target === 'selection') {
      const rect = this.selectionRect;
      if (rect === null) return null;
      const zone = this.deps.zoneOf(rect);
      request.zone = { width: zone.width, height: zone.height, openings: zone.openings };
      request.params = { ...this.params, width: zone.width, height: zone.height };
    }
    return { request, key: this.key() };
  }

  private async runPreview(): Promise<void> {
    await this.execute();
  }

  /** Runs the generator for the current state; null when cancelled, failed or impossible. */
  private async execute(): Promise<GenOutcome | null> {
    this.cancelCurrent();
    const token = ++this.runToken;
    this.errorCode = null;
    this.errorMessage = '';
    if (!this.seedValid) {
      this.status = 'idle';
      return null;
    }
    if (this.zoneTooSmall) {
      this.status = 'error';
      this.errorCode = 'zone_too_small';
      this.outcome = null;
      this.outcomeKey = null;
      return null;
    }
    const built = this.request();
    if (built === null) return null;
    this.status = 'running';
    this.progress = null;
    try {
      const run = this.deps.client.run(built.request, {
        onProgress: (p) => {
          if (token === this.runToken) this.progress = p;
        },
      });
      this.cancelRun = run.cancel;
      const outcome = await run.promise;
      if (token !== this.runToken) return null;
      this.cancelRun = null;
      this.outcome = outcome;
      this.outcomeKey = built.key;
      this.status = 'ready';
      this.progress = null;
      void this.refreshMissing(outcome.result);
      return outcome;
    } catch (error) {
      if (token !== this.runToken) return null;
      this.cancelRun = null;
      this.progress = null;
      if (error instanceof GenCancelledError) {
        this.status = this.outcome === null ? 'idle' : 'ready';
        return null;
      }
      this.status = 'error';
      this.outcome = null;
      this.outcomeKey = null;
      const message = error instanceof Error ? error.message : String(error);
      this.errorCode = /zone_too_small/.test(message) ? 'zone_too_small' : 'failed';
      this.errorMessage = message;
      return null;
    }
  }

  private async refreshMissing(result: GenResult): Promise<void> {
    try {
      const pack = await this.deps.loadPack();
      if (this.outcome?.result === result) this.missing = missingPackKeys(result, pack);
    } catch {
      this.missing = [];
    }
  }

  // ---- apply --------------------------------------------------------------------------------
  /** Outcome of the preview when still valid, else a new run (progress, cancellable). */
  private async ensureOutcome(): Promise<GenOutcome | null> {
    this.clearTimer();
    if (this.previewIsCurrent && this.outcome !== null && this.status === 'ready') {
      return this.outcome;
    }
    return this.execute();
  }

  /** `generation` as stored in maps.generation (params as sent to the generator). */
  private generationOf(result: GenResult, params: Record<string, unknown>): MapGeneration {
    return {
      generator: result.generator,
      gen_version: result.gen_version,
      seed: result.seed,
      params,
    };
  }

  /**
   * Applies the generation. Resolves null when nothing was applied (cancelled run, error shown
   * by the panel). Throws on a failed save / request (the caller shows a toast); a
   * PendingOpsError means the pending operations could not be saved first.
   */
  async apply(): Promise<ApplyOutcome | null> {
    if (this.busy !== null || !this.canApply) return null;
    this.busy = 'apply';
    try {
      const target = this.effectiveTarget;
      const outcome = await this.ensureOutcome();
      if (outcome === null) return null;
      const { result } = outcome;
      const sent = { ...this.params, ...this.size };
      if (target === 'new') return await this.createMap(outcome, sent);

      const rect = target === 'selection' ? this.selectionRect : null;
      if (target === 'selection' && rect === null) return null;
      const pack = await this.deps.loadPack();
      if (!this.deps.isEmpty(rect)) {
        if (!(await this.deps.settle())) throw new PendingOpsError();
        await this.deps.maps.createVersion(
          this.deps.mapId,
          this.deps.t('editor.generate.snapshot_label', {
            generator: this.deps.t(`procgen.generators.${this.generator}`),
            seed: result.seed,
          }),
          'pre_generate',
        );
      }
      const report = this.deps.apply({
        result,
        pack,
        target,
        ...(rect === null ? {} : { rect }),
      });
      this.missing = report.missing;
      if (target === 'map') {
        await this.deps.maps.update(this.deps.mapId, {
          generation: this.generationOf(result, sent),
        });
      } else {
        // The openings of the zone changed: the next preview must be computed again.
        this.outcomeKey = null;
        this.schedule();
      }
      return { kind: 'applied', report, target };
    } finally {
      this.busy = null;
    }
  }

  private async createMap(
    outcome: GenOutcome,
    sent: Record<string, unknown>,
  ): Promise<ApplyOutcome> {
    const { width, height } = this.size;
    const name = this.newName.trim();
    const map = await this.deps.maps.create(this.deps.gameId, { name, width, height });
    this.deps.stash(map.id, {
      result: outcome.result,
      params: sent,
      fingerprint: outcome.fingerprint,
    });
    this.deps.navigate(`/games/${this.deps.gameId}/maps/${map.id}/edit`);
    return { kind: 'created', mapId: map.id };
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.cancelCurrent();
    this.runToken++;
    this.deps.client.dispose();
  }
}
