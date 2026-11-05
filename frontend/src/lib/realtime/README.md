# lib/realtime — real-time client

Event stream with automatic fallback: SSE, then long polling, with one leader tab per browser.

## Key files

- `sync-client.ts`: `SyncClientImpl` (leader election via Web Locks, `BroadcastChannel` fan-out, heartbeat).
- `flow.ts`: `Flow` state machine (modes, cuts, reconnection with backoff).
- `transports.ts`: SSE and long polling. `types.ts`: timing constants and public types.
- `event-types.ts`: known event types. `util.ts`: event id helpers and wire validation. `mode-memory.ts`, `deps.ts`.

## Invariants

- Events carry ordered ids; resume with the last id, never replay out of order.
- Unknown events are ignored, not fatal.
- The server filters events by audience; the client trusts but never re-derives visibility.

## Tests

`tests/realtime/`. Server side: `docs/realtime.md`.
