# components — shared and feature components

Svelte 5 components. Root files are generic building blocks; subfolders group components of one feature.

## Overview

- Root: form fields (`TextField`, `SelectField`, `CheckboxField`, `ColorField`), `Button`, `Modal`, `ConfirmDialog`, `Toasts`, `ErrorAlert`, `CommandPalette`, `MarkdownEditor`/`MarkdownView`, `HelpLink`, `AppHeader`, `ThemeControls`.
- `admin/`, `display/`, `editor/`, `export/`, `games/`, `library/`, `maps/`, `play/`, `sessions/`: feature components, one folder per page or tool.

## Conventions

- Components render and forward events; logic and state live in `lib/` models or `editor/` view models.
- Texts come from `Translate`, never literals. Every control has an accessible name and keyboard access.
- Never use `{@html}`; render Markdown through `MarkdownView`.
- Styles use tokens from `src/styles/tokens.css` (light, dark and style variants).

## Tests

Logic is tested under `frontend/tests/`; behaviour and accessibility by `e2e/tests/` (including `a11y.spec.ts`).
