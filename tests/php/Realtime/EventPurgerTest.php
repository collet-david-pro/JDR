<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Core\Errors\GoneException;
use JDR\Realtime\Audience;
use JDR\Realtime\EventPurger;
use JDR\Realtime\EventReader;

/**
 * Purge (D2): durable events > 24 h (mark raised), ephemeral > 2 min (mark kept).
 */
final class EventPurgerTest extends RealtimeTestCase
{
    private function age(int $id, int $seconds): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('events') . ' SET `created_at` = ? WHERE `id` = ?',
            [gmdate('Y-m-d H:i:s', time() - $seconds), $id],
        );
    }

    public function testPurge(): void
    {
        $old1 = $this->write([['session:1', 'old.one', Audience::ALL, []]]);
        $oldCursor = $this->write([['map:2', 'cursor', Audience::GM, [], null, true]]);
        $old2 = $this->write([['session:1', 'old.two', Audience::GM, []]]);
        $recentCursor = $this->write([['map:2', 'cursor', Audience::GM, [], null, true]]);
        $staleCursor = $this->write([['map:2', 'cursor', Audience::GM, [], null, true]]);
        $fresh = $this->write([['session:1', 'fresh', Audience::ALL, []]]);
        $this->age($old1, 25 * 3600);
        $this->age($oldCursor, 25 * 3600);
        $this->age($old2, 24 * 3600 + 60);
        $this->age($recentCursor, 60);
        $this->age($staleCursor, 180);

        $purger = $this->app->container()->get(EventPurger::class);
        self::assertSame(4, $purger->purge());
        self::assertSame($old2, $purger->purgedUpto());
        $left = array_map('intval', array_column($this->db->fetchAll('SELECT `id` FROM ' . $this->db->t('events') . ' ORDER BY `id`'), 'id'));
        self::assertSame([$recentCursor, $fresh], $left);

        $reader = $this->app->container()->get(EventReader::class);
        self::assertSame(['fresh'], array_map(static fn ($e) => $e->type, $reader->read(self::gmSub('session:1'), $old2)->events));
        try {
            $reader->read(self::gmSub('session:1'), $old1);
            self::fail('410 expected');
        } catch (GoneException) {
        }

        // Idempotent; the mark never goes down; an ephemeral-only purge keeps it.
        self::assertSame(0, $purger->purge());
        $this->age($recentCursor, 200);
        self::assertSame(1, $purger->purge());
        self::assertSame($old2, $purger->purgedUpto());
    }

    public function testRetentionSetting(): void
    {
        $id = $this->write([['session:1', 'x.y', Audience::ALL, []]]);
        $this->age($id, 3 * 3600);
        $this->changeSetting('events_retention_hours', 2);
        self::assertSame(1, $this->app->container()->get(EventPurger::class)->purge());
        self::assertSame($id, $this->app->container()->get(EventPurger::class)->purgedUpto());
    }
}
