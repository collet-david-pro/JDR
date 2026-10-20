<script lang="ts">
  import { onMount } from 'svelte';
  import Gauge from '../components/Gauge.svelte';
  import { errorMessage } from '../lib/errors';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { href, services } from '../lib/services';
  import type { StorageUsage } from '../lib/types';

  let _props: PageProps = $props();

  const { api, auth } = services();
  let storage = $state.raw<StorageUsage | null>(null);
  let storageError = $state<string | null>(null);
  /** Session codes: 8 characters, displayed XXXX-XXXX (projet.md 6.4). */
  const codePattern = '[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}';

  onMount(() => {
    api
      .get<StorageUsage>('/me/storage')
      .then(({ data }) => {
        storage = data;
      })
      .catch((error: unknown) => {
        storageError = errorMessage(error, t);
      });
  });
</script>

<!-- Dashboard (projet.md 18.1 p.2). Games arrive in P3, joining a session in P6. -->
<div class="dashboard">
  <header>
    <h1>{t('dashboard.title', { name: auth.user?.username ?? '' })}</h1>
  </header>

  <div class="grid">
    <section class="card" aria-labelledby="gm-games">
      <h2 id="gm-games">{t('dashboard.gm_games')}</h2>
      <p class="muted">{t('dashboard.gm_games_empty')}</p>
    </section>

    <section class="card" aria-labelledby="player-games">
      <h2 id="player-games">{t('dashboard.player_games')}</h2>
      <p class="muted">{t('dashboard.player_games_empty')}</p>
    </section>

    <section class="card" aria-labelledby="join-session">
      <h2 id="join-session">{t('dashboard.join.title')}</h2>
      <form class="join" onsubmit={(event) => event.preventDefault()}>
        <label for="join-code" class="visually-hidden">{t('dashboard.join.label')}</label>
        <input
          id="join-code"
          name="code"
          placeholder="XXXX-XXXX"
          maxlength="9"
          pattern={codePattern}
          autocomplete="off"
          disabled
          aria-describedby="join-hint"
        />
        <button type="submit" class="button" disabled>{t('dashboard.join.submit')}</button>
      </form>
      <p id="join-hint" class="small muted">{t('dashboard.join.unavailable')}</p>
    </section>

    <section class="card" aria-labelledby="storage-title">
      <h2 id="storage-title">{t('dashboard.storage')}</h2>
      {#if storage}
        <Gauge label={t('storage.label')} used={storage.used_bytes} quota={storage.quota_bytes} />
      {:else if storageError}
        <p class="small muted">{storageError}</p>
      {:else}
        <p class="small muted" aria-busy="true">{t('common.loading')}</p>
      {/if}
      <p><a href={href('/library')}>{t('dashboard.library_link')}</a></p>
    </section>
  </div>
</div>

<style>
  .dashboard {
    display: grid;
    gap: var(--space-5);
  }
  h1 {
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    gap: var(--space-4);
  }
  .join {
    display: flex;
    gap: var(--space-2);
  }
  .join input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-sunken);
    font-family: var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  #join-hint {
    margin-bottom: 0;
  }
</style>
