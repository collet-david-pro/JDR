<script lang="ts">
  import AssetPicker from '../AssetPicker.svelte';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import type { Asset, AssetKind } from '../../lib/types';
  import { MAX_TEXTURE_REPEAT } from '../../engine/texture-tiles';

  /**
   * Palette: library assets of kind "tile" (one cell each, projet.md 15.2) or "texture"
   * (world-aligned, `repeat` × `repeat` cells, P14) added with palette.add.
   */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  let picking = $state(false);
  let pickKind = $state<AssetKind>('tile');
  let filter = $state<'all' | 'tile' | 'texture'>('all');
  const filters = [
    { id: 'all', label: t('editor.palette.filter_all') },
    { id: 'tile', label: t('editor.palette.filter_tile') },
    { id: 'texture', label: t('editor.palette.filter_texture') },
  ] as const;
  const hasTextures = $derived(ui.palette.some((p) => p.repeat !== null));
  const items = $derived(
    ui.palette.filter((p) => filter === 'all' || (filter === 'texture') === (p.repeat !== null)),
  );
  const selected = $derived(
    ui.tile === null ? null : ui.palette.find((p) => p.index === ui.tile?.index),
  );

  function openPicker(kind: AssetKind): void {
    pickKind = kind;
    picking = true;
  }

  function changeRepeat(event: Event): void {
    const item = selected;
    if (item === null || item === undefined || item.repeat === null) return;
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) session.setTextureRepeat(item.index, value);
  }

  function toggleSoft(event: Event): void {
    const item = selected;
    if (item === null || item === undefined) return;
    session.setSoftEdges(item.index, (event.currentTarget as HTMLInputElement).checked);
  }

  function pick(asset: Asset): void {
    session.addTileAsset(asset);
  }
</script>

<section class="palette" aria-labelledby={`${uid}-title`}>
  <div class="head">
    <h2 id={`${uid}-title`}>{t('editor.palette.title')}</h2>
    <div class="actions">
      <button
        type="button"
        class="button button-small"
        aria-haspopup="dialog"
        data-testid="palette-add"
        onclick={() => openPicker('tile')}
      >
        {t('editor.palette.add')}
      </button>
      <button
        type="button"
        class="button button-small"
        aria-haspopup="dialog"
        data-testid="palette-add-texture"
        onclick={() => openPicker('texture')}
      >
        {t('editor.palette.add_texture')}
      </button>
    </div>
  </div>
  {#if hasTextures}
    <div class="filter" role="group" aria-label={t('editor.palette.filter')}>
      {#each filters as f (f.id)}
        <button
          type="button"
          class="button button-small"
          aria-pressed={filter === f.id}
          data-testid={`palette-filter-${f.id}`}
          onclick={() => (filter = f.id)}
        >
          {f.label}
        </button>
      {/each}
    </div>
  {/if}
  {#if ui.palette.length === 0}
    <p class="small muted">{t('editor.palette.empty')}</p>
  {:else}
    <ul>
      {#each items as item (item.index)}
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
            {#if item.repeat !== null}
              <span class="frames small muted"
                >{t('editor.palette.repeat_badge', { count: item.repeat })}</span
              >
            {:else if item.frames > 1}
              <span class="frames small muted"
                >{t('editor.palette.frames', { count: item.frames })}</span
              >
            {/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if selected !== null && selected !== undefined}
      <label class="soft small">
        <input
          type="checkbox"
          checked={selected.soft}
          data-testid="palette-soft"
          onchange={toggleSoft}
        />
        <span>{t('editor.palette.soft_edges')}</span>
        <span class="muted">{t('editor.palette.soft_edges_hint')}</span>
      </label>
    {/if}
    {#if selected !== null && selected !== undefined && selected.repeat !== null}
      <label class="repeat small">
        <span>{t('editor.palette.repeat')}</span>
        <input
          type="number"
          min="1"
          max={MAX_TEXTURE_REPEAT}
          step="1"
          value={selected.repeat}
          data-testid="palette-repeat"
          onchange={changeRepeat}
        />
        <span class="muted">{t('editor.palette.repeat_hint')}</span>
      </label>
    {/if}
  {/if}
</section>

<AssetPicker
  bind:open={picking}
  kind={pickKind}
  title={pickKind === 'texture'
    ? t('editor.palette.picker_texture_title')
    : t('editor.palette.picker_title')}
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
  .actions,
  .filter {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .filter {
    margin-bottom: var(--space-2);
  }
  .soft {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .repeat {
    display: grid;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }
  .repeat input {
    width: 5rem;
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
