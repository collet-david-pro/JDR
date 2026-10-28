import { ApiError } from './api';

/** What the chunked upload needs from the server (see admin-update.svelte.ts for the real client). */
export interface UploadTransport {
  putChunk(uploadId: string, offset: number, chunk: Blob): Promise<{ received: number }>;
}

export interface ChunkedUploadOptions {
  readonly file: Blob;
  readonly uploadId: string;
  readonly chunkBytes: number;
  readonly transport: UploadTransport;
  /** Called with the number of bytes the server has acknowledged. */
  readonly onProgress?: (sent: number, total: number) => void;
  /** New attempts per chunk after a network error (default 2). */
  readonly retries?: number;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly signal?: AbortSignal;
}

const MAX_RESYNC = 5;
const NETWORK_CODES = new Set(['network_error', 'timeout']);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Lowercase hexadecimal SHA-256 of a file (the whole file in memory: archives are ≤ 100 MB). */
export async function sha256Hex(file: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('no_crypto');
  const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Sends the file chunk by chunk (PUT ?offset=n). `409 update.bad_offset` resumes at the offset the
 * server reports (fields.received); a network error is retried `retries` times for the same chunk.
 * Any other error is thrown as is.
 */
export async function uploadInChunks(options: ChunkedUploadOptions): Promise<void> {
  const { file, uploadId, chunkBytes, transport, onProgress, signal } = options;
  const retries = options.retries ?? 2;
  const sleep = options.sleep ?? defaultSleep;
  const total = file.size;
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1) throw new Error('invalid chunk size');

  let offset = 0;
  let resyncs = 0;
  let failures = 0;
  onProgress?.(0, total);
  while (offset < total) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const end = Math.min(offset + chunkBytes, total);
    try {
      const { received } = await transport.putChunk(uploadId, offset, file.slice(offset, end));
      failures = 0;
      resyncs = 0;
      offset = Number.isInteger(received) && received >= 0 ? received : end;
      onProgress?.(offset, total);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'update.bad_offset') {
        const received = Number(error.fields['received']);
        if (
          !Number.isInteger(received) ||
          received < 0 ||
          received > total ||
          resyncs >= MAX_RESYNC
        ) {
          throw error;
        }
        resyncs += 1;
        offset = received;
        onProgress?.(offset, total);
      } else if (error instanceof ApiError && NETWORK_CODES.has(error.code) && failures < retries) {
        failures += 1;
        await sleep(400 * failures);
      } else {
        throw error;
      }
    }
  }
}
