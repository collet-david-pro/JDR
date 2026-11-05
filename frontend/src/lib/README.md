# lib — front-end logic

Framework-light logic shared by the pages: API client, forms, validation, i18n, theme, boot.
Subfolders hold one feature each (see their own README).

## Key files

- `api.ts`: `ApiClient` (JSON, CSRF header, timeout, retries) and `ApiError`.
- `boot.ts`: reads the boot config injected by the server in the `jdr-boot` element.
- `services.ts`: singletons (`boot`, `api`, `router`, `auth`) registered once by `main.ts`.
- `translator.ts`, `i18n.ts`: `Translate` function over `i18n/fr.json`.
- `validation.ts`, `form.svelte.ts`, `auth-forms.ts`, `settings-form.ts`: form checks that return i18n keys.
- `guard.ts`: route access decisions (login, role, maintenance).
- `markdown-safe.ts`: Markdown parser that never produces raw HTML.
- `admin-*.ts`: models of the admin pages (backup, update, integrity, users, base pack).

## Invariants

- No `{@html}` and no raw HTML from Markdown: parse to a block tree, render in components.
- User-facing text goes through `Translate` with keys from `i18n/fr.json`; never hard-code French.
- Files named `*.svelte.ts` use runes and are the only ones with reactive state.
- Logic stays testable without DOM: inject `fetch`, timers and storage.

## Tests

`frontend/tests/*.test.ts` (api, boot, guard, forms, markdown-_, theme, i18n, router, upload-queue, reduce_, admin-*),
including `i18n-keys.test.ts` which checks every literal key exists in `i18n/fr.json`.
