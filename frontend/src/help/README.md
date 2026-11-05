# help — built-in help content

Markdown files shown on the public `/aide` page. Four audiences: `joueur/`, `mj/`, `irl/`, `admin/`. Screenshots are in `img/` (WebP).

## Adding or editing a section

1. Create `<audience>/NN-name.md` (`NN` orders the section; the file starts with `# Title`).
2. The anchor is `<audience>-<name>`; link to it from the UI with `components/HelpLink.svelte` or `lib/help/links.ts`.
3. Images: `img/<name>.webp`, produced by `e2e/shots/help-shots.ts` from the real app.

## Rules

- French, plain language, task oriented. Only the restricted Markdown supported by `lib/help/markdown.ts`; no raw HTML.
- Keep text consistent with the UI strings in `i18n/fr.json`.

## Tests

`frontend/tests/help-catalog.test.ts`, `e2e/tests/help.spec.ts`.
