<?php

declare(strict_types=1);

namespace JDR\Tests\Domain;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\RateLimiter;
use JDR\Migrate\Runner;
use JDR\Tests\Support\DbTestCase;

final class RateLimiterTest extends DbTestCase
{
    private Db $db;

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

    protected function setUp(): void
    {
        self::truncateTestTables();
        $this->db = self::newDb();
    }

    private function limiter(string $at): RateLimiter
    {
        return new RateLimiter($this->db, Clock::at($at));
    }

    public function testAttemptWindow(): void
    {
        $t0 = '2026-10-20 10:00:00';
        for ($i = 1; $i <= 3; $i++) {
            self::assertNull($this->limiter($t0)->attempt('forgot:a', 3, 3600), 'request ' . $i);
        }
        self::assertSame(3600, $this->limiter($t0)->attempt('forgot:a', 3, 3600));
        self::assertSame(1800, $this->limiter('2026-10-20 10:30:00')->attempt('forgot:a', 3, 3600));
        self::assertNull($this->limiter('2026-10-20 10:30:00')->attempt('forgot:b', 3, 3600), 'other bucket');
        self::assertNull($this->limiter('2026-10-20 11:00:00')->attempt('forgot:a', 3, 3600), 'new window');
    }

    public function testHitBlocksWithGrowingDelay(): void
    {
        $l = $this->limiter('2026-10-20 10:00:00');
        for ($i = 1; $i <= 4; $i++) {
            self::assertNull($l->hit('login:x', 5, 900));
            self::assertNull($l->tooMany('login:x'));
        }
        self::assertSame(60, $l->hit('login:x', 5, 900));
        self::assertSame(60, $l->tooMany('login:x'));
        self::assertSame(30, $this->limiter('2026-10-20 10:00:30')->tooMany('login:x'));
        $after = $this->limiter('2026-10-20 10:01:01');
        self::assertNull($after->tooMany('login:x'));
        self::assertSame(120, $after->hit('login:x', 5, 900), 'next failure doubles the delay');
        self::assertSame(240, $this->limiter('2026-10-20 10:03:02')->hit('login:x', 5, 900));
        // Quiet for longer than the window: counter reset.
        $later = $this->limiter('2026-10-20 12:00:00');
        self::assertNull($later->hit('login:x', 5, 900));
        $row = $this->db->fetchOne('SELECT `hits` FROM ' . $this->db->t('rate_limits') . " WHERE `bucket` = 'login:x'");
        self::assertSame(1, (int) $row['hits']);
        $later->clear('login:x');
        self::assertSame(0, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('rate_limits')));
    }

    public function testDelayIsCapped(): void
    {
        $l = $this->limiter('2026-10-20 10:00:00');
        $last = null;
        for ($i = 1; $i <= 30; $i++) {
            $last = $l->hit('login:y', 5, 900);
        }
        self::assertSame(RateLimiter::MAX_BLOCK_SECONDS, $last);
    }

    public function testKeys(): void
    {
        self::assertSame('login:alice@x.fr:203.0.113.4', RateLimiter::key('login', ' Alice@X.fr ', '203.0.113.4'));
        $long = RateLimiter::key('login', str_repeat('a', 300), '203.0.113.4');
        self::assertLessThanOrEqual(191, strlen($long));
        self::assertStringStartsWith('login:h:', $long);
        self::assertSame(['limit' => 5, 'window' => 900], RateLimiter::definition('login'));
        $this->expectException(\InvalidArgumentException::class);
        RateLimiter::definition('nope');
    }

    public function testPurge(): void
    {
        $this->limiter('2026-10-01 10:00:00')->attempt('old', 5, 60);
        $this->limiter('2026-10-20 10:00:00')->attempt('new', 5, 60);
        self::assertSame(1, $this->limiter('2026-10-20 10:00:00')->purge());
    }
}
