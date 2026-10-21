import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REJECT_REASONS } from '../src/lib/assets/reduce-plan';
import { UPLOAD_ERROR_CODES } from '../src/lib/assets/upload-errors';
import { INT_KEYS } from '../src/lib/settings-form';
import { createTranslator, toMessages } from '../src/lib/translator';
import { SCHEME_PREFERENCES, UI_STYLES } from '../src/lib/theme';
import { VALIDATION_CODES } from '../src/lib/validation';

/**
 * Integration check with the shared translations (owned by the PHP side): every key used
 * literally by the front-end must exist in i18n/fr.json or in a pending file
 * i18n/_pending/*.json (keys written by parallel work lots, merged into fr.json by the
 * orchestrator). Dynamic keys are listed explicitly below.
 */
const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const frJson = fileURLToPath(new URL('../../i18n/fr.json', import.meta.url));
const pendingDir = fileURLToPath(new URL('../../i18n/_pending/', import.meta.url));

type Tree = Record<string, unknown>;

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge of nested message trees (later sources win on leaves). */
function mergeTrees(...trees: unknown[]): Tree {
  const out: Tree = {};
  for (const tree of trees) {
    if (!isTree(tree)) continue;
    for (const [key, value] of Object.entries(tree)) {
      const current = out[key];
      out[key] = isTree(current) && isTree(value) ? mergeTrees(current, value) : value;
    }
  }
  return out;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function messageSources(): unknown[] {
  const sources: unknown[] = [readJson(frJson)];
  if (existsSync(pendingDir)) {
    for (const name of readdirSync(pendingDir).sort()) {
      if (name.endsWith('.json')) sources.push(readJson(join(pendingDir, name)));
    }
  }
  return sources;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte)$/.test(name) ? [path] : [];
  });
}

function usedKeys(): Set<string> {
  const keys = new Set<string>();
  const patterns = [
    /\bt\(\s*'([a-z_]+(?:\.[a-z_]+)+)'/g,
    /titleKey[:=]\s*["']([a-z_]+(?:\.[a-z_]+)+)["']/g,
  ];
  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) if (match[1]) keys.add(match[1]);
    }
  }
  // Dynamic keys.
  for (const scheme of SCHEME_PREFERENCES) keys.add(`theme.scheme.${scheme}`);
  for (const style of UI_STYLES) keys.add(`theme.style.${style}`);
  for (const code of [
    'network',
    'timeout',
    'unknown',
    'invalid_credentials',
    'reset_link_invalid',
    'csrf_invalid',
    'account_suspended',
    'registration_closed',
    'last_admin',
    'self_action',
  ])
    keys.add(`errors.${code}`);
  for (const code of VALIDATION_CODES) keys.add(`validation.${code}`);
  for (const key of INT_KEYS) keys.add(`admin.settings.fields.${key}`);
  for (const status of ['ok', 'warn', 'error']) keys.add(`admin.diagnostic.status.${status}`);
  for (const reason of REJECT_REASONS) keys.add(`library.upload.reject.${reason}`);
  for (const code of UPLOAD_ERROR_CODES) {
    keys.add(`library.upload.errors.${code}`);
    keys.add(`errors.${code}`);
  }
  // Keys chosen by a condition inside t(...).
  for (const key of [
    'admin.users.suspended',
    'admin.users.unsuspended',
    'admin.users.role_admin',
    'admin.users.role_user',
    'common.yes',
    'common.no',
  ])
    keys.add(key);
  return keys;
}

describe('mergeTrees', () => {
  it('merges nested objects and keeps sibling keys', () => {
    expect(mergeTrees({ a: { b: '1' } }, { a: { c: '2' }, d: '3' })).toEqual({
      a: { b: '1', c: '2' },
      d: '3',
    });
  });
});

describe.skipIf(!existsSync(frJson))('i18n/fr.json (+ _pending) covers the front-end keys', () => {
  it('has every key used by the sources', () => {
    const missing: string[] = [];
    const t = createTranslator({
      locale: 'fr',
      messages: toMessages(mergeTrees(...messageSources())),
      onMissing: (key) => missing.push(key),
    });
    for (const key of usedKeys()) t(key);
    expect(missing.sort()).toEqual([]);
  });
});
