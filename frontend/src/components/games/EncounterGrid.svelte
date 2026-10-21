<script lang="ts">
  import { tick } from 'svelte';
  import {
    gridCells,
    gridRadius,
    moveCell,
    sameCell,
    tokensAt,
    type Cell,
  } from '../../lib/games/encounter-grid';
  import { t } from '../../lib/i18n';
  import type { EncounterToken } from '../../lib/types';

  /**
   * Clickable grid of relative positions (origin at the centre). Keyboard: arrow keys move
   * the focus (Home/End, Ctrl+Home/End), Enter or Space activates the cell. The numeric
   * dx/dy inputs of the composition list are the other alternative.
   */
  interface Props {
    placements: readonly EncounterToken[];
    names: ReadonlyMap<string, string>;
    selectedId: string | null;
    onactivate: (cell: Cell) => void;
  }

  let { placements, names, selectedId, onactivate }: Props = $props();

  const uid = $props.id();
  const radius = $derived(gridRadius(placements));
  const rows = $derived(gridCells(radius));
  let focus = $state<Cell>({ dx: 0, dy: 0 });
  const focused = $derived({
    dx: Math.max(-radius, Math.min(radius, focus.dx)),
    dy: Math.max(-radius, Math.min(radius, focus.dy)),
  });

  const cellId = (cell: Cell): string => `${uid}-c${cell.dx}_${cell.dy}`;

  function label(cell: Cell): string {
    const ids = tokensAt(placements, cell);
    const position =
      cell.dx === 0 && cell.dy === 0
        ? t('games.encounters.grid.origin')
        : t('games.encounters.grid.cell', { dx: cell.dx, dy: cell.dy });
    if (ids.length === 0) return t('games.encounters.grid.empty_cell', { position });
    return t('games.encounters.grid.filled_cell', {
      position,
      tokens: ids.map((id) => names.get(id) ?? '?').join(', '),
    });
  }

  function initials(cell: Cell): string {
    const ids = tokensAt(placements, cell);
    if (ids.length === 0) return '';
    const first = [...(names.get(ids[0] ?? '') ?? '?')].slice(0, 2).join('');
    return ids.length > 1 ? `${first}+${ids.length - 1}` : first;
  }

  async function keydown(event: KeyboardEvent): Promise<void> {
    const next = moveCell(focused, event.key, radius, event.ctrlKey || event.metaKey);
    if (next === null) return;
    event.preventDefault();
    focus = next;
    await tick();
    document.getElementById(cellId(next))?.focus();
  }
</script>

<div
  class="grid"
  role="grid"
  aria-label={t('games.encounters.grid.label')}
  style:--size={2 * radius + 1}
>
  {#each rows as row (row[0]?.dy)}
    <div role="row" class="grid-row">
      {#each row as cell (cell.dx)}
        {@const ids = tokensAt(placements, cell)}
        <div role="gridcell">
          <button
            type="button"
            id={cellId(cell)}
            class="cell"
            class:origin={cell.dx === 0 && cell.dy === 0}
            class:filled={ids.length > 0}
            class:selected={selectedId !== null && ids.includes(selectedId)}
            tabindex={sameCell(cell, focused) ? 0 : -1}
            aria-label={label(cell)}
            onfocus={() => (focus = cell)}
            onkeydown={keydown}
            onclick={() => {
              focus = cell;
              onactivate(cell);
            }}
          >
            <span aria-hidden="true">{initials(cell)}</span>
          </button>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    gap: 1px;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    padding: 1px;
    background: var(--color-border);
    border-radius: var(--radius-sm);
  }
  .grid-row {
    display: grid;
    grid-template-columns: repeat(var(--size), 2.25rem);
    gap: 1px;
  }
  .cell {
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: 0;
    background: var(--color-surface-raised);
    color: var(--color-text);
    font-size: var(--font-size-xs);
    cursor: pointer;
    overflow: hidden;
  }
  .cell:hover {
    background: var(--color-surface-sunken);
  }
  .cell.origin {
    box-shadow: inset 0 0 0 2px var(--color-border-strong);
  }
  .cell.filled {
    background: var(--color-primary-soft);
    font-weight: var(--font-weight-medium);
  }
  .cell.selected {
    background: var(--color-primary);
    color: var(--color-on-primary);
  }
  .cell:focus-visible {
    position: relative;
    z-index: 1;
  }
</style>
