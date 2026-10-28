/** Canonical JSON and SHA-256 fingerprint of a GenResult (D2). */
import { round3 } from './geometry';
import type { GenResult } from './types';

function num(v: number, path: string): string {
  if (!Number.isFinite(v)) throw new Error(`canonicalJson: non-finite number at ${path}`);
  const r = Number.isInteger(v) ? v : round3(v);
  return r === 0 ? '0' : JSON.stringify(r);
}

function enc(v: unknown, path: string): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number':
      return num(v, path);
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'object': {
      if (Array.isArray(v)) {
        const parts = v.map((x, i) => {
          if (x === undefined)
            throw new Error(`canonicalJson: undefined in array at ${path}[${i}]`);
          return enc(x, `${path}[${i}]`);
        });
        return '[' + parts.join(',') + ']';
      }
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort();
      return (
        '{' + keys.map((k) => JSON.stringify(k) + ':' + enc(o[k], `${path}.${k}`)).join(',') + '}'
      );
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof v} at ${path}`);
  }
}

/** Sorted keys, integers as is, other numbers rounded to 3 decimals, -0 => 0. */
export function canonicalJson(value: unknown): string {
  return enc(value, '$');
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++)
    hex += (bytes[i]! < 16 ? '0' : '') + bytes[i]!.toString(16);
  return hex;
}

export function fingerprint(r: GenResult): Promise<string> {
  return sha256Hex(canonicalJson(r));
}
