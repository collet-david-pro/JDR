import { describe, expect, it } from 'vitest';
import {
  consoleViewers,
  formatCountdown,
  formatPairingCode,
  formFromDisplay,
  patchFromForm,
  remainingMs,
  seenAgo,
  shortUserAgent,
} from '../../src/lib/sessions/console/displays-logic';
import { createSessionState } from '../../src/lib/sessions/state';
import { snapshot } from '../sessions/fixtures';

const display = {
  name: 'Table',
  settings: {
    diagonal_in: null,
    px_per_mm: null,
    mm_per_cell: 25,
    rotation: 0 as const,
    mirror: false,
    show_tokens: true,
    follow_camera: false,
    view_lock: null,
  },
};

describe('pairing code and countdown', () => {
  it('groups the code by 3', () => {
    expect(formatPairingCode('042917')).toBe('042 917');
    expect(formatPairingCode('0429175')).toBe('042 917 5');
    expect(formatPairingCode('')).toBe('');
  });

  it('counts down to the expiry and stops at 0', () => {
    const end = '2026-01-01T00:10:00Z';
    const now = Date.parse('2026-01-01T00:00:55Z');
    expect(remainingMs(end, now)).toBe(545_000);
    expect(formatCountdown(545_000)).toBe('9:05');
    expect(formatCountdown(500)).toBe('0:01');
    expect(remainingMs(end, Date.parse('2026-01-01T00:10:01Z'))).toBe(0);
    expect(remainingMs('garbage', now)).toBe(0);
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('presence', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('gives a relative last seen', () => {
    expect(seenAgo(null, now)).toEqual({ kind: 'never' });
    expect(seenAgo('2026-01-01T11:59:58Z', now)).toEqual({ kind: 'now' });
    expect(seenAgo('2026-01-01T11:59:30Z', now)).toEqual({ kind: 'seconds', n: 30 });
    expect(seenAgo('2026-01-01T11:50:00Z', now)).toEqual({ kind: 'minutes', n: 10 });
    expect(seenAgo('2026-01-01T09:00:00Z', now)).toEqual({ kind: 'hours', n: 3 });
    expect(seenAgo('2025-12-30T12:00:00Z', now)).toEqual({ kind: 'days', n: 2 });
  });

  it('abbreviates the user agent', () => {
    expect(
      shortUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 126 · Linux');
    expect(shortUserAgent(null)).toBe('');
  });
});

describe('settings form', () => {
  it('round-trips the defaults', () => {
    const result = patchFromForm(formFromDisplay(display));
    expect(result).toEqual({
      patch: {
        name: 'Table',
        settings: {
          diagonal_in: null,
          mm_per_cell: 25,
          rotation: 0,
          mirror: false,
          show_tokens: true,
          follow_camera: false,
        },
      },
    });
  });

  it('builds the patch of the edited fields', () => {
    const form = { ...formFromDisplay(display), diagonal: '55,5', rotation: '180', tokens: false };
    const result = patchFromForm(form);
    expect('patch' in result && result.patch.settings).toMatchObject({
      diagonal_in: 55.5,
      rotation: 180,
      show_tokens: false,
    });
  });

  it('rejects out of range values like the server', () => {
    const form = { ...formFromDisplay(display), name: ' ', diagonal: '4', mm: '101' };
    expect(patchFromForm(form)).toEqual({
      errors: { name: 'name', diagonal_in: 'range', mm_per_cell: 'range' },
    });
    expect('errors' in patchFromForm({ ...formFromDisplay(display), diagonal: 'abc' })).toBe(true);
    expect(
      'errors' in patchFromForm({ ...formFromDisplay(display), diagonal: '300', mm: '5' }),
    ).toBe(false);
  });
});

describe('table viewers given to the engine (D5)', () => {
  const state = (sessionState: 'running' | 'paused' | 'lobby') => {
    const base = createSessionState(snapshot('gm'), '1');
    return { ...base, session: { ...base.session, state: sessionState } };
  };

  it('only while the session runs and a screen is active', () => {
    expect(consoleViewers(state('running'), '35', 1)).toEqual(['t1', 't2']);
    expect(consoleViewers(state('running'), '35', 0)).toEqual([]);
    expect(consoleViewers(state('paused'), '35', 2)).toEqual([]);
    expect(consoleViewers(state('lobby'), '35', 2)).toEqual([]);
    expect(consoleViewers(null, '35', 2)).toEqual([]);
  });

  it('follows the floor', () => {
    expect(consoleViewers(state('running'), '99', 1)).toEqual([]);
  });
});
