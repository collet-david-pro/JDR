import type { SessionRun } from '../session-run.svelte';
import type { SessionAction } from '../types';
import type { Selection } from './console-input';

/** What every console panel receives. */
export interface PanelProps {
  readonly run: SessionRun;
  readonly gameId: string;
  /** Sends session actions as the GM; resolves true when they were applied (errors are shown). */
  readonly send: (actions: SessionAction[]) => Promise<boolean>;
  readonly selection: Selection | null;
}
