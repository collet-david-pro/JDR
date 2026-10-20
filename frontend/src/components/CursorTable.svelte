<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { describeError } from '../lib/errors';
  import { t } from '../lib/i18n';
  import type { CursorList } from '../lib/cursor-list.svelte';
  import Button from './Button.svelte';

  interface Props {
    list: CursorList<T>;
    caption: string;
    columns: number;
    empty: string;
    key: (item: T) => string;
    head: Snippet;
    row: Snippet<[T]>;
  }

  let { list, caption, columns, empty, key, head, row }: Props = $props();
  const failure = $derived(list.error === null ? null : describeError(list.error, t));
</script>

<div class="table-wrap" aria-busy={list.loading ? 'true' : undefined}>
  <table class="table">
    <caption class="visually-hidden">{caption}</caption>
    <thead><tr>{@render head()}</tr></thead>
    <tbody>
      {#each list.items as item (key(item))}
        <tr>{@render row(item)}</tr>
      {:else}
        <tr>
          <td colspan={columns} class="muted">
            {list.loaded ? empty : t('common.loading')}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if failure}
  <p class="alert alert-error" role="alert">
    {failure.message}
    {#if failure.requestId}
      <span class="small muted">{t('pages.error.request_id', { id: failure.requestId })}</span>
    {/if}
    <button type="button" class="button button-small" onclick={() => list.reload()}>
      {t('common.retry')}
    </button>
  </p>
{/if}

{#if list.hasMore}
  <p class="more">
    <Button loading={list.loading} onclick={() => list.more()}>{t('common.load_more')}</Button>
  </p>
{/if}

<style>
  .more {
    margin: var(--space-3) 0 0;
    text-align: center;
  }
</style>
