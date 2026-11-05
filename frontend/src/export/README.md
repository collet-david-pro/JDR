# export — PNG and print export of maps

Renders a map area to a PNG (streamed, in a worker) or a print layout.

## Key files

- `form.ts`, `dimensions.ts`, `print-layout.ts`: options and limits.
- `job.ts`, `run-export.ts`, `protocol.ts`: plan, run and worker protocol (`workers/export.worker.ts`).
- `scene-render.ts`, `scene-snapshot.ts`, `renderer.ts`, `images.ts`, `output.ts`.

## Invariants

- Output size is bounded by `EXPORT_LIMITS`; the worker never has more than `MAX_UNACKED` messages in flight.

## Tests

`tests/export/`. E2E: `export-png.spec.ts`.
