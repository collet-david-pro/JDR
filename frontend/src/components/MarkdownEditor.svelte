<script lang="ts">
  /**
   * Markdown editor (P9b2a): text area + toolbar (title, bold, italic, lists, quote, rule),
   * Ctrl/Cmd+B and I, Write / Preview switch (side by side when the width allows it), counter and
   * hard limit. The preview is the safe renderer (no HTML). Reused by the player notes (P9b2b).
   */
  import MarkdownView from './MarkdownView.svelte';
  import { applyFormat, MARKDOWN_FORMATS, type MarkdownFormat } from '../lib/markdown-edit';
  import { t } from '../lib/i18n';
  import { tick } from 'svelte';

  interface Props {
    value: string;
    label: string;
    /** Hard limit in characters (default: the 20 000 of a note). */
    maxlength?: number;
    rows?: number;
    disabled?: boolean;
    error?: string | null;
    name?: string;
  }

  let {
    value = $bindable(),
    label,
    maxlength = 20_000,
    rows = 10,
    disabled = false,
    error = null,
    name,
  }: Props = $props();

  const uid = $props.id();
  let area: HTMLTextAreaElement | undefined = $state();
  let mode = $state<'write' | 'preview'>('write');
  const over = $derived(value.length >= maxlength);

  function formatLabel(format: MarkdownFormat): string {
    switch (format) {
      case 'heading':
        return t('markdown.format.heading');
      case 'bold':
        return t('markdown.format.bold');
      case 'italic':
        return t('markdown.format.italic');
      case 'list':
        return t('markdown.format.list');
      case 'ordered':
        return t('markdown.format.ordered');
      case 'quote':
        return t('markdown.format.quote');
      case 'rule':
        return t('markdown.format.rule');
    }
  }

  const GLYPHS: Readonly<Record<MarkdownFormat, string>> = {
    heading: 'T',
    bold: 'B',
    italic: 'I',
    list: '•',
    ordered: '1.',
    quote: '❝',
    rule: '—',
  };

  async function format(kind: MarkdownFormat): Promise<void> {
    if (disabled || area === undefined) return;
    mode = 'write';
    const next = applyFormat(value, area.selectionStart, area.selectionEnd, kind);
    if (next.value.length > maxlength) return;
    value = next.value;
    await tick();
    area.focus();
    area.setSelectionRange(next.selStart, next.selEnd);
  }

  function keydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'b' && key !== 'i') return;
    event.preventDefault();
    void format(key === 'b' ? 'bold' : 'italic');
  }
</script>

<div class="editor" class:invalid={!!error} data-mode={mode} data-testid="markdown-editor">
  <label for={`${uid}-input`}>{label}</label>
  <div class="bar">
    <div class="formats" role="toolbar" aria-label={t('markdown.toolbar')}>
      {#each MARKDOWN_FORMATS as kind (kind)}
        <button
          type="button"
          class="button button-small"
          aria-label={formatLabel(kind)}
          title={formatLabel(kind)}
          {disabled}
          data-testid={`md-${kind}`}
          onclick={() => void format(kind)}
        >
          <span aria-hidden="true" class:b={kind === 'bold'} class:i={kind === 'italic'}
            >{GLYPHS[kind]}</span
          >
        </button>
      {/each}
    </div>
    <div class="tabs" role="group" aria-label={t('markdown.mode')}>
      <button
        type="button"
        class="button button-small"
        aria-pressed={mode === 'write'}
        data-testid="md-write"
        onclick={() => (mode = 'write')}>{t('markdown.write')}</button
      >
      <button
        type="button"
        class="button button-small"
        aria-pressed={mode === 'preview'}
        data-testid="md-preview"
        onclick={() => (mode = 'preview')}>{t('markdown.preview')}</button
      >
    </div>
  </div>
  <div class="panes">
    <textarea
      id={`${uid}-input`}
      class="write"
      bind:this={area}
      bind:value
      {rows}
      {disabled}
      {name}
      {maxlength}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={`${uid}-count`}
      data-testid="md-input"
      onkeydown={keydown}></textarea>
    <div class="preview" aria-label={t('markdown.preview')} data-testid="md-rendered">
      {#if value.trim() === ''}
        <p class="small muted">{t('markdown.preview_empty')}</p>
      {:else}
        <MarkdownView source={value} />
      {/if}
    </div>
  </div>
  <p id={`${uid}-count`} class="count small" class:full={over} aria-live="polite">
    {t('markdown.count', { count: value.length, max: maxlength })}
  </p>
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .editor {
    display: grid;
    gap: var(--space-1);
    container-type: inline-size;
  }
  label {
    font-weight: var(--font-weight-medium);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .formats,
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .b {
    font-weight: 700;
  }
  .i {
    font-style: italic;
  }
  .panes {
    display: grid;
    gap: var(--space-2);
  }
  textarea {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    resize: vertical;
    font: inherit;
  }
  .invalid textarea {
    border-color: var(--color-danger);
  }
  .preview {
    min-height: 6rem;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) dashed var(--color-border);
    border-radius: var(--radius-md);
    overflow: auto;
    max-height: 22rem;
  }
  .count {
    margin: 0;
    color: var(--color-text-muted);
    text-align: right;
  }
  .count.full {
    color: var(--color-danger);
  }
  .error {
    margin: 0;
    color: var(--color-danger);
  }
  /* One pane at a time. */
  [data-mode='write'] .preview,
  [data-mode='preview'] .write {
    display: none;
  }
  /* Wide enough: both panes side by side, no switch. */
  @container (min-width: 44rem) {
    .panes {
      grid-template-columns: 1fr 1fr;
    }
    [data-mode] .preview,
    [data-mode] .write {
      display: block;
    }
    .tabs {
      display: none;
    }
  }
</style>
