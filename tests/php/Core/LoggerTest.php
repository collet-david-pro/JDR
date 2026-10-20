<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\Clock;
use JDR\Core\Logger;
use PHPUnit\Framework\TestCase;

final class LoggerTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/jdr-logs-' . bin2hex(random_bytes(4));
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            unlink($file);
        }
        if (is_dir($this->dir)) {
            rmdir($this->dir);
        }
    }

    public function testWritesJsonLinesWithContextAndRedaction(): void
    {
        $logger = new Logger($this->dir, Clock::at('2026-10-20 12:34:56'));
        $logger->setRequestContext('abcd', 'GET /api/v1/health');
        $logger->setUserId(42);
        $logger->info('hello', ['password' => 'secret!', 'nested' => ['csrf_token' => 'x', 'n' => 1]]);
        $logger->debug('ignored below min level');

        $file = $this->dir . '/app-2026-10-20.log';
        self::assertFileExists($file);
        $lines = file($file, FILE_IGNORE_NEW_LINES);
        self::assertIsArray($lines);
        self::assertCount(1, $lines);
        $entry = json_decode($lines[0], true);
        self::assertSame('2026-10-20T12:34:56.000Z', $entry['ts']);
        self::assertSame('info', $entry['level']);
        self::assertSame('hello', $entry['msg']);
        self::assertSame('abcd', $entry['request_id']);
        self::assertSame('42', $entry['user_id']);
        self::assertSame('GET /api/v1/health', $entry['route']);
        self::assertIsInt($entry['ms']);
        self::assertSame(['password' => '[redacted]', 'nested' => ['csrf_token' => '[redacted]', 'n' => 1]], $entry['ctx']);
        self::assertStringNotContainsString('secret!', (string) file_get_contents($file));
    }

    public function testDiscardWritesNothing(): void
    {
        Logger::discard()->error('nothing');
        self::assertDirectoryDoesNotExist($this->dir);
    }
}
