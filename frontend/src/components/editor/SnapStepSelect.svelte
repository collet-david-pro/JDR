<script lang="ts">
  import { SNAP_STEPS, snapStepOf } from '../../editor/model/scene-values';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Snapping step of walls, doors, windows and secret passages (a setting of the map). */
  interface Props {
    session: EditorSession;
    testid?: string;
  }

  let { session, testid = 'snap-step' }: Props = $props();
  const current = $derived(snapStepOf(session.ui.ambient.snap_step));
  const label = (step: number): string => {
    switch (step) {
      case 1:
        return t('editor.snap.step_1');
      case 0.25:
        return t('editor.snap.step_1_4');
      case 0.125:
        return t('editor.snap.step_1_8');
      default:
        return t('editor.snap.step_1_2');
    }
  };
</script>

<label class="field">
  <span>{t('editor.snap.title')}</span>
  <select
    class="select"
    value={String(current)}
    data-testid={testid}
    onchange={(e) =>
      session.scene.setAmbient({ snap_step: Number(e.currentTarget.value) }, 'ambient:snap')}
  >
    {#each SNAP_STEPS as step (step)}
      <option value={String(step)}>{label(step)}</option>
    {/each}
  </select>
</label>

<style>
  .field {
    display: grid;
    gap: var(--space-1);
  }
</style>
