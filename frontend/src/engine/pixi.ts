/**
 * Single entry point to Pixi for the engine modules.
 *
 * CSP (projet.md 6.4, 3.1 point 12): the site policy has no 'unsafe-eval'. Pixi 8 generates
 * some uniform/UBO upload and particle update functions with `new Function`; the side-effect
 * module `pixi.js/unsafe-eval` (checked in pixi.js 8.22.0: lib/unsafe-eval/init.mjs) replaces
 * them with eval-free polyfills and disables the renderer's eval check. It must run before
 * any renderer is created, hence this module: every engine file imports Pixi from here.
 *
 * Images: decoded on the main thread with fetch + createImageBitmap (asynchronous, off the
 * main thread in practice). Pixi's worker path is disabled: before using it, Pixi checks
 * ImageBitmap support by fetching a `data:` URL inside a worker, which `connect-src 'self'`
 * refuses (CSP violation reported in Firefox and WebKit, P4a lot C). Canvas text uses a 2D
 * canvas (no eval). Never add 'unsafe-eval' (nor `data:` in connect-src) to the CSP.
 *
 * This module (and everything importing it) must only be loaded with a dynamic import()
 * (see ./load.ts) so that Pixi stays out of the initial bundle (projet.md 13.1, 22).
 */
import 'pixi.js/unsafe-eval';
import { loadTextures } from 'pixi.js';

if (loadTextures.config !== undefined) loadTextures.config.preferWorkers = false;

export {
  Assets,
  autoDetectRenderer,
  Container,
  Graphics,
  Matrix,
  Particle,
  ParticleContainer,
  Rectangle,
  RenderTexture,
  Sprite,
  Text,
  Texture,
  Ticker,
  CanvasSource,
} from 'pixi.js';
export type { Renderer } from 'pixi.js';
