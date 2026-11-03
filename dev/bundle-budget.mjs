#!/usr/bin/env node
// Bundle budgets (projet.md 22, P10e): gzip weight of the initial graph and of the editor graph,
// read from the Vite manifest of the production build (assets/vite-manifest.json).
//
//   initial = entry src/main.ts + its static imports (+ their CSS);
//   editor  = src/pages/Editor.svelte + everything it loads (static and dynamic imports, Pixi
//             renderers included), minus the initial graph, minus the other pages (own chunks).
//
// Budgets (gzip): initial <= 150 KB, editor <= 600 KB (1 KB = 1000 bytes, as in the spec).
// Usage: node dev/bundle-budget.mjs [--assets <dir>]   (exit code 1 over budget)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argIdx = process.argv.indexOf('--assets');
const assets = argIdx > 0 ? resolve(process.argv[argIdx + 1]) : join(root, 'assets');
const BUDGETS = { initial: 150_000, editor: 600_000 };
const ENTRY = 'src/main.ts';
const EDITOR = 'src/pages/Editor.svelte';

const manifest = JSON.parse(readFileSync(join(assets, 'vite-manifest.json'), 'utf8'));
if (!manifest[ENTRY] || !manifest[EDITOR]) {
  console.error(`bundle-budget: ${ENTRY} or ${EDITOR} missing from the manifest`);
  process.exit(2);
}

const sizeCache = new Map();
function gzipSize(file) {
  if (!sizeCache.has(file)) {
    sizeCache.set(file, gzipSync(readFileSync(join(assets, file)), { level: 9 }).length);
  }
  return sizeCache.get(file);
}

/** Files (js + css) of a graph; `dynamic` follows dynamic imports too. */
function collect(start, { dynamic, skip = new Set() }) {
  const seen = new Set();
  const files = new Set();
  const visit = (key) => {
    if (seen.has(key) || skip.has(key) || !manifest[key]) return;
    seen.add(key);
    const chunk = manifest[key];
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dep of chunk.imports ?? []) visit(dep);
    if (dynamic) {
      for (const dep of chunk.dynamicImports ?? []) {
        if (!dep.startsWith('src/pages/') || dep === EDITOR) visit(dep);
      }
    }
  };
  visit(start);
  return { keys: seen, files };
}

const initial = collect(ENTRY, { dynamic: false });
const editor = collect(EDITOR, { dynamic: true, skip: initial.keys });
const editorFiles = [...editor.files].filter((f) => !initial.files.has(f));

const total = (files) => [...files].reduce((sum, f) => sum + gzipSize(f), 0);
const rows = [
  ['initial', total(initial.files), BUDGETS.initial, [...initial.files]],
  ['editor', total(editorFiles), BUDGETS.editor, editorFiles],
];

const kb = (n) => (n / 1000).toFixed(1).padStart(7) + ' KB';
console.log('bundle-budget (gzip):');
let failed = false;
for (const [name, size, budget, files] of rows) {
  const over = size > budget;
  failed ||= over;
  console.log(`  ${name.padEnd(8)} ${kb(size)} / ${kb(budget)}  ${over ? 'OVER BUDGET' : 'ok'}  (${files.length} files)`);
  if (over || process.argv.includes('--verbose')) {
    for (const f of files.sort((a, b) => gzipSize(b) - gzipSize(a)).slice(0, 8)) {
      console.log(`      ${kb(gzipSize(f))}  ${f}`);
    }
  }
}
process.exit(failed ? 1 : 0);
