# lib/persistence — IndexedDB storage

Local persistence for the editor: chunk cache and pending operation batches, so a reload does not lose unsent edits.

## Key files

- `idb.ts`: opens the database (`DB_VERSION`, `STORES`).
- `map-stores.ts`: chunk cache store and pending-batch store; cells are packed in `Uint16Array`; `MemoryChunkCacheStore` is the fallback.

## Invariants

- Always degrade to memory when IndexedDB is unavailable (private mode, tests).
- Bump `DB_VERSION` and write an upgrade path when changing a store shape.

## Tests

`tests/editor/` (sync and persistence cases), `tests/maps/`.
