<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import EndedScreen from './EndedScreen.svelte';
  import KickedScreen from './KickedScreen.svelte';
  import PauseScreen from './PauseScreen.svelte';
  import PlayLobby from './PlayLobby.svelte';
  import PlayView from './PlayView.svelte';
  import ReadAloudDialog from './ReadAloudDialog.svelte';
  import { t } from '../../lib/i18n';
  import { mapsClient } from '../../lib/maps/service';
  import { services, sessionsClient, syncClient } from '../../lib/services';
  import { ownTokens } from '../../lib/sessions';
  import { sessionProblem } from '../../lib/sessions/labels';
  import {
    browserPreloadHost,
    Preloader,
    type PreloadProgress,
  } from '../../lib/sessions/play/preload';
  import { playScreen } from '../../lib/sessions/play/screen';
  import { SessionRun } from '../../lib/sessions/session-run.svelte';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Player side of a session (projet.md 18.1 p.7-8): picks the screen from the session state,
   * preloads the assets of the map in the lobby and sends `ready`, then shows the game view.
   */
  interface Props {
    sessionId: string;
    gameId: string;
    userId: string;
  }

  let { sessionId, gameId, userId }: Props = $props();
  const { router } = services();

  function revertTokens(): void {
    const s = run.state;
    const scene = run.scene;
    if (s === null || scene === null) return;
    for (const tok of ownTokens(s)) scene.revert(tok.uid);
  }

  // The page mounts a new component for another session: the initial props are kept.
  // svelte-ignore state_referenced_locally
  const run = new SessionRun({
    sessionId,
    userId,
    api: sessionsClient(),
    sync: syncClient(),
    tiles: mapsClient(),
    onProblem: (error) => {
      toasts.show('error', sessionProblem(error));
      revertTokens();
    },
    onBlocked: () => toasts.info(t('play.blocked_by_wall')),
  });

  const idle: PreloadProgress = {
    status: 'idle',
    done: 0,
    total: 0,
    loadedBytes: 0,
    totalBytes: 0,
    errors: 0,
    error: null,
  };
  let progress = $state.raw<PreloadProgress>(idle);
  const preloader = new Preloader(
    browserPreloadHost((signal) => sessionsClient().preload(sessionId, signal)),
    (next) => (progress = next),
  );
  let loadedKey = $state<string | null>(null);
  let readyKey: string | null = null;
  let optedOut = false;
  let busy = $state(false);

  const snap = $derived(run.state);
  const session = $derived(snap?.session ?? null);
  const status = $derived(session?.state ?? null);
  const key = $derived(
    session?.current_map_id == null
      ? null
      : `${session.current_map_id}:${session.current_floor_id ?? ''}:${run.preloadAsked}`,
  );
  const preloaded = $derived(key !== null && loadedKey === key && progress.status === 'done');
  const me = $derived(session?.players.find((p) => p.user_id === userId) ?? null);
  const screen = $derived(
    playScreen({
      phase: run.phase,
      status,
      hasMap: snap?.map != null,
      preloaded,
    }),
  );

  // Preload of the current map (lobby or running; never while paused or ended).
  $effect(() => {
    const k = key;
    const s = status;
    if (k === null || (s !== 'lobby' && s !== 'running')) return;
    untrack(() => {
      if (k !== loadedKey) {
        loadedKey = k;
        optedOut = false;
        readyKey = null;
        void preloader.start();
      } else if (progress.status === 'error') {
        void preloader.start();
      }
    });
  });

  // "Ready" as soon as the preload is over (the player can untick it).
  $effect(() => {
    const k = key;
    if (!preloaded || k === null || me === null) return;
    untrack(() => {
      if (readyKey === k || optedOut || me.ready) return;
      readyKey = k;
      void setReady(true, false);
    });
  });

  async function setReady(ready: boolean, byUser = true): Promise<void> {
    if (byUser) optedOut = !ready;
    busy = true;
    try {
      await sessionsClient().ready(sessionId, ready);
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    } finally {
      busy = false;
    }
  }

  async function leave(): Promise<void> {
    try {
      await sessionsClient().leave(sessionId);
    } catch (error) {
      toasts.show('error', sessionProblem(error));
      return;
    }
    router.navigate(`/games/${encodeURIComponent(gameId)}`);
  }

  // Kicked or ended: nothing more to follow.
  $effect(() => {
    if (screen === 'kicked' || screen === 'ended') {
      untrack(() => {
        preloader.stop();
        run.stop();
      });
    }
  });

  onMount(() => {
    void run.start();
    const hidden = (): void => run.setHidden(document.hidden);
    const online = (): void => run.sync.actions.resume();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('online', online);
      preloader.stop();
      run.stop();
    };
  });
</script>

<div class="play" data-testid="session-player" data-screen={screen} data-phase={run.phase}>
  {#if screen === 'error'}
    <div class="center alert alert-error" role="alert" data-testid="play-error">
      <span>{sessionProblem(run.error)}</span>
      <button type="button" class="button" onclick={() => window.location.reload()}
        >{t('common.retry')}</button
      >
    </div>
  {:else if screen === 'kicked'}
    <KickedScreen {gameId} />
  {:else if screen === 'loading' || snap === null || session === null}
    <p class="muted center" aria-busy="true">{t('common.loading')}</p>
  {:else if screen === 'ended'}
    <EndedScreen {gameId} name={session.name} />
  {:else if screen === 'paused'}
    <PauseScreen screen={session.pause_screen} name={session.name} onleave={leave} />
  {:else if screen === 'lobby'}
    <PlayLobby
      state={snap}
      {progress}
      ready={me?.ready ?? false}
      {busy}
      onready={(v) => void setReady(v)}
      onretry={() => void preloader.start()}
      onleave={leave}
    />
  {:else}
    <PlayView {run} onleave={leave} />
  {/if}
  {#if screen === 'lobby' || screen === 'game' || screen === 'paused'}
    <ReadAloudDialog note={run.readAloud} />
  {/if}
</div>

<style>
  .center {
    margin: var(--space-6) auto;
    text-align: center;
    width: fit-content;
  }
</style>
