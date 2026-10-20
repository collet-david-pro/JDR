import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  parseThemePrefs,
  resolveScheme,
  type ResolvedScheme,
  type SchemePreference,
  type UiStyle,
} from '../lib/theme';

/**
 * User interface preferences (local to the device for now; synchronised with
 * PUT /me/prefs/{key} once accounts exist, phase P1).
 */
class PrefsStore {
  scheme = $state<SchemePreference>(DEFAULT_THEME.scheme);
  style = $state<UiStyle>(DEFAULT_THEME.style);
  systemDark = $state(false);
  reducedMotion = $state(false);
  readonly resolvedScheme: ResolvedScheme = $derived(resolveScheme(this.scheme, this.systemDark));

  private win: Window | null = null;

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
  }

  setStyle(style: UiStyle): void {
    this.style = style;
    this.persist();
    this.apply();
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
