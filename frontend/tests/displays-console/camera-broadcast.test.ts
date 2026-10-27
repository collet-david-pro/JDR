import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cameraAction,
  CameraBroadcaster,
  startCameraBroadcast,
} from '../../src/lib/sessions/console/camera-broadcast';
import type { SessionAction } from '../../src/lib/sessions/types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const cam = (x: number, zoom = 1) => ({ x, y: 2, zoom });

describe('camera broadcast (D10)', () => {
  it('builds camera.set with a bounded zoom, follow on and the floor', () => {
    expect(cameraAction(cam(1, 50), '35')).toEqual({
      type: 'camera.set',
      x: 1,
      y: 2,
      zoom: 8,
      floor_id: '35',
      follow: true,
    });
    expect(cameraAction(cam(1, 0.01), null)).toMatchObject({ zoom: 0.1 });
  });

  it('sends at most 4 times per second and always ends on the final position', () => {
    const sent: SessionAction[][] = [];
    const b = new CameraBroadcaster({ send: (a) => sent.push(a) });
    for (let i = 0; i < 100; i++) {
      b.push(cam(i), '35');
      vi.advanceTimersByTime(10);
    }
    // 1 s of movements: the first goes out at once, then one every 250 ms.
    expect(sent.length).toBeGreaterThanOrEqual(4);
    expect(sent.length).toBeLessThanOrEqual(5);
    vi.advanceTimersByTime(300);
    const last = sent.at(-1)?.[0] as { x: number };
    expect(last.x).toBe(99);
    const stamps = sent.length;
    vi.advanceTimersByTime(2000);
    expect(sent.length).toBe(stamps);
  });

  it('sends the first state at once and defers the next one', () => {
    const sent: SessionAction[][] = [];
    const b = new CameraBroadcaster({ send: (a) => sent.push(a) });
    b.push(cam(1), null);
    expect(sent).toHaveLength(1);
    b.push(cam(2), null);
    b.push(cam(3), null);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(249);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(2);
    expect((sent[1]?.[0] as { x: number }).x).toBe(3);
  });

  it('dispose drops what is pending', () => {
    const sent: SessionAction[][] = [];
    const b = new CameraBroadcaster({ send: (a) => sent.push(a) });
    b.push(cam(1), null);
    b.push(cam(2), null);
    b.dispose();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
  });

  it('startCameraBroadcast sends the current camera, follows the engine and stops', () => {
    const sent: SessionAction[][] = [];
    let listener: ((c: { x: number; y: number; zoom: number }) => void) | null = null;
    const engine = {
      camera: { get: () => cam(5) },
      onCamera: (l: (c: { x: number; y: number; zoom: number }) => void) => {
        listener = l;
        return () => (listener = null);
      },
    };
    const stop = startCameraBroadcast(
      engine,
      () => '35',
      (a) => sent.push(a),
    );
    expect(sent).toHaveLength(1);
    listener!(cam(6));
    vi.advanceTimersByTime(250);
    expect(sent).toHaveLength(2);
    stop();
    expect(listener).toBeNull();
    expect(sent).toHaveLength(2);
  });
});
