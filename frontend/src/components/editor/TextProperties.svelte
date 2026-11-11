<script lang="ts">
  import type { MapObject } from '../../editor/contracts';
  import {
    TEXT_FONTS,
    TEXT_MAX,
    TEXT_SIZE_MAX,
    TEXT_SIZE_MIN,
    isTextObject,
    type TextFont,
    type TextObject,
    type TextProps,
  } from '../../editor/contracts-text';
  import { textFontLabel } from '../../editor/ui/labels';
  import { common } from '../../editor/ui/properties';
  import { objectTypeLabel } from '../../editor/ui/scene-labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Properties of the selected text objects (lot l17): content, size, colour, font, rotation. */
  interface Props {
    session: EditorSession;
    objects: readonly MapObject[];
  }

  let { session, objects }: Props = $props();
  const texts = $derived(objects.filter(isTextObject));
  const prop = <K extends keyof TextProps>(k: K) => common(texts, (o) => o.props[k]);
  const set = (change: Partial<TextProps>) =>
    session.scene.patchObjects(
      texts.map((o) => o.uid),
      (o) => (isTextObject(o) ? { props: { ...(o as TextObject).props, ...change } } : null),
    );
  const show = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
  const fonts: readonly TextFont[] = TEXT_FONTS;
  let contentInput = $state<HTMLInputElement | null>(null);

  // Double click on a label in the select tool: focus its content field.
  $effect(() => {
    const target = session.ui.textEditUid;
    if (target === null || contentInput === null) return;
    if (texts.length === 1 && texts[0]?.uid === target) {
      contentInput.focus();
      contentInput.select();
    }
    session.ui.textEditUid = null;
  });

  function content(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value.trim();
    if (value !== '') set({ text: value });
  }
  function number(event: Event, min: number, max: number): number | null {
    const v = Number((event.currentTarget as HTMLInputElement).value);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
  }
</script>

{#if texts.length > 0}
  <fieldset class="grid" data-testid="properties-text">
    <legend>{objectTypeLabel('text')}</legend>
    <label>
      <span>{t('editor.text.content')}</span>
      <input
        bind:this={contentInput}
        type="text"
        maxlength={TEXT_MAX}
        value={show(prop('text'))}
        onchange={content}
        data-testid="text-edit-content"
      />
    </label>
    <label>
      <span>{t('editor.text.size')}</span>
      <input
        type="number"
        min={TEXT_SIZE_MIN}
        max={TEXT_SIZE_MAX}
        step="0.1"
        value={show(prop('size'))}
        onchange={(e) => {
          const v = number(e, TEXT_SIZE_MIN, TEXT_SIZE_MAX);
          if (v !== null) set({ size: v });
        }}
      />
    </label>
    <label>
      <span>{t('editor.text.color')}</span>
      <input
        type="color"
        value={show(prop('color')) || '#222222'}
        onchange={(e) => set({ color: (e.currentTarget as HTMLInputElement).value })}
      />
    </label>
    <label>
      <span>{t('editor.text.font')}</span>
      <select
        value={show(prop('font'))}
        onchange={(e) => set({ font: (e.currentTarget as HTMLSelectElement).value as TextFont })}
      >
        {#each fonts as f (f)}<option value={f}>{textFontLabel(f)}</option>{/each}
      </select>
    </label>
    <label>
      <span>{t('editor.text.rotation')}</span>
      <input
        type="number"
        min="-360"
        max="360"
        step="5"
        value={show(prop('rotation'))}
        onchange={(e) => {
          const v = number(e, -360, 360);
          if (v !== null) set({ rotation: v });
        }}
      />
    </label>
  </fieldset>
{/if}

<style>
  .grid {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  legend {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  label {
    display: grid;
    gap: var(--space-1);
  }
</style>
