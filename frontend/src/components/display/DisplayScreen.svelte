<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import CalibrationWizard from './CalibrationWizard.svelte';
  import DisplayMenu from './DisplayMenu.svelte';
  import DisplayPause from './DisplayPause.svelte';
  import DisplayReadAloud from './DisplayReadAloud.svelte';
  import DisplayView from './DisplayView.svelte';
  import PairForm from './PairForm.svelte';
  import WaitScreen from './WaitScreen.svelte';
  import NetworkIndicator from '../play/NetworkIndicator.svelte';
  import { ApiError } from '../../lib/api';
  import { t } from '../../lib/i18n';
  import type { ScreenSize } from '../../lib/displays/calibration';
  import { CornerPress } from '../../lib/displays/corner-press';
  import { createDisplayRun } from '../../lib/displays/display-boot';
  import { orientation } from '../../lib/displays/orientation';
  import {
    CursorHider,
    RELOAD_DELAY_MS,
    isCodeComplete,
    normalizeCode,
    screenFor,
  } from '../../lib/displays/ui-logic';
  import type { DeviceSettingsPatch, Rotation } from '../../lib/displays/types';
  import {
    WakeLockManager,
    browserWakeLockDeps,
    type WakeLockState,
  } from '../../lib/displays/wake-lock';
  import type { SyncStatus } from '../../lib/realtime/types';
  import { href, services } from '../../lib/services';

  /** The `/display` page: a projection screen, no account, no visible interface in play. */
  interface Props {
    query: URLSearchParams;
  }
  let { query }: Props = $props();

  const svc = services();
  const { run, api } = createDisplayRun({
    baseUrl: svc.boot.apiBase,
    csrfToken: svc.api.csrfToken,
    onProblem: (error) => console.warn(error),
  });
  const initialCode = untrack(() => normalizeCode(query.get('c') ?? ''));

  let wake = $state<WakeLockState>('idle');
  const wakeLock = new WakeLockManager(browserWakeLockDeps(), (s) => (wake = s));
  let fullscreen = $state(false);
  let cursorHidden = $state(false);
  let menu = $state<'closed' | 'menu' | 'calibration'>('closed');
  let saveError = $state<string | null>(null);
  let outOfRange = $state<'low' | 'high' | null>(null);
  let net = $state.raw<SyncStatus>(api.sync.status);
  let win = $state({ width: window.innerWidth, height: window.innerHeight });

  const cursor = new CursorHider((hidden) => (cursorHidden = hidden));
  const press = new CornerPress({
    onTrigger: () => {
      if (run.settings !== null) menu = 'menu';
    },
  });

  const screenSize = $derived<ScreenSize | null>(
    typeof window.screen?.width === 'number' && window.screen.width > 0
      ? { width: window.screen.width, height: window.screen.height }
      : null,
  );
  const kind = $derived(screenFor(run.status, run.loading));
  const settings = $derived(run.settings);
  const orient = $derived(
    orientation(win, { rotation: settings?.rotation ?? 0, mirror: settings?.mirror ?? false }),
  );
  const session = $derived(run.run);
  const showNet = $derived(kind !== 'pair' && kind !== 'loading' && net.state !== 'online');
  const readAloud = $derived(kind === 'game' ? run.readAloud : null);

  // Opens the menu / closes it from the keyboard.
  function onkeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if (event.key === 'Escape' && menu !== 'closed') {
      menu = 'closed';
    } else if (
      (event.key === 'm' || event.key === 'M') &&
      !typing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      settings !== null
    ) {
      menu = menu === 'closed' ? 'menu' : 'closed';
    }
  }

  function toggleFullscreen(): void {
    const doc = document;
    if (doc.fullscreenElement) void doc.exitFullscreen?.().catch(() => undefined);
    else void doc.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  async function save(patch: DeviceSettingsPatch): Promise<void> {
    saveError = null;
    try {
      await run.saveSettings(patch);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      saveError = t('display.menu.save_error');
    }
  }

  async function pair(code: string): Promise<void> {
    await run.pair(code);
  }

  // A revoked / unpaired screen closes the menu.
  $effect(() => {
    if (settings === null) {
      menu = 'closed';
      saveError = null;
    }
  });

  // The server asked for a reload: nobody touches the screen.
  $effect(() => {
    if (session?.reloadAsked !== true) return;
    const handle = setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    return () => clearTimeout(handle);
  });

  onMount(() => {
    const unsubscribe = api.sync.onStatus((s) => (net = { ...s }));
    void wakeLock.start();
    cursor.activity();
    const onFs = (): void => {
      fullscreen = document.fullscreenElement !== null;
    };
    const onVis = (): void => run.setHidden(document.hidden);
    const onResize = (): void => {
      win = { width: window.innerWidth, height: window.innerHeight };
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onResize);
    onFs();
    onResize();

    // ?c=123456: the code leaves the URL at once (a reload must not replay it).
    if (query.has('c')) {
      try {
        window.history.replaceState(null, '', href('/display'));
      } catch {
        /* history not available */
      }
    }
    void run.start().then(() => {
      if (run.status === 'unpaired' && isCodeComplete(initialCode)) void pair(initialCode);
    });

    return () => {
      unsubscribe();
      wakeLock.stop();
      cursor.dispose();
      press.cancel();
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      run.stop();
      api.sync.close();
    };
  });
</script>

<svelte:window
  {onkeydown}
  onpointerdown={(e) => press.down(e.pointerId, e.clientX, e.clientY, win)}
  onpointermove={(e) => {
    press.move(e.pointerId, e.clientX, e.clientY);
    cursor.activity();
  }}
  onpointerup={(e) => press.up(e.pointerId)}
  onpointercancel={(e) => press.up(e.pointerId)}
/>

<div
  class="root"
  class:nocursor={cursorHidden}
  data-testid="display-page"
  data-status={run.status}
  data-wake={wake}
>
  <div
    class="stage"
    data-testid="display-stage"
    data-rotation={settings?.rotation ?? 0}
    data-mirror={settings?.mirror ?? false}
    style:width={`${orient.width}px`}
    style:height={`${orient.height}px`}
    style:transform={orient.transform}
  >
    {#if kind === 'loading'}
      <p class="loading" aria-busy="true">{t('common.loading')}</p>
    {:else if kind === 'pair'}
      <PairForm
        busy={run.pairing}
        error={run.pairError}
        {fullscreen}
        onsubmit={(code) => void pair(code)}
        onfullscreen={toggleFullscreen}
      />
    {:else if kind === 'lobby' || kind === 'waiting'}
      <WaitScreen
        {kind}
        sessionName={run.me?.session.name ?? ''}
        displayName={run.me?.name ?? ''}
        {fullscreen}
        wakeUnsupported={wake === 'unsupported'}
        onfullscreen={toggleFullscreen}
      />
    {:else if kind === 'pause'}
      <DisplayPause url={run.pauseScreen?.url ?? null} text={run.pauseScreen?.text ?? ''} />
    {:else if kind === 'game' && settings !== null}
      <DisplayView
        {run}
        {settings}
        size={{ width: orient.width, height: orient.height }}
        screen={screenSize}
        onrange={(range) => (outOfRange = range)}
      />
    {/if}

    {#if readAloud !== null}
      <DisplayReadAloud title={readAloud.title} body={readAloud.body} />
    {/if}

    {#if showNet}
      <div class="net"><NetworkIndicator client={api.sync} /></div>
    {/if}

    {#if menu === 'menu' && settings !== null}
      <DisplayMenu
        name={run.me?.name ?? ''}
        {settings}
        {wake}
        {fullscreen}
        {outOfRange}
        error={saveError}
        onclose={() => (menu = 'closed')}
        oncalibrate={() => (menu = 'calibration')}
        onrotation={(r: Rotation) => void save({ rotation: r })}
        onmirror={(m) => void save({ mirror: m })}
        onfullscreen={toggleFullscreen}
        onunpair={() => {
          menu = 'closed';
          void run.unpair();
        }}
      />
    {:else if menu === 'calibration' && settings !== null}
      <CalibrationWizard
        {settings}
        screen={screenSize}
        width={orient.width}
        error={saveError}
        onsave={(patch) => void save(patch)}
        onclose={() => (menu = 'menu')}
      />
    {/if}
  </div>
</div>

<style>
  .root {
    position: fixed;
    inset: 0;
    z-index: 70;
    overflow: hidden;
    background: #000;
    color: #fff;
    user-select: none;
    -webkit-user-select: none;
  }
  .root.nocursor,
  .root.nocursor :global(*) {
    cursor: none !important;
  }
  .stage {
    position: fixed;
    left: 50%;
    top: 50%;
    overflow: hidden;
    background: #000;
  }
  .loading {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    color: #667;
  }
  .net {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    padding: 0.25rem 0.6rem;
    border-radius: 0.5rem;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
    z-index: 4;
  }
  .net :global(.net) {
    color: #fff;
  }
</style>
