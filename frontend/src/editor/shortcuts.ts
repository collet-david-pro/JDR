/**
 * Editor keyboard shortcuts (projet.md 15.2-15.3, P4a subset). Bindings are data so they can be
 * customised later (user_prefs.shortcuts).
 *
 * Letters match on KeyboardEvent.key (layout aware: Cmd+Z is the key labelled Z on AZERTY too);
 * digits match on KeyboardEvent.code (AZERTY digits need Shift); symbols ([ ] ?) accept any
 * Shift/Alt state (AltGr) .
 */

export type LayerShortcut = `layer.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;
export type ShortcutAction =
  | 'tool.select'
  | 'tool.hand'
  | 'tool.brush'
  | 'tool.eraser'
  | 'tool.fill'
  | 'tool.shape'
  | 'tool.pipette'
  | 'tool.ruler'
  | 'brush.smaller'
  | 'brush.larger'
  | 'undo'
  | 'redo'
  | LayerShortcut
  | 'panels.toggle'
  | 'help'
  | 'zoom.reset'
  | 'zoom.fit'
  /** Named snapshot (P4c, projet.md 15.3: Cmd/Ctrl+Shift+S). */
  | 'snapshot'
  /** Space held: temporary hand tool (the UI handles keyup). */
  | 'pan.hold'
  | 'cancel';

export type Platform = 'mac' | 'other';

export interface KeyBinding {
  readonly action: ShortcutAction;
  /** Compared case-insensitively with KeyboardEvent.key. */
  readonly key?: string;
  /** Compared with KeyboardEvent.code (one of key/code is required). */
  readonly code?: string;
  /** Cmd on Mac, Ctrl elsewhere. Default false. */
  readonly mod?: boolean;
  /** undefined = any. */
  readonly shift?: boolean;
  /** undefined = any. */
  readonly alt?: boolean;
  /** Restrict to one platform. */
  readonly platform?: Platform;
}

export interface KeyLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

const tool = (action: ShortcutAction, key: string): KeyBinding => ({
  action,
  key,
  shift: false,
  alt: false,
});

const digitBindings = (n: number, action: ShortcutAction, mod: boolean): KeyBinding[] => [
  { action, code: `Digit${n}`, mod },
  { action, code: `Numpad${n}`, mod },
];

export const DEFAULT_BINDINGS: readonly KeyBinding[] = Object.freeze([
  tool('tool.select', 'v'),
  tool('tool.hand', 'h'),
  tool('tool.brush', 'b'),
  tool('tool.eraser', 'e'),
  tool('tool.fill', 'g'),
  tool('tool.shape', 'u'),
  tool('tool.pipette', 'i'),
  tool('tool.ruler', 'm'),
  { action: 'brush.smaller', key: '[' },
  { action: 'brush.larger', key: ']' },
  { action: 'undo', key: 'z', mod: true, shift: false, alt: false },
  { action: 'redo', key: 'z', mod: true, shift: true, alt: false },
  { action: 'redo', key: 'y', mod: true, shift: false, alt: false, platform: 'other' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) =>
    digitBindings(n, `layer.${n}` as LayerShortcut, false).map((b) => ({ ...b, alt: false })),
  ),
  { action: 'panels.toggle', key: 'Tab', shift: false, alt: false },
  { action: 'help', key: '?' },
  ...digitBindings(0, 'zoom.reset', true),
  ...digitBindings(1, 'zoom.fit', true),
  { action: 'snapshot', key: 's', mod: true, shift: true, alt: false },
  { action: 'pan.hold', key: ' ', shift: false, alt: false },
  { action: 'cancel', key: 'Escape' },
] satisfies KeyBinding[]);

/** Platform from navigator data (userAgentData.platform, platform or userAgent). */
export function detectPlatform(nav: {
  readonly platform?: string;
  readonly userAgent?: string;
  readonly userAgentData?: { readonly platform?: string };
}): Platform {
  const s = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? '';
  return /mac|iphone|ipad|ipod/i.test(s) ? 'mac' : 'other';
}

function matches(b: KeyBinding, e: KeyLike, platform: Platform): boolean {
  if (b.platform !== undefined && b.platform !== platform) return false;
  if (b.code !== undefined ? e.code !== b.code : b.key?.toLowerCase() !== e.key.toLowerCase()) {
    return false;
  }
  // AltGr on Windows/Linux is reported as Ctrl+Alt: not a "mod" for symbol keys.
  const altGr = platform === 'other' && e.ctrlKey && e.altKey && b.alt === undefined;
  const mod = altGr ? false : platform === 'mac' ? e.metaKey : e.ctrlKey;
  const other = platform === 'mac' ? e.ctrlKey : e.metaKey;
  if (other || mod !== (b.mod ?? false)) return false;
  if (b.shift !== undefined && b.shift !== e.shiftKey) return false;
  if (b.alt !== undefined && b.alt !== e.altKey) return false;
  return true;
}

/** Action bound to a key event, or null. */
export function resolveShortcut(
  e: KeyLike,
  platform: Platform,
  bindings: readonly KeyBinding[] = DEFAULT_BINDINGS,
): ShortcutAction | null {
  for (const b of bindings) if (matches(b, e, platform)) return b.action;
  return null;
}

/** Bindings with some actions replaced (customisation: user_prefs.shortcuts). */
export function customizeBindings(
  overrides: Partial<Record<ShortcutAction, readonly KeyBinding[]>>,
  base: readonly KeyBinding[] = DEFAULT_BINDINGS,
): KeyBinding[] {
  const replaced = new Set(Object.keys(overrides));
  const out = base.filter((b) => !replaced.has(b.action));
  for (const list of Object.values(overrides)) if (list !== undefined) out.push(...list);
  return out;
}

/** Human label of the first binding of an action ("⌘⇧Z", "Ctrl+Shift+Z"), for help/tooltips. */
export function shortcutLabel(
  action: ShortcutAction,
  platform: Platform,
  bindings: readonly KeyBinding[] = DEFAULT_BINDINGS,
): string | null {
  return shortcutLabels(action, platform, bindings)[0] ?? null;
}

/** Every distinct label of an action on a platform (e.g. redo: "Ctrl+Shift+Z", "Ctrl+Y"). */
export function shortcutLabels(
  action: ShortcutAction,
  platform: Platform,
  bindings: readonly KeyBinding[] = DEFAULT_BINDINGS,
): string[] {
  const labels = bindings
    .filter((b) => b.action === action && (b.platform ?? platform) === platform)
    .map((b) => bindingLabel(b, platform));
  return [...new Set(labels)];
}

function bindingLabel(b: KeyBinding, platform: Platform): string {
  const keyName =
    b.code !== undefined
      ? b.code.replace(/^(Digit|Numpad|Key)/, '')
      : b.key === ' '
        ? 'Space'
        : (b.key ?? '').length === 1
          ? (b.key ?? '').toUpperCase()
          : (b.key ?? '');
  if (platform === 'mac') {
    return `${b.mod ? '⌘' : ''}${b.alt ? '⌥' : ''}${b.shift ? '⇧' : ''}${keyName}`;
  }
  return [b.mod ? 'Ctrl' : '', b.alt ? 'Alt' : '', b.shift ? 'Shift' : '', keyName]
    .filter((s) => s !== '')
    .join('+');
}

/** True when keyboard focus is in a text field (shortcuts must then be ignored). */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const t = target as { tagName?: unknown; isContentEditable?: unknown };
  if (t.isContentEditable === true) return true;
  return typeof t.tagName === 'string' && /^(INPUT|TEXTAREA|SELECT)$/i.test(t.tagName);
}
