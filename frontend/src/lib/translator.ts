/**
 * Translation engine (pure, no global state). The application instance lives in i18n.ts.
 *
 * Message file format (i18n/fr.json, shared with PHP):
 * - keys are looked up as a flat key first ("home.title": "..."), then as a dotted path in
 *   nested objects ({"home": {"title": "..."}});
 * - interpolation: "Bonjour {name}" with t('key', {name: 'Ana'}); numbers are formatted with
 *   Intl.NumberFormat; unknown placeholders are left untouched;
 * - plurals: the value is an object whose keys are Intl.PluralRules categories
 *   ("zero" | "one" | "two" | "few" | "many" | "other"; "other" is required), selected by the
 *   numeric `count` parameter. An optional "zero" entry is used when count === 0, even in
 *   languages whose rules have no zero category (French maps 0 to "one").
 *     "maps.count": {"zero": "Aucune map", "one": "{count} map", "other": "{count} maps"}
 *     t("maps.count", {count: 3}) => "3 maps"
 * - missing key: the key itself is returned and onMissing is called (a warning in dev).
 */

export type TranslationParams = Readonly<Record<string, string | number>>;

export interface Messages {
  readonly [key: string]: string | Messages;
}

export type Translate = (key: string, params?: TranslationParams) => string;

export interface TranslatorOptions {
  readonly locale: string;
  readonly messages: Messages;
  readonly onMissing?: (key: string) => void;
}

const PLURAL_CATEGORIES: ReadonlySet<string> = new Set([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
]);

/** Validates a parsed JSON value as a message tree. Non-string leaves are dropped. */
export function toMessages(value: unknown): Messages {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string | Messages> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
    else if (typeof item === 'object' && item !== null && !Array.isArray(item))
      out[key] = toMessages(item);
  }
  return out;
}

function lookup(messages: Messages, key: string): string | Messages | undefined {
  const flat = messages[key];
  if (flat !== undefined) return flat;
  let node: string | Messages | undefined = messages;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

function isPluralForms(value: Messages): boolean {
  const keys = Object.keys(value);
  return (
    typeof value['other'] === 'string' &&
    keys.every((k) => PLURAL_CATEGORIES.has(k) && typeof value[k] === 'string')
  );
}

export function createTranslator(options: TranslatorOptions): Translate {
  const { locale, messages, onMissing } = options;
  const pluralRules = new Intl.PluralRules(locale);
  const numberFormat = new Intl.NumberFormat(locale);

  const interpolate = (template: string, params: TranslationParams | undefined): string => {
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      if (value === undefined) return match;
      return typeof value === 'number' ? numberFormat.format(value) : value;
    });
  };

  return (key, params) => {
    const value = lookup(messages, key);
    if (typeof value === 'string') return interpolate(value, params);
    if (value !== undefined && isPluralForms(value)) {
      const count = params?.['count'];
      const n = typeof count === 'number' ? count : Number(count ?? Number.NaN);
      let form: string | Messages | undefined;
      if (n === 0 && typeof value['zero'] === 'string') form = value['zero'];
      else if (Number.isFinite(n)) form = value[pluralRules.select(n)];
      if (typeof form !== 'string') form = value['other'];
      if (typeof form === 'string') return interpolate(form, params);
    }
    onMissing?.(key);
    return key;
  };
}
