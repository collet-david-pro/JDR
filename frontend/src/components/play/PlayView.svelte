<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import NetworkIndicator from './NetworkIndicator.svelte';
  import EngineUnsupported from '../editor/EngineUnsupported.svelte';
  import { isEngineUnsupportedError, loadSceneEngine, type SceneEngine } from '../../engine/load';
  import { t } from '../../lib/i18n';
  import { assignedTo, ownTokens } from '../../lib/sessions';
  import { CameraFollow } from '../../lib/sessions/play/camera';
  import { PlayerExplorer } from '../../lib/sessions/play/exploration';
  import { PlayerInput } from '../../lib/sessions/play/player-input';
  import type { SessionRun } from '../../lib/sessions/session-run.svelte';
  import { toasts } from '../../stores/toasts.svelte';
  import { createVisionService } from '../../vision/index';

  /**
   * Game view of a player (projet.md 18.1 p.8): the map seen through the player's tokens
   * (vision, fog, light), draggable own tokens, centring, GM camera following, network indicator.
   */
  interface Props {
    run: SessionRun;
    onleave: () => void;
  }
  let { run, onleave }: Props = $props();

  const vision = createVisionService();
  let viewport: HTMLDivElement | undefined = $state();
  let engine = $state.raw<SceneEngine | null>(null);
  let engineState = $state<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  let zoom = $state(1);
  let followOn = $state(untrack(() => run.state?.session.camera?.follow ?? false));
  let follow: CameraFollow | null = null;

  const running = $derived(run.state?.session.state === 'running');
  const snap = $derived(run.state);
  const viewerKey = $derived.by(() => {
    const s = run.state;
    const scene = run.scene;
    if (s === null || scene === null) return '';
    return ownTokens(s)
      .filter((tok) => tok.floor === scene.floor)
      .map((tok) => tok.uid)
      .sort()
      .join(',');
  });

  const input = new PlayerInput({
    scene: () => run.scene,
    cellsPerPixel: () => {
      const scene = run.scene;
      const z = engine?.camera.get().zoom ?? 1;
      return scene === null ? 0.05 : 1 / (scene.doc.grid.cellPx * Math.max(0.05, z));
    },
    canMove: () => {
      const s = run.state;
      return (
        s !== null &&
        s.session.state === 'running' &&
        s.session.settings.players_can_move_own_tokens
      );
    },
    isOwn: (uid) => {
      const s = run.state;
      const token = s?.tokens[uid];
      return (
        s !== undefined &&
        s !== null &&
        token !== undefined &&
        assignedTo(s, token.token_id) === s.me
      );
    },
    moveToken: (uid, x, y) => run.sync.actions.moveToken(uid, x, y),
  });

  function centerOnToken(): void {
    const s = run.state;
    const scene = run.scene;
    if (follow === null || s === null || scene === null) return;
    const own = ownTokens(s).find((tok) => tok.floor === scene.floor);
    follow.center(own === undefined ? null : { x: own.x, y: own.y });
  }

  function toggleFollow(on: boolean): void {
    followOn = on;
    follow?.setEnabled(on);
    if (on) follow?.apply(run.state?.session.camera ?? null, run.scene?.floor ?? null);
  }

  onMount(() => () => {
    input.cancel();
    vision.destroy();
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

  // Scene shown by the engine: player view, pointer, exploration, camera.
  $effect(() => {
    const e = engine;
    const scene = run.scene;
    if (e === null) return;
    if (scene === null) {
      e.setScene(null);
      return;
    }
    const offs: (() => void)[] = [];
    let explorer: PlayerExplorer | null = null;
    untrack(() => {
      e.setMap(scene.doc);
      e.setScene(scene.doc);
      e.setView({
        mode: 'player',
        viewers: viewerKey === '' ? [] : viewerKey.split(','),
        lighting: true,
        fog: true,
        shadows: true,
      });
      offs.push(e.onPointer((event) => input.handle(event)));
      explorer = new PlayerExplorer({
        scene,
        active: () => run.state?.session.state === 'running',
        send: (actions) => {
          run.sync.actions.send(actions).catch((error: unknown) => {
            if (run.phase === 'ready') console.warn(error);
          });
        },
      });
      offs.push(e.onVisibility((visible) => explorer?.push(visible)));
      follow = new CameraFollow(e.camera, followOn, (on) => (followOn = on));
      const camera = run.state?.session.camera ?? null;
      if (followOn && camera !== null) follow.apply(camera, scene.floor);
      else centerOnToken();
      zoom = e.camera.get().zoom;
      offs.push(
        e.onCamera((c) => {
          zoom = c.zoom;
          follow?.moved(c);
        }),
      );
    });
    return () => {
      for (const off of offs) off();
      input.cancel();
      explorer?.dispose();
      follow = null;
    };
  });

  // The player's tokens changed (assignment, appearance): the viewers follow.
  let lastViewers = '';
  $effect(() => {
    const key = viewerKey;
    const e = engine;
    if (e === null || key === lastViewers) return;
    lastViewers = key;
    untrack(() => e.setView({ viewers: key === '' ? [] : key.split(',') }));
  });

  // The GM's camera.
  $effect(() => {
    const camera = snap?.session.camera ?? null;
    untrack(() => follow?.apply(camera, run.scene?.floor ?? null));
  });

  $effect(() => {
    if (run.tilesErrors > 0) untrack(() => toasts.show('error', t('editor.save.load_partial')));
  });
</script>

<div class="view" data-testid="play-view" data-phase={run.phase}>
  <div class="top">
    <header class="bar">
      <h1 class="name">{snap?.session.name ?? ''}</h1>
      <NetworkIndicator />
      <label class="follow">
        <input
          type="checkbox"
          checked={followOn}
          data-testid="play-follow"
          onchange={(e) => toggleFollow(e.currentTarget.checked)}
        />
        <span>{t('play.view.follow')}</span>
      </label>
      <button
        type="button"
        class="button button-small"
        onclick={centerOnToken}
        data-testid="play-center">{t('play.view.center')}</button
      >
      <button
        type="button"
        class="button button-small button-ghost"
        onclick={onleave}
        data-testid="play-leave">{t('play.leave')}</button
      >
    </header>
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
      aria-label={t('play.view.map_label')}
      data-testid="play-viewport"
      data-state={engineState}
      data-scene={run.scene === null ? 'none' : 'ready'}
      data-zoom={zoom}
      data-cell-px={run.scene?.doc.grid.cellPx ?? ''}
      data-running={running}
    ></div>
    {#if engineState === 'unsupported'}
      <div class="state"><EngineUnsupported /></div>
    {:else if engineState === 'error'}
      <p class="state alert alert-error" role="alert">{t('editor.load_error')}</p>
    {:else if engineState === 'loading' || run.tilesLoading || run.scene === null}
      <p class="state muted" aria-busy="true">{t('common.loading')}</p>
    {/if}
  </div>
</div>

<style>
  .view {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--color-bg);
    color: var(--color-text);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  .name {
    margin: 0;
    font-size: var(--font-size-lg);
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .follow {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 2.75rem;
  }
  .stage {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--color-surface-sunken);
  }
  .viewport {
    position: absolute;
    inset: 0;
    touch-action: none;
  }
  .state {
    position: absolute;
    inset: 50% auto auto 50%;
    transform: translate(-50%, -50%);
    margin: 0;
  }
  .alert.row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
    margin: 0;
  }
</style>
