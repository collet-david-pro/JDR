import { BACKOFF_JITTER, BACKOFF_MAX_MS, BACKOFF_MIN_MS, type WireEvent } from './types';

const stripZeros = (id: string): string => id.replace(/^0+(?=\d)/, '');

/** Compares two decimal event ids (BIGINT, possibly beyond 2^53) without losing precision. */
export function compareIds(a: string, b: string): number {
  const x = stripZeros(a);
  const y = stripZeros(b);
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

export const isEventId = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,19}$/.test(value);

export function maxId(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return compareIds(a, b) >= 0 ? a : b;
}

/** Delay before reconnection attempt `attempt` (0-based): 0.5 s doubling up to 15 s, ±30 %. */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(attempt, 10));
  const jitter = 1 + (random() * 2 - 1) * BACKOFF_JITTER;
  return Math.round(base * jitter);
}

/** Bounded set of the ids already delivered (oldest forgotten first). */
export class SeenIds {
  private readonly ids = new Set<string>();

  constructor(private readonly capacity = 2000) {}

  /** True when the id was not known (and is now). */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }
}

/** Parses the JSON of an event; null when it is not an event. */
export function parseWireEvent(text: string | undefined): WireEvent | null {
  if (text === undefined || text === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return toWireEvent(value);
}

export function toWireEvent(value: unknown): WireEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isEventId(v['id']) || typeof v['channel'] !== 'string' || typeof v['type'] !== 'string') {
    return null;
  }
  return {
    id: v['id'],
    channel: v['channel'],
    type: v['type'],
    payload: v['payload'] ?? {},
    actor: typeof v['actor'] === 'string' ? v['actor'] : null,
    client_op_id: typeof v['client_op_id'] === 'string' ? v['client_op_id'] : null,
    at: typeof v['at'] === 'string' ? v['at'] : '',
  };
}
