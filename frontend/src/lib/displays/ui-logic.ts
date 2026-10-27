/** Small pure helpers of the `/display` page (P7d). */
import { ApiError } from '../api';
import type { DisplayStatus } from './types';

export const CURSOR_HIDE_MS = 3000;
export const DIAGONAL_MIN_IN = 5;
export const DIAGONAL_MAX_IN = 300;
export const RELOAD_DELAY_MS = 2000;

/** Digits only, at most 6 (spaces and dashes are tolerated). */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

export const isCodeComplete = (code: string): boolean => /^\d{6}$/.test(code);

export type DisplayScreenKind = 'loading' | 'pair' | 'lobby' | 'waiting' | 'game' | 'pause';

/** Which screen to show for the status of the run. */
export function screenFor(status: DisplayStatus, loading: boolean): DisplayScreenKind {
  if (status === 'unpaired' || status === 'pairing') return loading ? 'loading' : 'pair';
  if (status === 'running') return 'game';
  if (status === 'paused') return 'pause';
  return status;
}

/** i18n key of a pairing error. */
export function pairErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'display.pair.error_rate';
    if (error.status === 422 || error.code === 'display_code_invalid') {
      return 'display.pair.error_code';
    }
  }
  return 'display.pair.error_generic';
}

/** Diagonal in inches typed by the user (comma or dot); null when invalid / out of range. */
export function parseDiagonal(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(value) || raw.trim() === '') return null;
  return value >= DIAGONAL_MIN_IN && value <= DIAGONAL_MAX_IN ? value : null;
}

/** Ruler length clamp (CSS px). */
export function clampRuler(px: number, max: number): number {
  return Math.max(20, Math.min(Math.max(20, max), Math.round(px)));
}

/** Cursor hidden after `ms` without mouse movement; shown again at the next one. */
export class CursorHider {
  private timer: unknown = null;
  private hiddenNow = false;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (handle: unknown) => void;

  constructor(
    private readonly onChange: (hidden: boolean) => void,
    private readonly ms: number = CURSOR_HIDE_MS,
    timers?: {
      setTimeout: (fn: () => void, ms: number) => unknown;
      clearTimeout: (handle: unknown) => void;
    },
  ) {
    this.setT = timers?.setTimeout ?? ((fn, d) => setTimeout(fn, d));
    this.clearT = timers?.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get hidden(): boolean {
    return this.hiddenNow;
  }

  /** Mouse moved (or the page started). */
  activity(): void {
    if (this.timer !== null) this.clearT(this.timer);
    this.set(false);
    this.timer = this.setT(() => {
      this.timer = null;
      this.set(true);
    }, this.ms);
  }

  dispose(): void {
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
  }

  private set(hidden: boolean): void {
    if (hidden === this.hiddenNow) return;
    this.hiddenNow = hidden;
    this.onChange(hidden);
  }
}
