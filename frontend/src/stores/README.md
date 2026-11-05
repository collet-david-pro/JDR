# stores — global reactive stores

Singletons using Svelte runes: `auth.svelte.ts` (current user), `app.svelte.ts` (application status), `prefs.svelte.ts` (user preferences), `toasts.svelte.ts` (notifications).

## Invariants

- Keep stores small; feature state belongs in the feature model under `lib/`.
- Never persist secrets in preferences.

## Tests

`tests/auth-store.test.ts`, `tests/theme.test.ts`.
