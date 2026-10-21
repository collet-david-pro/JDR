<script lang="ts">
  import { t } from '../lib/i18n';

  /** Colour "#rrggbb": native picker + text input (keyboard and screen-reader friendly). */
  interface Props {
    label: string;
    value: string;
    name?: string;
    error?: string | null;
    disabled?: boolean;
  }

  let { label, value = $bindable(), name, error = null, disabled = false }: Props = $props();

  const uid = $props.id();
  const valid = $derived(/^#[0-9a-f]{6}$/i.test(value.trim()));
</script>

<div class="field" class:invalid={!!error}>
  <label for={`${uid}-text`}>{label}</label>
  <div class="inputs">
    <input
      type="color"
      value={valid ? value.trim().toLowerCase() : '#000000'}
      oninput={(event) => (value = event.currentTarget.value)}
      aria-label={t('games.color_picker', { label })}
      {disabled}
    />
    <input
      id={`${uid}-text`}
      type="text"
      {name}
      bind:value
      maxlength="7"
      spellcheck="false"
      autocomplete="off"
      placeholder="#rrggbb"
      {disabled}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? `${uid}-error` : undefined}
    />
  </div>
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
  .inputs {
    display: flex;
    gap: var(--space-2);
  }
  input[type='color'] {
    width: 2.75rem;
    height: 2.4rem;
    padding: 2px;
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    cursor: pointer;
  }
  input[type='text'] {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    font-family: var(--font-mono);
  }
  .invalid input[type='text'] {
    border-color: var(--color-danger);
  }
  .error {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }
</style>
