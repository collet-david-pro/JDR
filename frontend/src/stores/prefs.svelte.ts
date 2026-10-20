import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isSchemePreference,
  isUiStyle,
  parseThemePrefs,
  resolveScheme,
  type ResolvedScheme,
  type SchemePreference,
  type UiStyle,
} from '../lib/theme';

/** Server preference keys of the theme (PUT /me/prefs/{key}). */
export const THEME_PREF_KEYS = { scheme: 'theme_scheme', style: 'theme_style' } as const;

/** Sends a preference to the server (set by the auth store while signed in). */
export type RemotePrefSync = (key: string, value: string) => void;

/**
 * User interface preferences: stored on the device (localStorage) and, while signed in,
 * synchronised with the account (GET /auth/me prefs, PUT /me/prefs/{key}).
 */
class PrefsStore {
  scheme = $state<SchemePreference>(DEFAULT_THEME.scheme);
  style = $state<UiStyle>(DEFAULT_THEME.style);
  systemDark = $state(false);
  reducedMotion = $state(false);
  readonly resolvedScheme: ResolvedScheme = $derived(resolveScheme(this.scheme, this.systemDark));

  private win: Window | null = null;
  private remote: RemotePrefSync | null = null;

  /** Reads stored preferences, follows system settings and applies the theme to <html>. */
  init(win: Window = window): void {
    this.win = win;
    const stored = parseThemePrefs(readStorage(win, THEME_STORAGE_KEY));
    this.scheme = stored.scheme;
    this.style = stored.style;

    const dark = win.matchMedia('(prefers-color-scheme: dark)');
    const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
    this.systemDark = dark.matches;
    this.reducedMotion = motion.matches;
    dark.addEventListener('change', (event) => {
      this.systemDark = event.matches;
      this.apply();
    });
    motion.addEventListener('change', (event) => {
      this.reducedMotion = event.matches;
    });
    this.apply();
  }

  setScheme(scheme: SchemePreference): void {
    this.scheme = scheme;
    this.persist();
    this.apply();
    this.remote?.(THEME_PREF_KEYS.scheme, scheme);
  }

  setStyle(style: UiStyle): void {
    this.style = style;
    this.persist();
    this.apply();
    this.remote?.(THEME_PREF_KEYS.style, style);
  }

  /** Enables (signed in) or disables (signed out) the server synchronisation. */
  setRemoteSync(sync: RemotePrefSync | null): void {
    this.remote = sync;
  }

  /**
   * Applies the account preferences received from the server (invalid values are ignored).
   * Returns the theme keys missing on the server, so that the caller can upload the
   * device values.
   */
  applyRemote(values: Readonly<Record<string, unknown>>): string[] {
    const missing: string[] = [];
    const scheme = values[THEME_PREF_KEYS.scheme];
    const style = values[THEME_PREF_KEYS.style];
    if (isSchemePreference(scheme)) this.scheme = scheme;
    else missing.push(THEME_PREF_KEYS.scheme);
    if (isUiStyle(style)) this.style = style;
    else missing.push(THEME_PREF_KEYS.style);
    this.persist();
    this.apply();
    return missing;
  }

  /** Current value of a theme preference key. */
  valueOf(key: string): string | null {
    if (key === THEME_PREF_KEYS.scheme) return this.scheme;
    if (key === THEME_PREF_KEYS.style) return this.style;
    return null;
  }

  private persist(): void {
    if (this.win === null) return;
    writeStorage(
      this.win,
      THEME_STORAGE_KEY,
      JSON.stringify({ scheme: this.scheme, style: this.style }),
    );
  }

  private apply(): void {
    if (this.win === null) return;
    const root = this.win.document.documentElement;
    const scheme = resolveScheme(this.scheme, this.systemDark);
    root.dataset['scheme'] = scheme;
    root.dataset['style'] = this.style;
    root.style.colorScheme = scheme;
  }
}

/** localStorage may be unavailable (private mode, disabled storage, sandbox). */
function readStorage(win: Window, key: string): string | null {
  try {
    return win.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(win: Window, key: string, value: string): void {
  try {
    win.localStorage.setItem(key, value);
  } catch {
    // Preference kept for this page only.
  }
}

export const prefs = new PrefsStore();
