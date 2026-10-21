import { describe, expect, it } from 'vitest';
import { FpsMeter, PerformanceModeDetector, effectiveDpr } from '../../src/engine/frame-stats';
import {
  heldButton,
  modifiersOf,
  pinchDelta,
  pinchState,
  wheelPixels,
  wheelZoomFactor,
} from '../../src/engine/input-math';

describe('FpsMeter', () => {
  it('measures runs of consecutive frames', () => {
    const m = new FpsMeter(500, 250);
    const samples = [];
    for (let t = 0; t <= 1000; t += 20) {
      const s = m.frame(t);
      if (s !== null) samples.push(s);
    }
    expect(samples).toHaveLength(2);
    expect(samples[0]?.fps).toBeCloseTo(50, 6);
  });

  it('ignores idle gaps (render on demand)', () => {
    const m = new FpsMeter(500, 250);
    for (let t = 0; t < 400; t += 16) m.frame(t);
    // 5 s idle, then a new run: no low sample from the gap.
    expect(m.frame(5400)).toBeNull();
    let sample = null;
    for (let t = 5416; t <= 6000 && sample === null; t += 16) sample = m.frame(t);
    expect(sample?.fps).toBeGreaterThan(55);
  });
});

describe('performance mode', () => {
  it('turns on after 3 s below 30 fps', () => {
    const d = new PerformanceModeDetector();
    for (let i = 0; i < 5; i++) expect(d.sample({ fps: 20, durationMs: 500 })).toBe(false);
    expect(d.active).toBe(false);
    expect(d.sample({ fps: 25, durationMs: 500 })).toBe(true);
    expect(d.active).toBe(true);
    expect(d.sample({ fps: 10, durationMs: 500 })).toBe(false);
  });

  it('resets on a good sample', () => {
    const d = new PerformanceModeDetector();
    for (let i = 0; i < 5; i++) d.sample({ fps: 20, durationMs: 500 });
    d.sample({ fps: 40, durationMs: 500 });
    for (let i = 0; i < 5; i++) d.sample({ fps: 20, durationMs: 500 });
    expect(d.active).toBe(false);
  });

  it('caps the DPR at 2, 1 in performance mode', () => {
    expect(effectiveDpr(3, false)).toBe(2);
    expect(effectiveDpr(1.5, false)).toBe(1.5);
    expect(effectiveDpr(3, true)).toBe(1);
    expect(effectiveDpr(Number.NaN, false)).toBe(1);
  });
});

describe('input helpers', () => {
  it('maps modifiers (Cmd counts as Ctrl)', () => {
    expect(modifiersOf({ shiftKey: true, altKey: false, ctrlKey: false, metaKey: true })).toEqual({
      shift: true,
      alt: false,
      ctrlOrMeta: true,
    });
  });

  it('reports the held button for moves', () => {
    expect(heldButton(0)).toBe(-1);
    expect(heldButton(1)).toBe(0);
    expect(heldButton(4)).toBe(1);
    expect(heldButton(2)).toBe(2);
  });

  it('normalises wheel deltas and zooms in on negative deltas', () => {
    expect(wheelPixels(3, 1, 800)).toBe(48);
    expect(wheelPixels(1, 2, 800)).toBe(800);
    expect(wheelPixels(Number.NaN, 0, 800)).toBe(0);
    expect(wheelZoomFactor(-100, false)).toBeGreaterThan(1.1);
    expect(wheelZoomFactor(100, false)).toBeLessThan(0.9);
    expect(wheelZoomFactor(-10, true)).toBeCloseTo(Math.exp(0.1), 9);
    expect(wheelZoomFactor(-10_000, false)).toBe(2);
  });

  it('computes pinch zoom and pan', () => {
    const a = pinchState({ x: 0, y: 0 }, { x: 100, y: 0 });
    const b = pinchState({ x: 10, y: 10 }, { x: 210, y: 10 });
    const d = pinchDelta(a, b);
    expect(d.factor).toBe(2);
    expect(d.dx).toBe(60);
    expect(d.dy).toBe(10);
  });
});
