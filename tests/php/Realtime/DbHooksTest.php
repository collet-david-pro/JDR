<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Core\Db;
use JDR\Tests\Support\DbTestCase;

/**
 * Db transaction hooks used by EventStore: before COMMIT (inside), after COMMIT, after rollback.
 */
final class DbHooksTest extends DbTestCase
{
    public function testHooksRunAroundCommit(): void
    {
        $db = self::newDb();
        $log = [];
        $result = $db->transaction(static function (Db $db) use (&$log): string {
            self::assertTrue($db->inTransaction());
            $db->beforeCommit(static function (Db $db) use (&$log): void {
                $log[] = 'before1:' . ($db->inTransaction() ? 'in' : 'out');
                $db->beforeCommit(static function () use (&$log): void {
                    $log[] = 'before-late';
                });
            });
            $db->beforeCommit(static function () use (&$log): void {
                $log[] = 'before2';
            });
            $db->afterCommit(static function (Db $db) use (&$log): void {
                $log[] = 'after:' . ($db->inTransaction() ? 'in' : 'out');
            });
            $db->afterRollback(static function () use (&$log): void {
                $log[] = 'rollback';
            });

            return 'done';
        });
        self::assertSame('done', $result);
        self::assertSame(['before1:in', 'before2', 'before-late', 'after:out'], $log);
        self::assertFalse($db->inTransaction());

        // One-shot: the next transaction starts without hooks.
        $log = [];
        $db->transaction(static fn (): bool => true);
        self::assertSame([], $log);
    }

    public function testRollbackRunsOnlyTheRollbackHooks(): void
    {
        $db = self::newDb();
        $log = [];
        try {
            $db->transaction(static function (Db $db) use (&$log): void {
                $db->afterCommit(static function () use (&$log): void {
                    $log[] = 'after';
                });
                $db->afterRollback(static function () use (&$log): void {
                    $log[] = 'rollback';
                });
                throw new \DomainException('no');
            });
        } catch (\DomainException) {
        }
        self::assertSame(['rollback'], $log);
    }

    public function testFailingBeforeCommitHookRollsBack(): void
    {
        $db = self::newDb();
        $log = [];
        $this->expectException(\RuntimeException::class);
        try {
            $db->transaction(static function (Db $db) use (&$log): void {
                $db->beforeCommit(static function (): void {
                    throw new \RuntimeException('flush failed');
                });
                $db->afterCommit(static function () use (&$log): void {
                    $log[] = 'after';
                });
                $db->afterRollback(static function () use (&$log): void {
                    $log[] = 'rollback';
                });
            });
        } finally {
            self::assertSame(['rollback'], $log);
        }
    }

    public function testHooksNeedATransaction(): void
    {
        $this->expectException(\LogicException::class);
        self::newDb()->afterCommit(static function (): void {
        });
    }
}
