import fr from '$i18n/fr.json';
import { createTranslator, toMessages, type Translate, type TranslationParams } from './translator';

export type { TranslationParams, Translate } from './translator';

/** UI language. French only until P11 (projet.md D11). */
export const locale = 'fr';

const warned = new Set<string>();
const messages = toMessages(fr);

/** Translates a key of i18n/fr.json; see translator.ts for the message format. */
export const t: Translate = createTranslator({
  locale,
  messages,
  onMissing: (key) => {
    if (import.meta.env.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing translation key: ${key}`);
    }
  },
});

let missing = false;
const silent: Translate = createTranslator({
  locale,
  messages,
  onMissing: () => {
    missing = true;
  },
});

/** Translation of an optional key, or null when the key does not exist (no warning). */
export function tryT(key: string, params?: TranslationParams): string | null {
  missing = false;
  const value = silent(key, params);
  return missing ? null : value;
}
