import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/api';
import {
  CursorHider,
  clampRuler,
  isCodeComplete,
  normalizeCode,
  pairErrorKey,
  parseDiagonal,
  screenFor,
} from '../../src/lib/displays/ui-logic';

const err = (status: number, code: string) => new ApiError({ status, code, message: code });

describe('code', () => {
  it('normalizes spaces, dashes and letters, caps at 6 digits', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('12-34-56')).toBe('123456');
    expect(normalizeCode('1234567')).toBe('123456');
    expect(normalizeCode('ab12')).toBe('12');
  });
  it('is complete at 6 digits', () => {
    expect(isCodeComplete('123456')).toBe(true);
    expect(isCodeComplete('12345')).toBe(false);
  });
});

describe('screenFor', () => {
  it('maps the status to a screen', () => {
    expect(screenFor('unpaired', true)).toBe('loading');
    expect(screenFor('unpaired', false)).toBe('pair');
    expect(screenFor('pairing', false)).toBe('pair');
    expect(screenFor('running', false)).toBe('game');
    expect(screenFor('paused', false)).toBe('pause');
    expect(screenFor('lobby', false)).toBe('lobby');
    expect(screenFor('waiting', false)).toBe('waiting');
  });
});

describe('pairErrorKey', () => {
  it('distinguishes invalid code and rate limit', () => {
    expect(pairErrorKey(err(422, 'display_code_invalid'))).toBe('display.pair.error_code');
    expect(pairErrorKey(err(429, 'rate_limited'))).toBe('display.pair.error_rate');
    expect(pairErrorKey(err(500, 'x'))).toBe('display.pair.error_generic');
  });
});

describe('parseDiagonal / clampRuler', () => {
  it('accepts 5-300 with a comma or a dot', () => {
    expect(parseDiagonal('55')).toBe(55);
    expect(parseDiagonal('27,5')).toBe(27.5);
    expect(parseDiagonal('4.9')).toBeNull();
    expect(parseDiagonal('301')).toBeNull();
    expect(parseDiagonal('')).toBeNull();
    expect(parseDiagonal('abc')).toBeNull();
  });
  it('clamps the ruler', () => {
    expect(clampRuler(5, 800)).toBe(20);
    expect(clampRuler(900, 800)).toBe(800);
    expect(clampRuler(378.4, 800)).toBe(378);
  });
});

describe('CursorHider', () => {
  it('hides after 3 s without movement and shows again on movement', () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const hider = new CursorHider((h) => changes.push(h));
    hider.activity();
    vi.advanceTimersByTime(2999);
    expect(hider.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hider.hidden).toBe(true);
    hider.activity();
    expect(hider.hidden).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(changes).toEqual([true, false, true]);
    hider.dispose();
    vi.useRealTimers();
  });
});
