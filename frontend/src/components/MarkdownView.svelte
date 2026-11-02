<script lang="ts">
  /**
   * Safe rendering of a Markdown body (P9b2a): blocks of the parser printed as Svelte elements
   * and text nodes. No `{@html}`: nothing written by the user can create another element.
   */
  import { parseMarkdown, type MdRun } from '../lib/markdown-safe';

  let {
    source,
    maxHeight = null,
  }: { source: string | null | undefined; maxHeight?: string | null } = $props();
  const blocks = $derived(parseMarkdown(source));
</script>

{#snippet inline(runs: readonly MdRun[])}
  {#each runs as run, i (i)}
    {#if run.bold && run.italic}<strong><em>{run.text}</em></strong>{:else if run.bold}<strong
        >{run.text}</strong
      >{:else if run.italic}<em>{run.text}</em>{:else}{run.text}{/if}
  {/each}
{/snippet}

<div class="markdown" style:max-height={maxHeight} data-testid="markdown-view">
  {#each blocks as block, index (index)}
    {#if block.kind === 'heading'}
      {#if block.level === 1}
        <h3>{@render inline(block.runs)}</h3>
      {:else if block.level === 2}
        <h4>{@render inline(block.runs)}</h4>
      {:else}
        <h5>{@render inline(block.runs)}</h5>
      {/if}
    {:else if block.kind === 'paragraph'}
      <p>{@render inline(block.runs)}</p>
    {:else if block.kind === 'quote'}
      <blockquote>{@render inline(block.runs)}</blockquote>
    {:else if block.kind === 'rule'}
      <hr />
    {:else if block.ordered}
      <ol>
        {#each block.items as item, i (i)}
          <li>{@render inline(item)}</li>
        {/each}
      </ol>
    {:else}
      <ul>
        {#each block.items as item, i (i)}
          <li>{@render inline(item)}</li>
        {/each}
      </ul>
    {/if}
  {/each}
</div>

<style>
  .markdown {
    overflow: auto;
    overflow-wrap: anywhere;
  }
  p,
  ul,
  ol,
  blockquote {
    margin: 0 0 var(--space-2);
  }
  ul,
  ol {
    padding-left: var(--space-4);
  }
  h3,
  h4,
  h5 {
    margin: 0 0 var(--space-2);
    font-size: 1em;
    font-weight: 700;
  }
  h3 {
    font-size: 1.15em;
  }
  blockquote {
    padding-left: var(--space-3);
    border-left: 3px solid var(--color-border);
    color: var(--color-text-muted);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--color-border);
    margin: var(--space-2) 0;
  }
</style>
