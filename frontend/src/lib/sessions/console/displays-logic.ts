/**
 * Pure helpers of the console "Screens" panel (P7e): pairing code display, countdown, presence,
 * settings form <-> PATCH, table viewers (D5).
 */
import { tableViewers, type ViewerSource } from '../../displays/viewers';
import type { DisplayInfo, DisplaySettings, Rotation } from '../../displays/types';
import { DEFAULT_MM_PER_CELL } from '../../displays/types';

/** "042917" => "042 917" (any other length is grouped by 3 from the left). */
export function formatPairingCode(code: string): string {
  const digits = code.replace(/\s+/g, '');
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 3) groups.push(digits.slice(i, i + 3));
  return groups.join(' ');
}

/** Milliseconds left before `expiresAt` (0 when expired or unreadable). */
export function remainingMs(expiresAt: string, now: number): number {
  const end = Date.parse(expiresAt);
  return Number.isNaN(end) ? 0 : Math.max(0, end - now);
}

/** "9:05" */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export type SeenAgo =
  | { readonly kind: 'never' }
  | { readonly kind: 'now' }
  | { readonly kind: 'seconds' | 'minutes' | 'hours' | 'days'; readonly n: number };

/** Relative "last seen" (the label is translated by the component). */
export function seenAgo(lastSeenAt: string | null, now: number): SeenAgo {
  if (lastSeenAt === null) return { kind: 'never' };
  const at = Date.parse(lastSeenAt);
  if (Number.isNaN(at)) return { kind: 'never' };
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return { kind: 'now' };
  if (seconds < 60) return { kind: 'seconds', n: seconds };
  if (seconds < 3600) return { kind: 'minutes', n: Math.floor(seconds / 60) };
  if (seconds < 86400) return { kind: 'hours', n: Math.floor(seconds / 3600) };
  return { kind: 'days', n: Math.floor(seconds / 86400) };
}

/** Short user agent for a tooltip: "Chrome 126 · Linux". */
export function shortUserAgent(ua: string | null): string {
  if (ua === null || ua === '') return '';
  const browser = /(Firefox|Edg|Chrome|Version)\/(\d+)/.exec(ua) ?? /(Safari)\/(\d+)/.exec(ua);
  const name =
    browser === null
      ? ''
      : browser[1] === 'Edg'
        ? 'Edge'
        : browser[1] === 'Version'
          ? 'Safari'
          : (browser[1] ?? '');
  const os = /(Windows|Android|iPhone|iPad|Mac OS X|Linux|CrOS)/.exec(ua)?.[1] ?? '';
  const parts = [browser === null ? '' : `${name} ${browser[2]}`, os === 'Mac OS X' ? 'macOS' : os];
  return parts.filter((p) => p !== '').join(' · ') || ua.slice(0, 40);
}

/** Viewers given to the engine in GM view: the table, only while it is shown (D5). */
export function consoleViewers(
  state: ViewerSource | null,
  floor: string | null,
  activeScreens: number,
): string[] {
  if (state === null || state.session.state !== 'running' || activeScreens <= 0) return [];
  return tableViewers(state, floor);
}

// -- Settings form (D8) -------------------------------------------------------------------

export interface SettingsForm {
  name: string;
  diagonal: string;
  mm: string;
  rotation: string;
  mirror: boolean;
  tokens: boolean;
  follow: boolean;
}

export function formFromDisplay(d: Pick<DisplayInfo, 'name' | 'settings'>): SettingsForm {
  const s = d.settings;
  return {
    name: d.name,
    diagonal: s.diagonal_in === null ? '' : String(s.diagonal_in),
    mm: String(s.mm_per_cell),
    rotation: String(s.rotation),
    mirror: s.mirror,
    tokens: s.show_tokens,
    follow: s.follow_camera,
  };
}

export type FormErrors = Partial<Record<'name' | 'diagonal_in' | 'mm_per_cell', 'name' | 'range'>>;

export interface FormPatch {
  readonly name: string;
  readonly settings: Partial<DisplaySettings>;
}

function number(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(v) ? null : v;
}

/** Validates the form (same bounds as the server) and builds the PATCH, or the errors. */
export function patchFromForm(form: SettingsForm): { patch: FormPatch } | { errors: FormErrors } {
  const errors: FormErrors = {};
  const name = form.name.trim();
  if (name.length < 1 || name.length > 60) errors.name = 'name';
  let diagonal: number | null = null;
  if (form.diagonal.trim() !== '') {
    diagonal = number(form.diagonal);
    if (diagonal === null || diagonal < 5 || diagonal > 300) errors.diagonal_in = 'range';
  }
  const mm = form.mm.trim() === '' ? DEFAULT_MM_PER_CELL : number(form.mm);
  if (mm === null || mm < 5 || mm > 100) errors.mm_per_cell = 'range';
  if (Object.keys(errors).length > 0) return { errors };
  const rotation = Number(form.rotation);
  return {
    patch: {
      name,
      settings: {
        diagonal_in: diagonal,
        mm_per_cell: mm ?? DEFAULT_MM_PER_CELL,
        rotation: ([0, 90, 180, 270].includes(rotation) ? rotation : 0) as Rotation,
        mirror: form.mirror,
        show_tokens: form.tokens,
        follow_camera: form.follow,
      },
    },
  };
}
