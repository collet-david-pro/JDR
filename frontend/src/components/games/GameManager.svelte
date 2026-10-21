<script lang="ts">
  import { tick } from 'svelte';
  import Button from '../Button.svelte';
  import EmptyTab from './EmptyTab.svelte';
  import PlayersTab from './PlayersTab.svelte';
  import SettingsTab from './SettingsTab.svelte';
  import TokensTab from './TokensTab.svelte';
  import type { GamePageModel } from '../../lib/games/game-page.svelte';
  import { roleLabel, tabLabel } from '../../lib/games/labels';
  import {
    canManageGame,
    initialTab,
    nextTabIndex,
    tabsForRole,
    type GameTab,
  } from '../../lib/games/roles';
  import { describeError } from '../../lib/errors';
  import { formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { toasts } from '../../stores/toasts.svelte';

  /** GM / co-GM view of a game, with tabs (WAI-ARIA tabs pattern). */
  interface Props {
    model: GamePageModel;
    requestedTab: string | null;
  }

  let { model, requestedTab }: Props = $props();

  const uid = $props.id();
  const game = $derived(model.game);
  const role = $derived(game?.my_role ?? 'player');
  const tabs = $derived(tabsForRole(role) ?? []);
  // svelte-ignore state_referenced_locally
  let current = $state<GameTab>(initialTab(model.role, requestedTab) ?? 'maps');
  let restoring = $state(false);
  const listFailure = $derived(model.listError === null ? null : describeError(model.listError, t));

  const tabId = (tab: GameTab): string => `${uid}-tab-${tab}`;
  const panelId = (tab: GameTab): string => `${uid}-panel-${tab}`;

  async function keydown(event: KeyboardEvent, index: number): Promise<void> {
    const next = nextTabIndex(index, event.key, tabs.length);
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (tab === undefined) return;
    current = tab;
    await tick();
    document.getElementById(tabId(tab))?.focus();
  }

  async function restore(): Promise<void> {
    restoring = true;
    try {
      await model.restore();
      toasts.success(t('games.settings.restored'));
    } catch (error) {
      toasts.error(error);
    } finally {
      restoring = false;
    }
  }
</script>

{#if game}
  <div class="game">
    <header class="head">
      <div class="title">
        <h1>{game.name}</h1>
        <p class="muted small">
          {t('games.card.gm', { name: game.gm.username })}
          {#if role !== 'gm'}<span class="badge">{roleLabel(role)}</span>{/if}
        </p>
      </div>
      {#if game.cover_url}
        <img class="cover" src={game.cover_url} alt="" />
      {/if}
    </header>

    {#if game.archived_at}
      <div class="alert alert-warning row" role="status">
        <span>{t('games.archived_banner', { date: formatDateTime(game.archived_at) })}</span>
        {#if canManageGame(role)}
          <Button size="small" loading={restoring} onclick={restore}
            >{t('games.settings.unarchive')}</Button
          >
        {/if}
      </div>
    {/if}

    {#if listFailure}
      <div class="alert alert-error row" role="alert">
        <span>{listFailure.message}</span>
        <button type="button" class="button button-small" onclick={() => model.loadLists()}>
          {t('common.retry')}
        </button>
      </div>
    {/if}

    <div class="tabs" role="tablist" aria-label={t('games.tabs.label')}>
      {#each tabs as tab, index (tab)}
        <button
          type="button"
          role="tab"
          id={tabId(tab)}
          aria-selected={current === tab}
          aria-controls={panelId(tab)}
          tabindex={current === tab ? 0 : -1}
          onclick={() => (current = tab)}
          onkeydown={(event) => keydown(event, index)}
        >
          {tabLabel(tab)}
        </button>
      {/each}
    </div>

    <div
      class="panel"
      role="tabpanel"
      id={panelId(current)}
      aria-labelledby={tabId(current)}
      tabindex="0"
    >
      {#if current === 'maps'}
        <EmptyTab title={t('games.tabs.maps')} text={t('games.maps.empty')} />
      {:else if current === 'tokens'}
        <TokensTab {model} />
      {:else if current === 'players'}
        <PlayersTab {model} />
      {:else if current === 'sessions'}
        <EmptyTab title={t('games.tabs.sessions')} text={t('games.sessions.empty')} />
      {:else}
        <SettingsTab {model} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .game {
    display: grid;
    gap: var(--space-4);
  }
  .head {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: space-between;
  }
  .title {
    min-width: 0;
  }
  h1 {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .title p {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin: var(--space-1) 0 0;
  }
  .cover {
    width: 4rem;
    height: 4rem;
    object-fit: cover;
    border-radius: var(--radius-md);
    flex: none;
  }
  .alert.row {
    justify-content: space-between;
  }
  .tabs {
    display: flex;
    gap: var(--space-1);
    overflow-x: auto;
    border-bottom: var(--border-width) solid var(--color-border);
  }
  [role='tab'] {
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--color-text-muted);
    white-space: nowrap;
    cursor: pointer;
    font: inherit;
  }
  [role='tab']:hover {
    color: var(--color-text);
  }
  [role='tab'][aria-selected='true'] {
    border-bottom-color: var(--color-primary);
    color: var(--color-primary);
    font-weight: var(--font-weight-medium);
  }
  .panel:focus-visible {
    outline-offset: 4px;
  }
</style>
