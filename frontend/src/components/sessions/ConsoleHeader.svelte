<script lang="ts">
  import PauseScreenDialog from './PauseScreenDialog.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { copyText } from '../../lib/clipboard';
  import { t } from '../../lib/i18n';
  import { href, sessionsClient } from '../../lib/services';
  import { formatSessionCode, type Transition } from '../../lib/sessions';
  import { sessionProblem, sessionStateLabel } from '../../lib/sessions/labels';
  import type { SessionRun } from '../../lib/sessions/session-run.svelte';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Header of the GM console: name, state, session code (copyable), Start / Pause / Resume / End
   * and the camera sharing.
   */
  interface Props {
    run: SessionRun;
    gameId: string;
    onshare: (follow: boolean) => void;
    /** "Broadcast my camera" (continuous sending) is on. */
    broadcasting: boolean;
    onbroadcast: (on: boolean) => void;
  }

  let { run, gameId, onshare, broadcasting, onbroadcast }: Props = $props();
  const session = $derived(run.state?.session ?? null);
  const code = $derived(session?.code === undefined ? '' : formatSessionCode(session.code));
  let busy = $state<Transition | null>(null);
  let endOpen = $state(false);
  let follow = $state(false);
  let pauseOpen = $state(false);
  let regenOpen = $state(false);
  let regenBusy = $state(false);

  async function go(action: Transition): Promise<void> {
    if (session === null) return;
    busy = action;
    try {
      await sessionsClient().transition(session.id, action);
      endOpen = false;
      await run.reload();
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    } finally {
      busy = null;
    }
  }

  async function regenerate(): Promise<void> {
    if (session === null) return;
    regenBusy = true;
    try {
      await sessionsClient().regenerateCode(session.id);
      regenOpen = false;
      await run.reload();
      toasts.success(t('sessions.console.code_regenerated'));
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    } finally {
      regenBusy = false;
    }
  }

  async function copy(): Promise<void> {
    if (await copyText(code)) toasts.success(t('common.copied'));
    else toasts.info(t('common.copy_failed'));
  }
</script>

{#if session !== null}
  <header class="head" data-testid="console-header">
    <div class="title">
      <a class="small" href={href(`/games/${encodeURIComponent(gameId)}?tab=sessions`)}
        >{t('sessions.console.back')}</a
      >
      <h1>{session.name}</h1>
      <span class="badge" data-testid="session-state" data-state={session.state}
        >{sessionStateLabel(session.state)}</span
      >
    </div>
    {#if code !== '' && session.state !== 'ended'}
      <div class="code" data-testid="session-code-box">
        <span class="small muted">{t('sessions.console.code')}</span>
        <strong class="mono" data-testid="session-code">{code}</strong>
        <button
          type="button"
          class="button button-small"
          data-testid="session-code-copy"
          onclick={copy}>{t('common.copy')}</button
        >
        <button
          type="button"
          class="button button-small"
          data-testid="console-regenerate-code"
          onclick={() => (regenOpen = true)}>{t('sessions.console.regenerate_code')}</button
        >
      </div>
    {/if}
    <div class="actions" role="group" aria-label={t('sessions.console.controls')}>
      {#if session.state === 'lobby'}
        <button
          type="button"
          class="button button-primary"
          data-testid="session-start"
          disabled={busy !== null}
          onclick={() => go('start')}>{t('sessions.console.start')}</button
        >
      {/if}
      {#if session.state === 'running'}
        <button
          type="button"
          class="button"
          data-testid="session-pause"
          disabled={busy !== null}
          onclick={() => go('pause')}>{t('sessions.console.pause')}</button
        >
      {/if}
      {#if session.state === 'paused'}
        <button
          type="button"
          class="button button-primary"
          data-testid="session-resume"
          disabled={busy !== null}
          onclick={() => go('resume')}>{t('sessions.console.resume')}</button
        >
      {/if}
      {#if session.state !== 'ended'}
        <button
          type="button"
          class="button button-danger"
          data-testid="session-end"
          disabled={busy !== null}
          onclick={() => (endOpen = true)}>{t('sessions.console.end')}</button
        >
        <label class="check small">
          <input type="checkbox" bind:checked={follow} />
          {t('sessions.console.follow')}
        </label>
        <button
          type="button"
          class="button"
          data-testid="share-view"
          onclick={() => onshare(follow)}>{t('sessions.console.share_view')}</button
        >
        <label class="check small">
          <input
            type="checkbox"
            checked={broadcasting}
            data-testid="console-broadcast-camera"
            data-on={broadcasting ? 'true' : 'false'}
            onchange={(e) => onbroadcast(e.currentTarget.checked)}
          />
          {t('sessions.console.broadcast_camera')}
        </label>
        <button
          type="button"
          class="button"
          data-testid="console-pause-screen"
          onclick={() => (pauseOpen = true)}>{t('sessions.console.pause_screen')}</button
        >
      {/if}
    </div>
  </header>

  <ConfirmDialog
    bind:open={endOpen}
    title={t('sessions.console.end_title')}
    message={t('sessions.console.end_text')}
    confirmLabel={t('sessions.console.end')}
    danger
    busy={busy === 'end'}
    onconfirm={() => go('end')}
  />
  <ConfirmDialog
    bind:open={regenOpen}
    title={t('sessions.console.regenerate_title')}
    message={t('sessions.console.regenerate_text')}
    confirmLabel={t('sessions.console.regenerate_code')}
    confirmTestId="console-regenerate-confirm"
    busy={regenBusy}
    onconfirm={regenerate}
  />
  <PauseScreenDialog bind:open={pauseOpen} {run} />
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-4);
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: var(--font-size-lg);
    overflow-wrap: anywhere;
  }
  .code {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-sunken);
  }
  .code strong {
    font-size: var(--font-size-lg);
    letter-spacing: 0.12em;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    margin-left: auto;
  }
  .check {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
</style>
