import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTranslator, toMessages } from '../src/lib/translator';
import { SCHEME_PREFERENCES, UI_STYLES } from '../src/lib/theme';

/**
 * Integration check with the shared i18n/fr.json (owned by the PHP side): every key used
 * literally by the front-end must exist. Dynamic keys are listed explicitly below.
 */
const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const frJson = fileURLToPath(new URL('../../i18n/fr.json', import.meta.url));

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
  for (const db of ['ok', 'error', 'not_configured']) keys.add(`health.db_${db}`);
  for (const code of ['network', 'timeout', 'unknown']) keys.add(`errors.${code}`);
  return keys;
}

describe.skipIf(!existsSync(frJson))('i18n/fr.json covers the front-end keys', () => {
  it('has every key used by the sources', () => {
    const missing: string[] = [];
    const t = createTranslator({
      locale: 'fr',
      messages: toMessages(JSON.parse(readFileSync(frJson, 'utf8'))),
      onMissing: (key) => missing.push(key),
    });
    for (const key of usedKeys()) t(key);
    expect(missing.sort()).toEqual([]);
  });
});
