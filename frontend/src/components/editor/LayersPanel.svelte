<script lang="ts">
  import { layerLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /**
   * Layers (projet.md 15.2): shown top → bottom; the number is the `1`-`9` shortcut (bottom
   * layer = 1). Eye, lock, opacity and order are map changes (undoable); solo is a display
   * preference of this session.
   */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const rows = $derived(ui.layers.map((layer, index) => ({ layer, number: index + 1 })).reverse());
</script>

<section class="layers" aria-labelledby={`${uid}-title`}>
  <h2 id={`${uid}-title`}>{t('editor.layers.title')}</h2>
  <ul>
    {#each rows as { layer, number }, row (layer.id)}
      {@const name = layerLabel(layer.id)}
      {@const tiles = layer.kind === 'tiles'}
      <li
        class:active={tiles && ui.layer === layer.id}
        class:hidden={!layer.visible}
        data-testid={`layer-${layer.id}`}
      >
        <button
          type="button"
          class="name"
          aria-pressed={tiles && ui.layer === layer.id}
          aria-label={t('editor.layers.activate', { name })}
          title={tiles ? undefined : t('editor.layers.objects_hint')}
          disabled={!tiles}
          data-testid={`layer-activate-${layer.id}`}
          onclick={() => session.setActiveLayer(layer.id)}
        >
          {#if number <= 9}<kbd aria-hidden="true">{number}</kbd>{/if}
          <span>{name}</span>
        </button>
        <div class="controls">
          <button
            type="button"
            class="icon"
            aria-pressed={layer.visible}
            aria-label={t('editor.layers.visible', { name })}
            title={t('editor.layers.visible', { name })}
            data-testid={`layer-visible-${layer.id}`}
            onclick={() => session.toggleLayerVisible(layer.id)}
            ><span aria-hidden="true">{layer.visible ? '👁' : '–'}</span></button
          >
          <button
            type="button"
            class="icon"
            aria-pressed={layer.locked}
            aria-label={t('editor.layers.locked', { name })}
            title={t('editor.layers.locked', { name })}
            data-testid={`layer-locked-${layer.id}`}
            onclick={() => session.toggleLayerLocked(layer.id)}
            ><span aria-hidden="true">{layer.locked ? '🔒' : '🔓'}</span></button
          >
          <button
            type="button"
            class="icon"
            aria-pressed={ui.solo === layer.id}
            aria-label={t('editor.layers.solo', { name })}
            title={t('editor.layers.solo', { name })}
            data-testid={`layer-solo-${layer.id}`}
            onclick={() => session.toggleSolo(layer.id)}><span aria-hidden="true">S</span></button
          >
          <button
            type="button"
            class="icon"
            aria-label={t('editor.layers.up', { name })}
            title={t('editor.layers.up', { name })}
            disabled={row === 0}
            onclick={() => session.moveLayer(layer.id, 1)}><span aria-hidden="true">▲</span></button
          >
          <button
            type="button"
            class="icon"
            aria-label={t('editor.layers.down', { name })}
            title={t('editor.layers.down', { name })}
            disabled={row === rows.length - 1}
            onclick={() => session.moveLayer(layer.id, -1)}
            ><span aria-hidden="true">▼</span></button
          >
        </div>
        <label class="opacity">
          <span class="visually-hidden">{t('editor.layers.opacity', { name })}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(layer.opacity * 100)}
            aria-valuetext={`${Math.round(layer.opacity * 100)} %`}
            oninput={(event) =>
              session.patchLayer(layer.id, { opacity: Number(event.currentTarget.value) / 100 })}
          />
          <span class="small muted" aria-hidden="true">{Math.round(layer.opacity * 100)} %</span>
        </label>
      </li>
    {/each}
  </ul>
</section>

<style>
  .layers {
    padding: var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px var(--space-1);
    padding: var(--space-1);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
  }
  li.active {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }
  li.hidden .name span {
    color: var(--color-text-muted);
    text-decoration: line-through;
  }
  .name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
    padding: 2px var(--space-1);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .name:disabled {
    cursor: default;
    color: var(--color-text-muted);
  }
  .controls {
    display: flex;
    gap: 2px;
  }
  .icon {
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--font-size-xs);
    cursor: pointer;
  }
  .icon[aria-pressed='true'] {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .icon:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .opacity {
    grid-column: 1 / -1;
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .opacity input {
    flex: 1;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }
</style>
