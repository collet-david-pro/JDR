<script lang="ts" module>
  export interface SelectOption {
    readonly value: string;
    readonly label: string;
  }
</script>

<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLSelectAttributes, 'value'> {
    label: string;
    value: string;
    options: readonly SelectOption[];
    error?: string | null;
    hint?: string | null;
  }

  let { label, value = $bindable(), options, error = null, hint = null, ...rest }: Props = $props();

  const uid = $props.id();
  const describedBy = $derived(
    [hint ? `${uid}-hint` : null, error ? `${uid}-error` : null].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<div class="field">
  <label for={`${uid}-select`}>{label}</label>
  <select
    {...rest}
    id={`${uid}-select`}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={describedBy}
  >
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
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
  select {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
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
