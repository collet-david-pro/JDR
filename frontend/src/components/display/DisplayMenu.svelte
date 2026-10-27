<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { WakeLockState } from '../../lib/displays/wake-lock';
  import type { DisplaySettings, Rotation } from '../../lib/displays/types';

  /** Discreet menu of a projection screen (long press in a corner, or the M key). */
  interface Props {
    name: string;
    settings: DisplaySettings;
    wake: WakeLockState;
    fullscreen: boolean;
    outOfRange: 'low' | 'high' | null;
    error: string | null;
    onclose: () => void;
    oncalibrate: () => void;
    onrotation: (rotation: Rotation) => void;
    onmirror: (mirror: boolean) => void;
    onfullscreen: () => void;
    onunpair: () => void;
  }
  let {
    name,
    settings,
    wake,
    fullscreen,
    outOfRange,
    error,
    onclose,
    oncalibrate,
    onrotation,
    onmirror,
    onfullscreen,
    onunpair,
  }: Props = $props();

  const ROTATIONS: Rotation[] = [0, 90, 180, 270];
  let dialog: HTMLDivElement | undefined = $state();
  let confirming = $state(false);

  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    focusables()[0]?.focus();
    return () => previous?.focus?.();
  });

  function focusables(): HTMLElement[] {
    if (dialog === undefined) return [];
    return Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input'));
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<div class="backdrop">
  <div
    class="menu"
    bind:this={dialog}
    role="dialog"
    aria-modal="true"
    aria-labelledby="display-menu-title"
    tabindex="-1"
    data-testid="display-menu"
    onkeydown={keydown}
  >
    <h2 id="display-menu-title">{name}</h2>

    <button type="button" onclick={oncalibrate} data-testid="display-menu-calibrate">
      {t('display.menu.calibrate')}
    </button>

    <div class="group" role="group" aria-label={t('display.menu.rotation')}>
      <span>{t('display.menu.rotation')}</span>
      {#each ROTATIONS as r (r)}
        <button
          type="button"
          class:on={settings.rotation === r}
          aria-pressed={settings.rotation === r}
          onclick={() => onrotation(r)}
          data-testid={`display-menu-rotation-${r}`}>{r}°</button
        >
      {/each}
    </div>

    <button
      type="button"
      class:on={settings.mirror}
      aria-pressed={settings.mirror}
      onclick={() => onmirror(!settings.mirror)}
      data-testid="display-menu-mirror"
    >
      {t('display.menu.mirror')}
    </button>

    <button type="button" onclick={onfullscreen} data-testid="display-menu-fullscreen">
      {fullscreen ? t('display.menu.fullscreen_exit') : t('display.fullscreen')}
    </button>

    <p class="info" data-testid="display-menu-wake">
      {t('display.wake.label')} : {t(`display.wake.${wake}`)}
    </p>
    {#if outOfRange !== null}
      <p class="warn" role="status" data-testid="display-menu-range">
        {t(`display.menu.range_${outOfRange}`)}
      </p>
    {/if}
    {#if error !== null}
      <p class="warn" role="alert" data-testid="display-menu-error">{error}</p>
    {/if}

    {#if confirming}
      <div class="group" role="group">
        <span>{t('display.menu.unpair_confirm')}</span>
        <button
          type="button"
          class="danger"
          onclick={onunpair}
          data-testid="display-menu-unpair-confirm"
        >
          {t('display.menu.unpair_do')}
        </button>
        <button type="button" onclick={() => (confirming = false)}>{t('common.cancel')}</button>
      </div>
    {:else}
      <button
        type="button"
        class="danger"
        onclick={() => (confirming = true)}
        data-testid="display-menu-unpair"
      >
        {t('display.menu.unpair')}
      </button>
    {/if}

    <button type="button" onclick={onclose} data-testid="display-menu-close">
      {t('display.menu.close')}
    </button>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.6);
    z-index: 5;
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: min(24rem, 90%);
    max-height: 95%;
    overflow: auto;
    padding: 1.25rem;
    border-radius: 0.75rem;
    background: #1c1f27;
    border: 1px solid #445;
    color: #fff;
  }
  h2 {
    margin: 0 0 0.25rem;
    font-size: 1.25rem;
  }
  .group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .group > span {
    flex-basis: 100%;
  }
  button {
    min-height: 2.75rem;
    padding: 0 1rem;
    border-radius: 0.5rem;
    border: 1px solid #556;
    background: #262a35;
    color: #fff;
    font-size: 1rem;
    cursor: pointer;
  }
  button.on {
    background: #3b82f6;
    border-color: #3b82f6;
  }
  button.danger {
    border-color: #b34;
  }
  .info,
  .warn {
    margin: 0;
    font-size: 0.9rem;
  }
  .info {
    color: #aab;
  }
  .warn {
    color: #ffd966;
  }
</style>
