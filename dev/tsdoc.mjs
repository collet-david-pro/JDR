#!/usr/bin/env node
// Lists exported functions, classes and constants of frontend/src/**/*.ts
// that have no preceding JSDoc block. Usage: node dev/tsdoc.mjs [--count]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'frontend', 'src');
const decl = /^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const missing = [];
for (const file of walk(src).sort()) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = decl.exec(line);
    if (!m) return;
    // Walk back over decorators/blank-free lines to the previous non-empty line.
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === '') j--;
    const prev = j >= 0 ? lines[j].trim() : '';
    if (!prev.endsWith('*/')) missing.push(`${relative(root, file)}:${i + 1} ${m[1]} ${m[2]}`);
  });
}

if (process.argv.includes('--count')) console.log(missing.length);
else {
  for (const l of missing) console.log(l);
  console.error(`${missing.length} exported symbol(s) without a JSDoc comment`);
}
process.exit(missing.length ? 1 : 0);
