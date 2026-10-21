/**
 * Errors raised by the scene engine. This module has no Pixi dependency, so the editor page
 * can import it statically and show the incompatibility page (projet.md section 22) without
 * loading the renderer chunk.
 */

/**
 * - `no-gpu`: neither WebGPU nor WebGL2 is available (old browser, GPU blocklisted or
 *   hardware acceleration disabled).
 * - `init-failed`: an API was reported available but the renderer could not start
 *   (lost context, driver error...).
 */
export type EngineUnsupportedReason = 'no-gpu' | 'init-failed';

export class EngineUnsupportedError extends Error {
  override readonly name = 'EngineUnsupportedError';
  /** i18n key of the user-facing explanation (i18n/_pending/engine.json until merged). */
  readonly messageKey = 'engine.unsupported.text';

  constructor(
    readonly reason: EngineUnsupportedReason,
    options?: { cause?: unknown },
  ) {
    super(
      reason === 'no-gpu'
        ? 'Neither WebGPU nor WebGL2 is available in this browser'
        : 'The GPU renderer could not be initialised',
      options,
    );
  }
}

export function isEngineUnsupportedError(error: unknown): error is EngineUnsupportedError {
  return error instanceof EngineUnsupportedError;
}
