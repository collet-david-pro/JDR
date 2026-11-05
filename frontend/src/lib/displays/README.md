# lib/displays — table displays (IRL screens)

Logic of the display page (a screen laid flat on the table, paired with a session) and of the game master's display management.

## Key files

- `display-run.svelte.ts`: `DisplayRun`, state machine (pairing, waiting, showing).
- `display-boot.ts`, `display-api.ts`, `session-api.ts`: wiring and API of the display page.
- `device-client.ts`: calls made by the paired device. `displays-client.ts`: calls made by the game master.
- `calibration.ts`, `framing.ts`, `orientation.ts`: physical scale (mm per cell), rotation and mirror.
- `corner-press.ts`, `wake-lock.ts`, `read-aloud.ts`, `qr.ts`, `ui-logic.ts`: small helpers.

## Invariants

- A display only shows what its audience may see; filtering is done by the server, never here.
- Settings stored per device: see `DEVICE_SETTING_KEYS` in `types.ts`.
- Pairing codes have 6 digits.

## Tests

`tests/displays/`, `tests/display-ui/`, `tests/displays-console/`. E2E: `display.spec.ts`, `displays-gm.spec.ts`, `displays-criteria.spec.ts`.
