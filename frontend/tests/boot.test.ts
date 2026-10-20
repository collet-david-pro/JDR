import { describe, expect, it } from 'vitest';
import { BootConfigError, DEV_BOOT_CONFIG, parseBootConfig, readBootConfig } from '../src/lib/boot';

const valid = {
  version: '1.2.3',
  api_base: '/base/api/v1',
  routing_mode: 'rewrite',
  base_path: '/base',
  csrf: null,
};

const parse = (value: unknown) => parseBootConfig(JSON.stringify(value));

describe('parseBootConfig', () => {
  it('accepts the rewrite-mode shell payload', () => {
    expect(parse(valid)).toEqual({
      version: '1.2.3',
      apiBase: '/base/api/v1',
      routingMode: 'rewrite',
      basePath: '/base',
      csrf: null,
    });
  });

  it('accepts the query-mode shell payload at the domain root', () => {
    const config = parse({
      ...valid,
      api_base: '/index.php?r=/api/v1',
      routing_mode: 'query',
      base_path: '',
      csrf: 'abc',
    });
    expect(config.apiBase).toBe('/index.php?r=/api/v1');
    expect(config.routingMode).toBe('query');
    expect(config.basePath).toBe('');
    expect(config.csrf).toBe('abc');
  });

  it('normalises trailing slashes and a missing csrf', () => {
    const { csrf: _csrf, ...withoutCsrf } = valid;
    const config = parse({ ...withoutCsrf, base_path: '/base/', api_base: '/base/api/v1/' });
    expect(config.basePath).toBe('/base');
    expect(config.apiBase).toBe('/base/api/v1');
    expect(config.csrf).toBeNull();
    expect(parse({ ...valid, base_path: '/' }).basePath).toBe('');
  });

  it.each([
    ['invalid JSON', '{'],
    ['an array', '[]'],
    ['an empty version', JSON.stringify({ ...valid, version: '' })],
    ['an unknown routing mode', JSON.stringify({ ...valid, routing_mode: 'hash' })],
    ['a relative base path', JSON.stringify({ ...valid, base_path: 'base' })],
    ['a base path with a query', JSON.stringify({ ...valid, base_path: '/base?x' })],
    ['a missing base path', JSON.stringify({ ...valid, base_path: undefined })],
    ['a cross-origin api base', JSON.stringify({ ...valid, api_base: 'https://evil.test/api' })],
    ['a protocol-relative api base', JSON.stringify({ ...valid, api_base: '//evil.test/api' })],
    ['a non-string csrf', JSON.stringify({ ...valid, csrf: 12 })],
  ])('rejects %s', (_label, text) => {
    expect(() => parseBootConfig(text)).toThrow(BootConfigError);
  });
});

describe('readBootConfig', () => {
  const docWith = (text: string | null) => ({
    getElementById: (id: string) =>
      text === null || id !== 'jdr-boot' ? null : ({ textContent: text } as HTMLElement),
  });

  it('reads the #jdr-boot element', () => {
    expect(readBootConfig(docWith(JSON.stringify(valid)), false).basePath).toBe('/base');
  });

  it('uses development defaults when the element is missing in dev', () => {
    expect(readBootConfig(docWith(null), true)).toEqual(DEV_BOOT_CONFIG);
    expect(DEV_BOOT_CONFIG).toMatchObject({
      apiBase: '/api/v1',
      routingMode: 'rewrite',
      basePath: '',
    });
  });

  it('fails in production when the element is missing', () => {
    expect(() => readBootConfig(docWith(null), false)).toThrow(BootConfigError);
  });
});
