import { describe, expect, it, vi } from 'vitest';
import { createTranslator, toMessages } from '../src/lib/translator';

const messages = toMessages({
  'flat.key': 'Clé plate',
  app: { name: 'JDR', hello: 'Bonjour {name} !', size: '{size} Mo' },
  maps: {
    count: { zero: 'Aucune map', one: '{count} map', other: '{count} maps' },
    players: { one: '{count} joueur', other: '{count} joueurs' },
  },
  theme: { scheme: { label: 'Apparence', light: 'Clair' } },
  invalid: 42,
});

describe('translator', () => {
  it('looks up flat and nested keys', () => {
    const t = createTranslator({ locale: 'fr', messages });
    expect(t('flat.key')).toBe('Clé plate');
    expect(t('app.name')).toBe('JDR');
    expect(t('theme.scheme.label')).toBe('Apparence');
  });

  it('interpolates parameters and formats numbers', () => {
    const t = createTranslator({ locale: 'fr', messages });
    expect(t('app.hello', { name: 'Ana' })).toBe('Bonjour Ana !');
    expect(t('app.hello')).toBe('Bonjour {name} !');
    expect(t('app.size', { size: 1500.5 })).toBe(
      `${new Intl.NumberFormat('fr').format(1500.5)} Mo`,
    );
  });

  it('selects plural forms with Intl.PluralRules', () => {
    const t = createTranslator({ locale: 'fr', messages });
    expect(t('maps.count', { count: 0 })).toBe('Aucune map');
    expect(t('maps.count', { count: 1 })).toBe('1 map');
    expect(t('maps.count', { count: 3 })).toBe('3 maps');
    // French: 0 and 1 are "one" when no explicit zero form exists.
    expect(t('maps.players', { count: 0 })).toBe('0 joueur');
    expect(t('maps.players', { count: 1.5 })).toBe('1,5 joueur');
    expect(t('maps.players', { count: 2 })).toBe('2 joueurs');
  });

  it('uses English plural rules for an English locale', () => {
    const t = createTranslator({ locale: 'en', messages });
    expect(t('maps.players', { count: 0 })).toBe('0 joueurs');
  });

  it('falls back to "other" without a count', () => {
    const t = createTranslator({ locale: 'fr', messages });
    expect(t('maps.players')).toBe('{count} joueurs');
  });

  it('returns the key and reports missing translations', () => {
    const onMissing = vi.fn();
    const t = createTranslator({ locale: 'fr', messages, onMissing });
    expect(t('does.not.exist')).toBe('does.not.exist');
    expect(t('theme.scheme')).toBe('theme.scheme'); // an object that is not a plural
    expect(t('invalid')).toBe('invalid');
    expect(onMissing).toHaveBeenCalledWith('does.not.exist');
    expect(onMissing).toHaveBeenCalledTimes(3);
  });
});
