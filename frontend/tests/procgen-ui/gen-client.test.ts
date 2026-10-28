import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGenClient, GenCancelledError } from '../../src/lib/procgen/gen-client';
import type { GenFromWorker, GenToWorker } from '../../src/lib/procgen/gen-protocol';
import { fingerprint } from '../../src/procgen/canonical';
import { registerAllGenerators } from '../../src/procgen/generators';
import { runGenerator } from '../../src/procgen/registry';

const REQ = {
  generator: 'cave',
  gen_version: 1,
  seed: 'abc',
  params: { width: 30, height: 30 },
} as const;

class FakeWorker {
  sent: GenToWorker[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  postMessage(m: GenToWorker): void {
    this.sent.push(m);
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: GenFromWorker): void {
    for (const fn of this.listeners.get('message') ?? []) fn({ data });
  }
  fail(message: string): void {
    for (const fn of this.listeners.get('error') ?? []) fn({ message, preventDefault() {} });
  }
}

afterEach(() => vi.useRealTimers());

describe('GenClient, main-thread fallback', () => {
  it('produces the fingerprint of runGenerator and reports progress', async () => {
    registerAllGenerators();
    const client = createGenClient({ mainThread: true });
    expect(client.mode).toBe('main');
    const phases: string[] = [];
    const out = await client.run(REQ, { onProgress: (p) => phases.push(p.phase) }).promise;
    const direct = runGenerator('cave', 1, 'abc', REQ.params);
    expect(out.result).toEqual(direct);
    expect(out.fingerprint).toBe(await fingerprint(direct));
    expect(out.ms).toBeGreaterThanOrEqual(0);
    expect(phases.length).toBeGreaterThan(0);
    client.dispose();
  });

  it('falls back when no Worker can be created', async () => {
    const client = createGenClient({
      createWorker: () => {
        throw new Error('no worker');
      },
    });
    const out = await client.run(REQ).promise;
    expect(client.mode).toBe('main');
    expect(out.fingerprint).toHaveLength(64);
  });

  it('cancel before the start rejects with GenCancelledError; a new run cancels the previous', async () => {
    const client = createGenClient({ mainThread: true });
    const a = client.run(REQ);
    a.cancel();
    await expect(a.promise).rejects.toBeInstanceOf(GenCancelledError);
    const b = client.run(REQ);
    const c = client.run({ ...REQ, seed: 'other' });
    await expect(b.promise).rejects.toBeInstanceOf(GenCancelledError);
    expect((await c.promise).result.seed).toBe('other');
  });

  it('surfaces generator errors', async () => {
    const client = createGenClient({ mainThread: true });
    await expect(client.run({ ...REQ, seed: '' }).promise).rejects.toThrow(/Seed/);
  });
});

describe('GenClient, worker messages (fake Worker)', () => {
  const setup = () => {
    const workers: FakeWorker[] = [];
    const client = createGenClient({
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
    });
    return { client, workers };
  };

  it('posts run, forwards progress, resolves on done', async () => {
    const { client, workers } = setup();
    const progress = vi.fn();
    const run = client.run(REQ, { onProgress: progress });
    const w = workers[0]!;
    expect(client.mode).toBe('worker');
    expect(w.sent).toEqual([{ type: 'run', id: 1, payload: REQ }]);
    w.emit({ type: 'progress', id: 99, payload: { phase: 'x', done: 1, total: 2 } }); // other id
    w.emit({ type: 'progress', id: 1, payload: { phase: 'p', done: 1, total: 2 } });
    expect(progress).toHaveBeenCalledTimes(1);
    const outcome = { result: {} as never, fingerprint: 'f', ms: 5 };
    w.emit({ type: 'done', id: 1, payload: outcome });
    await expect(run.promise).resolves.toEqual(outcome);
    // The worker is reused by the next run.
    const again = client.run(REQ);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.sent.at(-1)).toMatchObject({ type: 'run', id: 2 });
    again.cancel();
    await expect(again.promise).rejects.toBeInstanceOf(GenCancelledError);
  });

  it('cancel terminates the worker and the next run creates a new one', async () => {
    const { client, workers } = setup();
    const run = client.run(REQ);
    run.cancel();
    await expect(run.promise).rejects.toBeInstanceOf(GenCancelledError);
    expect(workers[0]!.terminated).toBe(true);
    const next = client.run(REQ);
    expect(workers).toHaveLength(2);
    workers[1]!.emit({ type: 'cancelled', id: 2 });
    await expect(next.promise).rejects.toBeInstanceOf(GenCancelledError);
  });

  it('a new run cancels the previous one', async () => {
    const { client } = setup();
    const a = client.run(REQ);
    const b = client.run({ ...REQ, seed: 'z' });
    await expect(a.promise).rejects.toBeInstanceOf(GenCancelledError);
    b.cancel();
    await expect(b.promise).rejects.toBeInstanceOf(GenCancelledError);
  });

  it('maps worker errors and crashes', async () => {
    const { client, workers } = setup();
    const a = client.run(REQ);
    workers[0]!.emit({ type: 'error', id: 1, payload: { name: 'RangeError', message: 'boom' } });
    const error = await a.promise.catch((e: Error) => e);
    expect(error).toMatchObject({ name: 'RangeError', message: 'boom' });
    const b = client.run(REQ);
    workers[0]!.fail('crash');
    await expect(b.promise).rejects.toThrow('crash');
    expect(workers[0]!.terminated).toBe(true);
  });

  it('dispose cancels and terminates', async () => {
    const { client, workers } = setup();
    const a = client.run(REQ);
    client.dispose();
    await expect(a.promise).rejects.toBeInstanceOf(GenCancelledError);
    expect(workers[0]!.terminated).toBe(true);
    expect(() => client.run(REQ)).toThrow();
  });
});
