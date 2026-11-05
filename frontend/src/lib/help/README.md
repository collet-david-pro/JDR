# lib/help — built-in help logic

Turns the Markdown files of `src/help/` into a searchable catalog (public `/aide` page and contextual links).

## Key files

- `content.ts`: imports every `src/help/<audience>/NN-name.md` (Vite glob) and builds `helpSections`.
- `catalog.ts`: section ids, audiences (`joueur`, `mj`, `irl`, `admin`), path parsing.
- `markdown.ts`: restricted Markdown parser for help files (blocks, runs, images).
- `search.ts`: accent- and case-insensitive search. `links.ts`: contextual links by topic. `shortcuts.ts`: shortcut tables.

## Invariants

- The section id is `<audience>-<name>` (order prefix and extension dropped): renaming a file changes links.
- No raw HTML in help files.

## Tests

`tests/help-catalog.test.ts`. E2E: `e2e/tests/help.spec.ts`. Adding a section: see `src/help/README.md`.
