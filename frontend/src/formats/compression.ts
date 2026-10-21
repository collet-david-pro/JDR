/**
 * Raw deflate (projet.md 12.2): native CompressionStream/DecompressionStream('deflate-raw') when
 * available, pure JS fallback otherwise (22). Decompression is always bounded (anti-bomb).
 */
import { InflateError, deflateRawSync, inflateRawSync } from './deflate';

export class CompressionError extends Error {
  override readonly name = 'CompressionError';
  constructor(
    readonly code: 'invalid' | 'output_limit',
    message: string,
  ) {
    super(message);
  }
}

export interface CompressionOptions {
  /** Force the JS implementation (tests, broken native support). */
  readonly forceJs?: boolean;
}

let nativeSupport: boolean | null = null;

/** True when the platform supports CompressionStream/DecompressionStream('deflate-raw'). */
export function hasNativeDeflateRaw(): boolean {
  if (nativeSupport === null) {
    try {
      new CompressionStream('deflate-raw');
      new DecompressionStream('deflate-raw');
      nativeSupport = true;
    } catch {
      nativeSupport = false;
    }
  }
  return nativeSupport;
}

async function pump(
  transform: CompressionStream | DecompressionStream,
  data: Uint8Array,
  maxOutput: number,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Not awaited: with backpressure the write only resolves once output is read.
  writer.write(new Uint8Array(data)).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = transform.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxOutput) {
      await reader.cancel().catch(() => undefined);
      throw new CompressionError('output_limit', 'Decompressed data too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Compresses `data` to a raw deflate stream. */
export async function deflateRaw(
  data: Uint8Array,
  options: CompressionOptions = {},
): Promise<Uint8Array> {
  if (!options.forceJs && hasNativeDeflateRaw()) {
    return pump(new CompressionStream('deflate-raw'), data, Number.MAX_SAFE_INTEGER);
  }
  return deflateRawSync(data);
}

/** Decompresses a raw deflate stream; throws CompressionError past `maxOutput` bytes or on bad data. */
export async function inflateRaw(
  data: Uint8Array,
  maxOutput: number,
  options: CompressionOptions = {},
): Promise<Uint8Array> {
  if (!options.forceJs && hasNativeDeflateRaw()) {
    try {
      return await pump(new DecompressionStream('deflate-raw'), data, maxOutput);
    } catch (e) {
      if (e instanceof CompressionError) throw e;
      throw new CompressionError(
        'invalid',
        e instanceof Error ? e.message : 'Invalid deflate data',
      );
    }
  }
  try {
    return inflateRawSync(data, maxOutput);
  } catch (e) {
    if (e instanceof InflateError) {
      throw new CompressionError(e.code === 'output_limit' ? 'output_limit' : 'invalid', e.message);
    }
    throw e;
  }
}
