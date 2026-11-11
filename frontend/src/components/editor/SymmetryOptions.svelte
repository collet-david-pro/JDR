<script lang="ts">
  import { REPEAT_MAX, REPEAT_STEP_MAX, SYMMETRY_AXES } from '../../editor/tools/symmetry';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Mirror and repeat options of the tile brush and eraser. */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const axisLabel = (a: (typeof SYMMETRY_AXES)[number]): string => t(`editor.symmetry.axes.${a}`);
</script>

<fieldset data-testid="symmetry-options">
  <legend>{t('editor.symmetry.title')}</legend>
  {#each SYMMETRY_AXES as axis (axis)}
    <label class="choice">
      <input type="radio" name={`${uid}-axes`} value={axis} bind:group={ui.symmetryAxes} />
      {axisLabel(axis)}
    </label>
  {/each}
  {#if ui.symmetryAxes !== 'none'}
    <label class="choice">
      <input type="checkbox" bind:checked={ui.symmetryCustom} />
      {t('editor.symmetry.custom')}
    </label>
    {#if ui.symmetryCustom}
      <label class="num">
        {t('editor.symmetry.axis_x')}
        <input type="number" step="0.5" min="0" bind:value={ui.symmetryAxisX} />
      </label>
      <label class="num">
        {t('editor.symmetry.axis_y')}
        <input type="number" step="0.5" min="0" bind:value={ui.symmetryAxisY} />
      </label>
    {:else}
      <p class="small muted">{t('editor.symmetry.center_hint')}</p>
    {/if}
  {/if}
  <label class="num">
    {t('editor.symmetry.repeat_count')}
    <input type="number" min="0" max={REPEAT_MAX} step="1" bind:value={ui.repeatCount} />
  </label>
  {#if ui.repeatCount > 0}
    <label class="num">
      {t('editor.symmetry.repeat_step_x')}
      <input
        type="number"
        min={-REPEAT_STEP_MAX}
        max={REPEAT_STEP_MAX}
        step="1"
        bind:value={ui.repeatStepX}
      />
    </label>
    <label class="num">
      {t('editor.symmetry.repeat_step_y')}
      <input
        type="number"
        min={-REPEAT_STEP_MAX}
        max={REPEAT_STEP_MAX}
        step="1"
        bind:value={ui.repeatStepY}
      />
    </label>
  {/if}
</fieldset>

<style>
  .choice {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  fieldset {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    color: var(--color-text-muted);
  }
  .num {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
  }
  .num input {
    width: 5rem;
  }
  p {
    margin: 0;
  }
</style>
