# lib/procgen — generation from the editor UI

Main-thread side of procedural generation: worker client, panels and application of results. Generators themselves are in `src/procgen/`.

## Key files

- `gen-client.ts`, `gen-protocol.ts`: client of `workers/gen.worker.ts` (cancellable).
- `generate-panel.svelte.ts`, `generate-params.ts`, `preview.ts`: generation panel and live preview.
- `apply.ts`, `handoff.ts`, `handoff-apply.ts`: apply a result to a map, or hand it over to the editor through session storage.
- `texture-panel.svelte.ts`, `pack.ts`, `zone-from-map.ts`, `seed.ts`.

## Invariants

- Same seed, params and generator version give the same result.
- Applying a result goes through editor commands (undoable).

## Tests

`tests/procgen/`, `tests/procgen-ui/`. E2E: `procgen.spec.ts`. Doc: `docs/procgen.md`.
