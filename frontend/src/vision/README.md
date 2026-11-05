# vision — visibility and fog computation

Vision, light and exploration computed in a worker (`workers/vision.worker.ts`), with an in-thread fallback.

## Key files

- `core.ts`: `VisionCoreImpl`. `visibility.ts`, `occluders.ts`, `spatial-grid.ts`: geometry.
- `fog-raster.ts`, `ambient.ts`, `flicker.ts`: fog and light output.
- `service.ts`, `worker-host.ts`, `protocol.ts`: main-thread service and worker messages.

## Invariants

- Display aid for already-authorized data; the server remains the authority on what a player can know.

## Tests

`tests/vision/`. E2E: `vision.spec.ts`.
