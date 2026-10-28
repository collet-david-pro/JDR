<script lang="ts">
  import { parseNotes } from '../../lib/admin-update-notes';

  let { notes }: { notes: string | null } = $props();
  const blocks = $derived(parseNotes(notes));
</script>

<div class="notes">
  {#each blocks as block, index (index)}
    {#if block.kind === 'heading'}
      <p><strong>{block.text}</strong></p>
    {:else if block.kind === 'paragraph'}
      <p>{block.text}</p>
    {:else}
      <ul>
        {#each block.items as item, i (i)}
          <li>{item}</li>
        {/each}
      </ul>
    {/if}
  {/each}
</div>

<style>
  .notes {
    max-height: 18rem;
    overflow: auto;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0 0 var(--space-2);
  }
  ul {
    margin: 0 0 var(--space-2);
    padding-left: var(--space-4);
  }
</style>
