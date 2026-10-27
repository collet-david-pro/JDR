<script lang="ts">
  import { untrack } from 'svelte';
  import EngineUnsupported from '../editor/EngineUnsupported.svelte';
  import { isEngineUnsupportedError, loadSceneEngine, type SceneEngine } from '../../engine/load';
  import { t } from '../../lib/i18n';
  import type { ScreenSize } from '../../lib/displays/calibration';
  import { frame } from '../../lib/displays/framing';
  import type { DisplayRun } from '../../lib/displays/display-run.svelte';
  import type { DisplaySettings } from '../../lib/displays/types';
  import { tableViewerTokens } from '../../lib/displays/viewers';
  import { createVisionService } from '../../vision/index';

  /**
   * The map as seen from the table (view `display`): no input at all, camera set by `frame()`
   * (scale of the screen, GM camera, viewers). The host fills the rotated stage.
   */
  interface Props {
    run: DisplayRun;
    settings: DisplaySettings;
    /** Size of the render area (rotation applied), CSS px. */
    size: ScreenSize;
    screen: ScreenSize | null;
    onrange: (range: 'low' | 'high' | null) => void;
  }
  let { run, settings, size, screen, onrange }: Props = $props();

  const vision = createVisionService();
  let host: HTMLDivElement | undefined = $state();
  let engine = $state.raw<SceneEngine | null>(null);
  let engineState = $state<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  let zoom = $state(1);

  const session = $derived(run.run);
  const scene = $derived(session?.scene ?? null);
  const viewerKey = $derived([...run.viewers].sort().join(','));

  $effect(() => () => vision.destroy());

  $effect(() => {
    const el = host;
    if (el === undefined) return;
    let created: SceneEngine | null = null;
    let cancelled = false;
    untrack(() => {
      loadSceneEngine(el, { vision })
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

  // Scene shown.
  $effect(() => {
    const e = engine;
    const s = scene;
    if (e === null) return;
    if (s === null) {
      untrack(() => e.setScene(null));
      return;
    }
    untrack(() => {
      e.setMap(s.doc);
      e.setScene(s.doc);
    });
  });

  // View options: viewers, tokens.
  $effect(() => {
    const e = engine;
    const key = viewerKey;
    const tokens = settings.show_tokens;
    if (e === null || scene === null) return;
    untrack(() =>
      e.setView({
        mode: 'display',
        viewers: key === '' ? [] : key.split(','),
        tokens,
        lighting: true,
        fog: true,
        shadows: true,
      }),
    );
  });

  // Framing: settings, GM camera, viewers, window size, scene.
  $effect(() => {
    const e = engine;
    const s = scene;
    const state = session?.state ?? null;
    const width = size.width;
    const height = size.height;
    const cfg = settings;
    void viewerKey;
    if (e === null || s === null) return;
    untrack(() => {
      const f = frame({
        settings: cfg,
        floorId: s.floor,
        camera: state?.session.camera ?? null,
        viewers: state === null ? [] : tableViewerTokens(state, s.floor),
        map: { width: s.doc.grid.width, height: s.doc.grid.height, cellPx: s.doc.grid.cellPx },
        viewport: { width, height },
        screen,
      });
      e.camera.set({ x: f.x, y: f.y, zoom: f.zoom });
      zoom = e.camera.get().zoom;
      onrange(f.outOfRange);
    });
  });

  $effect(() => {
    const e = engine;
    if (e === null) return;
    return e.onCamera((c) => (zoom = c.zoom));
  });

  const cellPx = $derived(scene?.doc.grid.cellPx ?? null);
</script>

<div
  class="host"
  bind:this={host}
  data-testid="display-viewport"
  data-state={engineState}
  data-scene={scene === null ? 'none' : 'ready'}
  data-zoom={zoom}
  data-cell-px={cellPx ?? ''}
  data-cell-css-px={cellPx === null ? '' : cellPx * zoom}
  data-viewers={viewerKey}
  data-tokens={settings.show_tokens ? 'on' : 'off'}
></div>
{#if engineState === 'unsupported'}
  <div class="state"><EngineUnsupported /></div>
{:else if engineState === 'error'}
  <p class="state" role="alert">{t('editor.load_error')}</p>
{:else if engineState === 'loading' || scene === null || session?.tilesLoading}
  <p class="state" aria-busy="true">{t('common.loading')}</p>
{/if}

<style>
  .host {
    position: absolute;
    inset: 0;
    touch-action: none;
    pointer-events: none;
  }
  .state {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    color: #aab;
  }
</style>
