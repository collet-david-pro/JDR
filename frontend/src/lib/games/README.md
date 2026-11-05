# lib/games — games, tokens and encounters

Clients, models and form logic of the game pages (maps, tokens, players, sessions, settings).

## Key files

- `games-client.ts`: `GamesClient` endpoints. `service.ts`: services bundle.
- `game-page.svelte.ts`: `GamePageModel` of the game page. `dashboard.svelte.ts`: list on the dashboard.
- `game-form.ts`, `token-form.ts`: drafts and validation (limits mirror the server).
- `encounter-grid.ts`: token placement in an encounter (cells and offsets).
- `roles.ts`, `labels.ts`, `optimistic.ts`, `units.ts`.

## Invariants

- Roles (`GameRole`) decide which tabs and actions exist; the server enforces them again.
- Form limits (name length, cell size, units per cell) must match the PHP validators.

## Tests

`tests/games-client.test.ts`, `games-forms.test.ts`, `games-models.test.ts`, `games-roles.test.ts`, `encounter-grid.test.ts`. E2E: `games.spec.ts`.
