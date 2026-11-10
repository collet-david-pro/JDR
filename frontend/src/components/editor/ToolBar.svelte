<script lang="ts">
  import ToolOptions from './ToolOptions.svelte';
  import type { ToolId } from '../../editor/tools/types';
  import { toolGroupLabel, toolLabel } from '../../editor/ui/labels';
  import { groupTools } from '../../editor/ui/layout';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Tool bar (WAI-ARIA toolbar: arrow keys move between tools, one tab stop). */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const groups = $derived(groupTools(Object.values(session.controller.tools)));
  /** Keyboard order: the groups one after the other. */
  const tools = $derived(groups.flatMap((group) => group.tools));
  const uid = $props.id();

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
    {#each groups as group (group.id)}
      <div class="group" role="group" aria-labelledby={`${uid}-${group.id}`}>
        <span class="group-label" id={`${uid}-${group.id}`}>{toolGroupLabel(group.id)}</span>
        <div class="grid">
          {#each group.tools as tool (tool.id)}
            {@const index = tools.indexOf(tool)}
            <button
              type="button"
              class="tool"
              aria-pressed={ui.tool === tool.id}
              tabindex={index === current ? 0 : -1}
              title={tool.shortcut === ''
                ? null
                : t('editor.tools.shortcut', { key: tool.shortcut })}
              data-testid={`tool-${tool.id}`}
              onclick={() => choose(tool.id, index)}
              onfocus={() => (focusIndex = index)}
            >
              <span class="label">{toolLabel(tool.id)}</span>
              {#if tool.shortcut !== ''}<kbd aria-hidden="true">{tool.shortcut}</kbd>{/if}
            </button>
          {/each}
        </div>
      </div>
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
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-2);
    overflow-y: auto;
    border-right: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  .tools {
    display: grid;
    gap: var(--space-2);
  }
  .group {
    display: grid;
    gap: 2px;
  }
  .group-label {
    padding: 0 var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: 2px;
  }
  .tools:focus {
    outline: none;
  }
  .tool {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 2rem;
    padding: var(--space-1) 0.9rem var(--space-1) var(--space-2);
    overflow-wrap: normal;
    hyphens: auto;
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
  .label {
    line-height: 1.2;
  }
  kbd {
    position: absolute;
    top: 2px;
    right: 3px;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    line-height: 1;
    color: var(--color-text-muted);
  }
  @media (max-width: 48rem) {
    .toolbar {
      width: 8.5rem;
      box-sizing: border-box;
    }
  }
</style>
