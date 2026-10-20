<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'type'> {
    label: string;
    value: string;
    type?: 'text' | 'email' | 'password' | 'url' | 'search' | 'tel';
    /** Translated error message, linked to the input with aria-describedby. */
    error?: string | null;
    hint?: string | null;
  }

  let {
    label,
    value = $bindable(),
    type = 'text',
    error = null,
    hint = null,
    required = false,
    ...rest
  }: Props = $props();

  const uid = $props.id();
  const describedBy = $derived(
    [hint ? `${uid}-hint` : null, error ? `${uid}-error` : null].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<div class="field" class:invalid={!!error}>
  <label for={`${uid}-input`}>
    {label}{#if required}<span class="required" aria-hidden="true"> *</span>{/if}
  </label>
  <input
    {...rest}
    id={`${uid}-input`}
    {type}
    bind:value
    {required}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={describedBy}
  />
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
  .required {
    color: var(--color-danger);
  }
  input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }
  input:disabled,
  input:read-only {
    background: var(--color-surface-sunken);
  }
  .invalid input {
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
