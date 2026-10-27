/**
 * Event types of the catalogue (etapes/P06, app/Domain/Sessions/EventTypes.php). EventSource
 * has no "any event" listener: the SSE transport listens to each name. `ping` and `events_gone`
 * are protocol events, not part of this list.
 */
export const EVENT_TYPES = [
  'session.state',
  'session.code',
  'player.joined',
  'player.left',
  'player.ready',
  'player.kicked',
  'assignment.set',
  'map.changed',
  'maptoken.moved',
  'maptoken.added',
  'maptoken.updated',
  'maptoken.removed',
  'door.toggled',
  'object.revealed',
  'fog.updated',
  'light.changed',
  'ambient.changed',
  'camera.moved',
  'note.read_aloud',
  'map.ops',
  'map.ops.public',
  'server.notice',
  'display.paired',
  'display.updated',
  'display.revoked',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
