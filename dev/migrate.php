<?php

/**
 * Development CLI for the migration engine.
 *
 *   php dev/migrate.php            apply every pending migration
 *   php dev/migrate.php --status   show the status of every migration
 *   php dev/migrate.php --env      read the connection from JDR_DB_* variables instead of config.php
 *
 * Connection: config.php (key 'db') when present, otherwise JDR_DB_HOST, JDR_DB_PORT,
 * JDR_DB_NAME, JDR_DB_USER, JDR_DB_PASS, JDR_DB_PREFIX.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

define('JDR_BOOT', true);

$root = dirname(__DIR__);
require $root . '/app/autoload.php';

use JDR\Core\Db;
use JDR\Migrate\CallbackLogger;
use JDR\Migrate\MigrationException;
use JDR\Migrate\Runner;

$args = array_slice($argv, 1);
$unknown = array_diff($args, ['--status', '--env', '--help', '-h']);
if ($unknown !== [] || in_array('--help', $args, true) || in_array('-h', $args, true)) {
    fwrite(STDOUT, "Usage: php dev/migrate.php [--status] [--env]\n");
    exit($unknown === [] ? 0 : 2);
}
$statusOnly = in_array('--status', $args, true);
$useEnv = in_array('--env', $args, true);

$configFile = $root . '/config.php';
if (!$useEnv && is_file($configFile)) {
    $config = require $configFile;
    $dbCfg = is_array($config) && isset($config['db']) && is_array($config['db']) ? $config['db'] : null;
    if ($dbCfg === null) {
        fwrite(STDERR, "config.php does not return a 'db' array.\n");
        exit(1);
    }
    $source = 'config.php';
} else {
    $env = static fn (string $k, string $default): string => ($v = getenv($k)) === false ? $default : $v;
    if (getenv('JDR_DB_NAME') === false && !$useEnv) {
        fwrite(STDERR, "No config.php and no JDR_DB_NAME variable: nothing to connect to.\n");
        exit(1);
    }
    $dbCfg = [
        'host' => $env('JDR_DB_HOST', '127.0.0.1'),
        'port' => (int) $env('JDR_DB_PORT', '3306'),
        'name' => $env('JDR_DB_NAME', 'jdr_dev'),
        'user' => $env('JDR_DB_USER', 'root'),
        'pass' => $env('JDR_DB_PASS', ''),
        'prefix' => $env('JDR_DB_PREFIX', 'jdr_'),
    ];
    $source = 'environment';
}

$out = static function (string $line): void {
    fwrite(STDOUT, '[' . gmdate('Y-m-d H:i:s') . '] ' . $line . "\n");
};

try {
    $db = new Db($dbCfg);
    $out(sprintf(
        'Database %s@%s:%d (prefix "%s", server %s, from %s)',
        (string) $dbCfg['name'],
        (string) ($dbCfg['host'] ?? '127.0.0.1'),
        (int) ($dbCfg['port'] ?? 3306),
        $db->prefix(),
        $db->serverVersion(),
        $source
    ));

    $logger = new CallbackLogger(static function (string $msg, array $ctx) use ($out): void {
        $out($msg);
    });
    $runner = new Runner($db, $root . '/migrations', $logger);

    if ($statusOnly) {
        foreach ($runner->status() as $m) {
            $out(sprintf(
                '%s %-30s %-8s %s%s%s',
                $m['version'],
                $m['name'],
                $m['status'],
                $m['applied_at'] ?? '',
                $m['checksum_ok'] === false ? '  CHECKSUM MISMATCH' : '',
                $m['file_missing'] ? '  FILE MISSING' : ''
            ));
            if ($m['error'] !== null && $m['status'] === 'failed') {
                $out('     error: ' . $m['error']);
            }
        }
        exit(0);
    }

    $pending = $runner->pending();
    $out(count($pending) . ' pending migration(s)');
    $done = $runner->runAll();
    $out(sprintf('Done: %d migration(s) applied. Current version: %s', count($done), $runner->currentVersion() ?? '-'));
    exit(0);
} catch (MigrationException $e) {
    $out('ERROR: ' . $e->getMessage());
    exit(1);
} catch (\Throwable $e) {
    $out('ERROR (' . get_class($e) . '): ' . $e->getMessage());
    exit(1);
}
