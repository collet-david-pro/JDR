<script lang="ts">
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import {
    ANCHORS,
    DEFAULT_ANCHOR,
    MAP_SIDE_MAX,
    MAP_SIDE_MIN,
    anchorShift,
    lostByResize,
    type Anchor,
  } from '../../editor/map-resize';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /**
   * "Taille de la map…": width and height in cells and the anchor (which side keeps its place).
   * Growing adds empty cells on the other sides; shrinking crops them. With an anchor other than
   * the top-left corner the whole content of the floors moves in the same lot as the new size.
   * What would leave the map is counted and must be confirmed.
   */
  interface Props {
    session: EditorSession;
    /** Saves the new size (and shift) then reloads the editor. */
    onapply?: (width: number, height: number, shiftX: number, shiftY: number) => Promise<void>;
  }

  let { session, onapply }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const grid = $derived(session.doc.grid);

  let width = $state(10);
  let height = $state(10);
  let anchor = $state<Anchor>(DEFAULT_ANCHOR);
  let confirmed = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!ui.resizeOpen) return;
    width = grid.width;
    height = grid.height;
    anchor = DEFAULT_ANCHOR;
    confirmed = false;
    error = null;
  });

  const valid = $derived(
    Number.isInteger(width) &&
      Number.isInteger(height) &&
      width >= MAP_SIDE_MIN &&
      width <= MAP_SIDE_MAX &&
      height >= MAP_SIDE_MIN &&
      height <= MAP_SIDE_MAX,
  );
  const changed = $derived(valid && (width !== grid.width || height !== grid.height));
  const shift = $derived(anchorShift(anchor, grid, { width, height }));
  const lost = $derived(
    valid && ui.resizeOpen
      ? lostByResize(session.doc, shift, width, height)
      : { objects: 0, tokens: 0, tiles: 0 },
  );
  const losing = $derived(lost.objects + lost.tokens + lost.tiles > 0);

  $effect(() => {
    // A new choice asks for a new confirmation.
    void [width, height, anchor];
    confirmed = false;
  });

  async function apply(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!changed || (losing && !confirmed) || onapply === undefined) return;
    busy = true;
    error = null;
    try {
      await onapply(width, height, shift.dx, shift.dy);
      ui.resizeOpen = false;
    } catch (e) {
      console.error(e);
      error = t('editor.resize.failed');
    } finally {
      busy = false;
    }
  }

  const numberOf = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);
</script>

<Modal bind:open={ui.resizeOpen} title={t('editor.resize.title')}>
  <form class="resize" onsubmit={apply} data-testid="resize-dialog">
    <p class="small muted">
      {t('editor.resize.current', { width: grid.width, height: grid.height })}
    </p>
    <div class="row">
      <label>
        <span>{t('editor.resize.width')}</span>
        <input
          type="number"
          min={MAP_SIDE_MIN}
          max={MAP_SIDE_MAX}
          step="1"
          value={width}
          oninput={(e) => (width = numberOf(e))}
          data-testid="resize-width"
        />
      </label>
      <label>
        <span>{t('editor.resize.height')}</span>
        <input
          type="number"
          min={MAP_SIDE_MIN}
          max={MAP_SIDE_MAX}
          step="1"
          value={height}
          oninput={(e) => (height = numberOf(e))}
          data-testid="resize-height"
        />
      </label>
    </div>
    <fieldset class="anchors">
      <legend>{t('editor.resize.anchor')}</legend>
      <div class="pad" role="radiogroup" aria-label={t('editor.resize.anchor')}>
        {#each ANCHORS as a (a)}
          <label class="cell" class:on={anchor === a}>
            <input
              type="radio"
              name={`${uid}-anchor`}
              value={a}
              checked={anchor === a}
              onchange={() => (anchor = a)}
              aria-label={t(`editor.resize.anchor_${a}`)}
              data-testid={`resize-anchor-${a}`}
            />
            <span aria-hidden="true">{anchor === a ? '■' : '□'}</span>
          </label>
        {/each}
      </div>
      <p class="small muted">{t('editor.resize.anchor_hint')}</p>
    </fieldset>
    {#if !valid}
      <p class="alert alert-error small" role="alert">
        {t('editor.resize.invalid', { min: MAP_SIDE_MIN, max: MAP_SIDE_MAX })}
      </p>
    {:else if changed && losing}
      <div class="alert alert-warning small" role="status" data-testid="resize-lost">
        <p>
          {t('editor.resize.lost', {
            objects: lost.objects,
            tokens: lost.tokens,
            tiles: lost.tiles,
          })}
        </p>
        <label class="check">
          <input type="checkbox" bind:checked={confirmed} data-testid="resize-confirm" />
          {t('editor.resize.confirm')}
        </label>
      </div>
    {/if}
    <p class="small muted">{t('editor.resize.snapshot_hint')}</p>
    {#if error !== null}<p class="alert alert-error" role="alert">{error}</p>{/if}
    <div class="row actions">
      <button type="button" class="button" onclick={() => (ui.resizeOpen = false)}>
        {t('common.cancel')}
      </button>
      <Button
        type="submit"
        variant="primary"
        loading={busy}
        disabled={!changed || (losing && !confirmed)}
        data-testid="resize-submit"
      >
        {t('editor.resize.apply')}
      </Button>
    </div>
  </form>
</Modal>

<style>
  .resize {
    display: grid;
    gap: var(--space-3);
    min-width: min(24rem, 90vw);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: end;
  }
  .actions {
    justify-content: flex-end;
  }
  label {
    display: grid;
    gap: var(--space-1);
  }
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .anchors {
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 2.5rem);
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }
  .cell {
    position: relative;
    display: grid;
    place-items: center;
    height: 2.5rem;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .cell.on {
    border-color: var(--color-accent, currentColor);
  }
  .cell input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .cell:focus-within {
    outline: 2px solid var(--color-accent, currentColor);
  }
</style>
