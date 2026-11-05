# procgen — procedural generators

Pure, deterministic generators (dungeon, cave, outdoor, village), textures and sprites. Run in `workers/gen.worker.ts`.

## Key files

- `registry.ts`, `generators.ts`: registration and metadata. Each generator folder has `index.ts` and `params.ts`.
- `prng.ts` (`Rng`), `noise.ts`, `grid.ts`, `geometry.ts`: shared primitives.
- `populate.ts`, `populate-rules.ts`: props and lights. `bind.ts`: result to editor operations.
- `textures/`, `sprites/`, `themes/`, `canonical.ts` (fingerprint).

## Invariants

- No `Math.random`, no clock: use `Rng`. Same seed, params and version give the same output.
- Change an algorithm: bump its `*_VERSION`.

## Tests

`tests/procgen/`. Doc: `docs/procgen.md`.
