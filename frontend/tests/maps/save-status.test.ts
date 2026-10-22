import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SaveStatus } from '../../src/editor/sync/OpsQueue';
import { saveStatusText, saveStatusTone } from '../../src/editor/sync/save-status';
import { createTranslator, toMessages } from '../../src/lib/translator';

/** fr.json + the pending maps translations (merged by the orchestrator). */
function translator() {
  const read = (p: string): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as Record<string, unknown>;
  const pending = new URL('../../../i18n/_pending/maps-front.json', import.meta.url);
  const fr = read('../../../i18n/fr.json');
  const extra = existsSync(pending) ? read(pending.href) : {};
  const merge = (a: unknown, b: unknown): unknown => {
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return b ?? a;
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
    return out;
  };
  return createTranslator({ locale: 'fr', messages: toMessages(merge(fr, extra)) });
}

const status = (s: Partial<SaveStatus>): SaveStatus => ({
  state: 'saved',
  pending: 0,
  error: null,
  durable: true,
  ...s,
});

describe('save indicator texts (projet.md 15.1)', () => {
  const t = translator();

  it('shows the four states of the specification', () => {
    expect(saveStatusText(status({ state: 'saved' }), t)).toBe('Enregistré');
    expect(saveStatusText(status({ state: 'saving', pending: 3 }), t)).toBe('Enregistrement…');
    expect(saveStatusText(status({ state: 'offline', pending: 12 }), t)).toBe(
      'Hors ligne — 12 modifications en attente',
    );
    expect(saveStatusText(status({ state: 'offline', pending: 1 }), t)).toBe(
      'Hors ligne — 1 modification en attente',
    );
    expect(saveStatusText(status({ state: 'conflict' }), t)).toBe('Conflit résolu');
  });

  it('explains blocking errors', () => {
    for (const code of ['revision_conflict', 'unauthenticated', 'forbidden', 'not_found']) {
      const text = saveStatusText(status({ state: 'error', error: code }), t);
      expect(text).not.toMatch(/^editor\./);
    }
    expect(saveStatusText(status({ state: 'error', error: 'validation_failed' }), t)).toBe(
      saveStatusText(status({ state: 'error', error: 'rejected' }), t),
    );
    expect(saveStatusText(status({ state: 'error', error: 'weird' }), t)).toBe(
      'Enregistrement impossible.',
    );
  });

  it('maps states to badge tones', () => {
    expect(
      (['saved', 'saving', 'offline', 'conflict', 'error'] as const).map((state) =>
        saveStatusTone(status({ state })),
      ),
    ).toEqual(['ok', 'info', 'warn', 'warn', 'error']);
  });
});
