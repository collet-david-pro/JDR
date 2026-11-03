import { describe, expect, it } from 'vitest';
import { bestWorkloadMs, loadFactor } from './load-factor';

describe('load factor', () => {
  it('stays within [1, 12]', () => {
    const f = loadFactor();
    console.info(
      `[perf] calibration workload ${bestWorkloadMs().toFixed(1)} ms, load factor ${f.toFixed(2)}`,
    );
    expect(f).toBeGreaterThanOrEqual(1);
    expect(f).toBeLessThanOrEqual(12);
  });
});
