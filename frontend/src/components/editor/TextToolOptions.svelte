<script lang="ts">
  import type { ObjectLayerId } from '../../editor/contracts';
  import {
    TEXT_FONTS,
    TEXT_MAX,
    TEXT_SIZE_MAX,
    TEXT_SIZE_MIN,
    type TextFont,
  } from '../../editor/contracts-text';
  import { layerLabel, textFontLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Options of the text tool (lot l17): content, size, colour, font, rotation, layer. */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const LAYERS: ObjectLayerId[] = ['labels', 'props', 'walls', 'lighting', 'gm'];
  const fonts: readonly TextFont[] = TEXT_FONTS;
</script>

<div class="text-options" data-testid="text-tool-options">
  <label class="field">
    <span>{t('editor.text.content')}</span>
    <input
      type="text"
      maxlength={TEXT_MAX}
      bind:value={ui.textContent}
      data-testid="text-content"
    />
  </label>
  <label class="field">
    <span>{t('editor.text.size')}</span>
    <input
      type="number"
      min={TEXT_SIZE_MIN}
      max={TEXT_SIZE_MAX}
      step="0.1"
      bind:value={ui.textSize}
      data-testid="text-size"
    />
  </label>
  <label class="field">
    <span>{t('editor.text.color')}</span>
    <input type="color" bind:value={ui.textColor} data-testid="text-color" />
  </label>
  <label class="field">
    <span>{t('editor.text.font')}</span>
    <select bind:value={ui.textFont} data-testid="text-font">
      {#each fonts as f (f)}<option value={f}>{textFontLabel(f)}</option>{/each}
    </select>
  </label>
  <label class="field">
    <span>{t('editor.text.rotation')}</span>
    <input
      type="number"
      min="-360"
      max="360"
      step="5"
      bind:value={ui.textRotation}
      data-testid="text-rotation"
    />
  </label>
  <label class="field">
    <span>{t('editor.properties.layer')}</span>
    <select bind:value={ui.textLayer}>
      {#each LAYERS as l (l)}<option value={l}>{layerLabel(l)}</option>{/each}
    </select>
  </label>
  <p class="small muted">{t('editor.text.tool_hint')}</p>
</div>

<style>
  .text-options {
    display: grid;
    gap: var(--space-2);
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
</style>
