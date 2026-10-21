<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLTextareaAttributes, 'value'> {
    label: string;
    value: string;
    /** Translated error message, linked with aria-describedby. */
    error?: string | null;
    hint?: string | null;
  }

  let {
    label,
    value = $bindable(),
    error = null,
    hint = null,
    rows = 4,
    ...rest
  }: Props = $props();

  const uid = $props.id();
  const describedBy = $derived(
    [hint ? `${uid}-hint` : null, error ? `${uid}-error` : null].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<div class="field" class:invalid={!!error}>
  <label for={`${uid}-input`}>{label}</label>
  <textarea
    {...rest}
    id={`${uid}-input`}
    {rows}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={describedBy}></textarea>
  {#if hint}<p id={`${uid}-hint`} class="hint">{hint}</p>{/if}
  {#if error}<p id={`${uid}-error`} class="error">{error}</p>{/if}
</div>

<style>
  .field {
    display: grid;
    gap: var(--space-1);
  }
  label {
    font-weight: var(--font-weight-medium);
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
  textarea:disabled,
  textarea:read-only {
    background: var(--color-surface-sunken);
  }
  .invalid textarea {
    border-color: var(--color-danger);
  }
  .hint,
  .error {
    margin: 0;
    font-size: var(--font-size-sm);
  }
  .hint {
    color: var(--color-text-muted);
  }
  .error {
    color: var(--color-danger);
  }
</style>
