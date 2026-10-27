import type { ViewLock } from '../../displays/types';
import type { SessionRun } from '../session-run.svelte';
import type { SessionAction } from '../types';
import type { Selection } from './console-input';
import type { DisplaysModel } from './displays.svelte';

/** What every console panel receives. */
export interface PanelProps {
  readonly run: SessionRun;
  readonly gameId: string;
  /** Sends session actions as the GM; resolves true when they were applied (errors are shown). */
  readonly send: (actions: SessionAction[]) => Promise<boolean>;
  readonly selection: Selection | null;
  /** Projection screens of the session (panel "Screens" and tab indicator). */
  readonly displays: DisplaysModel;
  /** The engine camera and the current floor, as a view lock; null while there is no scene. */
  readonly currentView: () => ViewLock | null;
}
