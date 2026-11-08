<script lang="ts">
  import { onMount } from 'svelte';
  import type { Component } from 'svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import HelpLink from '../../components/HelpLink.svelte';
  import Modal from '../../components/Modal.svelte';
  import TextField from '../../components/TextField.svelte';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { t } from '../../lib/i18n';
  import { playerTokensClient, type PlayerToken } from '../../lib/player-tokens/client';
  import { toasts } from '../../stores/toasts.svelte';

  /** Personal token collection (profile): create, edit again, rename, duplicate, delete. */
  interface GeneratorProps {
    open: boolean;
    token: PlayerToken | null;
    onsaved: (token: PlayerToken) => void;
  }

  const client = playerTokensClient();
  let tokens = $state.raw<readonly PlayerToken[] | null>(null);
  let max = $state(100);
  let failure = $state.raw<ErrorSummary | null>(null);
  // The generator is a separate chunk, fetched on first use.
  let Generator = $state.raw<Component<GeneratorProps> | null>(null);
  let generatorOpen = $state(false);
  let editing = $state.raw<PlayerToken | null>(null);
  let renaming = $state.raw<PlayerToken | null>(null);
  let renameOpen = $state(false);
  let renameValue = $state('');
  let deleting = $state.raw<PlayerToken | null>(null);
  let deleteOpen = $state(false);
  let busy = $state(false);

  const full = $derived(tokens !== null && tokens.length >= max);

  async function load(): Promise<void> {
    failure = null;
    try {
      const list = await client.list();
      tokens = list.items;
      max = list.max;
    } catch (error) {
      failure = describeError(error, t);
      tokens = [];
    }
  }

  onMount(() => {
    void load();
  });

  async function openGenerator(token: PlayerToken | null): Promise<void> {
    try {
      Generator ??= (await import('../../components/player-tokens/TokenGenerator.svelte'))
        .default as Component<GeneratorProps>;
    } catch (error) {
      failure = describeError(error, t);
      return;
    }
    editing = token;
    generatorOpen = true;
  }

  function saved(token: PlayerToken): void {
    const list = tokens ?? [];
    tokens = list.some((x) => x.id === token.id)
      ? list.map((x) => (x.id === token.id ? token : x))
      : [token, ...list];
    toasts.success(t('player_tokens.saved'));
  }

  function startRename(token: PlayerToken): void {
    renaming = token;
    renameValue = token.name;
    renameOpen = true;
  }

  async function rename(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (renaming === null || renameValue.trim() === '') return;
    busy = true;
    try {
      saved(await client.rename(renaming.id, renameValue.trim()));
      renameOpen = false;
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }

  async function duplicate(token: PlayerToken): Promise<void> {
    busy = true;
    try {
      saved(await client.duplicate(token.id, t('player_tokens.copy_name', { name: token.name })));
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }

  function startDelete(token: PlayerToken): void {
    deleting = token;
    deleteOpen = true;
  }

  async function remove(): Promise<void> {
    if (deleting === null) return;
    const target = deleting;
    busy = true;
    try {
      await client.remove(target.id, target.games_count > 0);
      tokens = (tokens ?? []).filter((x) => x.id !== target.id);
      deleteOpen = false;
      toasts.success(t('player_tokens.deleted'));
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card stack" aria-labelledby="profile-tokens" data-testid="profile-tokens">
  <div class="title-row">
    <h2 id="profile-tokens">{t('player_tokens.title')}</h2>
    <HelpLink anchor="joueur-mon-token" />
  </div>
  <p class="muted small">{t('player_tokens.hint', { max })}</p>
  <ErrorAlert {failure} />
  {#if tokens === null}
    <p class="muted" aria-busy="true">{t('common.loading')}</p>
  {:else}
    <div class="row">
      <button
        type="button"
        class="button button-primary"
        disabled={full}
        onclick={() => openGenerator(null)}
        data-testid="token-new">{t('player_tokens.new')}</button
      >
      <span class="muted small">{t('player_tokens.count', { count: tokens.length, max })}</span>
    </div>
    {#if full}<p class="alert alert-info">{t('errors.player_token_limit')}</p>{/if}
    {#if tokens.length === 0}
      <p class="muted">{t('player_tokens.empty')}</p>
    {:else}
      <ul class="list">
        {#each tokens as token (token.id)}
          <li class="item" data-testid="player-token-item">
            {#if token.image}<img src={token.image.thumb} alt="" />{/if}
            <div class="info">
              <strong>{token.name}</strong>
              {#if token.games_count > 0}
                <span class="muted small"
                  >{t('player_tokens.used', { count: token.games_count })}</span
                >
              {/if}
            </div>
            <div class="row actions">
              <button
                type="button"
                class="button button-small"
                onclick={() => openGenerator(token)}
              >
                {t('player_tokens.edit')}
              </button>
              <button type="button" class="button button-small" onclick={() => startRename(token)}>
                {t('player_tokens.rename')}
              </button>
              <button
                type="button"
                class="button button-small"
                disabled={full || busy}
                onclick={() => duplicate(token)}>{t('player_tokens.duplicate')}</button
              >
              <button
                type="button"
                class="button button-small button-danger"
                onclick={() => startDelete(token)}>{t('common.delete')}</button
              >
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

{#if Generator !== null}
  <Generator bind:open={generatorOpen} token={editing} onsaved={saved} />
{/if}

<Modal bind:open={renameOpen} title={t('player_tokens.rename')}>
  <form class="stack" onsubmit={rename}>
    <TextField
      label={t('player_tokens.gen.name')}
      bind:value={renameValue}
      maxlength={80}
      required
    />
    <div class="row">
      <button type="button" class="button" onclick={() => (renameOpen = false)}
        >{t('common.cancel')}</button
      >
      <button
        type="submit"
        class="button button-primary"
        disabled={busy || renameValue.trim() === ''}>{t('common.save')}</button
      >
    </div>
  </form>
</Modal>

<ConfirmDialog
  bind:open={deleteOpen}
  title={t('player_tokens.delete_title')}
  message={deleting !== null && deleting.games_count > 0
    ? t('player_tokens.delete_used', { name: deleting.name, count: deleting.games_count })
    : t('player_tokens.delete_text', { name: deleting?.name ?? '' })}
  confirmLabel={t('common.delete')}
  danger
  {busy}
  onconfirm={remove}
/>

<style>
  .list {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .item img {
    width: 3.5rem;
    height: 3.5rem;
    object-fit: contain;
  }
  .info {
    display: grid;
    flex: 1 1 8rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .actions {
    flex-wrap: wrap;
  }
</style>
