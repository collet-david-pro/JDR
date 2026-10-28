import { describe, expect, it, vi } from 'vitest';
import { sha256Hex, uploadInChunks, type UploadTransport } from '../../src/lib/admin-update-upload';
import { ApiError } from '../../src/lib/api';

const err = (code: string, status: number, fields: Record<string, string> = {}): ApiError =>
  new ApiError({ code, message: '', status, fields });

function blob(size: number): Blob {
  return new Blob([new Uint8Array(size)]);
}

describe('uploadInChunks', () => {
  it('sends consecutive chunks of chunkBytes and reports progress', async () => {
    const calls: Array<[number, number]> = [];
    const transport: UploadTransport = {
      putChunk: async (_id, offset, chunk) => {
        calls.push([offset, chunk.size]);
        return { received: offset + chunk.size };
      },
    };
    const progress: number[] = [];
    await uploadInChunks({
      file: blob(25),
      uploadId: 'u',
      chunkBytes: 10,
      transport,
      onProgress: (sent) => progress.push(sent),
    });
    expect(calls).toEqual([
      [0, 10],
      [10, 10],
      [20, 5],
    ]);
    expect(progress).toEqual([0, 10, 20, 25]);
  });

  it('resumes at fields.received after 409 update.bad_offset', async () => {
    const offsets: number[] = [];
    let first = true;
    const transport: UploadTransport = {
      putChunk: async (_id, offset, chunk) => {
        offsets.push(offset);
        if (offset === 10 && first) {
          first = false;
          throw err('update.bad_offset', 409, { received: '4' });
        }
        return { received: offset + chunk.size };
      },
    };
    await uploadInChunks({ file: blob(20), uploadId: 'u', chunkBytes: 10, transport });
    expect(offsets).toEqual([0, 10, 4, 14]);
  });

  it('gives up when the server keeps desynchronising', async () => {
    const transport: UploadTransport = {
      putChunk: async () => {
        throw err('update.bad_offset', 409, { received: '0' });
      },
    };
    await expect(
      uploadInChunks({ file: blob(20), uploadId: 'u', chunkBytes: 10, transport }),
    ).rejects.toMatchObject({ code: 'update.bad_offset' });
  });

  it('retries a chunk twice on network errors, then fails', async () => {
    const sleep = vi.fn(async () => {});
    let attempts = 0;
    const flaky: UploadTransport = {
      putChunk: async (_id, offset, chunk) => {
        attempts += 1;
        if (attempts <= 2) throw err('network_error', 0);
        return { received: offset + chunk.size };
      },
    };
    await uploadInChunks({ file: blob(5), uploadId: 'u', chunkBytes: 10, transport: flaky, sleep });
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    attempts = 0;
    const dead: UploadTransport = {
      putChunk: async () => {
        attempts += 1;
        throw err('timeout', 0);
      },
    };
    await expect(
      uploadInChunks({ file: blob(5), uploadId: 'u', chunkBytes: 10, transport: dead, sleep }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(attempts).toBe(3);
  });

  it('does not retry server errors', async () => {
    let attempts = 0;
    const transport: UploadTransport = {
      putChunk: async () => {
        attempts += 1;
        throw err('update.too_large', 422);
      },
    };
    await expect(
      uploadInChunks({ file: blob(5), uploadId: 'u', chunkBytes: 10, transport }),
    ).rejects.toMatchObject({ code: 'update.too_large' });
    expect(attempts).toBe(1);
  });
});

describe('sha256Hex', () => {
  it('computes the lowercase hexadecimal digest', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
