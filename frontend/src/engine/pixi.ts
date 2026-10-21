/**
 * Single entry point to Pixi for the engine modules.
 *
 * CSP (projet.md 6.4, 3.1 point 12): the site policy has no 'unsafe-eval'. Pixi 8 generates
 * some uniform/UBO upload and particle update functions with `new Function`; the side-effect
 * module `pixi.js/unsafe-eval` (checked in pixi.js 8.22.0: lib/unsafe-eval/init.mjs) replaces
 * them with eval-free polyfills and disables the renderer's eval check. It must run before
 * any renderer is created, hence this module: every engine file imports Pixi from here.
 *
 * Workers: the texture loader decodes images in a worker created from a `blob:` URL
 * (lib/_virtual/loadImageBitmap.worker.mjs), allowed by `worker-src 'self' blob:`; the image
 * fetch inside the worker is same-origin (`connect-src 'self'`). Canvas text uses a 2D
 * canvas (no eval). Never add 'unsafe-eval' to the CSP.
 *
 * This module (and everything importing it) must only be loaded with a dynamic import()
 * (see ./load.ts) so that Pixi stays out of the initial bundle (projet.md 13.1, 22).
 */
import 'pixi.js/unsafe-eval';

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
