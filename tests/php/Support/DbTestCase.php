<?php

declare(strict_types=1);

namespace JDR\Tests\Support;

use JDR\Core\Db;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/boot.php';

/**
 * Base class of tests that need the test database.
 *
 * Connection from JDR_TEST_DB_HOST / PORT / NAME / USER / PASS / PREFIX
 * (defaults: 127.0.0.1, 3306, jdr_test, root, '', jdrt_).
 * Only tables carrying the test prefix are ever dropped or truncated, and only
 * in a database whose name contains "test" (unless JDR_TEST_DB_ALLOW_ANY=1).
 */
abstract class DbTestCase extends TestCase
{
    /**
     * Every table of projet.md §7.2 (without prefix).
     */
    public const SCHEMA_TABLES = [
        'schema_migrations', 'settings', 'audit_log', 'rate_limits', 'background_jobs',
        'users', 'user_prefs', 'remember_tokens', 'password_resets', 'login_attempts', 'invitations', 'php_sessions',
        'games', 'game_members', 'party_positions', 'tokens', 'encounters', 'encounter_tokens',
        'asset_categories', 'assets', 'asset_tags', 'asset_tag_map', 'asset_favorites', 'map_asset_refs',
        'maps', 'map_floors', 'map_chunks', 'map_objects', 'map_notes', 'map_links', 'map_tokens', 'map_fog',
        'map_versions',
        'play_sessions', 'session_players', 'token_assignments', 'session_displays', 'events', 'processed_ops',
    ];

    /**
     * @return array{host:string,port:int,name:string,user:string,pass:string,prefix:string}
     */
    public static function dbConfig(): array
    {
        $env = static fn (string $k, string $default): string => ($v = getenv($k)) === false ? $default : $v;

        return [
            'host' => $env('JDR_TEST_DB_HOST', '127.0.0.1'),
            'port' => (int) $env('JDR_TEST_DB_PORT', '3306'),
            'name' => $env('JDR_TEST_DB_NAME', 'jdr_test'),
            'user' => $env('JDR_TEST_DB_USER', 'root'),
            'pass' => $env('JDR_TEST_DB_PASS', ''),
            'prefix' => $env('JDR_TEST_DB_PREFIX', 'jdrt_'),
        ];
    }

    /**
     * A fresh Db instance (its own connection).
     */
    protected static function newDb(): Db
    {
        return new Db(self::dbConfig());
    }

    protected static function projectRoot(): string
    {
        return dirname(__DIR__, 3);
    }

    protected static function migrationsDir(): string
    {
        return self::projectRoot() . '/migrations';
    }

    /**
     * Names (with prefix) of every table carrying the test prefix.
     *
     * @return list<string>
     */
    protected static function testTables(Db $db): array
    {
        $like = addcslashes($db->prefix(), '\\_%') . '%';
        $rows = $db->fetchAll(
            'SELECT TABLE_NAME AS t FROM information_schema.TABLES '
            . 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?',
            [$like]
        );

        return array_map(static fn (array $r): string => (string) $r['t'], $rows);
    }

    /**
     * Drops every table carrying the test prefix.
     */
    protected static function dropTestTables(?Db $db = null): void
    {
        $db ??= self::newDb();
        self::assertSafeDatabase($db);
        $pdo = $db->pdo();
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        try {
            foreach (self::testTables($db) as $table) {
                $pdo->exec('DROP TABLE IF EXISTS `' . $table . '`');
            }
        } finally {
            $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
        }
    }

    /**
     * Empties every table carrying the test prefix (keeps schema_migrations).
     */
    protected static function truncateTestTables(?Db $db = null): void
    {
        $db ??= self::newDb();
        self::assertSafeDatabase($db);
        $pdo = $db->pdo();
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        try {
            foreach (self::testTables($db) as $table) {
                if ($table !== $db->prefix() . 'schema_migrations') {
                    $pdo->exec('TRUNCATE TABLE `' . $table . '`');
                }
            }
        } finally {
            $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
        }
    }

    /**
     * Creates a temporary migrations directory holding $files (name => content).
     *
     * @param array<string, string> $files
     */
    protected static function makeMigrationsDir(array $files): string
    {
        $dir = sys_get_temp_dir() . '/jdr-mig-' . bin2hex(random_bytes(6));
        mkdir($dir, 0700, true);
        foreach ($files as $name => $content) {
            file_put_contents($dir . '/' . $name, $content);
        }

        return $dir;
    }

    protected static function removeDir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $entry) {
            if ($entry !== '.' && $entry !== '..') {
                @unlink($dir . '/' . $entry);
            }
        }
        @rmdir($dir);
    }

    private static function assertSafeDatabase(Db $db): void
    {
        $name = (string) $db->fetchValue('SELECT DATABASE()');
        if (!str_contains($name, 'test') && getenv('JDR_TEST_DB_ALLOW_ANY') !== '1') {
            throw new \RuntimeException('Refusing to drop tables in a database whose name lacks "test": ' . $name);
        }
    }
}
