/**
 * Messages between the page and gen.worker (projet.md 13.4: typed `{type, id, payload}`).
 * `ms` is measured outside procgen/ (D1: the generators never read a clock).
 */
import type { GenResult, GeneratorId } from '../../procgen/types';

export interface GenRequest {
  generator: GeneratorId;
  gen_version: number;
  seed: string;
  /** Raw params: the generator validates / clamps them. */
  params: unknown;
  /** Selection target (dungeon, cave): size and openings, local coordinates. */
  zone?: { width: number; height: number; openings: [number, number][] };
}

export interface GenProgress {
  phase: string;
  done: number;
  total: number;
}

export interface GenOutcome {
  result: GenResult;
  /** SHA-256 hex of the canonical JSON of `result` (procgen/canonical.ts). */
  fingerprint: string;
  ms: number;
}

export type GenToWorker =
  | { readonly type: 'run'; readonly id: number; readonly payload: GenRequest }
  | { readonly type: 'cancel'; readonly id: number };

export type GenFromWorker =
  | { readonly type: 'progress'; readonly id: number; readonly payload: GenProgress }
  | { readonly type: 'done'; readonly id: number; readonly payload: GenOutcome }
  | { readonly type: 'cancelled'; readonly id: number }
  | {
      readonly type: 'error';
      readonly id: number;
      readonly payload: { readonly name: string; readonly message: string };
    };

/** Minimum delay between two progress messages (<= 10 per second). */
export const PROGRESS_INTERVAL_MS = 100;
