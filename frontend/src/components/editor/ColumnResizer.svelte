<script lang="ts">
  import { t } from '../../lib/i18n';
  import {
    COLUMN_LIMITS,
    clampWidth,
    keyWidth,
    maxWidth,
    type ColumnId,
  } from '../../editor/ui/column-width';

  /** Drag handle between a side column and the map (WAI-ARIA window splitter). */
  interface Props {
    id: ColumnId;
    /** Current width of the column in px. */
    width: number;
    /** Width of the other column and of the editor, to bound the map area. */
    other: number;
    container: number;
    /** +1 when dragging to the right widens the column (tools), -1 otherwise (panels). */
    sign: 1 | -1;
    label: string;
    onchange: (width: number, final: boolean) => void;
  }

  let { id, width, other, container, sign, label, onchange }: Props = $props();
  let dragging = $state(false);
  let startX = 0;
  let startW = 0;

  function down(event: PointerEvent): void {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    startW = width;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event: PointerEvent): void {
    if (!dragging) return;
    onchange(clampWidth(id, startW + (event.clientX - startX) * sign, container, other), false);
  }
  function up(): void {
    if (!dragging) return;
    dragging = false;
    onchange(width, true);
  }
  function key(event: KeyboardEvent): void {
    const next = keyWidth(id, event.key, width, container, other, sign);
    if (next === null) return;
    event.preventDefault();
    onchange(next, true);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="resizer {id}"
  class:dragging
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={width}
  aria-valuemin={COLUMN_LIMITS[id].min}
  aria-valuemax={maxWidth(id, container, other)}
  title={t('editor.columns.hint')}
  tabindex="0"
  data-testid="resizer-{id}"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
  ondblclick={() => onchange(COLUMN_LIMITS[id].def, true)}
></div>

<style>
  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 5;
    width: 8px;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
  }
  .resizer.tools {
    left: 0;
  }
  .resizer.panels {
    right: 0;
  }
  .resizer:hover,
  .resizer.dragging {
    background: color-mix(in srgb, var(--color-focus) 45%, transparent);
  }
  .resizer:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
  }
  @media (max-width: 48rem) {
    .resizer {
      display: none;
    }
  }
</style>
