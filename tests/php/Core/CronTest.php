<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\Config;
use JDR\Core\Cron;
use JDR\Core\Logger;
use PHPUnit\Framework\TestCase;

final class CronTest extends TestCase
{
    public function testKeyIsRequired(): void
    {
        $cron = new Cron(new Config(['cron_key' => 'right-key']), Logger::discard());
        self::assertSame(204, $cron->run('right-key'));
        self::assertSame(403, $cron->run('wrong-key'));
        self::assertSame(403, $cron->run(''));
    }

    public function testEmptyConfiguredKeyRefusesEverything(): void
    {
        self::assertSame(403, (new Cron(new Config(['cron_key' => '']), Logger::discard()))->run(''));
    }

    public function testNotInstalled(): void
    {
        self::assertSame(503, (new Cron(null, Logger::discard()))->run('x'));
    }
}
