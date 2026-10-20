/**
 * Real-time flow test of the diagnostic page (projet.md 10.3, 6.6): the server sends
 * 3 SSE messages one second apart (GET /admin/diagnostic/sse). If a proxy, a compression
 * layer or output buffering holds the response, the messages arrive together at the end.
 */

export interface SseProbeResult {
  /** Messages received before the end of the test. */
  readonly received: number;
  /** Arrival times in ms, relative to the opening of the stream. */
  readonly arrivals: readonly number[];
  /** All messages arrived but (nearly) at the same time: the stream is buffered. */
  readonly buffered: boolean;
  /** Expected number of messages, received progressively. */
  readonly ok: boolean;
  /** The connection failed before all messages arrived. */
  readonly failed: boolean;
}

/** Minimal EventSource surface (injectable for tests). */
export interface EventSourceLike {
  addEventListener(type: string, listener: () => void): void;
  close(): void;
}

export interface SseProbeOptions {
  readonly expected?: number;
  readonly timeoutMs?: number;
  /** Two consecutive messages closer than this are considered buffered. */
  readonly minGapMs?: number;
  readonly open?: (url: string) => EventSourceLike;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** The test stream sends named `ping` events; unnamed ones are counted too. */
export const SSE_EVENT_TYPES = ['message', 'ping'] as const;

export function analyzeArrivals(
  arrivals: readonly number[],
  expected: number,
  minGapMs: number,
  failed: boolean,
): SseProbeResult {
  const complete = arrivals.length >= expected;
  let minGap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < arrivals.length; i++) {
    minGap = Math.min(minGap, (arrivals[i] ?? 0) - (arrivals[i - 1] ?? 0));
  }
  const buffered = complete && expected > 1 && minGap < minGapMs;
  return {
    received: arrivals.length,
    arrivals,
    buffered,
    ok: complete && !buffered,
    failed: failed && !complete,
  };
}

export function runSseProbe(url: string, options: SseProbeOptions = {}): Promise<SseProbeResult> {
  const expected = options.expected ?? 3;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const minGapMs = options.minGapMs ?? 400;
  const open = options.open ?? ((u: string) => new EventSource(u));
  const now = options.now ?? (() => performance.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  return new Promise((resolve) => {
    const start = now();
    const arrivals: number[] = [];
    let done = false;
    const source = open(url);

    const finish = (failed: boolean): void => {
      if (done) return;
      done = true;
      clearTimer(timer);
      // Closing also stops the automatic reconnection of EventSource.
      source.close();
      resolve(analyzeArrivals(arrivals, expected, minGapMs, failed));
    };

    const timer = setTimer(() => finish(false), timeoutMs);
    const onMessage = (): void => {
      if (done) return;
      arrivals.push(Math.round(now() - start));
      if (arrivals.length >= expected) finish(false);
    };
    for (const type of SSE_EVENT_TYPES) source.addEventListener(type, onMessage);
    source.addEventListener('error', () => finish(true));
  });
}
