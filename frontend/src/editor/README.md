# editor — map editor core

Document model, tools, undo history and sync of the map editor. Rendering is in `src/engine/`, panels in `src/components/editor/`.

## Layout

- `EditorController.ts`: facade tying document, history, sync and tools together. `state.svelte.ts`: UI state.
- `model/`: `MapDocument`, `FloorSlot`, `SceneState`, `NotesState`; `ops.ts` defines operations, `commands.ts` builds undoable commands.
- `tools/`: one file per tool (`paint`, `fill`, `wall`, `door`, `light`, `token`, `select`...), registered in `index.ts`.
- `history/`: `History` (undo/redo, merge by key). `sync/`: `MapSync`, `OpsQueue`, chunk loading, save status.
- `ui/`: view models (floors, notes, properties, scene controls, command palette). `thumbnail/`, `versions/`, `util/`.
- `contracts*.ts`: interfaces shared with the engine.

## Invariants

- Every change is an operation applied through a `Command`; never mutate the document directly.
- Operations are batched (max ops and cells per request, see `sync/batch.ts`) and persisted locally before sending.
- Limits (cells per side, floors, objects) mirror `formats/map-document.ts` and the PHP validators.
- Tools receive a `ToolContext`; they do not touch Svelte components.

## Tests

`tests/editor/`, `tests/formats/`. E2E: `editor.spec.ts`, `floors.spec.ts`, `notes-editor.spec.ts`, `versions.spec.ts`, `palette.spec.ts`.
Recipe for a new tool: `docs/dev/recettes.md`.
