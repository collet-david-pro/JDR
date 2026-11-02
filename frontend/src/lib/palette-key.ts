/**
 * Opening key of the command palette (Cmd on Mac, Ctrl elsewhere, K alone). Shared by the
 * editor and the GM console. The key is always taken (preventDefault), even from a text field,
 * so that the browser never opens its own search; it opens nothing while another dialog is up.
 */
import { resolveShortcut, type Platform } from '../editor/shortcuts';

export interface PaletteKeyHost {
  readonly platform: Platform;
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

function otherDialogOpen(target: unknown): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  if (typeof el?.closest === 'function' && el.closest('dialog[open], [role="dialog"]') !== null) {
    return true;
  }
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null;
}

/** Window keydown. Returns true when the event was the palette key (already prevented). */
export function handlePaletteKey(event: KeyboardEvent, host: PaletteKeyHost): boolean {
  if (resolveShortcut(event, host.platform) !== 'palette') return false;
  event.preventDefault();
  if (event.repeat) return true;
  if (host.isOpen()) host.setOpen(false);
  else if (!otherDialogOpen(event.target)) host.setOpen(true);
  return true;
}
