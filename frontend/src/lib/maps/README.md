# lib/maps — map management (outside the editor)

Maps tab of a game: listing, folders, creation, templates, import and export of map files.

## Key files

- `maps-client.ts`: `MapsClient`. `templates.ts`: `TemplatesClient`.
- `maps-tab.svelte.ts`: `MapsTabModel`. `map-import.svelte.ts`: import dialog model.
- `map-form.ts`: draft and validation (name, folder, size). `folders.ts`: sorting and folder helpers.
- `import-labels.ts`: messages for import errors (`MapDocumentIssue`).

## Invariants

- Map size limits are the same as in `formats/map-document.ts` and the PHP side.
- Imported documents are validated by `formats/` before any request.

## Tests

`tests/maps/`. E2E: `maps.spec.ts`, `templates.spec.ts`.
