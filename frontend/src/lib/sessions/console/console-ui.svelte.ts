/**
 * UI flags of the GM console shared with the command palette (P9c2): the shown panel tab and
 * the dialogs that used to live in the local state of the header or of a panel. The panels
 * read them; a palette command sets them (after switching to the tab that mounts the dialog).
 */
export const CONSOLE_PANELS = [
  'players',
  'tokens',
  'reveal',
  'ambiance',
  'notes',
  'maps',
  'displays',
] as const;
export type ConsolePanelId = (typeof CONSOLE_PANELS)[number];

export class ConsoleUi {
  tab = $state<ConsolePanelId>('players');
  /** "End the session" confirmation (ConsoleHeader). */
  endOpen = $state(false);
  /** "New code" confirmation (ConsoleHeader). */
  regenOpen = $state(false);
  /** Pause screen dialog (ConsoleHeader). */
  pauseOpen = $state(false);
  /** Map the Maps panel must propose to switch to (opens its confirmation). */
  mapRequest = $state<string | null>(null);
  /** Uid of the passage the Passages panel must offer to take (opens its dialog). */
  passageRequest = $state<string | null>(null);
  /** Uid of the note the Notes list must offer to share (opens its dialog). */
  shareRequest = $state<string | null>(null);

  reset(): void {
    this.tab = 'players';
    this.endOpen = false;
    this.regenOpen = false;
    this.pauseOpen = false;
    this.mapRequest = null;
    this.passageRequest = null;
    this.shareRequest = null;
  }
}

/** The console is a single page: one shared instance. */
export const consoleUi = new ConsoleUi();
