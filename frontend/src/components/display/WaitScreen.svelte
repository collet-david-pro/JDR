<script lang="ts">
  import { t } from '../../lib/i18n';

  /** Lobby ("the session is about to start") and waiting ("next session") screens. */
  interface Props {
    kind: 'lobby' | 'waiting';
    sessionName: string;
    displayName: string;
    fullscreen: boolean;
    wakeUnsupported: boolean;
    onfullscreen: () => void;
  }
  let { kind, sessionName, displayName, fullscreen, wakeUnsupported, onfullscreen }: Props =
    $props();
</script>

<main class="wait" data-testid={kind === 'lobby' ? 'display-lobby' : 'display-waiting'}>
  <h1>{kind === 'lobby' ? t('display.lobby.title') : t('display.waiting.title')}</h1>
  {#if kind === 'lobby' && sessionName !== ''}
    <p class="session">{sessionName}</p>
  {/if}
  <p class="name">{displayName}</p>
  {#if !fullscreen}
    <button type="button" onclick={onfullscreen} data-testid="display-fullscreen">
      {t('display.fullscreen')}
    </button>
  {/if}
  {#if wakeUnsupported}
    <p class="banner" role="status" data-testid="display-wake-banner">
      {t('display.wake.banner')}
    </p>
  {/if}
</main>

<style>
  .wait {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    text-align: center;
    padding: 1.5rem;
  }
  h1 {
    margin: 0;
    font-size: clamp(2rem, 6vmin, 4rem);
  }
  .session {
    margin: 0;
    font-size: clamp(1.25rem, 4vmin, 2.5rem);
  }
  .name {
    margin: 0;
    color: #aab;
  }
  button {
    font-size: 1.1rem;
    min-height: 3rem;
    padding: 0 1.5rem;
    border-radius: 0.5rem;
    border: 1px solid #667;
    background: transparent;
    color: #fff;
    cursor: pointer;
  }
  .banner {
    position: absolute;
    bottom: 1rem;
    margin: 0;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    background: #3a2f0b;
    color: #ffd966;
  }
</style>
