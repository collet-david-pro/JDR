<script lang="ts">
  import { countColumns, gridNavigate } from '../../lib/assets/grid-nav';
  import { kindLabel } from '../../lib/assets/labels';
  import { t } from '../../lib/i18n';
  import type { Asset } from '../../lib/types';

  interface Props {
    items: readonly Asset[];
    /** Accessible name of the grid. */
    label: string;
    selectedId?: string | null;
    onactivate: (asset: Asset, element: HTMLElement) => void;
  }

  let { items, label, selectedId = null, onactivate }: Props = $props();

  let list: HTMLUListElement | undefined = $state();
  /** Roving tabindex: only one tile is in the tab order. */
  let focusIndex = $state(0);
  const current = $derived(Math.min(focusIndex, Math.max(0, items.length - 1)));

  function buttons(): HTMLButtonElement[] {
    return list === undefined ? [] : [...list.querySelectorAll<HTMLButtonElement>('button.tile')];
  }

  function keydown(event: KeyboardEvent): void {
    const all = buttons();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const columns = countColumns(all.map((button) => button.offsetTop));
    const next = gridNavigate(index, event.key, all.length, columns);
    if (next === null) return;
    event.preventDefault();
    focusIndex = next;
    all[next]?.focus();
  }

  /** Focuses the tile of an asset (after closing the detail panel). */
  export function focusAsset(id: string): void {
    const index = items.findIndex((asset) => asset.id === id);
    if (index < 0) return;
    focusIndex = index;
    buttons()[index]?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul class="grid" aria-label={label} bind:this={list} onkeydown={keydown}>
  {#each items as asset, index (asset.id)}
    <li>
      <button
        type="button"
        class="tile"
        tabindex={index === current ? 0 : -1}
        aria-current={asset.id === selectedId ? 'true' : undefined}
        onfocus={() => (focusIndex = index)}
        onclick={(event) => onactivate(asset, event.currentTarget)}
      >
        <span class="thumb">
          <img
            src={asset.urls.thumb}
            alt=""
            loading="lazy"
            decoding="async"
            width={asset.width}
            height={asset.height}
          />
          {#if asset.is_animated}
            <span class="badge badge-anim">{t('library.animated')}</span>
          {/if}
          {#if asset.favorite}
            <span class="fav" title={t('library.favorite')}
              ><span aria-hidden="true">★</span><span class="visually-hidden"
                >{t('library.favorite')}</span
              ></span
            >
          {/if}
        </span>
        <span class="name">{asset.name}</span>
        <span class="kind small muted">{kindLabel(asset.kind)}</span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tile {
    display: grid;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
  }
  .tile:hover {
    border-color: var(--color-border-strong);
  }
  .tile[aria-current='true'] {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary);
  }
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: var(--radius-sm);
    /* Checkerboard: makes transparency visible. */
    background: repeating-conic-gradient(
        var(--color-surface-sunken) 0% 25%,
        var(--color-surface) 0% 50%
      )
      50% / 1rem 1rem;
  }
  .thumb img {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
  }
  .badge-anim {
    position: absolute;
    left: var(--space-1);
    bottom: var(--space-1);
    background: var(--color-surface-raised);
  }
  .fav {
    position: absolute;
    right: var(--space-1);
    top: var(--space-1);
    color: var(--color-warning);
    text-shadow: 0 0 2px var(--color-surface);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }
  .kind {
    font-size: var(--font-size-xs);
  }
</style>
