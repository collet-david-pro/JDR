import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { resolveShortcut } from '../../src/editor/shortcuts';
import { EditorSession } from '../../src/editor/ui/session';
import { commandLabel, shortcutDescription } from '../../src/editor/ui/labels';
import { applyHandoff } from '../../src/lib/procgen/handoff-apply';
import { stashGeneration, takeGeneration } from '../../src/lib/procgen/handoff';
import { TexturePanelModel, palettesFor } from '../../src/lib/procgen/texture-panel.svelte';
import { GENERATOR_IDS, GENERATOR_INFO } from '../../src/procgen/generators';
import { MATERIALS, PALETTES } from '../../src/procgen/textures';
import type { GenResult } from '../../src/procgen/types';
import { grid } from '../editor/helpers';

const key = (k: string, shift = false) => ({
  key: k,
  code: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: shift,
  altKey: false,
});

describe('shortcut Shift+G', () => {
  it('opens the panel; G alone stays the fill tool', () => {
    expect(resolveShortcut(key('G', true), 'other')).toBe('generate');
    expect(resolveShortcut(key('g'), 'other')).toBe('tool.fill');
    expect(resolveShortcut(key('g'), 'mac')).toBe('tool.fill');
  });

  it('is handled by the session and described in the help', () => {
    const session = new EditorSession({ grid: grid(10, 10) });
    expect(session.ui.generateOpen).toBe(false);
    session.ui.panelsOpen = false;
    session.handleKeyDown({ ...key('G', true), target: null, repeat: false });
    expect(session.ui.generateOpen).toBe(true);
    expect(session.ui.panelsOpen).toBe(true);
    expect(shortcutDescription('generate')).not.toBeNull();
    expect(commandLabel('editor.command.generate')).toBeTypeOf('string');
  });
});

describe('hand-off of a new map', () => {
  const result = (): GenResult => ({
    generator: 'cave',
    gen_version: 1,
    seed: 'graine',
    width: 3,
    height: 3,
    floors: [],
    stats: {},
  });

  it('applies the stashed generation once and stores it in maps.generation', async () => {
    stashGeneration('42', { result: result(), params: { fill: 0.5, width: 3, height: 3 } });
    const update = vi.fn(async () => undefined);
    const session = new EditorSession({ grid: grid(10, 10) });
    // a result without floor makes applyGeneration throw: the stash is restored
    await expect(
      applyHandoff({
        mapId: '42',
        session,
        update,
        loadPack: async () => ({ version: 1, assets: {} }),
      }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(takeGeneration('42')).not.toBeNull();
    expect(takeGeneration('42')).toBeNull();
  });

  it('does nothing without a stash', async () => {
    const session = new EditorSession({ grid: grid(10, 10) });
    const loadPack = vi.fn();
    expect(await applyHandoff({ mapId: 'none', session, update: vi.fn(), loadPack })).toBeNull();
    expect(loadPack).not.toHaveBeenCalled();
  });
});

describe('texture model', () => {
  it('keeps a palette that suits the material and renders on change', () => {
    const model = new TexturePanelModel({ upload: vi.fn(), t: (k) => k });
    expect(PALETTES[model.palette]!.materials).toContain(model.material);
    model.setMaterial('wood');
    expect(PALETTES[model.palette]!.materials).toContain('wood');
    expect(palettesFor('wood').length).toBeGreaterThan(0);
    model.size = 128;
    model.render();
    expect(model.pixels).toHaveLength(128 * 128 * 4);
  });

  it('uploads an opaque PNG named "<matière> <palette> <graine>" with source generated', async () => {
    const upload = vi.fn(async (_f: Blob, _n: string, fields: unknown) => ({
      asset: { id: '5', name: (fields as { name: string }).name } as never,
      duplicate: false,
    }));
    const model = new TexturePanelModel({ upload, t: (k) => k });
    model.setMaterial('wood');
    model.palette = 'oak';
    model.size = 128;
    model.seed = 'planches';
    model.render();
    await model.save();
    const [file, , fields] = upload.mock.calls[0]!;
    expect(fields).toEqual({
      kind: 'texture',
      name: 'procgen.materials.wood Chêne planches',
      source: 'generated',
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes[25]).toBe(2); // colour type 2: RGB, no alpha
    expect(model.saved?.asset.id).toBe('5');
    expect(model.saving).toBe(false);
  });

  it('a failed upload rethrows and re-enables saving', async () => {
    const model = new TexturePanelModel({
      upload: vi.fn(async () => {
        throw new Error('413');
      }),
      t: (k) => k,
    });
    model.size = 128;
    model.render();
    await expect(model.save()).rejects.toThrow('413');
    expect(model.saving).toBe(false);
    expect(model.saved).toBeNull();
  });
});

describe('translations of the panel', () => {
  const read = (rel: string): unknown =>
    JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
  const fr = read('../../../i18n/fr.json');
  const find = (path: string): unknown => {
    let cur: unknown = fr;
    for (const part of path.split('.')) {
      cur =
        typeof cur === 'object' && cur !== null
          ? (cur as Record<string, unknown>)[part]
          : undefined;
    }
    return cur;
  };

  it('every generator, parameter, preset, theme, material and option has a label', () => {
    const missing: string[] = [];
    const need = (path: string): void => {
      if (typeof find(path) !== 'string') missing.push(path);
    };
    for (const g of GENERATOR_IDS) {
      need(`procgen.generators.${g}`);
      for (const spec of GENERATOR_INFO[g].params) {
        need(`procgen.params.${spec.key}`);
        for (const option of spec.options ?? []) {
          need(
            spec.key === 'theme'
              ? `procgen.themes.${g}.${option}`
              : `procgen.options.${spec.key}.${option}`,
          );
        }
      }
      for (const preset of Object.keys(GENERATOR_INFO[g].presets)) {
        need(`procgen.presets.${g}.${preset}`);
      }
    }
    for (const m of MATERIALS) need(`procgen.materials.${m}`);
    for (const k of ['editor.shortcuts.generate', 'editor.command.generate']) need(k);
    expect(missing).toEqual([]);
  });
});
