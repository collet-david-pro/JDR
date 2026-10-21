<script lang="ts">
  import { untrack } from 'svelte';
  import EditorTopBar from './EditorTopBar.svelte';
  import EngineUnsupported from './EngineUnsupported.svelte';
  import HelpDialog from './HelpDialog.svelte';
  import LayersPanel from './LayersPanel.svelte';
  import PalettePanel from './PalettePanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import ToolBar from './ToolBar.svelte';
  import type { GridSpec } from '../../editor/contracts';
  import { detectPlatform } from '../../editor/shortcuts';
  import { noticeText } from '../../editor/ui/labels';
  import { EditorSession } from '../../editor/ui/session';
  import { isEngineUnsupportedError, loadSceneEngine, type SceneEngine } from '../../engine/load';
  import { t } from '../../lib/i18n';

  /**
   * Full-screen editor (projet.md 18.1 p.5): top bar, tools on the left, map, collapsible
   * panels on the right (layers, tile palette), status bar. The session and the engine are
   * plain objects (never in $state, projet.md 13.2); `session.ui` holds the reactive values.
   */
  interface Props {
    gameId: string;
    gameName: string;
    grid: GridSpec;
    /** Shows the frame rate in the status bar. */
    debug?: boolean;
  }

  let { gameId, gameName, grid, debug = false }: Props = $props();

  let viewport: HTMLDivElement | undefined = $state();
  let engineState = $state<'loading' | 'ready' | 'unsupported' | 'error'>('loading');

  // svelte-ignore state_referenced_locally
  const session = new EditorSession({
    grid,
    platform: detectPlatform(navigator),
    describeNotice: noticeText,
    isViewportTarget: (target) =>
      target === document.body ||
      target === document.documentElement ||
      (target instanceof Node && viewport !== undefined && viewport.contains(target)),
  });
  const ui = session.ui;

  $effect(() => {
    const host = viewport;
    if (host === undefined) return;
    let engine: SceneEngine | null = null;
    let cancelled = false;
    untrack(() => {
      loadSceneEngine(host)
        .then((created) => {
          if (cancelled) {
            created.destroy();
            return;
          }
          engine = created;
          session.attach(created);
          engineState = 'ready';
          host.focus({ preventScroll: true });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          engineState = isEngineUnsupportedError(error) ? 'unsupported' : 'error';
          if (!isEngineUnsupportedError(error)) console.error(error);
        });
    });
    return () => {
      cancelled = true;
      session.detach();
      engine?.destroy();
    };
  });

  $effect(() => () => session.dispose());

  function keydown(event: KeyboardEvent): void {
    if (engineState !== 'ready') return;
    if (session.handleKeyDown(event)) event.preventDefault();
  }
</script>

<svelte:window
  onkeydown={keydown}
  onkeyup={(event) => session.handleKeyUp(event)}
  onblur={() => session.releaseKeys()}
/>

<div class="editor" class:panels-hidden={!ui.panelsOpen} data-testid="editor">
  <EditorTopBar {session} {gameId} {gameName} />

  <ToolBar {session} />

  <div class="stage">
    <!-- The map is focusable so that Space / Tab shortcuts and screen-reader hints apply to it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="viewport"
      class:pan={ui.panMode}
      bind:this={viewport}
      tabindex="0"
      role="application"
      aria-label={t('editor.viewport', { width: grid.width, height: grid.height })}
      aria-describedby="editor-notice"
      data-testid="editor-viewport"
      data-state={engineState}
      onpointerdown={() => viewport?.focus({ preventScroll: true })}
    ></div>
    {#if engineState === 'loading'}
      <p class="state muted" aria-busy="true">{t('editor.loading')}</p>
    {:else if engineState === 'unsupported'}
      <div class="state"><EngineUnsupported /></div>
    {:else if engineState === 'error'}
      <div class="state alert alert-error" role="alert">
        <span>{t('editor.load_error')}</span>
        <button type="button" class="button" onclick={() => window.location.reload()}>
          {t('common.reload')}
        </button>
      </div>
    {/if}
  </div>

  {#if ui.panelsOpen}
    <aside class="panels" aria-label={t('editor.panels.hide')}>
      <LayersPanel {session} />
      <PalettePanel {session} />
    </aside>
  {/if}

  <StatusBar {session} {debug} />
</div>

<p id="editor-notice" class="visually-hidden" aria-live="polite" data-testid="editor-notice">
  {#key ui.notice?.id}{ui.notice?.text ?? ''}{/key}
</p>

<HelpDialog bind:open={ui.helpOpen} />

<style>
  .editor {
    position: fixed;
    inset: 0;
    /* Above the site header and banner (z-banner 50), below dialogs and toasts. */
    z-index: 60;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 18rem;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'top top top'
      'tools stage panels'
      'status status status';
    background: var(--color-bg);
    color: var(--color-text);
  }
  .editor.panels-hidden {
    grid-template-columns: auto minmax(0, 1fr) 0;
  }
  .stage {
    grid-area: stage;
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--color-surface-sunken);
  }
  .viewport {
    position: absolute;
    inset: 0;
    cursor: crosshair;
  }
  .viewport.pan {
    cursor: grab;
  }
  .viewport:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
  }
  .state {
    position: absolute;
    inset: auto var(--space-4) var(--space-4) var(--space-4);
    margin: 0;
  }
  p.state {
    inset: 50% auto auto 50%;
    transform: translate(-50%, -50%);
  }
  .panels {
    grid-area: panels;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    overflow-x: hidden;
    overflow-y: auto;
    border-left: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  @media (max-width: 48rem) {
    .editor {
      grid-template-columns: auto minmax(0, 1fr) 0;
    }
    .panels {
      position: fixed;
      top: 3rem;
      right: 0;
      bottom: 2rem;
      width: min(18rem, 80vw);
      box-shadow: var(--shadow-lg);
    }
  }
</style>
