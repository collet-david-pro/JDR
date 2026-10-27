<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ConsoleHeader from './ConsoleHeader.svelte';
  import ConsolePanels from './ConsolePanels.svelte';
  import EngineUnsupported from '../editor/EngineUnsupported.svelte';
  import type { Overlay } from '../../editor/contracts';
  import { newObjectUid } from '../../editor/util/uid';
  import { isEngineUnsupportedError, loadSceneEngine, type SceneEngine } from '../../engine/load';
  import { DisplaysClient } from '../../lib/displays/displays-client';
  import type { ViewLock } from '../../lib/displays/types';
  import { t } from '../../lib/i18n';
  import { mapsClient } from '../../lib/maps/service';
  import { services, sessionsClient, syncClient } from '../../lib/services';
  import {
    ConsoleInput,
    type ConsoleTool,
    type Selection,
  } from '../../lib/sessions/console/console-input';
  import { consoleViewers } from '../../lib/sessions/console/displays-logic';
  import { DisplaysModel } from '../../lib/sessions/console/displays.svelte';
  import { bindEngineToScreens, gmView } from '../../lib/sessions/console/engine-bindings.svelte';
  import { addTokenOp, newPlacedToken, sendMapOps } from '../../lib/sessions/console/map-ops';
  import { sessionProblem } from '../../lib/sessions/labels';
  import { SessionRun } from '../../lib/sessions/session-run.svelte';
  import type { SessionAction } from '../../lib/sessions/types';
  import { toasts } from '../../stores/toasts.svelte';
  import { createVisionService } from '../../vision/index';

  /**
   * GM console of a session (projet.md 18.1 p.6): the map in GM view with the pointer tools,
   * the header (state, code, controls) and the side panels. The scene shown by the engine is
   * the session scene adapter (lib/sessions/scene), fed by the session events.
   */
  interface Props {
    sessionId: string;
    gameId: string;
    userId: string;
  }

  let { sessionId, gameId, userId }: Props = $props();
  const { router } = services();

  // svelte-ignore state_referenced_locally
  const displays = new DisplaysModel({
    sessionId,
    api: new DisplaysClient(services().api),
    onError: (error) => console.warn(error),
  });

  // The page mounts a new console for another session: the initial props are kept.
  // svelte-ignore state_referenced_locally
  const run = new SessionRun({
    sessionId,
    userId,
    api: sessionsClient(),
    sync: syncClient(),
    tiles: mapsClient(),
    onEvent: (event) => displays.onEvent(event),
    onProblem: (error) => toasts.show('error', sessionProblem(error)),
  });
  const vision = createVisionService();

  let viewport: HTMLDivElement | undefined = $state();
  let engine = $state.raw<SceneEngine | null>(null);
  let engineState = $state<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  let tool = $state.raw<ConsoleTool>({ kind: 'select' });
  let selection = $state.raw<Selection | null>(null);
  let toolOverlay: Overlay | null = null;
  let broadcasting = $state(false);
  const tableViewerIds = $derived(
    consoleViewers(run.state, run.scene?.floor ?? null, displays.activeCount),
  );

  const input = new ConsoleInput({
    scene: () => run.scene,
    cellsPerPixel: () => {
      const scene = run.scene;
      const zoom = engine?.camera.get().zoom ?? 1;
      return scene === null ? 0.05 : 1 / (scene.doc.grid.cellPx * Math.max(0.05, zoom));
    },
    moveToken: (uid, x, y) => run.sync.actions.moveToken(uid, x, y),
    send: (actions) => void send(actions),
    placeToken: (tokenId, cx, cy, hidden) => void place(tokenId, cx, cy, hidden),
    setOverlay: (overlay) => {
      toolOverlay = overlay;
      showOverlay();
    },
    onSelect: (next) => {
      selection = next;
      showOverlay();
    },
    tokenSize: (tokenId) => {
      const def = run.state?.definitions[tokenId];
      return { w: Math.max(0.25, def?.size_w ?? 1), h: Math.max(0.25, def?.size_h ?? 1) };
    },
  });

  function showOverlay(): void {
    const parts: Overlay[] = [];
    if (selection !== null) {
      parts.push({
        kind: 'objects',
        objects: selection.kind === 'object' ? [selection.uid] : [],
        tokens: selection.kind === 'token' ? [selection.uid] : [],
      });
    }
    if (toolOverlay !== null) parts.push(toolOverlay);
    engine?.setOverlay(parts.length === 0 ? null : { kind: 'group', items: parts });
  }

  async function send(actions: SessionAction[]): Promise<boolean> {
    try {
      await run.sync.actions.send(actions);
      return true;
    } catch (error) {
      toasts.show('error', sessionProblem(error));
      return false;
    }
  }

  async function place(tokenId: string, cx: number, cy: number, hidden: boolean): Promise<void> {
    const state = run.state;
    const scene = run.scene;
    const def = state?.definitions[tokenId];
    if (state?.map == null || scene === null || def === undefined) return;
    const token = newPlacedToken(
      { id: def.id, sizeW: Math.max(0.25, def.size_w), sizeH: Math.max(0.25, def.size_h) },
      newObjectUid(),
      scene.floor,
      cx,
      cy,
      scene.doc.grid,
      hidden,
    );
    try {
      await sendMapOps(mapsClient(), state.map.id, state.mapRevision ?? state.map.revision, [
        addTokenOp(token),
      ]);
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    }
  }

  function setTool(next: ConsoleTool): void {
    tool = next;
    input.setTool(next);
  }

  function share(follow: boolean): void {
    const scene = run.scene;
    if (engine === null || scene === null) return;
    const camera = engine.camera.get();
    void send([
      {
        type: 'camera.set',
        x: camera.x,
        y: camera.y,
        zoom: Math.min(8, Math.max(0.1, camera.zoom)),
        floor_id: scene.floor,
        follow,
      },
    ]).then((ok) => ok && toasts.success(t('sessions.console.view_shared')));
  }

  /** Engine camera and current floor, as a view lock ("Lock here" of a screen). */
  function currentView(): ViewLock | null {
    const scene = run.scene;
    if (engine === null || scene === null) return null;
    const { x, y, zoom } = engine.camera.get();
    return { x, y, zoom: Math.min(8, Math.max(0.1, zoom)), floor_id: scene.floor };
  }

  onMount(() => {
    void run.start();
    displays.start();
    const hidden = (): void => run.setHidden(document.hidden);
    const online = (): void => run.sync.actions.resume();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('online', online);
      input.cancel();
      displays.stop();
      run.stop();
      vision.destroy();
    };
  });

  // Engine.
  $effect(() => {
    const host = viewport;
    if (host === undefined) return;
    let created: SceneEngine | null = null;
    let cancelled = false;
    untrack(() => {
      loadSceneEngine(host, { vision })
        .then((e) => {
          if (cancelled) {
            e.destroy();
            return;
          }
          created = e;
          engine = e;
          engineState = 'ready';
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          engineState = isEngineUnsupportedError(error) ? 'unsupported' : 'error';
          if (!isEngineUnsupportedError(error)) console.error(error);
        });
    });
    return () => {
      cancelled = true;
      engine = null;
      created?.destroy();
    };
  });

  // Scene shown by the engine; pointer events.
  $effect(() => {
    const e = engine;
    const scene = run.scene;
    if (e === null) return;
    if (scene === null) {
      e.setScene(null);
      return;
    }
    e.setMap(scene.doc);
    e.setScene(scene.doc);
    e.setView(gmView(untrack(() => tableViewerIds)));
    const off = e.onPointer((event) => input.handle(event));
    return () => off();
  });

  bindEngineToScreens({
    engine: () => engine,
    run,
    viewers: () => tableViewerIds,
    broadcasting: () => broadcasting,
    send,
  });

  // Selection that no longer exists.
  $effect(() => {
    const sel = selection;
    const state = run.state;
    if (sel === null || state === null) return;
    const exists = sel.kind === 'token' ? sel.uid in state.tokens : sel.uid in state.objects;
    if (!exists) {
      selection = null;
      showOverlay();
    }
  });

  // Kicked (or session gone): back to the dashboard.
  $effect(() => {
    if (run.phase === 'kicked') {
      untrack(() => {
        toasts.show('error', t('sessions.console.kicked'));
        router.navigate('/', { replace: true });
      });
    }
  });

  $effect(() => {
    if (run.tilesErrors > 0) untrack(() => toasts.show('error', t('editor.save.load_partial')));
  });

  $effect(() => {
    const note = run.readAloud;
    if (note !== null) {
      untrack(() => toasts.info(t('sessions.console.note_shown', { title: note.title })));
    }
  });

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && (tool.kind !== 'select' || selection !== null)) {
      setTool({ kind: 'select' });
      selection = null;
      showOverlay();
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="console" data-testid="session-console" data-phase={run.phase}>
  {#if run.phase === 'error'}
    <div class="center alert alert-error" role="alert" data-testid="console-error">
      <span>{sessionProblem(run.error)}</span>
      <button type="button" class="button" onclick={() => window.location.reload()}
        >{t('common.retry')}</button
      >
    </div>
  {:else}
    <div class="top">
      <ConsoleHeader
        {run}
        {gameId}
        onshare={share}
        {broadcasting}
        onbroadcast={(on) => (broadcasting = on)}
      />
      {#if run.reloadAsked}
        <div class="alert alert-warning row" role="status" data-testid="reload-notice">
          <span>{t('sessions.console.reload_asked')}</span>
          <button type="button" class="button button-small" onclick={() => window.location.reload()}
            >{t('common.reload')}</button
          >
        </div>
      {/if}
    </div>

    <div class="stage">
      <div
        class="viewport"
        bind:this={viewport}
        role="application"
        aria-label={t('sessions.console.map_label')}
        data-testid="console-viewport"
        data-state={engineState}
        data-scene={run.scene === null ? 'none' : 'ready'}
        data-table-viewers={[...tableViewerIds].sort().join(',')}
      ></div>
      {#if engineState === 'unsupported'}
        <div class="state"><EngineUnsupported /></div>
      {:else if engineState === 'error'}
        <p class="state alert alert-error" role="alert">{t('editor.load_error')}</p>
      {:else if run.phase === 'loading' || engineState === 'loading' || run.tilesLoading}
        <p class="state muted" aria-busy="true">{t('common.loading')}</p>
      {:else if run.scene === null}
        <p class="state muted" data-testid="console-no-map">{t('sessions.console.no_map')}</p>
      {/if}
    </div>

    <aside class="side" aria-label={t('sessions.panels.label')}>
      <ConsolePanels
        {run}
        {gameId}
        {send}
        {selection}
        {displays}
        {currentView}
        {tool}
        ontool={setTool}
      />
    </aside>
  {/if}
</div>

<style>
  .console {
    position: fixed;
    inset: 0;
    /* Above the site header and banner, below dialogs and toasts (like the editor). */
    z-index: 60;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20rem;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'top top'
      'stage side';
    background: var(--color-bg);
    color: var(--color-text);
  }
  .top {
    grid-area: top;
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
  .state {
    position: absolute;
    inset: 50% auto auto 50%;
    transform: translate(-50%, -50%);
    margin: 0;
  }
  .side {
    grid-area: side;
    display: grid;
    min-height: 0;
    overflow: hidden;
    border-left: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  .center {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    align-self: center;
    justify-self: center;
  }
  .alert.row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
    margin: 0;
  }
  @media (max-width: 48rem) {
    .console {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(12rem, 1fr) minmax(0, 18rem);
      grid-template-areas:
        'top'
        'stage'
        'side';
    }
    .side {
      border-left: 0;
      border-top: var(--border-width) solid var(--color-border);
    }
  }
</style>
