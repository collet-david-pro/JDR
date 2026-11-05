# e2e — Playwright end-to-end tests

Real browsers against the built front end and the PHP site. Config: `playwright.config.ts`.

## Layout
- `tests/*.spec.ts`: one spec per area (auth, admin, games, maps, editor, sessions, display, help, a11y, update, install...).
- `helpers/`: app/session/display setup, database access, install and update package builders, buffering proxy (SSE tests).
- `shots/`: help screenshot script (`help-shots.ts`).

## Servers
`dev/e2e-serve.sh` starts isolated sites (ports 8090 main, 8091 install without JavaScript, 8093 update) with blank databases, wiped at the end. One worker, because tests share server-wide state.

## Run
```
cd frontend && npm run build
cd e2e && npm ci && npx playwright install chromium firefox webkit
E2E_BROWSERS=chromium npx playwright test tests/help.spec.ts
```
Database settings: `E2E_DB_HOST/PORT/USER/PASS`. Use the repository lock convention for builds and E2E (see `AGENTS.md`).

## Invariants
- Specs must not depend on each other's data except through `setup`.
- Keep accessibility checks (`a11y.spec.ts`) green when adding pages.
