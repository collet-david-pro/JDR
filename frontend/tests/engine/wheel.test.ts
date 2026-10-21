import { describe, expect, it } from 'vitest';
import { WheelClassifier, type WheelSample } from '../../src/engine/input-math';

function wheel(t: number, deltaY: number, opts: Partial<WheelSample> = {}): WheelSample {
  return {
    deltaX: 0,
    deltaY,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    timeStamp: t,
    ...opts,
  };
}

describe('WheelClassifier (mouse wheel vs trackpad)', () => {
  it('zooms with a mouse wheel (pixel notches, line or page deltas)', () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel(0, 100))).toBe('zoom'); // Chrome / Edge
    expect(c.classify(wheel(1000, -120))).toBe('zoom'); // Windows high-res
    expect(c.classify(wheel(2000, 53))).toBe('zoom'); // Safari
    expect(c.classify(wheel(3000, 3, { deltaMode: 1 }))).toBe('zoom'); // Firefox lines
    expect(c.classify(wheel(4000, 1, { deltaMode: 2 }))).toBe('zoom'); // pages
  });

  it('pans with a trackpad two-finger scroll', () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel(0, 4))).toBe('pan'); // small pixel deltas
    expect(c.classify(wheel(1000, 12.5))).toBe('pan'); // fractional (high-DPI)
    expect(c.classify(wheel(2000, 0, { deltaX: -7 }))).toBe('pan'); // horizontal
    expect(c.classify(wheel(3000, 30, { deltaX: 2 }))).toBe('pan');
  });

  it('zooms on pinch (reported as Ctrl + wheel) and Ctrl/Cmd + mouse wheel', () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel(0, 2.4, { ctrlKey: true }))).toBe('pinch');
    expect(c.classify(wheel(1000, 100, { metaKey: true }))).toBe('pinch');
  });

  it('keeps the device for the whole gesture', () => {
    const c = new WheelClassifier();
    // Trackpad swipe starting with a large delta, then deltas in the same gesture.
    expect(c.classify(wheel(0, 3))).toBe('pan');
    expect(c.classify(wheel(16, 80))).toBe('pan');
    expect(c.classify(wheel(32, 120))).toBe('pan');
    // Mouse flick followed by small inertial deltas: still a zoom.
    expect(c.classify(wheel(1000, 100))).toBe('zoom');
    expect(c.classify(wheel(1016, 4))).toBe('zoom');
    // A horizontal component switches to trackpad mid-gesture.
    expect(c.classify(wheel(1032, 4, { deltaX: 1 }))).toBe('pan');
    // After a pause, a new gesture is classified again.
    expect(c.classify(wheel(2000, 100))).toBe('zoom');
  });

  it('Shift: horizontal pan with a mouse, plain pan with a trackpad', () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel(0, 100, { shiftKey: true }))).toBe('pan-shift');
    expect(c.classify(wheel(1000, 5, { shiftKey: true }))).toBe('pan');
  });
});
