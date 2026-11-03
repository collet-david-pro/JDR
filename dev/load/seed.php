<?php

/**
 * Load test seeding (P10e): writes config.php into the isolated site copy, migrates the blank
 * database and creates the accounts (one password hash computed once and shared).
 *
 *   php dev/load/seed.php <site-dir> <sessions>
 *
 * Reads the connection from the E2E_DB_* variables (same as dev/e2e-serve.sh). Accounts:
 * gm1..gmN and p1_1..pN_5, password "Load-Test-Password-42".
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit;
}
define('JDR_BOOT', true);

$site = rtrim((string) ($argv[1] ?? ''), '/');
$sessions = max(1, (int) ($argv[2] ?? 5));
if ($site === '' || !is_dir($site . '/app')) {
    fwrite(STDERR, "usage: seed.php <site-dir> <sessions>\n");
    exit(2);
}
$env = static fn (string $k, string $d): string => ($v = getenv($k)) === false ? $d : $v;
$port = (int) $env('LOAD_PORT', '8092');
$db = [
    'host' => $env('E2E_DB_HOST', '127.0.0.1'),
    'port' => (int) $env('E2E_DB_PORT', '3306'),
    'name' => $env('E2E_DB_NAME', 'jdr_load'),
    'user' => $env('E2E_DB_USER', 'root'),
    'pass' => $env('E2E_DB_PASS', ''),
    'prefix' => 'jdr_',
];
file_put_contents($site . '/config.php', "<?php\n\ndefined('JDR_BOOT') || exit;\n\nreturn " . var_export([
    'db' => $db,
    'base_url' => 'http://127.0.0.1:' . $port,
    'routing_mode' => 'rewrite',
    'storage_path' => $site . '/storage',
    'app_secret' => bin2hex(random_bytes(32)),
    'cron_key' => bin2hex(random_bytes(8)),
    'debug' => false,
    'cookie_secure' => false,
], true) . ";\n");

require $site . '/app/autoload.php';

use JDR\Core\Db;
use JDR\Migrate\CallbackLogger;
use JDR\Migrate\Runner;
use JDR\Domain\Auth\Passwords;

$conn = new Db($db);
(new Runner($conn, $site . '/migrations', new CallbackLogger(static function (string $m, array $c): void {})))->runAll();

$hash = Passwords::hash('Load-Test-Password-42');
$insert = static function (string $name) use ($conn, $hash): void {
    $conn->execute(
        'INSERT INTO ' . $conn->t('users') . ' (`email`, `username`, `password_hash`, `role`, `status`, `storage_used_bytes`, `locale`, `created_at`, `updated_at`) '
        . "VALUES (?, ?, ?, 'user', 'active', 0, 'fr', UTC_TIMESTAMP(), UTC_TIMESTAMP())",
        [$name . '@example.org', $name, $hash],
    );
};
for ($s = 1; $s <= $sessions; $s++) {
    $insert('gm' . $s);
    for ($p = 1; $p <= 5; $p++) {
        $insert('p' . $s . '_' . $p);
    }
}
echo "seeded $sessions sessions\n";
