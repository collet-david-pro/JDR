<script lang="ts">
  import { sceneItemLabel } from '../../editor/ui/scene-labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /**
   * Text list of the objects and placed tokens of the floor, selectable with the keyboard
   * (projet.md 22: the canvas content is reachable without a pointer). Shift adds.
   */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const LIMIT = 300;
  const items = $derived(ui.sceneItems.slice(0, LIMIT));

  function choose(item: (typeof items)[number], add: boolean): void {
    const sel = ui.objectSelection;
    const key = item.kind === 'token' ? 'tokens' : 'objects';
    const list = sel[key];
    const next = add
      ? list.includes(item.uid)
        ? list.filter((u) => u !== item.uid)
        : [...list, item.uid]
      : [item.uid];
    session.selectObjects(add ? { ...sel, [key]: next } : { objects: [], tokens: [], [key]: next });
  }
</script>

<details class="list" data-testid="scene-object-list">
  <summary id={`${uid}-title`}>
    {t('editor.properties.list', { count: ui.sceneItems.length })}
  </summary>
  {#if ui.sceneItems.length === 0}
    <p class="small muted">{t('editor.properties.list_empty')}</p>
  {:else}
    <ul aria-labelledby={`${uid}-title`}>
      {#each items as item (item.uid)}
        {@const selected =
          item.kind === 'token'
            ? ui.objectSelection.tokens.includes(item.uid)
            : ui.objectSelection.objects.includes(item.uid)}
        <li>
          <button
            type="button"
            aria-pressed={selected}
            data-testid={`scene-item-${item.kind}`}
            onclick={(e) => choose(item, e.shiftKey)}>{sceneItemLabel(item)}</button
          >
        </li>
      {/each}
    </ul>
    {#if ui.sceneItems.length > LIMIT}
      <p class="small muted">{t('editor.properties.list_more', { count: LIMIT })}</p>
    {/if}
  {/if}
</details>

<style>
  .list summary {
    cursor: pointer;
  }
  ul {
    display: grid;
    gap: 1px;
    max-height: 14rem;
    margin: var(--space-1) 0 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  button {
    width: 100%;
    padding: 2px var(--space-1);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    background: var(--color-surface-sunken);
  }
  button[aria-pressed='true'] {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }
  p {
    margin: 0;
  }
</style>
