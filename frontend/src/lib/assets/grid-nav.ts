/**
 * Keyboard navigation of a thumbnail grid (roving tabindex): arrows move by one item or
 * one row, Home / End go to the first / last item (Ctrl not required), PageUp / PageDown
 * move by `pageRows` rows. Returns the new index, or null when the key is not handled.
 */
export function gridNavigate(
  index: number,
  key: string,
  count: number,
  columns: number,
  pageRows = 3,
): number | null {
  if (count <= 0) return null;
  const cols = Math.max(1, Math.floor(columns));
  const last = count - 1;
  const clamp = (value: number): number => Math.min(last, Math.max(0, value));
  switch (key) {
    case 'ArrowRight':
      return clamp(index + 1);
    case 'ArrowLeft':
      return clamp(index - 1);
    case 'ArrowDown':
      return index + cols <= last ? index + cols : index;
    case 'ArrowUp':
      return index - cols >= 0 ? index - cols : index;
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'PageDown':
      return clamp(index + cols * pageRows);
    case 'PageUp':
      return clamp(index - cols * pageRows);
    default:
      return null;
  }
}

/** Number of columns of a rendered grid: items sharing the first item's top offset. */
export function countColumns(tops: readonly number[]): number {
  if (tops.length === 0) return 1;
  const first = tops[0];
  let columns = 0;
  for (const top of tops) {
    if (top !== first) break;
    columns++;
  }
  return Math.max(1, columns);
}
