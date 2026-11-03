<?php

declare(strict_types=1);

namespace JDR\Tests\Security;

use JDR\Core\Clock;
use JDR\Core\Logger;
use PHPUnit\Framework\TestCase;

/**
 * Log retention (projet.md 6.6 and 24, docs/securite.md A09): the cron task "logs" deletes the daily files
 * older than 14 days and keeps the others (and any foreign file).
 */
final class LogRetentionTest extends TestCase
{
    public function testDailyFilesOlderThanFourteenDaysAreDeleted(): void
    {
        $dir = sys_get_temp_dir() . '/jdr-logs-' . bin2hex(random_bytes(4));
        mkdir($dir);
        try {
            foreach (['app-2026-10-01.log', 'app-2026-10-05.log', 'app-2026-10-06.log', 'app-2026-10-20.log', 'smtp.txt'] as $name) {
                file_put_contents($dir . '/' . $name, "x\n");
            }
            $logger = new Logger($dir, Clock::at('2026-10-20 08:00:00'));
            self::assertSame(14, Logger::RETENTION_DAYS);
            self::assertSame(2, $logger->purge());
            $left = array_map('basename', glob($dir . '/*') ?: []);
            sort($left);
            self::assertSame(['app-2026-10-06.log', 'app-2026-10-20.log', 'smtp.txt'], $left);
            self::assertSame(0, (new Logger(null, Clock::at('2026-10-20 08:00:00')))->purge());
        } finally {
            array_map('unlink', glob($dir . '/*') ?: []);
            rmdir($dir);
        }
    }
}
