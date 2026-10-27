<script lang="ts">
  import DisplayItem from './DisplayItem.svelte';
  import TextField from '../TextField.svelte';
  import { t } from '../../lib/i18n';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';
  import { sessionProblem } from '../../lib/sessions/labels';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Console panel "Écrans": add a projection screen (code + QR), presence, settings, view
   * lock, revocation (screens are revoked automatically when the session ends).
   */
  let { run, displays, currentView }: PanelProps = $props();
  const uid = $props.id();
  const ended = $derived(run.state?.session.state === 'ended');
  let name = $state('');
  let busy = $state(false);

  async function add(event: Event): Promise<void> {
    event.preventDefault();
    const value = name.trim();
    if (value === '' || busy) return;
    busy = true;
    try {
      await displays.add(value.slice(0, 60));
      name = '';
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    } finally {
      busy = false;
    }
  }
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="displays-panel">
  <h2 id={`${uid}-title`}>{t('sessions.displays.title')}</h2>
  <p class="small muted">{t('sessions.displays.intro')}</p>

  {#if !ended}
    <form class="add" onsubmit={add}>
      <TextField
        label={t('sessions.displays.add_name')}
        bind:value={name}
        maxlength={60}
        placeholder={t('sessions.displays.add_placeholder')}
        data-testid="displays-add-name"
      />
      <button
        type="submit"
        class="button button-primary"
        disabled={busy || name.trim() === ''}
        data-testid="displays-add">{t('sessions.displays.add')}</button
      >
    </form>
  {/if}

  {#if displays.loaded && displays.displays.length === 0}
    <p class="muted small" data-testid="displays-empty">{t('sessions.displays.empty')}</p>
  {:else}
    <ul class="list">
      {#each displays.displays as d (d.id)}
        <DisplayItem
          display={d}
          pairing={displays.pairings[d.id] ?? null}
          model={displays}
          {currentView}
        />
      {/each}
    </ul>
  {/if}
</section>

<style>
  .panel {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-md);
  }
  p {
    margin: 0;
  }
  .add {
    display: grid;
    gap: var(--space-2);
  }
  .list {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
  }
</style>
