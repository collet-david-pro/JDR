import { describe, expect, it } from 'vitest';
import { createVisionCore, createVisionService } from '../../src/vision';
import type { FromVisionWorker, ToVisionWorker } from '../../src/vision/protocol';
import type { VisionWorkerLike } from '../../src/vision/service';
import { createVisionHost } from '../../src/vision/worker-host';
import { door, light, scene, wall } from './helpers';

/** In-process worker: structured clone with transfer, asynchronous delivery both ways. */
class FakeWorker implements VisionWorkerLike {
  onmessage: ((event: MessageEvent<FromVisionWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly received: ToVisionWorker[] = [];
  transferred = 0;
  terminated = false;
  private readonly host = createVisionHost((message, transfer) => {
    this.transferred += transfer.length;
    const copy = structuredClone(message, { transfer });
    setTimeout(() => {
      if (!this.terminated) this.onmessage?.({ data: copy } as MessageEvent<FromVisionWorker>);
    }, 0);
  });

  constructor(private readonly failOnCompute = false) {}

  postMessage(message: ToVisionWorker): void {
    const copy = structuredClone(message);
    this.received.push(copy);
    setTimeout(() => {
      if (this.terminated) return;
      if (this.failOnCompute && copy.type === 'compute') {
        this.onerror?.({ preventDefault: () => undefined, message: 'boom' } as ErrorEvent);
        return;
      }
      this.host(copy);
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const objects = [
  wall([
    [8, 0],
    [8, 20],
  ]),
  door([8, 9], [8, 11]),
  light(3, 3),
];
const sources = [
  { id: 'a', x: 4, y: 10, radius: 12 },
  { id: 'b', x: 12, y: 5, radius: 6, cone: { angle: 90, direction: 45 } },
];

function expected(kind: 'vision' | 'light'): Map<string, Float32Array> {
  const core = createVisionCore();
  core.setScene(scene(objects));
  return new Map(core.compute(kind, sources));
}

describe('VisionService', () => {
  it('{worker: false} computes in the same thread', async () => {
    const service = createVisionService({ worker: false });
    expect(service.mode).toBe('local');
    service.setScene(scene(objects));
    expect(await service.compute('vision', sources)).toEqual(expected('vision'));
    service.destroy();
  });

  it('falls back when no worker can be created (node: no Worker global)', async () => {
    const auto = createVisionService();
    expect(auto.mode).toBe('local');
    const none = createVisionService({ createWorker: () => null });
    none.setScene(scene(objects));
    expect(await none.compute('light', sources)).toEqual(expected('light'));
  });

  it('uses the worker: typed messages, transferred polygons, same results', async () => {
    const fake = new FakeWorker();
    const service = createVisionService({ createWorker: () => fake });
    expect(service.mode).toBe('worker');
    service.setScene(scene(objects));
    const [vision, lightResult] = await Promise.all([
      service.compute('vision', sources),
      service.compute('light', sources),
    ]);
    expect(vision).toEqual(expected('vision'));
    expect(lightResult).toEqual(expected('light'));
    expect(fake.transferred).toBe(4);
    expect(fake.received.map((m) => m.type)).toEqual(['scene', 'compute', 'compute']);
    for (const m of fake.received) expect(typeof m.id).toBe('number');
    // Only occluders are posted (the light object is not).
    const posted = fake.received[0] as Extract<ToVisionWorker, { type: 'scene' }>;
    expect(posted.payload.objects.map((o) => o.type)).toEqual(['wall', 'door']);
    // The cached polygon of the worker survives the transfer (copies are sent).
    expect(await service.compute('vision', sources)).toEqual(expected('vision'));
    service.destroy();
    expect(fake.terminated).toBe(true);
  });

  it('posts the scene only when the occluders change', async () => {
    const fake = new FakeWorker();
    const service = createVisionService({ createWorker: () => fake });
    service.setScene(scene(objects, 20, 20, 'gm', 1));
    // New revision, same wall / door objects (a token moved).
    service.setScene(scene([objects[0]!, objects[1]!], 20, 20, 'gm', 2));
    expect(fake.received.filter((m) => m.type === 'scene')).toHaveLength(1);
    const opened = door([8, 9], [8, 11], { state: 'open' });
    service.setScene(scene([objects[0]!, opened], 20, 20, 'gm', 3));
    service.setScene(scene([objects[0]!, opened], 20, 20, 'player', 4));
    expect(fake.received.filter((m) => m.type === 'scene')).toHaveLength(3);
    const result = await service.compute('vision', [{ id: 't', x: 4, y: 10, radius: 12 }]);
    const core = createVisionCore();
    core.setScene(scene([objects[0]!, opened], 20, 20, 'player'));
    expect(result.get('t')).toEqual(
      core.compute('vision', [{ id: 't', x: 4, y: 10, radius: 12 }]).get('t'),
    );
    service.destroy();
  });

  it('falls back to the same thread when the worker fails; pending requests resolve', async () => {
    const fake = new FakeWorker(true);
    const service = createVisionService({ createWorker: () => fake });
    service.setScene(scene(objects));
    const result = await service.compute('vision', sources);
    expect(result).toEqual(expected('vision'));
    expect(service.mode).toBe('local');
    expect(fake.terminated).toBe(true);
    // Later calls stay local.
    expect(await service.compute('light', sources)).toEqual(expected('light'));
  });

  it('destroy resolves pending requests with an empty result', async () => {
    const fake = new FakeWorker();
    const service = createVisionService({ createWorker: () => fake });
    service.setScene(scene(objects));
    const pending = service.compute('vision', sources);
    service.destroy();
    expect((await pending).size).toBe(0);
    expect((await service.compute('vision', sources)).size).toBe(0);
  });
});
