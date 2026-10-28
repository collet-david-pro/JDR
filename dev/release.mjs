#!/usr/bin/env node
// Release tooling for JDR (Node >= 20, ESM, no npm dependency).
//
//   node dev/release.mjs manifest   write manifest.json (SHA-256 of every shipped file)
//   node dev/release.mjs package    regenerate manifest.json, then build
//                                   dist/jdr-vX.Y.Z-full.zip, dist/jdr-update-vX.Y.Z.zip and dist/SHA256SUMS
//   node dev/release.mjs verify     recompute hashes and compare with manifest.json (exit 1 on drift)
//
// Options: --root <dir>  repository root (default: parent of this script's folder)
//
// Environment: SOURCE_DATE_EPOCH (seconds) forces the timestamp stored in ZIP entries
// and in manifest.generated_at, for reproducible archives.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// Shipped file selection
// ---------------------------------------------------------------------------

/** Files shipped from the repository root (absent ones are simply skipped). */
const ROOT_FILES = [
  'index.php',
  'install.php',
  'update.php',
  'cron.php',
  '.htaccess',
  'VERSION',
  'CHANGELOG.md',
  'sw.js',
];

/** Directories shipped recursively. */
const ROOT_DIRS = ['assets', 'app', 'migrations', 'i18n'];

/** Only these names are shipped from storage/ (skeleton: protections + empty folders). */
const STORAGE_SKELETON_ROOT = new Set(['.htaccess', 'index.php']);
const STORAGE_SKELETON_ANY = new Set(['.gitkeep']);

/** Files never shipped, whatever the selection rules say (defence in depth). */
const FORBIDDEN = [
  /^config\.php$/,
  /^config\.example\.php$/,
  /^manifest\.json$/,
  /^(frontend|tests|dev|docs|etapes|dist|node_modules|\.git|\.github|\.vscode)\//,
  /^projet\.md$/,
  /^phpunit\.xml(\.dist)?$/,
  /^phpcs\.xml(\.dist)?$/,
];

/** Paths left out of the update archive (§8.3: never install.php nor storage/). */
const isUpdateExcluded = (rel) => rel === 'install.php' || rel.startsWith('storage/');

const MANIFEST_NAME = 'manifest.json';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Hidden files are skipped, except Apache protections. Junk files too. */
function isSkippedName(name) {
  if (name === '.htaccess') return false;
  if (name.startsWith('.')) return true; // .DS_Store, .gitkeep (outside storage), .vite/, editor swap files…
  if (name === 'Thumbs.db' || name === 'desktop.ini' || name.endsWith('~')) return true;
  return false;
}

