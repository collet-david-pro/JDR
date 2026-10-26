<script lang="ts">
  import type { TileLayerId } from '../../editor/contracts';
  import { EXPORT_LIMITS, RESOLUTION_FACTORS, type ExtentKind } from '../../export/dimensions';
  import type { ExportForm, FormEvaluation } from '../../export/form';
  import { PAPER_IDS, dpi } from '../../export/print-layout';
  import { TILE_LAYERS } from '../../export/scene';
  import type { ExportSource } from '../../export/types';
  import { t } from '../../lib/i18n';

  /** Option fields of the PNG export dialog (extent, layers, resolution, print). */
  interface Props {
    form: ExportForm;
    source: ExportSource;
    evaluation: FormEvaluation;
  }

  let { form = $bindable(), source, evaluation }: Props = $props();
  const uid = $props.id();

  const extents: readonly ExtentKind[] = ['map', 'selection', 'view'];
  const available = (kind: ExtentKind): boolean =>
    kind === 'map' || (kind === 'selection' ? source.selection !== null : source.viewport !== null);

  const layerLabel = (id: TileLayerId): string => t(`export_png.layers.${id}`);
  const size = $derived(evaluation.size);
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
</script>

<fieldset>
  <legend>{t('export_png.extent')}</legend>
  <div class="choices">
    {#each extents as kind (kind)}
      <label class="choice">
        <input
          type="radio"
          name={`${uid}-extent`}
          value={kind}
          bind:group={form.extent}
          disabled={!available(kind)}
          data-testid={`export-extent-${kind}`}
        />
        {t(`export_png.extents.${kind}`)}
      </label>
    {/each}
  </div>
  {#if evaluation.extent}
    <p class="hint">
      {t('export_png.cells', { w: evaluation.extent.w, h: evaluation.extent.h })}
    </p>
  {/if}
</fieldset>

<fieldset>
  <legend>{t('export_png.content')}</legend>
  <div class="choices">
    {#each TILE_LAYERS as id (id)}
      <label class="choice">
        <input type="checkbox" bind:checked={form.layers[id]} data-testid={`export-layer-${id}`} />
        {layerLabel(id)}
      </label>
    {/each}
    <label class="choice">
      <input type="checkbox" bind:checked={form.grid} data-testid="export-grid" />
      {t('export_png.grid')}
    </label>
    <label class="choice">
      <input type="checkbox" bind:checked={form.transparent} data-testid="export-transparent" />
      {t('export_png.transparent')}
    </label>
  </div>
  <p class="hint">{t('export_png.floor_hint')}</p>
</fieldset>

{#if evaluation.hasScene}
  <fieldset data-testid="export-scene">
    <legend>{t('export_png.scene.legend')}</legend>
    <div class="choices">
      <label class="choice">
        <input type="checkbox" bind:checked={form.tokens} data-testid="export-tokens" />
        {t('export_png.scene.tokens')}
      </label>
      <label class="choice">
        <input type="checkbox" bind:checked={form.lighting} data-testid="export-lighting" />
        {t('export_png.scene.lighting')}
      </label>
      <label class="choice">
        <input type="checkbox" bind:checked={form.fog} data-testid="export-fog" />
        {t('export_png.scene.fog')}
      </label>
    </div>
    <p class="hint">{t('export_png.scene.hint')}</p>
  </fieldset>
{/if}

<fieldset>
  <legend>{t('export_png.resolution')}</legend>
  <label class="field">
    <span>{t('export_png.mode')}</span>
    <select bind:value={form.mode} data-testid="export-mode">
      {#each ['factor', 'cell', 'width', 'height', 'custom'] as const as mode (mode)}
        <option value={mode}>{t(`export_png.modes.${mode}`)}</option>
      {/each}
    </select>
  </label>
  {#if form.mode === 'factor'}
    <div class="choices" role="radiogroup" aria-label={t('export_png.modes.factor')}>
      {#each RESOLUTION_FACTORS as f (f)}
        <label class="choice">
          <input
            type="radio"
            name={`${uid}-factor`}
            value={String(f)}
            bind:group={form.factor}
            data-testid={`export-factor-${f}`}
          />
          ×{f}
        </label>
      {/each}
    </div>
  {:else if form.mode === 'cell'}
    <label class="field">
      <span>{t('export_png.cell_px')}</span>
      <input inputmode="decimal" bind:value={form.cellPx} data-testid="export-cell-px" />
    </label>
  {:else if form.mode === 'width'}
    <label class="field">
      <span>{t('export_png.target_width')}</span>
      <input inputmode="numeric" bind:value={form.width} data-testid="export-width" />
    </label>
  {:else if form.mode === 'height'}
    <label class="field">
      <span>{t('export_png.target_height')}</span>
      <input inputmode="numeric" bind:value={form.height} data-testid="export-height" />
    </label>
  {:else}
    <label class="field">
      <span>{t('export_png.scale')}</span>
      <input inputmode="decimal" bind:value={form.scale} data-testid="export-scale" />
    </label>
  {/if}

  <p
    class="size"
    aria-live="polite"
    data-testid="export-size"
    data-width={size?.width ?? 0}
    data-height={size?.height ?? 0}
  >
    {#if size && size.error === null}
      {t('export_png.size', {
        width: size.width,
        height: size.height,
        mpx: nf.format(size.megapixels),
        ppc: nf2.format(size.pxPerCell),
      })}
    {:else if size}
      <span class="error"
        >{t(`export_png.errors.size_${size.error}`, { max: EXPORT_LIMITS.maxMegapixels })}</span
      >
    {/if}
  </p>
  {#if size}
    {#each size.warnings as w (w)}
      <p class="alert alert-warning" data-testid={`export-warning-${w}`}>
        {t(`export_png.warnings.${w}`, {
          threshold: EXPORT_LIMITS.warnMegapixels,
          side: EXPORT_LIMITS.viewerMaxSide,
        })}
      </p>
    {/each}
  {/if}
</fieldset>

<fieldset>
  <legend>{t('export_png.print')}</legend>
  <label class="choice">
    <input type="checkbox" bind:checked={form.print} data-testid="export-print" />
    {t('export_png.print_enable')}
  </label>
  {#if form.print}
    <div class="grid">
      <label class="field">
        <span>{t('export_png.mm_per_cell')}</span>
        <input inputmode="decimal" bind:value={form.mmPerCell} data-testid="export-mm" />
      </label>
      <label class="choice">
        <input type="checkbox" bind:checked={form.paging} data-testid="export-paging" />
        {t('export_png.paging')}
      </label>
      {#if form.paging}
        <label class="field">
          <span>{t('export_png.paper')}</span>
          <select bind:value={form.paper} data-testid="export-paper">
            {#each PAPER_IDS as p (p)}
              <option value={p}>{t(`export_png.papers.${p}`)}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>{t('export_png.orientation')}</span>
          <select bind:value={form.orientation}>
            <option value="portrait">{t('export_png.portrait')}</option>
            <option value="landscape">{t('export_png.landscape')}</option>
          </select>
        </label>
        <label class="field">
          <span>{t('export_png.margin')}</span>
          <input inputmode="decimal" bind:value={form.marginMm} />
        </label>
        <label class="field">
          <span>{t('export_png.overlap')}</span>
          <input inputmode="decimal" bind:value={form.overlapMm} />
        </label>
        <label class="choice">
          <input type="checkbox" bind:checked={form.cropMarks} />
          {t('export_png.crop_marks')}
        </label>
      {/if}
    </div>
    {#if size && size.error === null && evaluation.print}
      <p class="hint" data-testid="export-print-info">
        {t('export_png.dpi', { dpi: Math.round(dpi(size.pxPerCell, evaluation.print.mmPerCell)) })}
        {#if evaluation.layout}
          · {t('export_png.pages', {
            count: evaluation.layout.pages.length,
            columns: evaluation.layout.columns,
            rows: evaluation.layout.rows,
          })}
        {/if}
      </p>
    {/if}
    {#each evaluation.errors.filter((e) => e.startsWith('print_')) as e (e)}
      <p class="error">{t(`export_png.errors.${e}`)}</p>
    {/each}
  {/if}
</fieldset>

{#each evaluation.errors.filter((e) => e === 'no_extent' || e === 'no_layers') as e (e)}
  <p class="error">{t(`export_png.errors.${e}`)}</p>
{/each}

<style>
  fieldset {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    min-width: 0;
  }
  legend {
    padding: 0 var(--space-1);
    font-weight: var(--font-weight-medium);
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .field input,
  .field select {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-2) var(--space-3);
    align-items: end;
  }
  .size {
    margin: 0;
    font-weight: var(--font-weight-medium);
  }
  .hint {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  .error {
    margin: 0;
    color: var(--color-danger);
  }
  .alert {
    margin: 0;
  }
</style>
