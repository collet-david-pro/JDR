# lib/sessions — play sessions

State, events and actions of a running session, for the player view and the game master console.

## Key files

- `state.ts`, `reducer.ts`, `effects.ts`: pure session state, `applyEvent`, resulting effects.
- `session-run.svelte.ts`: `SessionRun` (snapshot, event stream, actions). `session-sync.ts`: sync and presence.
- `action-sender.ts`: batched, throttled actions. `sessions-client.ts`: HTTP endpoints.
- `scene/`: scene host and `SessionScene` (map, objects, tokens, fog as the viewer sees them).
- `console/`: game master console (input, commands, displays, camera broadcast). `play/`: player input, camera, exploration, preload.
- `note-events.ts`, `event-payloads.ts`, `scene-ops.ts`, `errors.ts`, `labels.ts`.

## Invariants

- The reducer is pure: state in, state and effects out.
- Hidden data never reaches the client; do not add client-side hiding as a substitute.
- Moves are throttled; other actions are sent in order.

## Tests

`tests/sessions/`, `tests/sessions-ui/`, `tests/play/`, `tests/commands/`. E2E: `sessions-gm.spec.ts`, `sessions-player.spec.ts`, `sessions-criteria.spec.ts`.