function walk(root, relDir, out, warnings) {
  const absDir = path.join(root, relDir);
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (isSkippedName(entry.name)) continue;
    const rel = `${relDir}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      warnings.push(`symlink ignored: ${rel}`);
    } else if (entry.isDirectory()) {
      walk(root, rel, out, warnings);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

function walkStorageSkeleton(root, relDir, out) {
  const absDir = path.join(root, relDir);
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkStorageSkeleton(root, rel, out);
    } else if (entry.isFile()) {
      const atRoot = relDir === 'storage';
      if (STORAGE_SKELETON_ANY.has(entry.name) || (atRoot && STORAGE_SKELETON_ROOT.has(entry.name))) {
        out.push(rel);
      }
    }
  }
}

function isRegularFile(abs) {
  try {
    const st = fs.lstatSync(abs);
    return st.isFile();
  } catch {
    return false;
  }
}

function isDirectory(abs) {
  try {
    return fs.lstatSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/** Returns the sorted list of shipped paths (relative, "/" separators). */
function collectFiles(root) {
  const files = [];
  const warnings = [];
  for (const f of ROOT_FILES) {
    if (isRegularFile(path.join(root, f))) files.push(f);
  }
  for (const d of ROOT_DIRS) {
    if (isDirectory(path.join(root, d))) walk(root, d, files, warnings);
  }
  if (isDirectory(path.join(root, 'storage'))) walkStorageSkeleton(root, 'storage', files);

  for (const rel of files) {
    if (FORBIDDEN.some((re) => re.test(rel))) {
      throw new Error(`refusing to ship forbidden path: ${rel}`);
    }
  }
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { files, warnings };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function readVersion(root) {
  const file = path.join(root, 'VERSION');
  if (!isRegularFile(file)) throw new Error('VERSION file not found');
  const version = fs.readFileSync(file, 'utf8').trim();
  if (!SEMVER.test(version)) throw new Error(`VERSION is not semver: "${version}"`);
  return version;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function now() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000);
  return new Date();
}

function buildManifest(root) {
  const version = readVersion(root);
  const { files, warnings } = collectFiles(root);
  const hashes = {};
  for (const rel of files) hashes[rel] = sha256(fs.readFileSync(path.join(root, rel)));
  const manifest = {
    version,
    generated_at: now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    files: hashes,
  };
  return { manifest, warnings };
}

function writeManifest(root) {
  const { manifest, warnings } = buildManifest(root);
  for (const w of warnings) console.warn(`warning: ${w}`);
  const target = path.join(root, MANIFEST_NAME);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(tmp, target);
  const count = Object.keys(manifest.files).length;
  console.log(`manifest.json: version ${manifest.version}, ${count} files`);
  for (const [label, rel] of [
    ['front build (assets/)', 'assets'],
    ['service worker (sw.js)', 'sw.js'],
  ]) {
    if (!fs.existsSync(path.join(root, rel))) console.warn(`warning: ${label} missing — front not built yet?`);
  }
  return manifest;
}

function verifyManifest(root) {
  const target = path.join(root, MANIFEST_NAME);
  if (!isRegularFile(target)) {
    console.error('verify: manifest.json not found (run "node dev/release.mjs manifest")');
    return 1;
  }
  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    console.error(`verify: manifest.json is not valid JSON: ${e.message}`);
    return 1;
  }
  if (!stored || typeof stored !== 'object' || typeof stored.files !== 'object' || stored.files === null) {
    console.error('verify: manifest.json has no "files" object');
    return 1;
  }
  const { manifest: actual } = buildManifest(root);
  const problems = [];
  if (stored.version !== actual.version) {
    problems.push(`version: manifest ${stored.version} != VERSION ${actual.version}`);
  }
  for (const [rel, hash] of Object.entries(stored.files)) {
    if (!(rel in actual.files)) problems.push(`missing:  ${rel}`);
    else if (actual.files[rel] !== hash) problems.push(`modified: ${rel}`);
  }
  for (const rel of Object.keys(actual.files)) {
    if (!(rel in stored.files)) problems.push(`unlisted: ${rel}`);
  }
  if (problems.length > 0) {
    console.error(`verify: ${problems.length} difference(s) with manifest.json`);
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  console.log(`verify: OK (${Object.keys(actual.files).length} files, version ${actual.version})`);
  return 0;
}

// ---------------------------------------------------------------------------
// CRC32 (zlib.crc32 exists since Node 20.15 / 22.2; table fallback otherwise)
// ---------------------------------------------------------------------------

let crcTable = null;
function crc32Fallback(buf) {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const crc32 = typeof zlib.crc32 === 'function' ? (buf) => zlib.crc32(buf) >>> 0 : crc32Fallback;

// ---------------------------------------------------------------------------
// Minimal streaming ZIP writer (store/deflate, UTF-8 names, no ZIP64)
// ---------------------------------------------------------------------------

function dosDateTime(date) {
  let d = date;
  if (d.getFullYear() < 1980) d = new Date(1980, 0, 1, 0, 0, 0);
  if (d.getFullYear() > 2107) d = new Date(2107, 11, 31, 23, 59, 58);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date: day };
}

class ZipWriter {
  constructor(file) {
    this.fd = fs.openSync(file, 'w');
    this.offset = 0;
    this.entries = [];
  }

  #write(buf) {
    let done = 0;
    while (done < buf.length) done += fs.writeSync(this.fd, buf, done, buf.length - done);
    this.offset += buf.length;
  }

  addFile(name, data, mtime, mode = 0o644) {
    const nameBuf = Buffer.from(name, 'utf8');
    if (nameBuf.length > 0xffff) throw new Error(`path too long for ZIP: ${name}`);
    const crc = crc32(data);
    let method = 0;
    let payload = data;
    if (data.length > 0) {
      const deflated = zlib.deflateRawSync(data, { level: 9 });
      if (deflated.length < data.length) {
        method = 8;
        payload = deflated;
      }
    }
    if (data.length >= 0xffffffff || payload.length >= 0xffffffff || this.offset >= 0xffffffff) {
      throw new Error('archive too large (ZIP64 not supported)');
    }
    const { time, date } = dosDateTime(mtime);
    const flags = 0x0800; // bit 11: names are UTF-8

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const headerOffset = this.offset;
    this.#write(local);
    this.#write(nameBuf);
    this.#write(payload);
    this.entries.push({ nameBuf, crc, method, time, date, flags, csize: payload.length, usize: data.length, headerOffset, mode });
  }

  close() {
    if (this.entries.length > 0xfffe) throw new Error('too many entries (ZIP64 not supported)');
    const cdStart = this.offset;
    for (const e of this.entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, spec 2.0
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(e.flags, 8);
      cd.writeUInt16LE(e.method, 10);
      cd.writeUInt16LE(e.time, 12);
      cd.writeUInt16LE(e.date, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(e.csize, 20);
      cd.writeUInt32LE(e.usize, 24);
      cd.writeUInt16LE(e.nameBuf.length, 28);
      cd.writeUInt16LE(0, 30); // extra
      cd.writeUInt16LE(0, 32); // comment
      cd.writeUInt16LE(0, 34); // disk
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(((0o100000 | e.mode) << 16) >>> 0, 38); // regular file + permissions
      cd.writeUInt32LE(e.headerOffset, 42);
      this.#write(cd);
      this.#write(e.nameBuf);
    }
    const cdSize = this.offset - cdStart;
    if (this.offset >= 0xffffffff) throw new Error('archive too large (ZIP64 not supported)');
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    this.#write(eocd);
    fs.closeSync(this.fd);
  }
}

/** Independent read-back: parses the central directory, inflates every entry, checks CRCs. */
function selfCheckZip(file, expected) {
  const buf = fs.readFileSync(file);
  const eocdPos = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdPos < 0) throw new Error(`${file}: end of central directory not found`);
  const count = buf.readUInt16LE(eocdPos + 10);
  let p = buf.readUInt32LE(eocdPos + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: bad central header #${i}`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`${file}: bad local header for ${name}`);
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`${file}: corrupt entry ${name}`);
    names.push(name);
    p += 46 + nlen + xlen + clen;
  }
  if (names.join('\n') !== expected.join('\n')) throw new Error(`${file}: entry list mismatch`);
  return names.length;
}

