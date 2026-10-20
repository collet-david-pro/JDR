<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\Db;
use JDR\Core\SystemStatus;
use PHPUnit\Framework\TestCase;

final class SystemStatusTest extends TestCase
{
    public function testNotConfigured(): void
    {
        $status = SystemStatus::notConfigured();
        self::assertSame('not_configured', $status->db());
        self::assertNull($status->dbVersion());
        self::assertFalse($status->needsMaintenance('0001'));
    }

    public function testFailingDatabaseIsReportedWithoutThrowing(): void
    {
        $status = SystemStatus::fromDb(static function (): Db {
            throw new \PDOException('SQLSTATE[HY000] [2002] Connection refused');
        });
        self::assertSame('error', $status->db());
        self::assertNull($status->dbVersion());
        self::assertFalse($status->needsMaintenance('0001'));
    }

    public function testUnreachableServerIsReported(): void
    {
        if (!class_exists(Db::class)) {
            self::markTestSkipped('Db not available.');
        }
        $status = SystemStatus::fromDb(static fn (): Db => new Db([
            'host' => '127.0.0.1', 'port' => 1, 'name' => 'none', 'user' => 'none', 'pass' => '', 'prefix' => 'x_',
        ]));
        self::assertSame('error', $status->db());
    }

    public function testMaintenanceRules(): void
    {
        self::assertFalse(SystemStatus::fixed('ok', '0001')->needsMaintenance('0001'));
        self::assertFalse(SystemStatus::fixed('ok', '0002')->needsMaintenance('0001'));
        self::assertTrue(SystemStatus::fixed('ok', '0001')->needsMaintenance('0002'));
        self::assertTrue(SystemStatus::fixed('ok', null)->needsMaintenance('0001'));
        self::assertTrue(SystemStatus::fixed('ok', '0001', true)->needsMaintenance('0001'));
        self::assertTrue(SystemStatus::fixed('error', null, false, true)->needsMaintenance('0001'));
        self::assertFalse(SystemStatus::fixed('error', null)->needsMaintenance('0001'));
    }
}
