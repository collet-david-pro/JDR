<?php

declare(strict_types=1);

namespace JDR\Tests\Domain;

use JDR\Core\Clock;
use JDR\Core\DbSessionHandler;
use JDR\Migrate\Runner;
use JDR\Tests\Support\DbTestCase;

final class DbSessionHandlerTest extends DbTestCase
{
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
    }

    public function testLifecycle(): void
    {
        self::truncateTestTables();
        $db = self::newDb();
        $handler = new DbSessionHandler($db, Clock::at('2026-10-20 10:00:00'), '203.0.113.9');
        self::assertTrue($handler->open('', 'jdr_sid'));
        self::assertFalse($handler->validateId('abc'));
        self::assertSame('', $handler->read('abc'));
        $handler->setUserId(42);
        self::assertTrue($handler->write('abc', 'uid|i:42;'));
        self::assertTrue($handler->close());
        self::assertTrue($handler->validateId('abc'));
        self::assertSame('uid|i:42;', $handler->read('abc'));
        $row = $db->fetchOne('SELECT * FROM ' . $db->t('php_sessions'));
        self::assertSame(42, (int) $row['user_id']);
        self::assertSame('203.0.113.9', $row['ip']);
        self::assertTrue($handler->updateTimestamp('abc', 'uid|i:42;'));
        $handler->close();

        $handler->setUserId(null);
        $handler->write('def', 'x');
        self::assertSame(1, $handler->destroyUser(42));
        self::assertTrue($handler->validateId('def'));
        self::assertFalse($handler->validateId('abc'));
        self::assertTrue($handler->destroy('def'));
        self::assertFalse($handler->validateId('def'));

        $handler->write('old', 'x');
        $future = new DbSessionHandler($db, Clock::at('2026-10-21 10:00:00'));
        self::assertSame(1, $future->gc(3600));
    }
}
