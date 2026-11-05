/**
 * Theme model (projet.md Q8 + user answer): two independent axes applied on <html>.
 * - data-scheme="light|dark": resolved colour scheme (preference light | dark | auto,
 *   auto follows prefers-color-scheme);
 * - data-style="modern|fantasy|scifi": visual style, "modern" (neutral, light) by default.
 * All visual values are CSS custom properties (design tokens, src/styles/tokens.css).
 */

export const SCHEME_PREFERENCES = ['auto', 'light', 'dark'] as const;
/** Available interface styles. */
export const UI_STYLES = ['modern', 'fantasy', 'scifi'] as const;

export type SchemePreference = (typeof SCHEME_PREFERENCES)[number];
export type ResolvedScheme = 'light' | 'dark';
export type UiStyle = (typeof UI_STYLES)[number];

export interface ThemePrefs {
  readonly scheme: SchemePreference;
  readonly style: UiStyle;
}

/** Default theme preferences. */
export const DEFAULT_THEME: ThemePrefs = Object.freeze({ scheme: 'auto', style: 'modern' });

/** Local storage key of the theme preferences. */
export const THEME_STORAGE_KEY = 'jdr.theme';

/** Type guard for color scheme preferences. */
export function isSchemePreference(value: unknown): value is SchemePreference {
  return typeof value === 'string' && (SCHEME_PREFERENCES as readonly string[]).includes(value);
}

/** Type guard for interface styles. */
export function isUiStyle(value: unknown): value is UiStyle {
  return typeof value === 'string' && (UI_STYLES as readonly string[]).includes(value);
}

/** Parses stored preferences; invalid or missing values fall back to the defaults. */
export function parseThemePrefs(raw: string | null): ThemePrefs {
  if (raw === null) return DEFAULT_THEME;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_THEME;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_THEME;
  const record = value as Record<string, unknown>;
  return {
    scheme: isSchemePreference(record['scheme']) ? record['scheme'] : DEFAULT_THEME.scheme,
    style: isUiStyle(record['style']) ? record['style'] : DEFAULT_THEME.style,
  };
}

/** Resolves the color scheme from the preference and the system setting. */
export function resolveScheme(preference: SchemePreference, systemDark: boolean): ResolvedScheme {
  if (preference === 'auto') return systemDark ? 'dark' : 'light';
  return preference;
}
