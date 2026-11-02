<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import { searchCommands, type Command } from '../lib/commands';
  import { t } from '../lib/i18n';
  import { toasts } from '../stores/toasts.svelte';

  /**
   * Command palette (Cmd/Ctrl+K): a search field (combobox) over a list of commands (listbox).
   * Arrows move (and loop), Enter or a click runs. The palette closes BEFORE the command runs:
   * a command may open a dialog. An error thrown by a command ends as a toast.
   */
  interface Props {
    open: boolean;
    commands: readonly Command[];
    platform?: 'mac' | 'other';
  }

  let { open = $bindable(), commands, platform = 'other' }: Props = $props();
  const uid = $props.id();
  let query = $state('');
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();

  // `when` is read again at every opening and every keystroke.
  let openedAt = $state(0);
  const results = $derived.by(() => {
    void openedAt;
    return searchCommands(commands, query);
  });
  const optionId = (index: number): string => `${uid}-option-${index}`;

  $effect(() => {
    if (!open) return;
    untrack(() => {
      query = '';
      active = 0;
      openedAt++;
    });
    // After showModal() (which focuses the first button of the dialog).
    void tick().then(() => setTimeout(() => input?.focus(), 0));
  });

  $effect(() => {
    if (active >= results.length) active = 0;
  });

  $effect(() => {
    if (!open) return;
    void active;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  });

  async function run(command: Command): Promise<void> {
    open = false;
    await tick();
    try {
      command.run();
    } catch (error) {
      toasts.error(error);
    }
  }

  function keydown(event: KeyboardEvent): void {
    const count = results.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count === 0) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    } else if (event.key === 'Escape') {
      // Closed at once (the native dialog only tells us with a later event).
      event.preventDefault();
      open = false;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = results[active];
      if (command !== undefined) void run(command);
    }
  }
</script>

<Modal bind:open title={t('palette.title')}>
  <div class="palette" data-testid="command-palette" data-platform={platform}>
    <!-- showModal() focuses the autofocus field first; the effect above is the fallback. -->
    <!-- svelte-ignore a11y_autofocus -->
    <input
      autofocus
      bind:this={input}
      bind:value={query}
      class="input"
      type="text"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      aria-label={t('palette.label')}
      aria-expanded="true"
      aria-controls={`${uid}-list`}
      aria-autocomplete="list"
      aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
      placeholder={t('palette.placeholder')}
      data-testid="palette-input"
      oninput={() => (active = 0)}
      onkeydown={keydown}
    />
    <ul
      id={`${uid}-list`}
      role="listbox"
      aria-label={t('palette.title')}
      data-testid="palette-list"
    >
      {#each results as command, index (command.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={optionId(index)}
          role="option"
          aria-selected={index === active}
          class:active={index === active}
          data-testid="palette-item"
          data-command={command.id}
          onpointermove={() => (active = index)}
          onclick={() => void run(command)}
        >
          <span class="label">{command.label}</span>
          <span class="group">{command.group}</span>
          {#if command.shortcut}<kbd>{command.shortcut}</kbd>{/if}
        </li>
      {/each}
    </ul>
    {#if results.length === 0}
      <p class="empty muted" role="status" data-testid="palette-empty">{t('palette.empty')}</p>
    {/if}
  </div>
</Modal>

<style>
  .palette {
    display: grid;
    gap: var(--space-2);
  }
  .input {
    width: 100%;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: min(24rem, 55vh);
    overflow-y: auto;
  }
  li {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  li.active {
    background: var(--color-surface-sunken);
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .group {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  kbd {
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
  .empty {
    margin: 0;
  }
</style>
