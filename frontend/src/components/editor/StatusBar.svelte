<script lang="ts">
  import { layerLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  interface Props {
    session: EditorSession;
    /** Shows the frame rate. */
    debug: boolean;
  }

  let { session, debug }: Props = $props();
  const ui = $derived(session.ui);
</script>

<footer class="status" aria-label={t('editor.status.label')} data-testid="editor-status">
  <span
    data-testid="status-cell"
    data-wx={ui.cursorWorld?.x.toFixed(3) ?? ''}
    data-wy={ui.cursorWorld?.y.toFixed(3) ?? ''}
  >
    {ui.cursor === null
      ? t('editor.status.no_cell')
      : t('editor.status.cell', { x: ui.cursor.x, y: ui.cursor.y })}
  </span>
  <span data-testid="status-zoom">
    {t('editor.status.zoom', { value: Math.round(ui.zoom * 100) })}
  </span>
  <span data-testid="status-layer">{layerLabel(ui.layer)}</span>
  <span data-testid="status-history" data-count={ui.history.undoSize}>
    {t('editor.status.history', { count: ui.history.undoSize })}
  </span>
  <span class="end">
    {#if ui.visionMs !== null}
      <span
        class:visually-hidden={!debug}
        data-testid="status-vision"
        data-ms={ui.visionMs}
        data-samples={ui.visionSamples}>{t('editor.status.vision', { value: ui.visionMs })}</span
      >
    {/if}
    {#if debug && ui.fps !== null}
      <span data-testid="status-fps">{t('editor.status.fps', { value: ui.fps })}</span>
    {/if}
    {#if ui.performanceMode}
      <span class="badge badge-warn">{t('editor.status.performance')}</span>
    {/if}
    {#if ui.renderer !== null}
      <span data-testid="status-renderer" data-renderer={ui.renderer}>
        {ui.renderer === 'webgpu'
          ? t('editor.status.renderer_webgpu')
          : t('editor.status.renderer_webgl')}
      </span>
    {/if}
  </span>
</footer>

<style>
  .status {
    grid-area: status;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    align-items: center;
    padding: var(--space-1) var(--space-3);
    border-top: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
  }
  .end {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin-left: auto;
  }
</style>
