<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t } from '../lib/i18n';
  import { placeCard, spotlight, type Box, type CardPlacement } from '../lib/tour/position';
  import { stepBodyKey, stepTitleKey } from '../lib/tour/tours';
  import { prefs } from '../stores/prefs.svelte';
  import { tour } from '../stores/tour.svelte';

  /** Guided tour on top of the page: lit element and a card with the step (modal dialog). */
  interface Props {
    /** Current route: a tour stops when the page changes. */
    path: string;
  }

  let { path }: Props = $props();

  const uid = $props.id();
  let dialog: HTMLDialogElement | undefined = $state();
  let card: HTMLDivElement | undefined = $state();
  let nextButton: HTMLButtonElement | undefined = $state();
  let spot = $state.raw<Box | null>(null);
  let place = $state.raw<CardPlacement | null>(null);

  const active = $derived(tour.active);
  const step = $derived(active === null ? null : (active.steps[active.index] ?? null));
  const last = $derived(active !== null && active.index === active.steps.length - 1);
  let lastPath = untrack(() => path);

  $effect(() => {
    if (dialog === undefined) return;
    if (active !== null && !dialog.open) dialog.showModal();
    else if (active === null && dialog.open) dialog.close();
  });

  $effect(() => {
    const current = path;
    if (current === lastPath) return;
    lastPath = current;
    untrack(() => tour.cancel());
  });

  function target(): HTMLElement | null {
    const selector = step?.target;
    return selector === undefined ? null : document.querySelector<HTMLElement>(selector);
  }

  function measure(): void {
    if (step === null || card === undefined) return;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const element = target();
    const rect = element?.getBoundingClientRect() ?? null;
    const box =
      rect === null ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    spot = box === null ? null : spotlight(box, view);
    place = placeCard(spot, { width: card.offsetWidth, height: card.offsetHeight }, view);
  }

  let frame = 0;
  function remeasure(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }

  $effect(() => {
    if (step === null) return;
    void (async () => {
      await tick();
      target()?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: prefs.reducedMotion ? 'auto' : 'smooth',
      });
      measure();
      // The card is hidden until placed: focus once it is drawn.
      await tick();
      nextButton?.focus();
    })();
  });

  function cancel(event: Event): void {
    // Escape skips the tour (native close prevented: the store closes the dialog).
    event.preventDefault();
    tour.finish();
  }
</script>

<svelte:window onresize={remeasure} onscrollcapture={remeasure} />

<dialog
  bind:this={dialog}
  class="tour"
  class:moving={!prefs.reducedMotion}
  aria-labelledby={`${uid}-title`}
  aria-describedby={`${uid}-body`}
  data-testid="tour"
  data-tour-id={active?.id ?? ''}
  oncancel={cancel}
  onkeydown={(event) => event.stopPropagation()}
>
  {#if active !== null && step !== null}
    {#if spot === null}
      <div class="dim"></div>
    {:else}
      <div
        class="spot"
        style:left={`${spot.x}px`}
        style:top={`${spot.y}px`}
        style:width={`${spot.width}px`}
        style:height={`${spot.height}px`}
      ></div>
    {/if}
    <div
      class="card"
      bind:this={card}
      data-side={place?.side ?? 'center'}
      style:left={`${place?.x ?? 0}px`}
      style:top={`${place?.y ?? 0}px`}
      style:visibility={place === null ? 'hidden' : 'visible'}
    >
      <p class="progress small muted" data-testid="tour-progress">
        {t('tour.progress', { n: active.index + 1, total: active.steps.length })}
      </p>
      <h2 id={`${uid}-title`}>{t(stepTitleKey(active.id, step))}</h2>
      <p id={`${uid}-body`}>{t(stepBodyKey(active.id, step))}</p>
      <div class="actions">
        {#if !last}
          <button
            type="button"
            class="button button-ghost button-small"
            data-testid="tour-skip"
            onclick={() => tour.finish()}>{t('tour.skip')}</button
          >
        {/if}
        <span class="spacer"></span>
        {#if active.index > 0}
          <button
            type="button"
            class="button button-small"
            data-testid="tour-previous"
            onclick={() => tour.previous()}>{t('tour.previous')}</button
          >
        {/if}
        <button
          type="button"
          class="button button-primary button-small"
          data-testid="tour-next"
          bind:this={nextButton}
          onclick={() => tour.next()}>{last ? t('tour.done') : t('tour.next')}</button
        >
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog.tour {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    background: transparent;
    color: var(--color-text);
  }
  dialog.tour::backdrop {
    background: transparent;
  }
  .dim {
    position: absolute;
    inset: 0;
    background: var(--color-backdrop);
  }
  .spot {
    position: absolute;
    border-radius: var(--radius-md);
    box-shadow:
      0 0 0 3px var(--color-focus),
      0 0 0 200vmax var(--color-backdrop);
    pointer-events: none;
  }
  .card {
    position: absolute;
    width: min(22rem, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-4);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    box-shadow: var(--shadow-lg);
  }
  .moving .spot,
  .moving .card {
    transition:
      left 0.2s ease,
      top 0.2s ease,
      width 0.2s ease,
      height 0.2s ease;
  }
  .progress {
    margin: 0 0 var(--space-1);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-lg);
  }
  .card > p:not(.progress) {
    margin: 0 0 var(--space-4);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .spacer {
    flex: 1;
  }
</style>
