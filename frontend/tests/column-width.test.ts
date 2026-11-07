import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLUMN_LIMITS,
  KEY_STEP,
  MIN_STAGE,
  clampWidth,
  keyWidth,
  loadColumns,
  maxWidth,
  saveColumns,
} from '../src/editor/ui/column-width';

describe('column widths', () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      },
    });
  });

  it('keeps the map at least MIN_STAGE wide', () => {
    expect(maxWidth('panels', 1000, 176)).toBe(1000 - 176 - MIN_STAGE);
    expect(clampWidth('panels', 5000, 1000, 176)).toBe(1000 - 176 - MIN_STAGE);
    expect(clampWidth('panels', 10, 1000, 176)).toBe(COLUMN_LIMITS.panels.min);
    expect(clampWidth('tools', Number.NaN, 1280, 288)).toBe(COLUMN_LIMITS.tools.def);
  });

  it('handles keys (handle on the right of the tools, left of the panels)', () => {
    expect(keyWidth('tools', 'ArrowRight', 176, 1280, 288, 1)).toBe(176 + KEY_STEP);
    expect(keyWidth('panels', 'ArrowRight', 288, 1280, 176, -1)).toBe(288 - KEY_STEP);
    expect(keyWidth('tools', 'Home', 200, 1280, 288, 1)).toBe(COLUMN_LIMITS.tools.min);
    expect(keyWidth('tools', 'End', 200, 1280, 288, 1)).toBe(COLUMN_LIMITS.tools.max);
    expect(keyWidth('tools', 'a', 200, 1280, 288, 1)).toBeNull();
  });

  it('persists and falls back to defaults', () => {
    expect(loadColumns()).toEqual({ tools: 176, panels: 288 });
    saveColumns({ tools: 200, panels: 400 });
    expect(loadColumns()).toEqual({ tools: 200, panels: 400 });
    window.localStorage.setItem('jdr.editor.columns', '{bad');
    expect(loadColumns()).toEqual({ tools: 176, panels: 288 });
    window.localStorage.setItem('jdr.editor.columns', '{"tools":99999,"panels":"x"}');
    expect(loadColumns()).toEqual({ tools: COLUMN_LIMITS.tools.max, panels: 288 });
  });
});
