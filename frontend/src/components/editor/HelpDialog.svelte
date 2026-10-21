<script lang="ts">
  import Modal from '../Modal.svelte';
  import {
    DEFAULT_BINDINGS,
    detectPlatform,
    shortcutLabels,
    type ShortcutAction,
  } from '../../editor/shortcuts';
  import { shortcutDescription } from '../../editor/ui/labels';
  import { t } from '../../lib/i18n';

  /** Keyboard shortcuts of the editor (`?`). */
  interface Props {
    open: boolean;
  }

  let { open = $bindable() }: Props = $props();

  const platform = detectPlatform(navigator);
  const actions = [...new Set(DEFAULT_BINDINGS.map((b) => b.action))];
  const rows = actions.flatMap((action: ShortcutAction) => {
    const text = shortcutDescription(action);
    if (text === null) return [];
    const keys = action === 'layer.1' ? ['1 – 9'] : shortcutLabels(action, platform);
    return [{ action, text, keys }];
  });
</script>

<Modal bind:open title={t('editor.help.title')}>
  <table class="shortcuts" data-testid="editor-help-dialog">
    <thead>
      <tr>
        <th scope="col">{t('editor.help.keys')}</th>
        <th scope="col">{t('editor.help.action')}</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.action)}
        <tr>
          <td>
            {#each row.keys as key, i (key)}
              {#if i > 0}<span class="muted"> / </span>{/if}<kbd>{key}</kbd>
            {/each}
          </td>
          <td>{row.text}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <h3>{t('editor.help.pointer_title')}</h3>
  <ul class="small">
    <li>{t('editor.help.wheel')}</li>
    <li>{t('editor.help.trackpad')}</li>
    <li>{t('editor.help.middle')}</li>
    <li>{t('editor.help.inputs')}</li>
  </ul>
</Modal>

<style>
  .shortcuts {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }
  th,
  td {
    padding: var(--space-1) var(--space-2);
    border-bottom: var(--border-width) solid var(--color-border);
    text-align: left;
    vertical-align: top;
  }
  th {
    color: var(--color-text-muted);
    font-weight: var(--font-weight-medium);
  }
  td:first-child {
    white-space: nowrap;
  }
  kbd {
    padding: 0 var(--space-1);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }
  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--font-size-md);
  }
  ul {
    margin: 0;
    padding-left: var(--space-5);
  }
</style>
