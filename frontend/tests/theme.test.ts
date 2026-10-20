import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, parseThemePrefs, resolveScheme } from '../src/lib/theme';

describe('theme preferences', () => {
  it('defaults to modern + auto', () => {
    expect(DEFAULT_THEME).toEqual({ scheme: 'auto', style: 'modern' });
    expect(parseThemePrefs(null)).toEqual(DEFAULT_THEME);
  });

  it('parses stored values and ignores invalid ones', () => {
    expect(parseThemePrefs('{"scheme":"dark","style":"scifi"}')).toEqual({
      scheme: 'dark',
      style: 'scifi',
    });
    expect(parseThemePrefs('{"scheme":"purple","style":"fantasy"}')).toEqual({
      scheme: 'auto',
      style: 'fantasy',
    });
    expect(parseThemePrefs('not json')).toEqual(DEFAULT_THEME);
    expect(parseThemePrefs('null')).toEqual(DEFAULT_THEME);
  });

  it('resolves auto with the system preference', () => {
    expect(resolveScheme('auto', true)).toBe('dark');
    expect(resolveScheme('auto', false)).toBe('light');
    expect(resolveScheme('light', true)).toBe('light');
    expect(resolveScheme('dark', false)).toBe('dark');
  });
});
