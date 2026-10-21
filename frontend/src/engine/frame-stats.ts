/**
 * Frame rate measurement and automatic performance mode (pure). projet.md 14.1: performance
 * mode when < 30 frames/s for 3 s.
 *
 * Rendering happens on demand, so frames only exist while something changes (interaction,
 * inertia, loading). The meter only measures runs of consecutive frames: a gap longer than
 * FPS_IDLE_GAP_MS ends the run without producing a (meaningless) low value.
 */

export const FPS_WINDOW_MS = 500;
export const FPS_IDLE_GAP_MS = 250;
export const PERF_MODE_FPS = 30;
export const PERF_MODE_AFTER_MS = 3000;

export interface FpsSample {
  readonly fps: number;
  /** Duration covered by the sample, ms. */
  readonly durationMs: number;
}

export class FpsMeter {
  private windowStart = -1;
  private last = -1;
  private frames = 0;

  constructor(
    private readonly windowMs = FPS_WINDOW_MS,
    private readonly idleGapMs = FPS_IDLE_GAP_MS,
  ) {}

  /** Records a rendered frame; returns a sample when a measurement window completes. */
  frame(now: number): FpsSample | null {
    if (this.last < 0 || now - this.last > this.idleGapMs) {
      this.windowStart = now;
      this.last = now;
      this.frames = 0;
      return null;
    }
    this.last = now;
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < this.windowMs) return null;
    const sample = { fps: (this.frames * 1000) / elapsed, durationMs: elapsed };
    this.windowStart = now;
    this.frames = 0;
    return sample;
  }

  reset(): void {
    this.windowStart = -1;
    this.last = -1;
    this.frames = 0;
  }
}

/** Accumulates time spent below the threshold; a good sample resets the count. */
export class PerformanceModeDetector {
  private lowMs = 0;
  private activeFlag = false;

  constructor(
    private readonly thresholdFps = PERF_MODE_FPS,
    private readonly afterMs = PERF_MODE_AFTER_MS,
  ) {}

  get active(): boolean {
    return this.activeFlag;
  }

  /** Returns true when this sample switches the performance mode on. */
  sample(s: FpsSample): boolean {
    if (this.activeFlag) return false;
    if (s.fps >= this.thresholdFps) {
      this.lowMs = 0;
      return false;
    }
    this.lowMs += s.durationMs;
    if (this.lowMs >= this.afterMs) {
      this.activeFlag = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.lowMs = 0;
    this.activeFlag = false;
  }
}

/** Device pixel ratio used by the renderer: capped at 2, 1 in performance mode. */
export function effectiveDpr(devicePixelRatio: number, performanceMode: boolean, max = 2): number {
  if (performanceMode) return 1;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(max, dpr);
}
