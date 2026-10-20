<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\Config;
use PHPUnit\Framework\TestCase;

final class ConfigTest extends TestCase
{
    public function testMissingFileReturnsNull(): void
    {
        self::assertNull(Config::load(sys_get_temp_dir() . '/jdr-missing-' . bin2hex(random_bytes(4)) . '.php'));
    }

    public function testLoadsArray(): void
    {
        $file = tempnam(sys_get_temp_dir(), 'jdrcfg');
        file_put_contents($file, "<?php\nreturn ['base_url' => 'https://ex.org/jdr/', 'routing_mode' => 'query',"
            . " 'db' => ['host' => 'h', 'port' => '3307', 'name' => 'n', 'user' => 'u', 'pass' => 'p'],"
            . " 'app_secret' => 's', 'cron_key' => 'k', 'debug' => 1];\n");
        try {
            $config = Config::load($file);
        } finally {
            unlink($file);
        }
        self::assertNotNull($config);
        self::assertSame('https://ex.org/jdr', $config->baseUrl());
        self::assertSame('/jdr', $config->basePath());
        self::assertSame('query', $config->routingMode());
        self::assertSame(
            ['host' => 'h', 'port' => 3307, 'name' => 'n', 'user' => 'u', 'pass' => 'p', 'prefix' => 'jdr_'],
            $config->db(),
        );
        self::assertSame('s', $config->appSecret());
        self::assertSame('k', $config->cronKey());
        self::assertTrue($config->debug());
        self::assertFalse($config->cookieSecure());
        self::assertTrue($config->isHttpsBaseUrl());
        self::assertSame('/root/storage', $config->storagePath('/root'));
    }

    public function testNonArrayConfigIsAnError(): void
    {
        $file = tempnam(sys_get_temp_dir(), 'jdrcfg');
        file_put_contents($file, "<?php\nreturn 42;\n");
        try {
            $this->expectException(\RuntimeException::class);
            Config::load($file);
        } finally {
            unlink($file);
        }
    }

    public function testDefaultsAndUnknownRoutingMode(): void
    {
        $config = new Config(['routing_mode' => 'weird', 'base_url' => 'http://localhost:8000']);
        self::assertSame('rewrite', $config->routingMode());
        self::assertSame('', $config->basePath());
        self::assertFalse($config->isHttpsBaseUrl());
        self::assertSame('/srv/data', (new Config(['storage_path' => '/srv/data/']))->storagePath('/x'));
    }

    public function testApiBase(): void
    {
        self::assertSame('/api/v1', Config::apiBase('', 'rewrite'));
        self::assertSame('/jdr/api/v1', Config::apiBase('/jdr', 'rewrite'));
        self::assertSame('/index.php?r=/api/v1', Config::apiBase('', 'query'));
        self::assertSame('/jdr/index.php?r=/api/v1', Config::apiBase('/jdr', 'query'));
    }

    public function testNormalizeBasePath(): void
    {
        self::assertSame('', Config::normalizeBasePath('/'));
        self::assertSame('', Config::normalizeBasePath(''));
        self::assertSame('', Config::normalizeBasePath('.'));
        self::assertSame('/jdr', Config::normalizeBasePath('jdr/'));
        self::assertSame('/a/b', Config::normalizeBasePath('//a//b//'));
    }
}
