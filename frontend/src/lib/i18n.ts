import fr from '$i18n/fr.json';
import { createTranslator, toMessages, type Translate } from './translator';

export type { TranslationParams, Translate } from './translator';

/** UI language. French only until P11 (projet.md D11). */
export const locale = 'fr';

const warned = new Set<string>();

/** Translates a key of i18n/fr.json; see translator.ts for the message format. */
export const t: Translate = createTranslator({
  locale,
  messages: toMessages(fr),
  onMissing: (key) => {
    if (import.meta.env.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing translation key: ${key}`);
    }
  },
});
