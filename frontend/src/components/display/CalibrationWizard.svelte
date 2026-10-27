<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n';
  import {
    RULER_MM,
    cellCssPx,
    effectivePxPerMm,
    pxPerMmFromRuler,
    type ScreenSize,
  } from '../../lib/displays/calibration';
  import { clampRuler, parseDiagonal } from '../../lib/displays/ui-logic';
  import type { DeviceSettingsPatch, DisplaySettings } from '../../lib/displays/types';

  /**
   * Calibration wizard: the scale of the screen from its diagonal or from an on-screen ruler
   * matched with a real one (10 cm). Shown in the rotated frame of the screen.
   */
  interface Props {
    settings: DisplaySettings;
    screen: ScreenSize | null;
    /** Width of the render area (CSS px): bounds the ruler. */
    width: number;
    error: string | null;
    onsave: (patch: DeviceSettingsPatch) => void;
    onclose: () => void;
  }
  let { settings, screen, width, error, onsave, onclose }: Props = $props();

  type Tab = 'diagonal' | 'ruler';
  let tab = $state<Tab>('diagonal');
  let diagonal = $state('');
  let line = $state(378);
  let root: HTMLDivElement | undefined = $state();

  onMount(() => {
    const known = settings.px_per_mm;
    diagonal = settings.diagonal_in === null ? '' : String(settings.diagonal_in);
    if (known !== null) line = Math.round(known * RULER_MM);
    else {
      const eff = effectivePxPerMm(settings, screen);
      if (eff !== null) line = Math.round(eff * RULER_MM);
    }
    if (settings.px_per_mm !== null && settings.diagonal_in === null) tab = 'ruler';
    const previous = document.activeElement as HTMLElement | null;
    root?.querySelector<HTMLElement>('button')?.focus();
    return () => previous?.focus?.();
  });

  const maxLine = $derived(Math.max(100, Math.floor(width - 40)));
  const parsed = $derived(parseDiagonal(diagonal));
  const pxPerMm = $derived(
    tab === 'diagonal'
      ? parsed === null
        ? null
        : effectivePxPerMm({ px_per_mm: null, diagonal_in: parsed }, screen)
      : pxPerMmFromRuler(line),
  );
  const cellPx = $derived(pxPerMm === null ? null : cellCssPx(pxPerMm, settings.mm_per_cell));

  function nudge(delta: number): void {
    line = clampRuler(line + delta, maxLine);
  }

  function save(): void {
    if (pxPerMm === null) return;
    if (tab === 'diagonal' && parsed !== null) onsave({ diagonal_in: parsed, px_per_mm: null });
    else onsave({ px_per_mm: pxPerMm });
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.key !== 'Tab' || root === undefined) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input'));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<div class="backdrop">
  <div
    class="wizard"
    bind:this={root}
    role="dialog"
    aria-modal="true"
    aria-labelledby="display-cal-title"
    tabindex="-1"
    data-testid="display-calibration"
    onkeydown={keydown}
  >
    <h2 id="display-cal-title">{t('display.cal.title')}</h2>

    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'diagonal'}
        class:on={tab === 'diagonal'}
        onclick={() => (tab = 'diagonal')}
        data-testid="display-cal-diagonal">{t('display.cal.tab_diagonal')}</button
      >
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'ruler'}
        class:on={tab === 'ruler'}
        onclick={() => (tab = 'ruler')}
        data-testid="display-cal-ruler">{t('display.cal.tab_ruler')}</button
      >
    </div>

    {#if tab === 'diagonal'}
      <label for="display-cal-diagonal-input">{t('display.cal.diagonal_label')}</label>
      <input
        id="display-cal-diagonal-input"
        data-testid="display-cal-diagonal-input"
        type="text"
        inputmode="decimal"
        bind:value={diagonal}
      />
      {#if diagonal.trim() !== '' && parsed === null}
        <p class="warn" role="alert">{t('display.cal.diagonal_invalid')}</p>
      {/if}
    {:else}
      <p>{t('display.cal.ruler_help')}</p>
      <div class="line-box">
        <div
          class="line"
          style:width={`${line}px`}
          data-testid="display-cal-line"
          data-px={line}
        ></div>
      </div>
      <input
        type="range"
        min="50"
        max={maxLine}
        step="1"
        value={line}
        aria-label={t('display.cal.ruler_length')}
        oninput={(e) => (line = clampRuler(Number(e.currentTarget.value), maxLine))}
        data-testid="display-cal-range"
      />
      <div class="nudge">
        <button type="button" onclick={() => nudge(-10)}>−10</button>
        <button type="button" onclick={() => nudge(-1)}>−1</button>
        <span>{line} px</span>
        <button type="button" onclick={() => nudge(1)}>+1</button>
        <button type="button" onclick={() => nudge(10)}>+10</button>
      </div>
    {/if}

    <p class="info" data-testid="display-cal-result">
      {#if pxPerMm === null}
        {t('display.cal.unknown')}
      {:else}
        {t('display.cal.result', { value: pxPerMm.toFixed(3) })}
      {/if}
    </p>
    {#if cellPx !== null}
      <div class="preview">
        <div class="cell" style:width={`${cellPx}px`} style:height={`${cellPx}px`}></div>
        <span>{t('display.cal.cell', { mm: settings.mm_per_cell })}</span>
      </div>
    {/if}
    {#if error !== null}
      <p class="warn" role="alert" data-testid="display-cal-error">{error}</p>
    {/if}

    <div class="actions">
      <button
        type="button"
        disabled={pxPerMm === null}
        onclick={save}
        data-testid="display-cal-save"
      >
        {t('display.cal.save')}
      </button>
      <button
        type="button"
        onclick={() => onsave({ diagonal_in: null, px_per_mm: null })}
        data-testid="display-cal-reset">{t('display.cal.reset')}</button
      >
      <button type="button" onclick={onclose} data-testid="display-cal-close">
        {t('display.menu.close')}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.75);
    z-index: 6;
  }
  .wizard {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: min(100% - 2rem, 48rem);
    max-height: 96%;
    overflow: auto;
    padding: 1.25rem;
    border-radius: 0.75rem;
    background: #1c1f27;
    border: 1px solid #445;
    color: #fff;
  }
  h2,
  p {
    margin: 0;
  }
  .tabs,
  .nudge,
  .actions,
  .preview {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
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
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  input[type='text'] {
    font-size: 1.25rem;
    padding: 0.4rem;
    border-radius: 0.4rem;
    border: 1px solid #667;
    background: #111;
    color: #fff;
    max-width: 10rem;
  }
  input[type='range'] {
    width: 100%;
  }
  .line-box {
    padding: 0.75rem 0;
    overflow: hidden;
  }
  .line {
    height: 4px;
    background: #fff;
    position: relative;
  }
  .line::before,
  .line::after {
    content: '';
    position: absolute;
    top: -8px;
    width: 2px;
    height: 20px;
    background: #fff;
  }
  .line::before {
    left: 0;
  }
  .line::after {
    right: 0;
  }
  .cell {
    border: 2px solid #fff;
    box-sizing: border-box;
    max-width: 100%;
  }
  .info {
    color: #aab;
  }
  .warn {
    color: #ffd966;
  }
</style>
