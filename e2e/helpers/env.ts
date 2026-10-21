/**
 * Shared settings of the E2E run. The database settings are also read by dev/e2e-serve.sh
 * (same E2E_DB_* variables), so the installer form and the server always agree.
 */
export const db = {
  host: process.env.E2E_DB_HOST ?? '127.0.0.1',
  port: process.env.E2E_DB_PORT ?? '3306',
  user: process.env.E2E_DB_USER ?? 'root',
  pass: process.env.E2E_DB_PASS ?? '',
  prefix: 'jdr_',
};

/** Main instance: installed by install.spec.ts, used by auth.spec.ts and admin.spec.ts. */
export const main = {
  port: Number(process.env.E2E_PORT ?? 8090),
  dbName: process.env.E2E_DB_NAME ?? 'jdr_e2e',
  get baseURL(): string {
    return `http://127.0.0.1:${this.port}`;
  },
};

/** Second instance, installed without JavaScript by install-no-js.spec.ts. */
export const noJs = {
  port: Number(process.env.E2E_NOJS_PORT ?? 8091),
  dbName: process.env.E2E_NOJS_DB_NAME ?? 'jdr_e2e_nojs',
  get baseURL(): string {
    return `http://127.0.0.1:${this.port}`;
  },
};

/** Administrator created by the installer. */
export const admin = {
  email: 'mj@example.org',
  username: 'Maitre MJ',
  password: 'Tr3s-B0nne phrase secrète!',
};

/** Password of the accounts created by the tests (passes the server policy). */
export const userPassword = 'Une-phrase de passe solide 42';

/** Unique suffix: the same database serves every browser project of a run. */
export function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
