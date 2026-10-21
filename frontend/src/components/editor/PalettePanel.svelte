<script lang="ts">
  import AssetPicker from '../AssetPicker.svelte';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import type { Asset } from '../../lib/types';

  /** Tile palette: library assets of kind "tile" added with palette.add (projet.md 15.2). */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  let picking = $state(false);

  function pick(asset: Asset): void {
    session.addTileAsset(asset);
  }
</script>

<section class="palette" aria-labelledby={`${uid}-title`}>
  <div class="head">
    <h2 id={`${uid}-title`}>{t('editor.palette.title')}</h2>
    <button
      type="button"
      class="button button-small"
      aria-haspopup="dialog"
      data-testid="palette-add"
      onclick={() => (picking = true)}
    >
      {t('editor.palette.add')}
    </button>
  </div>
  {#if ui.palette.length === 0}
    <p class="small muted">{t('editor.palette.empty')}</p>
  {:else}
    <ul>
      {#each ui.palette as item (item.index)}
        <li>
          <button
            type="button"
            class="item"
            aria-pressed={ui.tile?.index === item.index}
            aria-label={t('editor.palette.use', { name: item.name })}
            title={item.name}
            data-testid={`palette-item-${item.index}`}
            onclick={() => session.selectTile(item.index)}
          >
            {#if item.thumb}
              <img src={item.thumb} alt="" loading="lazy" decoding="async" />
            {:else}
              <span class="placeholder" aria-hidden="true">{item.index}</span>
            {/if}
            <span class="label">{item.name}</span>
            {#if item.frames > 1}
              <span class="frames small muted"
                >{t('editor.palette.frames', { count: item.frames })}</span
              >
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<AssetPicker
  bind:open={picking}
  kind="tile"
  title={t('editor.palette.picker_title')}
  onpick={pick}
/>

<style>
  .palette {
    padding: var(--space-3);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  p {
    margin: 0;
  }
  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: grid;
    justify-items: center;
    gap: 2px;
    width: 100%;
    padding: var(--space-1);
    border: 2px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--color-surface-sunken);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .item[aria-pressed='true'] {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }
  img,
  .placeholder {
    width: 3rem;
    height: 3rem;
    object-fit: cover;
    image-rendering: pixelated;
    border-radius: 2px;
  }
  .placeholder {
    display: grid;
    place-items: center;
    background: var(--color-border);
  }
  .label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-xs);
  }
</style>
