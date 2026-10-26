<script lang="ts">
  import ObjectToolOptions from './ObjectToolOptions.svelte';
  import { BRUSH_MAX, BRUSH_MIN, type BrushShape, type ShapeKind } from '../../editor/tools/types';
  import { brushShapeLabel, shapeKindLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Options of the active tool (projet.md 15.2). */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();

  const tool = $derived(ui.tool);
  const usesBrush = $derived(tool === 'brush' || tool === 'eraser');
  const usesTile = $derived(tool === 'brush' || tool === 'fill' || tool === 'shape');
  const tileName = $derived(
    ui.tile === null ? null : (ui.palette.find((p) => p.index === ui.tile?.index)?.name ?? null),
  );
  const brushShapes: BrushShape[] = ['square', 'round'];
  const shapeKinds: ShapeKind[] = ['rect', 'ellipse', 'line'];
</script>

<section class="options" aria-labelledby={`${uid}-title`} data-testid="tool-options">
  <h2 id={`${uid}-title`}>{t('editor.options.label')}</h2>

  {#if usesBrush}
    <label class="field">
      <span>
        {t('editor.options.size')} : <strong>{ui.brushSize}</strong>
        <kbd aria-hidden="true">[</kbd> <kbd aria-hidden="true">]</kbd>
      </span>
      <input
        type="range"
        min={BRUSH_MIN}
        max={BRUSH_MAX}
        step="1"
        value={ui.brushSize}
        data-testid="brush-size"
        oninput={(event) => ui.setBrushSize(Number(event.currentTarget.value))}
      />
    </label>
    <fieldset>
      <legend>{t('editor.options.brush_shape')}</legend>
      {#each brushShapes as shape (shape)}
        <label class="choice">
          <input type="radio" name={`${uid}-brush`} value={shape} bind:group={ui.brushShape} />
          {brushShapeLabel(shape)}
        </label>
      {/each}
    </fieldset>
  {/if}

  {#if tool === 'shape'}
    <fieldset>
      <legend>{t('editor.options.kind')}</legend>
      {#each shapeKinds as kind (kind)}
        <label class="choice">
          <input type="radio" name={`${uid}-kind`} value={kind} bind:group={ui.shapeKind} />
          {shapeKindLabel(kind)}
        </label>
      {/each}
    </fieldset>
    {#if ui.shapeKind !== 'line'}
      <fieldset>
        <legend class="visually-hidden">{t('editor.options.filled')}</legend>
        <label class="choice">
          <input type="radio" name={`${uid}-fill`} value={true} bind:group={ui.shapeFilled} />
          {t('editor.options.filled')}
        </label>
        <label class="choice">
          <input type="radio" name={`${uid}-fill`} value={false} bind:group={ui.shapeFilled} />
          {t('editor.options.outline')}
        </label>
      </fieldset>
    {/if}
  {/if}

  {#if usesTile}
    <p class="tile small" data-testid="current-tile">
      {tileName === null
        ? t('editor.options.no_tile')
        : t('editor.options.tile', { name: tileName })}
    </p>
    <label class="choice">
      <input type="checkbox" bind:checked={ui.randomVariant} />
      {t('editor.options.random_variant')}
    </label>
    {#if ui.randomVariant && ui.tileFrames < 2}
      <p class="small muted">{t('editor.options.random_variant_hint')}</p>
    {/if}
    <label class="choice">
      <input type="checkbox" bind:checked={ui.randomRotation} />
      {t('editor.options.random_rotation')}
    </label>
  {/if}

  {#if tool === 'fill'}
    <p class="small muted">{t('editor.options.fill_hint')}</p>
  {:else if tool === 'select'}
    <p class="small muted">{t('editor.options.select_hint')}</p>
  {:else if tool === 'hand'}
    <p class="small muted">{t('editor.options.hand_hint')}</p>
  {:else if tool === 'pipette'}
    <p class="small muted">{t('editor.options.pipette_hint')}</p>
  {:else if tool === 'ruler'}
    <p class="small muted">{t('editor.options.ruler_hint')}</p>
  {/if}

  <ObjectToolOptions {session} />
</section>

<style>
  .options {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: var(--border-width) solid var(--color-border);
    font-size: var(--font-size-sm);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  fieldset {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 2px;
  }
  .choice {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .tile {
    margin: 0;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }
</style>