function unzipTest(file) {
  try {
    execFileSync('unzip', ['-tqq', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    return 'unzip -t OK';
  } catch (e) {
    if (e.code === 'ENOENT') return 'unzip not available, skipped';
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
    throw new Error(`unzip -t failed for ${file}${out ? `:\n${out}` : ''}`);
  }
}

function buildZip(root, target, entries) {
  const stamp = process.env.SOURCE_DATE_EPOCH ? now() : null;
  const tmp = `${target}.tmp`;
  const zip = new ZipWriter(tmp);
  try {
    for (const rel of entries) {
      const abs = path.join(root, rel);
      const st = fs.statSync(abs);
      zip.addFile(rel, fs.readFileSync(abs), stamp ?? st.mtime, 0o644);
    }
    zip.close();
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw e;
  }
  fs.renameSync(tmp, target);
  const n = selfCheckZip(target, entries);
  const unzip = unzipTest(target);
  const size = fs.statSync(target).size;
  console.log(`${path.relative(root, target)}: ${n} entries, ${(size / 1024).toFixed(1)} KiB (self-check OK, ${unzip})`);
}

function packageRelease(root) {
  const manifest = writeManifest(root);
  const files = Object.keys(manifest.files);
  const full = [...files, MANIFEST_NAME].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const update = full.filter((rel) => !isUpdateExcluded(rel));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const names = [`jdr-v${manifest.version}-full.zip`, `jdr-update-v${manifest.version}.zip`];
  buildZip(root, path.join(dist, names[0]), full);
  buildZip(root, path.join(dist, names[1]), update);
  // SHA256SUMS (sha256sum format): published with the release, read by the update check
  // to tell an official archive from a modified one.
  const sums = names.map((name) => `${sha256(fs.readFileSync(path.join(dist, name)))}  ${name}\n`).join('');
  fs.writeFileSync(path.join(dist, 'SHA256SUMS'), sums);
  console.log('dist/SHA256SUMS written');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log('usage: node dev/release.mjs <manifest|package|verify> [--root <dir>]');
}

function main(argv) {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let command = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root needs a value');
      root = path.resolve(value);
    } else if (arg === '-h' || arg === '--help') {
      usage();
      return 0;
    } else if (command === null) {
      command = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  switch (command) {
    case 'manifest':
      writeManifest(root);
      return 0;
    case 'package':
      packageRelease(root);
      return 0;
    case 'verify':
      return verifyManifest(root);
    default:
      usage();
      return 2;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(`release: ${e.message}`);
  process.exitCode = 1;
}
