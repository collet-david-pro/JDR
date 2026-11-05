# lib/assets — asset library client

Upload, reduction and listing of images and files in the user library and the base pack.

## Key files

- `assets-client.ts`: `AssetsClient`, endpoints for upload, list, delete, jobs.
- `reduce-plan.ts`, `reduce.ts`: decide and perform client-side image reduction before upload (`planUpload`, `prepareFile`).
- `upload-queue.svelte.ts`: `UploadQueue` with concurrency, progress, retry.
- `xhr-upload.ts`: XMLHttpRequest upload with progress.
- `jobs.ts`: polling of background (sliced) jobs until a terminal state.
- `library.svelte.ts`: `LibraryModel` of the library page. `grid-nav.ts`: keyboard navigation of the grid.

## Invariants

- Limits come from the server (`AssetLimits`); the client plan only avoids useless uploads.
- Rejected files never reach the network (`UploadRejected`).
- Terminal job statuses: `done`, `failed`, `cancelled`.

## Tests

`tests/assets-client.test.ts`, `reduce-plan.test.ts`, `reduce.test.ts`, `upload-queue.test.ts`, `jobs.test.ts`, `grid-nav.test.ts`, `image-info.test.ts`.
E2E: `e2e/tests/library.spec.ts`.
