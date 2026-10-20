<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'default' | 'primary' | 'danger' | 'ghost';
    size?: 'normal' | 'small';
    /** Shows a spinner, disables the button and sets aria-busy. */
    loading?: boolean;
    children: Snippet;
  }

  let {
    variant = 'default',
    size = 'normal',
    loading = false,
    type = 'button',
    disabled = false,
    class: extra = '',
    children,
    ...rest
  }: Props = $props();
</script>

<button
  {...rest}
  {type}
  class={['button', `button-${variant}`, size === 'small' && 'button-small', extra]}
  disabled={disabled || loading}
  aria-busy={loading ? 'true' : undefined}
>
  {#if loading}<span class="spinner" aria-hidden="true"></span>{/if}
  {@render children()}
</button>
