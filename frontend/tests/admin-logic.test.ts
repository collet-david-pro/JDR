import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/lib/api';
import { CursorList, cursorFetcher } from '../src/lib/cursor-list.svelte';
import {
  bytesToMbInput,
  formatBytes,
  formatDuration,
  mbInputToBytes,
  usageRatio,
} from '../src/lib/format';
import { buildSettingsPatch, toFormValues, validateSettings } from '../src/lib/settings-form';
import { analyzeArrivals, runSseProbe, type EventSourceLike } from '../src/lib/sse-probe';
import type { SiteSettings } from '../src/lib/types';

const MIB = 1024 * 1024;
/** Intl uses (narrow) no-break spaces between numbers and units. */
const sp = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ');

describe('format', () => {
  it('formats sizes in ko/Mo/Go', () => {
    expect(sp(formatBytes(0))).toBe('0 Mo');
    expect(sp(formatBytes(512 * 1024))).toBe('512 ko');
    expect(sp(formatBytes(12.5 * MIB))).toBe('12,5 Mo');
    expect(sp(formatBytes(500 * MIB))).toBe('500 Mo');
    expect(sp(formatBytes(1.25 * 1024 * MIB))).toBe('1,25 Go');
  });

  it('converts Mo form values', () => {
    expect(mbInputToBytes('')).toBeNull();
    expect(mbInputToBytes('10')).toBe(10 * MIB);
    expect(mbInputToBytes('0,5')).toBe(MIB / 2);
    expect(mbInputToBytes('abc')).toBeUndefined();
    expect(mbInputToBytes('-1')).toBeUndefined();
    expect(bytesToMbInput(null)).toBe('');
    expect(bytesToMbInput(500 * MIB)).toBe('500');
  });

  it('formats durations and ratios', () => {
    expect(sp(formatDuration(30))).toBe('30 secondes');
    expect(sp(formatDuration(61))).toBe('2 minutes');
    expect(usageRatio(50, 100)).toBe(0.5);
    expect(usageRatio(150, 100)).toBe(1);
    expect(usageRatio(1, null)).toBeNull();
  });
});

const settings: SiteSettings = {
  site_name: 'JDR',
  base_url: 'https://jdr.example.test',
  default_locale: 'fr',
  registration_mode: 'open',
  default_quota_bytes: 500 * MIB,
  max_upload_bytes: 10 * MIB,
  max_dimension_px: 4096,
  max_total_pixels: 16777216,
  max_frames: 300,
  max_animation_ms: 60000,
  events_retention_hours: 24,
  versions_retention: 20,
  trash_days: 30,
  session_idle_hours: 12,
  use_db_sessions: false,
  maintenance: false,
  smtp: {
    host: '',
    port: 587,
    encryption: 'starttls',
    username: '',
    password_set: true,
    from_email: '',
    from_name: 'JDR',
  },
};

describe('settings form', () => {
  it('round-trips without changes', () => {
    const form = toFormValues(settings);
    expect(form.values['default_quota_bytes']).toBe('500');
    expect(validateSettings(form)).toEqual({});
    expect(buildSettingsPatch(settings, form)).toEqual({});
  });

  it('builds a patch of the changed fields; the SMTP password is write-only', () => {
    const form = toFormValues(settings);
    form.values['site_name'] = 'Ma table';
    form.values['default_quota_bytes'] = '1024';
    form.values['trash_days'] = '7';
    form.values['smtp.host'] = 'smtp.example.test';
    form.flags.maintenance = true;
    expect(buildSettingsPatch(settings, form)).toEqual({
      site_name: 'Ma table',
      default_quota_bytes: 1024 * MIB,
      trash_days: 7,
      maintenance: true,
      smtp: { host: 'smtp.example.test' },
    });
    form.smtpPassword = 'secret';
    expect(buildSettingsPatch(settings, form).smtp).toEqual({
      host: 'smtp.example.test',
      password: 'secret',
    });
  });

  it('validates the values', () => {
    const form = toFormValues(settings);
    form.values['base_url'] = 'ftp://x';
    form.values['max_frames'] = '-3';
    form.values['default_quota_bytes'] = '';
    form.values['smtp.host'] = 'smtp.example.test';
    form.values['smtp.port'] = '70000';
    form.values['smtp.from_email'] = 'nope';
    expect(validateSettings(form)).toEqual({
      base_url: 'invalid',
      max_frames: 'invalid',
      default_quota_bytes: 'required',
      'smtp.port': 'invalid',
      'smtp.from_email': 'invalid',
    });
  });
});

describe('SSE probe', () => {
  it('analyses arrival times', () => {
    expect(analyzeArrivals([1000, 2000, 3000], 3, 400, false)).toMatchObject({
      ok: true,
      buffered: false,
    });
    expect(analyzeArrivals([3000, 3001, 3002], 3, 400, false)).toMatchObject({
      ok: false,
      buffered: true,
    });
    expect(analyzeArrivals([1000], 3, 400, true)).toMatchObject({
      ok: false,
      failed: true,
      received: 1,
    });
  });

  it('opens the stream, counts messages and closes it', async () => {
    const listeners = new Map<string, () => void>();
    const source: EventSourceLike = {
      addEventListener: (type, fn) => listeners.set(type, fn),
      close: vi.fn(),
    };
    let clock = 0;
    const promise = runSseProbe('/api/v1/admin/diagnostic/sse', {
      open: () => source,
      now: () => clock,
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    for (const at of [1000, 2000, 3000]) {
      clock = at;
      listeners.get('message')?.();
    }
    const result = await promise;
    expect(result).toMatchObject({ ok: true, received: 3, arrivals: [1000, 2000, 3000] });
    expect(source.close).toHaveBeenCalled();
  });

  it('reports a connection failure', async () => {
    const listeners = new Map<string, () => void>();
    const promise = runSseProbe('/sse', {
      open: () => ({
        addEventListener: (type, fn) => listeners.set(type, fn),
        close: () => undefined,
      }),
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    listeners.get('error')?.();
    expect(await promise).toMatchObject({ ok: false, failed: true, received: 0 });
  });
});

describe('CursorList', () => {
  it('loads pages with ?cursor= and meta.next_cursor', async () => {
    const pages: Record<string, unknown> = {
      '': { ok: true, data: [{ id: '1' }, { id: '2' }], meta: { next_cursor: 'c2' } },
      c2: { ok: true, data: [{ id: '3' }], meta: { next_cursor: null } },
    };
    const urls: string[] = [];
    const api = new ApiClient({
      baseUrl: '/api/v1',
      sleep: () => Promise.resolve(),
      fetch: ((input: string) => {
        urls.push(input);
        const cursor = new URL(input, 'https://x.test').searchParams.get('cursor') ?? '';
        return Promise.resolve(new Response(JSON.stringify(pages[cursor]), { status: 200 }));
      }) as unknown as typeof fetch,
    });
    const list = new CursorList<{ id: string }>(
      cursorFetcher(api, '/admin/users', () => ({ q: 'an', status: null, limit: 50 })),
    );
    await list.reload();
    expect(list.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(list.hasMore).toBe(true);
    await list.more();
    expect(list.items.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(list.hasMore).toBe(false);
    expect(urls).toEqual([
      '/api/v1/admin/users?q=an&limit=50',
      '/api/v1/admin/users?q=an&limit=50&cursor=c2',
    ]);
    list.remove((i) => i.id === '2');
    expect(list.items.map((i) => i.id)).toEqual(['1', '3']);
  });
});
