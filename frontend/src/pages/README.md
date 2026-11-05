# pages — route components

One component per route, plus `admin/` and `profile/` sections. Routes are declared in `src/routes.ts` and matched by `src/router.ts`; access rules are in `lib/guard.ts`.

## Files

- Public: `Home`, `Login`, `Register`, `Forgot`, `Reset`, `Join`, `Help`, `NotFound`, `Forbidden`.
- Game: `Game`, `Library`, `Editor`, `Session`, `Display`.
- `admin/`: administration tabs. `profile/`: account sections.

## Conventions

- Pages are thin: they create or receive a model from `lib/` and compose components.
- Adding a page: component here, route in `routes.ts` (with its guard), i18n keys, and a test in `e2e/tests/`.
- API routes used by a page must exist server-side and be covered by `tests/php/Security/RouteCoverageTest.php`.

## Tests

`e2e/tests/` (one spec per area), `frontend/tests/router.test.ts`, `guard.test.ts`.
