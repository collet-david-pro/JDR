<script lang="ts">
  interface Props {
    label: string;
    checked: boolean;
    hint?: string | null;
    disabled?: boolean;
    name?: string;
  }

  let { label, checked = $bindable(), hint = null, disabled = false, name }: Props = $props();
  const uid = $props.id();
</script>

<div class="checkbox">
  <input
    id={`${uid}-box`}
    type="checkbox"
    bind:checked
    {disabled}
    {name}
    aria-describedby={hint ? `${uid}-hint` : undefined}
  />
  <label for={`${uid}-box`}>{label}</label>
  {#if hint}<p id={`${uid}-hint`} class="hint">{hint}</p>{/if}
</div>

<style>
  .checkbox {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 var(--space-2);
    align-items: center;
  }
  input {
    width: 1.1rem;
    height: 1.1rem;
    margin: 0;
    accent-color: var(--color-primary);
  }
  .hint {
    grid-column: 2;
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
</style>
