<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';

  /**
   * A token entered a zone with a note: the GM may read it. Nothing is ever sent by itself; a
   * suggestion disappears alone after a minute.
   */
  let { run, send }: Pick<PanelProps, 'run' | 'send'> = $props();
  const LIFETIME_MS = 60_000;

  onMount(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const z of run.zoneSuggestions) {
        if (now - z.at >= LIFETIME_MS) run.dismissSuggestion(z.zoneUid);
      }
    }, 1000);
    return () => clearInterval(timer);
  });

  async function read(zoneUid: string, noteUid: string): Promise<void> {
    if (await send([{ type: 'note.show', note_uid: noteUid }])) run.dismissSuggestion(zoneUid);
  }
</script>

{#if run.zoneSuggestions.length > 0}
  <div class="suggestions" role="status" data-testid="zone-suggestions">
    {#each run.zoneSuggestions as z (z.zoneUid)}
      <div class="item" data-testid="zone-suggestion" data-zone={z.zoneUid}>
        <span>{t('sessions.zone.entered', { title: z.title })}</span>
        <button
          type="button"
          class="button button-small button-primary"
          data-testid="zone-read"
          onclick={() => read(z.zoneUid, z.noteUid)}
          >{t('sessions.zone.read', { title: z.title })}</button
        >
        <button
          type="button"
          class="button button-small button-ghost"
          data-testid="zone-ignore"
          onclick={() => run.dismissSuggestion(z.zoneUid)}>{t('sessions.zone.ignore')}</button
        >
      </div>
    {/each}
  </div>
{/if}

<style>
  .suggestions {
    display: grid;
    gap: var(--space-1);
  }
  .item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font-size: var(--font-size-sm);
  }
</style>
