<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n';
  import { playerTokensClient, type PlayerToken } from '../../lib/player-tokens/client';
  import { href } from '../../lib/services';

  /**
   * Choice of a token from the personal collection (join page, game page): one pressed button
   * per token, plus "no token" (the GM's image is used). Loads the collection itself.
   */
  interface Props {
    /** Selected token id, null = none. */
    value: string | null;
    disabled?: boolean;
    /** Called once the collection is loaded. */
    onloaded?: (tokens: readonly PlayerToken[]) => void;
  }

  let { value = $bindable(), disabled = false, onloaded }: Props = $props();

  let tokens = $state.raw<readonly PlayerToken[] | null>(null);
  let failed = $state(false);

  onMount(() => {
    playerTokensClient()
      .list()
      .then((list) => {
        tokens = list.items;
        onloaded?.(list.items);
      })
      .catch(() => {
        failed = true;
        tokens = [];
      });
  });
</script>

<div class="picker" data-testid="player-token-picker">
  {#if tokens === null}
    <p class="muted" aria-busy="true">{t('common.loading')}</p>
  {:else}
    <div class="grid" role="group" aria-label={t('player_tokens.picker.label')}>
      <button
        type="button"
        class="pick"
        aria-pressed={value === null}
        {disabled}
        onclick={() => (value = null)}
        data-testid="player-token-none"
      >
        <span class="none" aria-hidden="true">∅</span>
        <span class="name">{t('player_tokens.picker.none')}</span>
      </button>
      {#each tokens as token (token.id)}
        <button
          type="button"
          class="pick"
          aria-pressed={value === token.id}
          {disabled}
          onclick={() => (value = token.id)}
          data-testid="player-token-option"
        >
          {#if token.image}<img src={token.image.thumb} alt="" />{/if}
          <span class="name">{token.name}</span>
        </button>
      {/each}
    </div>
    {#if tokens.length === 0 && !failed}
      <p class="muted small">{t('player_tokens.picker.empty')}</p>
    {/if}
    <p class="small">
      <a href={href('/profile')}>{t('player_tokens.picker.manage')}</a>
    </p>
  {/if}
</div>

<style>
  .picker p {
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: var(--space-2);
  }
  .pick {
    display: grid;
    justify-items: center;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
  }
  .pick[aria-pressed='true'] {
    outline: 2px solid var(--color-accent, currentColor);
    background: var(--color-surface-sunken);
  }
  img,
  .none {
    width: 3.5rem;
    height: 3.5rem;
    object-fit: contain;
  }
  .none {
    display: grid;
    place-items: center;
    font-size: var(--font-size-xl, 1.5rem);
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-sm);
  }
</style>
