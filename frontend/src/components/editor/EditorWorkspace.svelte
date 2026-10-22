<script lang="ts">
  import { untrack } from 'svelte';
  import EditorTopBar from './EditorTopBar.svelte';
  import EngineUnsupported from './EngineUnsupported.svelte';
  import HelpDialog from './HelpDialog.svelte';
  import LayersPanel from './LayersPanel.svelte';
  import PalettePanel from './PalettePanel.svelte';
  import StatusBar from './StatusBar.svelte';
  import ToolBar from './ToolBar.svelte';
  import { detectPlatform } from '../../editor/shortcuts';
  import { visibleChunkKeys } from '../../editor/sync/chunk-loader';
  import { MapSync } from '../../editor/sync/MapSync';
  import { saveErrorText } from '../../editor/sync/save-status';
  import { gridOf, layersFromWire, paletteFromWire, themeOf } from '../../editor/sync/wire';
  import { noticeText } from '../../editor/ui/labels';
  import { EditorSession } from '../../editor/ui/session';
  import { isEngineUnsupportedError, loadSceneEngine, type SceneEngine } from '../../engine/load';
  import { t } from '../../lib/i18n';
  import type { MapsClient } from '../../lib/maps/maps-client';
  import { openMapStores } from '../../lib/persistence/map-stores';
  import { requestPersistentStorage } from '../../lib/persistence/idb';
  import type { MapDetail } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Full-screen editor (projet.md 18.1 p.5): top bar, tools on the left, map, collapsible
   * panels on the right (layers, tile palette), status bar. The session and the engine are
   * plain objects (never in $state, projet.md 13.2); `session.ui` holds the reactive values.
   */
  interface Props {
    gameId: string;
    gameName: string;
    /** The map loaded from the server (GET /maps/{id}). */
    map: MapDetail;
    client: Pick<MapsClient, 'chunks' | 'sendOps'>;
    /** Loads the page again (after a revision conflict). */
    onreload?: (() => void) | undefined;
    /** Shows the frame rate in the status bar. */
    debug?: boolean;
  }

  let { gameId, gameName, map, client, onreload, debug = false }: Props = $props();
  // The page mounts a new workspace for another map: the initial props are kept.
  // svelte-ignore state_referenced_locally
  const initial = { map, client };
  const grid = gridOf(initial.map);

  let viewport: HTMLDivElement | undefined = $state();
  let engineState = $state<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  let loadFailed = $state(false);

  const session = new EditorSession({
    grid,
    floor: initial.map.floors[0]?.id ?? 'f1',
    layers: layersFromWire(initial.map.layers),
    palette: paletteFromWire(initial.map.palette),
    theme: themeOf(initial.map.theme),
    editable: false,
    platform: detectPlatform(navigator),
    describeNotice: noticeText,
    isViewportTarget: (target) =>
      target === document.body ||
      target === document.documentElement ||
      (target instanceof Node && viewport !== undefined && viewport.contains(target)),
  });
  const ui = session.ui;
  for (const entry of initial.map.palette) {
    if (entry != null) {
      session.catalog.rememberEntry(entry.asset_id, {
        name: entry.name,
        full: entry.url,
        thumb: entry.thumb_url,
      });
    }
  }
  session.refreshPalette();

  let sync: MapSync | null = null;
  let destroyed = false;

  /** Persistence starts once the engine shows the map (visible blocks first). */
  async function startSync(visible: ReturnType<typeof visibleChunkKeys> | null): Promise<void> {
    void requestPersistentStorage();
    const stores = await openMapStores();
    if (destroyed) return;
    sync = new MapSync({
      session,
      map: initial.map,
      client: initial.client,
      stores,
      win: window,
      doc: document,
      onRejected: (error) => {
        session.notify(saveErrorText(error.code));
        toasts.show('error', saveErrorText('rejected'));
      },
    });
    try {
      const result = await sync.start(visible);
      if (result.chunks.errors > 0 || result.replayFailed > 0) {
        toasts.show('error', t('editor.save.load_partial'));
      }
    } catch (error) {
      console.error(error);
      loadFailed = true;
    }
  }

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
          const visible = visibleChunkKeys(grid, created.camera.get(), {
            width: host.clientWidth,
            height: host.clientHeight,
          });
          void startSync(visible);
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

  $effect(() => () => {
    destroyed = true;
    sync?.dispose();
    session.dispose();
  });

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
  <EditorTopBar {session} {gameId} {gameName} mapName={map.name} {onreload} />

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
    {#if loadFailed}
      <div class="state alert alert-error" role="alert" data-testid="editor-load-error">
        <span>{t('editor.save.load_error')}</span>
        <button type="button" class="button" onclick={() => window.location.reload()}>
          {t('common.reload')}
        </button>
      </div>
    {:else if engineState === 'loading'}
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
