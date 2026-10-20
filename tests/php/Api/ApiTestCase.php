<?php

declare(strict_types=1);

namespace JDR\Tests\Api;

use JDR\Core\App;
use JDR\Core\Clock;
use JDR\Core\Config;
use JDR\Core\Db;
use JDR\Core\ErrorHandler;
use JDR\Core\I18n;
use JDR\Core\Logger;
use JDR\Core\Response;
use JDR\Core\Session\CookieJar;
use JDR\Core\Session\MemoryCookieJar;
use JDR\Core\Session\MemorySessionBackend;
use JDR\Core\Session\SessionBackend;
use JDR\Domain\Auth\Passwords;
use JDR\Migrate\Runner;
use JDR\Tests\Support\DbTestCase;

/**
 * End-to-end API tests: App::create(...)->handle(Request::create(...)) against the test database,
 * with in-memory sessions and cookies (no session_start() in CLI).
 */
abstract class ApiTestCase extends DbTestCase
{
    protected const PASSWORD = 'Correct-Horse-Battery-42';

    protected static string $root;
    protected static string $logDir;

    protected App $app;
    protected MemoryCookieJar $jar;
    protected MemorySessionBackend $sessions;
    protected Db $db;

    public static function setUpBeforeClass(): void
    {
        self::dropTestTables();
        $dir = self::makeMigrationsDir([
            '0001_initial.sql' => (string) file_get_contents(self::migrationsDir() . '/0001_initial.sql'),
        ]);
        try {
            (new Runner(self::newDb(), $dir))->runAll();
        } finally {
            self::removeDir($dir);
        }
        self::$root = sys_get_temp_dir() . '/jdr-api-' . bin2hex(random_bytes(4));
        self::$logDir = self::$root . '/storage/logs';
        @mkdir(self::$root . '/storage/tmp', 0777, true);
        @mkdir(self::$logDir, 0777, true);
    }

    public static function tearDownAfterClass(): void
    {
        self::removeTree(self::$root);
    }

    protected function setUp(): void
    {
        self::truncateTestTables();
        $this->db = self::newDb();
        // Schema 0001 only: every other setting comes from the defaults of Settings.
        $this->setSetting('db_version', \REQUIRED_DB_VERSION);
        $this->jar = new MemoryCookieJar();
        $this->sessions = new MemorySessionBackend($this->jar);
        $this->app = $this->makeApp();
    }

    protected function makeApp(?Clock $clock = null): App
    {
        $clock ??= new Clock();
        $config = new Config([
            'db' => self::dbConfig(),
            'base_url' => 'http://jdr.test',
            'routing_mode' => 'rewrite',
            'storage_path' => self::$root . '/storage',
            'app_secret' => str_repeat('0123456789abcdef', 4),
            'cron_key' => 'cron',
            'debug' => false,
            'cookie_secure' => false,
        ]);
        $logger = new Logger(self::$logDir, $clock, 'debug');
        $errors = new ErrorHandler($logger, I18n::forLocale('fr'));
        $app = App::create(self::$root, $config, $logger, $errors, $clock);
        $app->container()->instance(CookieJar::class, $this->jar);
        $app->container()->instance(SessionBackend::class, $this->sessions);

        return $app;
    }

    protected function client(string $ip = '203.0.113.10'): ApiClient
    {
        return new ApiClient($this->app, $this->jar, $ip);
    }

    protected function createUser(
        string $username,
        string $role = 'user',
        string $password = self::PASSWORD,
        string $status = 'active',
    ): int {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('users') . ' (`email`, `username`, `password_hash`, `role`, `status`, '
            . "`storage_used_bytes`, `locale`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, 0, 'fr', UTC_TIMESTAMP(), UTC_TIMESTAMP())",
            [strtolower($username) . '@example.org', $username, Passwords::hash($password), $role, $status],
        );

        return (int) $this->db->lastInsertId();
    }

    protected function setSetting(string $key, mixed $value): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('settings') . ' (`key`, `value`, `updated_at`) VALUES (?, ?, UTC_TIMESTAMP()) '
            . 'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
            [$key, json_encode($value)],
        );
    }

    /**
     * @param list<mixed> $params
     */
    protected function rows(string $table, string $where = '1=1', array $params = []): int
    {
        return (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t($table) . ' WHERE ' . $where, $params);
    }

    protected static function errorCode(Response $response): ?string
    {
        $payload = $response->payload();

        return is_array($payload) ? ($payload['error']['code'] ?? null) : null;
    }

    private static function removeTree(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($items as $item) {
            $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($dir);
    }
}
