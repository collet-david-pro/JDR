import { describe, expect, it } from 'vitest';
import { formatCheckValue } from '../src/lib/diagnostic-format';

const t = (key: string, params?: Record<string, string | number>): string =>
  ({
    'common.yes': 'Oui',
    'common.no': 'Non',
    'admin.diagnostic.none': 'aucun',
    'admin.diagnostic.more': `(+${params?.['count'] ?? ''})`,
  })[key] ?? key;

describe('formatCheckValue', () => {
  it('formats scalars and booleans', () => {
    expect(formatCheckValue(null, t)).toBe('');
    expect(formatCheckValue('8.5.3', t)).toBe('8.5.3');
    expect(formatCheckValue(128, t)).toBe('128');
    expect(formatCheckValue(true, t)).toBe('Oui');
    expect(formatCheckValue(false, t)).toBe('Non');
  });

  it('formats the integrity object as readable pairs, never [object Object]', () => {
    const text = formatCheckValue(
      { version: '1.0.0', files: 412, modified: ['app/App.php'], missing: [] },
      t,
    );
    expect(text).toBe('version : 1.0.0 · files : 412 · modified : app/App.php · missing : aucun');
    expect(text).not.toContain('[object');
  });

  it('truncates long lists', () => {
    const files = Array.from({ length: 8 }, (_, i) => `f${i}.php`);
    expect(formatCheckValue({ missing: files }, t)).toBe(
      'missing : f0.php, f1.php, f2.php, f3.php, f4.php (+3)',
    );
    expect(formatCheckValue([], t)).toBe('aucun');
  });

  it('keeps nested objects compact', () => {
    expect(formatCheckValue([{ a: 1 }, { b: { c: 2 } }], t)).toBe('{a : 1}, {b : c}');
    expect(formatCheckValue({}, t)).toBe('');
  });
});
