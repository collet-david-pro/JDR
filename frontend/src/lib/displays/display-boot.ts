/**
 * Builds the screen's API and its DisplayRun together (the 401 callback of the API must reach
 * the run): what the `/display` page calls once.
 */
import type { ChunkKey } from '../../editor/contracts';
import { DisplayRun } from './display-run.svelte';
import { createDisplayApi, type DisplayApi, type DisplayApiOptions } from './display-api';

export interface DisplayBootOptions extends Omit<DisplayApiOptions, 'onUnpaired'> {
  readonly visible?: () => readonly ChunkKey[] | undefined;
  readonly onProblem?: (error: unknown) => void;
}

export function createDisplayRun(o: DisplayBootOptions): { run: DisplayRun; api: DisplayApi } {
  let run: DisplayRun | null = null;
  const api = createDisplayApi({ ...o, onUnpaired: () => run?.markUnpaired() });
  run = new DisplayRun({
    device: api.device,
    sessions: api.sessions,
    tiles: api.maps,
    sync: api.sync,
    ...(o.visible === undefined ? {} : { visible: o.visible }),
    ...(o.onProblem === undefined ? {} : { onProblem: o.onProblem }),
  });
  return { run, api };
}
