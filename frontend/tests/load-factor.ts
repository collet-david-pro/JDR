/**
 * Machine-load calibration for timing assertions (P10e).
 *
 * `loadFactor()` runs a small fixed CPU workload a few times and compares its best time with the
 * time measured on an idle development machine (BASELINE_MS). The result is >= 1: 1 on an idle
 * machine, 3 when everything runs three times slower (parallel suites, other builds). Timing
 * assertions multiply their threshold by it, so they keep their meaning (an algorithmic
 * regression of several times still fails) without flaking when the host is busy.
 * The factor is capped (MAX_FACTOR) so a real catastrophe is still caught.
 */
const BASELINE_MS = 6;
const MAX_FACTOR = 12;
// Allocation-heavy code slows down more than the arithmetic calibration under contention.
const SAFETY = 1.5;

function workload(): number {
  const a = new Float64Array(20_000);
  let acc = 0;
  for (let round = 0; round < 60; round++) {
    for (let i = 0; i < a.length; i++) {
      a[i] = Math.sqrt(i + round) * 1.0001 + (a[i - 1 < 0 ? 0 : i - 1] ?? 0) * 0.5;
      acc += a[i]!;
    }
  }
  return acc;
}

export function bestWorkloadMs(samples = 5): number {
  let best = Infinity;
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    workload();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

export function loadFactor(samples = 5): number {
  return Math.min(MAX_FACTOR, Math.max(1, (SAFETY * bestWorkloadMs(samples)) / BASELINE_MS));
}
