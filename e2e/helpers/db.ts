import { execFileSync } from 'node:child_process';
import { db } from './env';

/**
 * Runs SQL statements on an E2E database through PHP's PDO (PHP is required anyway to serve the
 * site; no npm database driver, no mysql client needed). Test hygiene only: never the app's data.
 */
export function runSql(database: string, statements: string[]): void {
  if (!/^jdr_e2e[a-z0-9_]*$/.test(database)) {
    throw new Error(`refusing to touch database ${database}`);
  }
  const script = `
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', getenv('E2E_DB_HOST'), (int) getenv('E2E_DB_PORT'), getenv('E2E_SQL_DB'));
    $pdo = new PDO($dsn, getenv('E2E_DB_USER'), (string) getenv('E2E_DB_PASS'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    foreach (json_decode(getenv('E2E_SQL'), true) as $sql) { $pdo->exec($sql); }
  `;
  execFileSync('php', ['-r', script], {
    env: {
      ...process.env,
      E2E_DB_HOST: db.host,
      E2E_DB_PORT: db.port,
      E2E_DB_USER: db.user,
      E2E_DB_PASS: db.pass,
      E2E_SQL_DB: database,
      E2E_SQL: JSON.stringify(statements),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

/**
 * Clears the rate-limit buckets. Every browser runs from 127.0.0.1, and the "register" bucket
 * allows 5 sign-ups per hour per IP: three browser projects would exhaust it.
 */
export function resetRateLimits(database: string): void {
  runSql(database, [`DELETE FROM \`${db.prefix}rate_limits\``]);
}
