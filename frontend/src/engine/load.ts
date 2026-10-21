/**
 * Lazy entry point of the scene engine. Import this module statically: it pulls Pixi with a
 * dynamic import() only when an engine is created, so Pixi stays out of the initial bundle
 * (projet.md 13.1, 22).
 *
 *   try {
 *     const engine = await loadSceneEngine(host);
 *     engine.setMap(view);
 *   } catch (e) {
 *     if (isEngineUnsupportedError(e)) showIncompatibilityPage(t(e.messageKey));
 *   }
 */

import type { SceneEngine, SceneEngineOptions } from './SceneEngine';

export type { SceneEngine, SceneEngineOptions, SceneEngineStats } from './SceneEngine';
export { EngineUnsupportedError, isEngineUnsupportedError } from './errors';

export async function loadSceneEngine(
  host: HTMLElement,
  options?: SceneEngineOptions,
): Promise<SceneEngine> {
  const module = await import('./SceneEngine');
  return module.SceneEngine.create(host, options);
}
