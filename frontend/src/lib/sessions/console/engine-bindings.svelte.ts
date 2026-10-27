/**
 * Effects tying the console engine to the projection screens (P7e). Call during the init of the
 * console component (they create `$effect`s).
 *  - table viewers (D5): in GM view, the viewers of the table make the engine compute the
 *    visibility (the GM rendering does not change) and a PlayerExplorer sends the `fog.reveal`;
 *  - "Broadcast my camera" (D10).
 */
import { untrack } from 'svelte';
import type { SceneEngine } from '../../../engine/load';
import type { SessionAction } from '../types';
import type { SessionRun } from '../session-run.svelte';
import { PlayerExplorer } from '../play/exploration';
import { startCameraBroadcast } from './camera-broadcast';

export interface EngineBindingsOptions {
  readonly engine: () => SceneEngine | null;
  readonly run: SessionRun;
  /** Uids of the table viewers (empty: nothing is explored). */
  readonly viewers: () => readonly string[];
  readonly broadcasting: () => boolean;
  readonly send: (actions: SessionAction[]) => Promise<boolean>;
}

export const gmView = (viewers: readonly string[]) =>
  ({ mode: 'gm', viewers: [...viewers], lighting: true, fog: true, shadows: true }) as const;

export function bindEngineToScreens(o: EngineBindingsOptions): void {
  // Viewers follow the assignments, the tokens and the floor.
  $effect(() => {
    const viewers = o.viewers();
    const engine = o.engine();
    if (engine === null || untrack(() => o.run.scene) === null) return;
    engine.setView(gmView(viewers));
  });

  // Exploration for the table: the GM has no range limit.
  $effect(() => {
    const engine = o.engine();
    const scene = o.run.scene;
    if (engine === null || scene === null) return;
    return untrack(() => {
      const explorer = new PlayerExplorer({
        scene,
        active: () => o.viewers().length > 0,
        send: (actions) => void o.send(actions),
      });
      const off = engine.onVisibility((visible) => explorer.push(visible));
      return () => {
        off();
        explorer.dispose();
      };
    });
  });

  // "Broadcast my camera".
  $effect(() => {
    const engine = o.engine();
    if (!o.broadcasting() || engine === null || o.run.scene === null) return;
    return untrack(() =>
      startCameraBroadcast(
        engine,
        () => o.run.scene?.floor ?? null,
        (actions) => void o.send(actions),
      ),
    );
  });
}
