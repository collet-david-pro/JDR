import { describe, expect, it } from 'vitest';
import {
  customizeBindings,
  detectPlatform,
  isTypingTarget,
  resolveShortcut,
  shortcutLabel,
  type KeyLike,
} from '../../src/editor/shortcuts';

function key(k: string, opts: Partial<KeyLike> = {}): KeyLike {
  return {
    key: k,
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...opts,
  };
}

describe('editor shortcuts', () => {
  it('maps tool letters and brush size keys', () => {
    for (const [k, action] of [
      ['v', 'tool.select'],
      ['h', 'tool.hand'],
      ['B', 'tool.brush'],
      ['e', 'tool.eraser'],
      ['g', 'tool.fill'],
      ['u', 'tool.shape'],
      ['i', 'tool.pipette'],
      ['m', 'tool.ruler'],
    ] as const) {
      expect(resolveShortcut(key(k), 'other')).toBe(action);
      expect(resolveShortcut(key(k), 'mac')).toBe(action);
    }
    expect(resolveShortcut(key('b', { shiftKey: true }), 'other')).toBeNull();
    expect(resolveShortcut(key('b', { ctrlKey: true }), 'other')).toBeNull();
    expect(resolveShortcut(key('b', { ctrlKey: true }), 'mac')).toBeNull();
    expect(resolveShortcut(key('['), 'other')).toBe('brush.smaller');
    // AltGr on AZERTY Windows (Ctrl+Alt) and Option+Shift on a French Mac.
    expect(resolveShortcut(key(']', { ctrlKey: true, altKey: true }), 'other')).toBe(
      'brush.larger',
    );
    expect(resolveShortcut(key(']', { altKey: true, shiftKey: true }), 'mac')).toBe('brush.larger');
  });

  it('resolves undo/redo per platform', () => {
    expect(resolveShortcut(key('z', { metaKey: true }), 'mac')).toBe('undo');
    expect(resolveShortcut(key('Z', { metaKey: true, shiftKey: true }), 'mac')).toBe('redo');
    expect(resolveShortcut(key('z', { ctrlKey: true }), 'mac')).toBeNull();
    expect(resolveShortcut(key('y', { metaKey: true }), 'mac')).toBeNull();
    expect(resolveShortcut(key('z', { ctrlKey: true }), 'other')).toBe('undo');
    expect(resolveShortcut(key('Z', { ctrlKey: true, shiftKey: true }), 'other')).toBe('redo');
    expect(resolveShortcut(key('y', { ctrlKey: true }), 'other')).toBe('redo');
    expect(resolveShortcut(key('z', { metaKey: true }), 'other')).toBeNull();
  });

  it('uses physical digits for layers (AZERTY) and Mod+0/1 for zoom', () => {
    expect(resolveShortcut(key('&', { code: 'Digit1' }), 'other')).toBe('layer.1');
    expect(resolveShortcut(key('9', { code: 'Digit9', shiftKey: true }), 'mac')).toBe('layer.9');
    expect(resolveShortcut(key('3', { code: 'Numpad3' }), 'other')).toBe('layer.3');
    expect(resolveShortcut(key('à', { code: 'Digit0', metaKey: true }), 'mac')).toBe('zoom.reset');
    expect(resolveShortcut(key('1', { code: 'Digit1', ctrlKey: true }), 'other')).toBe('zoom.fit');
    expect(resolveShortcut(key('Tab'), 'other')).toBe('panels.toggle');
    expect(resolveShortcut(key('?', { shiftKey: true }), 'other')).toBe('help');
    expect(resolveShortcut(key(' '), 'mac')).toBe('pan.hold');
    expect(resolveShortcut(key('Escape'), 'mac')).toBe('cancel');
  });

  it('can be customised and labelled', () => {
    const custom = customizeBindings({
      'tool.brush': [{ action: 'tool.brush', key: 'p', shift: false, alt: false }],
    });
    expect(resolveShortcut(key('p'), 'other', custom)).toBe('tool.brush');
    expect(resolveShortcut(key('b'), 'other', custom)).toBeNull();
    expect(shortcutLabel('redo', 'mac')).toBe('⌘⇧Z');
    expect(shortcutLabel('redo', 'other')).toBe('Ctrl+Shift+Z');
    expect(shortcutLabel('layer.2', 'other')).toBe('2');
    expect(shortcutLabel('pan.hold', 'other')).toBe('Space');
  });

  it('detects the platform and text fields', () => {
    expect(detectPlatform({ userAgentData: { platform: 'macOS' } })).toBe('mac');
    expect(detectPlatform({ platform: 'iPad' })).toBe('mac');
    expect(detectPlatform({ platform: 'Win32' })).toBe('other');
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
