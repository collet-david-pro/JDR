<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { GeneratePanelModel } from '../../lib/procgen/generate-panel.svelte';
  import { previewPixels } from '../../lib/procgen/preview';

  /** Thumbnail (1 px per cell), duration, fingerprint, progress and cancellation of a run. */
  interface Props {
    model: GeneratePanelModel;
  }

  let { model }: Props = $props();
  let canvas: HTMLCanvasElement | undefined = $state();
  const outcome = $derived(model.outcome);
  const phase = $derived(
    model.status === 'error'
      ? 'error'
      : model.previewIsCurrent && model.status === 'ready' && !model.waiting
        ? 'ready'
        : 'busy',
  );
  const percent = $derived(
    model.progress === null || model.progress.total <= 0
      ? null
      : Math.min(100, Math.round((model.progress.done / model.progress.total) * 100)),
  );

  $effect(() => {
    const host = canvas;
    const o = outcome;
    if (host === undefined || o === null) return;
    const { width, height } = o.result;
    host.width = width;
    host.height = height;
    const ctx = host.getContext('2d');
    if (ctx === null) return;
    const pixels = previewPixels(o.result);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  });
</script>

<div class="preview" data-testid="gen-preview" data-state={phase} aria-busy={phase === 'busy'}>
  <p class="small muted">{t('editor.generate.slow_hint')}</p>
  {#if model.running}
    <div class="progress" data-testid="gen-progress">
      <progress
        max="100"
        value={percent ?? undefined}
        aria-label={t('editor.generate.progress_label')}
      ></progress>
      <span class="small">
        {#if model.progress !== null}
          {t('editor.generate.progress', {
            phase: model.progress.phase,
            done: model.progress.done,
            total: model.progress.total,
          })}
        {:else}
          {t('editor.generate.running')}
        {/if}
      </span>
      <button
        type="button"
        class="button button-small"
        data-testid="gen-cancel"
        onclick={() => model.cancel()}>{t('editor.generate.cancel')}</button
      >
    </div>
    {#if model.mode === 'main'}
      <p class="small muted" data-testid="gen-cancel-unavailable">
        {t('editor.generate.cancel_unavailable')}
      </p>
    {/if}
  {/if}
  {#if model.status === 'error'}
    <p class="alert alert-error small" role="alert" data-testid="gen-error">
      {model.errorCode === 'zone_too_small'
        ? t('editor.generate.error_zone_too_small')
        : t('editor.generate.error_failed', { message: model.errorMessage })}
    </p>
  {/if}
  {#if outcome !== null && model.status !== 'error'}
    <div
      class="frame"
      class:stale={phase !== 'ready'}
      role="img"
      aria-label={t('editor.generate.preview_alt', {
        width: outcome.result.width,
        height: outcome.result.height,
      })}
    >
      <canvas
        bind:this={canvas}
        style:aspect-ratio={`${outcome.result.width} / ${outcome.result.height}`}
        data-testid="gen-canvas"
      ></canvas>
    </div>
    <p class="small meta">
      <span data-testid="gen-duration">{t('editor.generate.duration', { ms: outcome.ms })}</span>
      ·
      <span
        title={outcome.fingerprint}
        data-testid="gen-fingerprint"
        data-fingerprint={outcome.fingerprint}
        >{t('editor.generate.fingerprint', { print: outcome.fingerprint.slice(0, 12) })}</span
      >
    </p>
    {#if model.missing.length > 0}
      <p class="small muted" data-testid="gen-missing">
        {t('editor.generate.missing', { keys: model.missing.join(', ') })}
      </p>
    {/if}
  {:else if model.status === 'idle' || model.status === 'running'}
    <p class="small muted">{t('editor.generate.preview_waiting')}</p>
  {/if}
</div>

<style>
  .preview {
    display: grid;
    gap: var(--space-2);
  }
  p {
    margin: 0;
  }
  .progress {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-1) var(--space-2);
    align-items: center;
  }
  .progress progress {
    grid-column: 1 / -1;
    width: 100%;
  }
  .frame {
    border: var(--border-width) solid var(--color-border);
    background: var(--color-surface-sunken);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .frame.stale {
    opacity: 0.6;
  }
  canvas {
    display: block;
    width: 100%;
    max-height: 16rem;
    object-fit: contain;
    image-rendering: pixelated;
  }
  .meta {
    word-break: break-all;
  }
</style>
