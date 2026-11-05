# engine — scene rendering

Pixi-based renderer used by the editor, the session view and the display. Loaded lazily (`load.ts`) to keep the main bundle small.

## Key files

- `SceneEngine.ts`: main class (camera, chunks, layers, overlays). `input.ts`, `camera.ts`: pointer and view.
- `tilemap.ts`, `chunk-plan.ts`, `cache-lod.ts`, `textures.ts`: tile chunks and caching.
- `scene/`: objects, tokens, fog, lighting, ambient renderers and view rules (`view-rules.ts`).
- `support.ts`, `errors.ts`: GPU detection and `EngineUnsupportedError`.

## Invariants

- The engine only draws what it is given: visibility rules for players are applied upstream.
- Only `pixi.ts` imports Pixi, so pure logic stays testable without WebGL.

## Tests

`tests/engine/`.
