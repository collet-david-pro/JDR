<script lang="ts">
  import ToolOptions from './ToolOptions.svelte';
  import type { ToolId } from '../../editor/tools/types';
  import { toolLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Tool bar (WAI-ARIA toolbar: arrow keys move between tools, one tab stop). */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const tools = $derived(Object.values(session.controller.tools));

  let list: HTMLDivElement | undefined = $state();
  let focusIndex = $state(-1);
  const current = $derived(
    focusIndex >= 0
      ? focusIndex
      : Math.max(
          0,
          tools.findIndex((tool) => tool.id === ui.tool),
        ),
  );

  function keydown(event: KeyboardEvent): void {
    const count = tools.length;
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % count;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
      next = (current - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    focusIndex = next;
    list?.querySelectorAll<HTMLButtonElement>('button.tool')[next]?.focus();
  }

  function choose(id: ToolId, index: number): void {
    focusIndex = index;
    session.setTool(id);
  }
</script>

<nav class="toolbar" aria-label={t('editor.tools.label')}>
  <div
    class="tools"
    role="toolbar"
    aria-orientation="vertical"
    aria-label={t('editor.tools.label')}
    bind:this={list}
    tabindex="-1"
    onkeydown={keydown}
  >
    {#each tools as tool, index (tool.id)}
      <button
        type="button"
        class="tool"
        aria-pressed={ui.tool === tool.id}
        tabindex={index === current ? 0 : -1}
        title={t('editor.tools.shortcut', { key: tool.shortcut })}
        data-testid={`tool-${tool.id}`}
        onclick={() => choose(tool.id, index)}
        onfocus={() => (focusIndex = index)}
      >
        <span class="label">{toolLabel(tool.id)}</span>
        <kbd aria-hidden="true">{tool.shortcut}</kbd>
      </button>
    {/each}
  </div>
  <ToolOptions {session} />
</nav>

<style>
  .toolbar {
    grid-area: tools;
    overflow-wrap: anywhere;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 11rem;
    padding: var(--space-2);
    overflow-y: auto;
    border-right: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  .tools {
    display: grid;
    gap: 2px;
  }
  .tools:focus {
    outline: none;
  }
  .tool {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
    text-align: left;
    cursor: pointer;
  }
  .tool:hover {
    background: var(--color-surface-sunken);
  }
  .tool[aria-pressed='true'] {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
    color: var(--color-primary);
    font-weight: var(--font-weight-medium);
  }
  kbd {
    min-width: 1.4em;
    padding: 0 var(--space-1);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    text-align: center;
    color: var(--color-text-muted);
  }
  @media (max-width: 48rem) {
    .toolbar {
      width: 8.5rem;
    }
  }
</style>
