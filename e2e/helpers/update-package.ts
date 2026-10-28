import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Dedicated instance of update.spec.ts: an update puts the site in maintenance. */
export const updateSite = {
  port: Number(process.env.E2E_UPDATE_PORT ?? 8093),
  dbName: process.env.E2E_UPDATE_DB_NAME ?? 'jdr_e2e_update',
  get baseURL(): string {
    return `http://127.0.0.1:${this.port}`;
  },
};

const repo = fileURLToPath(new URL('../../', import.meta.url));
const SHIPPED_DIRS = ['assets', 'app', 'migrations', 'i18n'];

export interface UpdatePackage {
  /** Absolute path of dist/jdr-update-v<version>.zip. */
  readonly zip: string;
  readonly version: string;
  /** Version of the working tree (the one the E2E site runs). */
  readonly current: string;
  cleanup(): void;
}

export function repoVersion(): string {
  return readFileSync(join(repo, 'VERSION'), 'utf8').trim();
}

/**
 * Builds a real update archive (dev/release.mjs package) from a temporary copy of the deliverable:
 * VERSION changed, one visible modified file (CHANGELOG.md), and, unless `migration` is false, a
 * test migration (no side effect) whose number the new code declares as required.
 * With `version` equal to the current one the archive is "not newer" (the server refuses it).
 */
export function buildUpdatePackage(options: { version?: string; migration?: boolean } = {}): UpdatePackage {
  const current = repoVersion();
  const version = options.version ?? '99.0.0-e2e';
  const dir = mkdtempSync(join(tmpdir(), 'jdr-e2e-pkg-'));
  for (const entry of readdirSync(repo, { withFileTypes: true })) {
    if (entry.name === 'config.php' || entry.name.startsWith('.')) continue;
    if (entry.isFile() || (entry.isDirectory() && SHIPPED_DIRS.includes(entry.name))) {
      cpSync(join(repo, entry.name), join(dir, entry.name), { recursive: true });
    }
  }
  rmSync(join(dir, 'manifest.json'), { force: true });
  writeFileSync(join(dir, 'VERSION'), `${version}\n`);
  writeFileSync(
    join(dir, 'CHANGELOG.md'),
    `${readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')}\n- Archive de test E2E ${version}.\n`,
  );
  if (options.migration !== false) {
    mkdirSync(join(dir, 'migrations'), { recursive: true });
    writeFileSync(
      join(dir, 'migrations', '9999_e2e_noop.sql'),
      '-- @idempotent-ddl\n-- E2E test migration: no lasting effect.\n' +
        'CREATE TABLE IF NOT EXISTS `{{prefix}}e2e_noop` (`id` INT NOT NULL) ENGINE=InnoDB;\n' +
        'DROP TABLE IF EXISTS `{{prefix}}e2e_noop`;\n',
    );
    const bootstrap = join(dir, 'app', 'bootstrap.php');
    writeFileSync(
      bootstrap,
      readFileSync(bootstrap, 'utf8').replace(
        /define\('REQUIRED_DB_VERSION', '\d+'\)/,
        "define('REQUIRED_DB_VERSION', '9999')",
      ),
    );
  }
  execFileSync('node', [join(repo, 'dev', 'release.mjs'), 'package', '--root', dir], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const zip = join(dir, 'dist', `jdr-update-v${version}.zip`);
  if (!existsSync(zip)) throw new Error(`update archive not built: ${zip}`);
  return { zip, version, current, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A file that is not a zip archive, named like one. */
export function buildFakeZip(): { path: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'jdr-e2e-fake-'));
  const path = join(dir, 'pas-une-archive.zip');
  writeFileSync(path, 'Ceci est du texte, pas une archive zip.\n');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
