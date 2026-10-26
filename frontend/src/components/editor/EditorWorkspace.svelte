<script lang="ts">
  import { untrack } from 'svelte';
  import AmbientPanel from './AmbientPanel.svelte';
  import EditorTopBar from './EditorTopBar.svelte';
  import EngineUnsupported from './EngineUnsupported.svelte';
  import HelpDialog from './HelpDialog.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
  import LayersPanel from './LayersPanel.svelte';
  import PalettePanel from './PalettePanel.svelte';
  import PropertiesPanel from './PropertiesPanel.svelte';
  import SnapshotDialog from './SnapshotDialog.svelte';
  import StatusBar from './StatusBar.svelte';
  import TokensPanel from './TokensPanel.svelte';
  import ToolBar from './ToolBar.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import ExportPngDialog from '../export/ExportPngDialog.svelte';
  import type { ExportSource } from '../../export/types';
  import { detectPlatform } from '../../editor/shortcuts';
  import { visibleChunkKeys } from '../../editor/sync/chunk-loader';
  import { MapSync } from '../../editor/sync/MapSync';
  import { saveErrorText } from '../../editor/sync/save-status';
  import {
    gridOf,
    layersFromWire,
    paletteFromWire,
    themeOf,
    tokenDefFromWire,
  } from '../../editor/sync/wire';
  import {
    markThumbnailStale,
    takeThumbnailStale,
    ThumbnailRenderer,
  } from '../../editor/thumbnail/render';
  import { sendThumbnail, ThumbnailScheduler } from '../../editor/thumbnail/ThumbnailScheduler';
  import {
    downloadBlob,
    selectionBounds,
    viewportCellRect,
    type ExportKind,
  } from '../../editor/ui/export-source';
  import { versionKindLabel } from '../../editor/versions/labels';
  import { PendingOpsError, VersionsModel } from '../../editor/versions/versions.svelte';
  import { TILE_LAYERS } from '../../formats/chunk-codec';
  import { noticeText } from '../../editor/ui/labels';
  import { EditorSession } from '../../editor/ui/session';
  import { isEngineUnsupportedError, loadSceneEngine, type SceneEngine } from '../../engine/load';
  import { t } from '../../lib/i18n';
  import type { MapsClient } from '../../lib/maps/maps-client';
  import { openMapStores } from '../../lib/persistence/map-stores';
  import { requestPersistentStorage } from '../../lib/persistence/idb';
  import type { MapDetail, Token } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';
  import { createVisionService } from '../../vision/index';

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
    client: Pick<
      MapsClient,
      | 'chunks'
      | 'sendOps'
      | 'versions'
      | 'createVersion'
      | 'restoreVersion'
      | 'exportFile'
      | 'putThumbnail'
      | 'fog'
      | 'resetFog'
    >;
    /** Token definitions of the game (Tokens panel, token tool; P5). */
    loadTokens?: (() => Promise<Token[]>) | undefined;
    /** Loads the page again (after a revision conflict). */
    onreload?: (() => void) | undefined;
    /** Shows the frame rate in the status bar. */
    debug?: boolean;
  }

  let { gameId, gameName, map, client, loadTokens, onreload, debug = false }: Props = $props();
  // The page mounts a new workspace for another map: the initial props are kept.
  // svelte-ignore state_referenced_locally
  const initial = { map, client, loadTokens };
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
    ambient: initial.map.ambient,
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

  // ---- P5: token definitions, vision service ----------------------------------------------
  let tokensState = $state<'loading' | 'ready' | 'error'>('loading');
  if (initial.loadTokens === undefined) tokensState = 'ready';
  else {
    initial
      .loadTokens()
      .then((tokens) => {
        session.scene.setTokenDefs(tokens.map(tokenDefFromWire));
        tokensState = 'ready';
      })
      .catch((error: unknown) => {
        console.error(error);
        tokensState = 'error';
      });
  }
  /** Vision service shared with the engine (never in $state). */
  const vision = createVisionService();
  let fogResetBusy = $state(false);

  async function resetFog(): Promise<void> {
    fogResetBusy = true;
    try {
      session.scene.flushExploration();
      await sync?.settle();
      const result = await initial.client.resetFog(initial.map.id, session.doc.floor);
      sync?.noteRevision(result.revision);
      session.scene.fogReset();
      ui.resetFogOpen = false;
      toasts.success(t('editor.view.fog_reset_done'));
    } catch (error) {
      toasts.error(error);
    } finally {
      fogResetBusy = false;
    }
  }

  let sync: MapSync | null = null;
  let destroyed = false;
  /** The engine, for the visible area of the PNG export (never in $state). */
  let engineRef: SceneEngine | null = null;

  // ---- Thumbnail (P4c): after confirmed saves, at most once a minute ----------------------
  const thumbnailRenderer = new ThumbnailRenderer();
  const thumbnails = new ThumbnailScheduler({
    send: () =>
      sendThumbnail(
        (maxPx, type) => thumbnailRenderer.render(session.doc, maxPx, type),
        (image) => initial.client.putThumbnail(initial.map.id, image),
      ),
    onError: (error) => console.warn('Map thumbnail not updated', error),
  });
  let restored = false;

  function hasTiles(): boolean {
    return TILE_LAYERS.some((layer) => session.doc.chunkKeys(layer).length > 0);
  }

  // ---- History (P4c) -----------------------------------------------------------------------
  const versions = new VersionsModel({
    mapId: initial.map.id,
    client: initial.client,
    settle: () => sync?.settle() ?? Promise.resolve(false),
    setEditable: (editable) => session.setEditable(editable),
    onRestored: () => {
      restored = true;
      markThumbnailStale(initial.map.id);
      toasts.info(t('editor.versions.restored'));
      if (onreload !== undefined) onreload();
      else window.location.reload();
    },
  });

  async function snapshot(label: string): Promise<void> {
    try {
      const version = await versions.snapshot(label);
      ui.snapshotOpen = false;
      toasts.success(
        t('editor.versions.snapshot_done', {
          name: version.label ?? versionKindLabel(version.kind),
        }),
      );
    } catch (error) {
      if (error instanceof PendingOpsError) toasts.show('error', t('editor.versions.pending_ops'));
      else toasts.error(error);
    }
  }

  // ---- Export (P4c) ------------------------------------------------------------------------
  let exporting = $state(false);
  let pngOpen = $state(false);
  let pngSource = $state.raw<ExportSource | null>(null);

  async function exportMap(kind: ExportKind): Promise<void> {
    if (kind === 'png') {
      const engine = engineRef;
      pngSource = {
        view: session.doc,
        scene: session.doc,
        name: map.name,
        selection: selectionBounds(grid, ui.selection),
        viewport:
          engine === null || viewport === undefined
            ? null
            : viewportCellRect(grid, engine.camera.get(), {
                width: viewport.clientWidth,
                height: viewport.clientHeight,
              }),
      };
      pngOpen = true;
      return;
    }
    exporting = true;
    try {
      // The server exports the saved state: send the pending modifications first.
      const settled = (await sync?.settle()) ?? false;
      if (!settled) toasts.info(t('editor.export.unsaved'));
      const file = await initial.client.exportFile(initial.map.id, kind === 'zip', map.name);
      downloadBlob(file.blob, file.fileName);
    } catch (error) {
      toasts.error(error);
    } finally {
      exporting = false;
    }
  }

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
      onSaved: () => thumbnails.saved(),
    });
    try {
      const result = await sync.start(visible);
      if (result.chunks.errors > 0 || result.replayFailed > 0 || result.fogErrors !== 0) {
        toasts.show('error', t('editor.save.load_partial'));
      }
      const stale = takeThumbnailStale(initial.map.id);
      if (!destroyed && (stale || initial.map.thumb_url === null) && hasTiles()) {
        thumbnails.saved();
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
      loadSceneEngine(host, { vision })
        .then((created) => {
          if (cancelled) {
            created.destroy();
            return;
          }
          engine = created;
          engineRef = created;
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
      engineRef = null;
      session.detach();
      engine?.destroy();
    };
  });

  $effect(() => () => {
    destroyed = true;
    session.scene.flushExploration();
    sync?.dispose();
    // Leaving the editor sends a pending thumbnail (not after a restoration: old content).
    void thumbnails.dispose({ flush: !restored });
    session.dispose();
    vision.destroy();
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
  <EditorTopBar
    {session}
    {gameId}
    {gameName}
    mapName={map.name}
    {onreload}
    {exporting}
    onexport={exportMap}
  />

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
      {#if ui.historyOpen}
        <HistoryPanel
          model={versions}
          ready={ui.save !== null}
          onsnapshot={() => (ui.snapshotOpen = true)}
          onclose={() => (ui.historyOpen = false)}
        />
      {/if}
      <PropertiesPanel {session} />
      <LayersPanel {session} />
      <PalettePanel {session} />
      <TokensPanel {session} state={tokensState} />
      <AmbientPanel {session} />
    </aside>
  {/if}

  <StatusBar {session} {debug} />
</div>

<p id="editor-notice" class="visually-hidden" aria-live="polite" data-testid="editor-notice">
  {#key ui.notice?.id}{ui.notice?.text ?? ''}{/key}
</p>

<HelpDialog bind:open={ui.helpOpen} />
<SnapshotDialog
  bind:open={ui.snapshotOpen}
  busy={versions.busy === 'snapshot'}
  onsubmit={(label) => void snapshot(label)}
/>
<ConfirmDialog
  bind:open={ui.resetFogOpen}
  title={t('editor.view.fog_reset_title')}
  message={t('editor.view.fog_reset_message')}
  confirmLabel={t('editor.view.fog_reset_confirm')}
  danger
  busy={fogResetBusy}
  onconfirm={() => void resetFog()}
/>
{#if pngSource !== null}
  <ExportPngDialog open={pngOpen} source={pngSource} onclose={() => (pngOpen = false)} />
{/if}

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
