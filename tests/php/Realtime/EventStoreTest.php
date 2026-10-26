<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Core\Db;
use JDR\Realtime\Audience;
use JDR\Realtime\ChannelSignal;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * EventStore (D1): buffered in the transaction, flushed before COMMIT under the event_seq lock,
 * signalled after COMMIT, dropped on rollback; record() outside a transaction is refused.
 */
final class EventStoreTest extends RealtimeTestCase
{
    public function testRecordOutsideATransactionIsRefused(): void
    {
        $this->expectException(\LogicException::class);
        $this->store()->record('session:1', 'session.state', Audience::ALL, ['state' => 'running']);
    }

    public function testEventsAreBufferedUntilCommitThenSignalled(): void
    {
        $store = $this->store();
        $signal = $this->app->container()->get(ChannelSignal::class);
        $seenInside = null;
        $this->appDb()->transaction(function (Db $db) use ($store, &$seenInside): void {
            $store->record('session:7', 'session.state', Audience::ALL, ['state' => 'running', 'current_map_id' => 34]);
            $store->record('map:34', 'map.ops', Audience::GM, ['map_id' => 34, 'revision' => 2]);
            $store->record('session:7', 'player.kicked', Audience::USER, ['reason' => null], 9, 5, 'op-1');
            $seenInside = [$store->pending(), $this->rows('events')];
        });
        self::assertSame([3, 0], $seenInside, 'nothing inserted before COMMIT');
        self::assertSame(0, $store->pending());

        $rows = $this->db->fetchAll('SELECT * FROM ' . $this->db->t('events') . ' ORDER BY `id`');
        self::assertCount(3, $rows);
        self::assertSame(['session.state', 'map.ops', 'player.kicked'], array_column($rows, 'type'));
        $ids = array_map('intval', array_column($rows, 'id'));
        self::assertSame($ids, array_values(array_unique($ids)));
        self::assertTrue($ids[0] < $ids[1] && $ids[1] < $ids[2], 'ids in record order');
        self::assertSame($ids[2], $store->lastCommittedId());
        self::assertSame(['state' => 'running', 'current_map_id' => '34'], json_decode((string) $rows[0]['payload'], true), 'ids as strings');
        self::assertSame('user', $rows[2]['audience']);
        self::assertSame(9, (int) $rows[2]['audience_user_id']);
        self::assertSame(5, (int) $rows[2]['actor_user_id']);
        self::assertSame('op-1', $rows[2]['client_op_id']);
        self::assertSame(0, (int) $rows[0]['ephemeral']);

        self::assertSame((string) $ids[2], file_get_contents($signal->file('session:7')));
        self::assertSame((string) $ids[1], file_get_contents($signal->file('map:34')));
    }

    public function testRollbackDropsTheBufferWithoutSignal(): void
    {
        $store = $this->store();
        $signal = $this->app->container()->get(ChannelSignal::class);
        try {
            $this->appDb()->transaction(static function () use ($store): void {
                $store->record('session:7', 'session.state', Audience::ALL, ['state' => 'paused']);
                throw new \RuntimeException('business failure');
            });
            self::fail('exception expected');
        } catch (\RuntimeException $e) {
            self::assertSame('business failure', $e->getMessage());
        }
        self::assertSame(0, $store->pending());
        self::assertSame(0, $this->rows('events'));
        self::assertFileDoesNotExist($signal->file('session:7'));
        self::assertNull($store->lastCommittedId());

        // The next transaction works normally (hooks registered again).
        $id = $this->write([['session:7', 'session.state', Audience::ALL, ['state' => 'running']]]);
        self::assertSame(1, $this->rows('events'));
        self::assertSame((string) $id, file_get_contents($signal->file('session:7')));
    }

    public function testAnEmptyTransactionDoesNotTouchEventSeq(): void
    {
        $this->appDb()->transaction(static fn (): int => 1);
        self::assertSame(0, $this->rows('events'));
        self::assertNull($this->store()->lastCommittedId());
    }

    public function testNestedTransactionsFlushOnceAtTheOuterCommit(): void
    {
        $store = $this->store();
        $db = $this->appDb();
        $db->transaction(function (Db $db) use ($store): void {
            $store->record('session:1', 'a.one', Audience::ALL, []);
            $db->transaction(static function () use ($store): void {
                $store->record('session:1', 'a.two', Audience::ALL, []);
            });
            self::assertSame(0, $this->rows('events'));
        });
        self::assertSame(['a.one', 'a.two'], array_column($this->db->fetchAll('SELECT `type` FROM ' . $this->db->t('events') . ' ORDER BY `id`'), 'type'));
        self::assertSame('{}', str_replace(' ', '', (string) $this->db->fetchValue('SELECT `payload` FROM ' . $this->db->t('events') . ' LIMIT 1')));
    }

    public function testDeadlockRetryStartsFromAnEmptyBuffer(): void
    {
        $store = $this->store();
        $attempts = 0;
        $this->appDb()->transaction(static function () use ($store, &$attempts): void {
            $attempts++;
            $store->record('session:1', 'try.' . $attempts, Audience::ALL, []);
            if ($attempts === 1) {
                $e = new \PDOException('Deadlock found');
                $e->errorInfo = ['40001', 1213, 'Deadlock found when trying to get lock'];
                throw $e;
            }
        });
        self::assertSame(2, $attempts);
        self::assertSame(['try.2'], array_column($this->db->fetchAll('SELECT `type` FROM ' . $this->db->t('events')), 'type'));
    }

    public function testLargeBatchesKeepTheirOrderAndLastIdPerChannel(): void
    {
        $events = [];
        for ($i = 0; $i < 230; $i++) {
            $events[] = [$i % 2 === 0 ? 'session:3' : 'map:4', 'bulk.n', Audience::ALL, ['n' => $i]];
        }
        $last = $this->write($events);
        $rows = $this->db->fetchAll('SELECT `id`, `channel`, `payload` FROM ' . $this->db->t('events') . ' ORDER BY `id`');
        self::assertCount(230, $rows);
        self::assertSame(range(0, 229), array_map(static fn (array $r): int => json_decode((string) $r['payload'], true)['n'], $rows));
        self::assertSame($last, (int) $rows[229]['id']);
        $signal = $this->app->container()->get(ChannelSignal::class);
        self::assertSame((string) $rows[228]['id'], file_get_contents($signal->file('session:3')));
        self::assertSame((string) $rows[229]['id'], file_get_contents($signal->file('map:4')));
    }

    public function testEphemeralFlagIsStored(): void
    {
        $this->write([['map:4', 'cursor', Audience::GM, ['user_id' => 3, 'x' => 1.5], null, true]]);
        self::assertSame(1, (int) $this->db->fetchValue('SELECT `ephemeral` FROM ' . $this->db->t('events')));
    }

    /**
     * @return iterable<string, array{0: string, 1: string, 2: string, 3: array<string, mixed>, 4: ?int, 5: ?string}>
     */
    public static function invalidRecords(): iterable
    {
        yield 'channel' => ['lobby:1', 'x.y', 'all', [], null, null];
        yield 'channel id 0' => ['session:0', 'x.y', 'all', [], null, null];
        yield 'type' => ['session:1', 'X Y', 'all', [], null, null];
        yield 'audience' => ['session:1', 'x.y', 'everyone', [], null, null];
        yield 'user without id' => ['session:1', 'x.y', 'user', [], null, null];
        yield 'id without user' => ['session:1', 'x.y', 'players', [], 3, null];
        yield 'list payload' => ['session:1', 'x.y', 'all', [1, 2], null, null];
        yield 'client_op_id' => ['session:1', 'x.y', 'all', [], null, str_repeat('a', 41)];
    }

    /**
     * @param array<string, mixed> $payload
     */
    #[DataProvider('invalidRecords')]
    public function testInvalidRecordsAreRefused(string $channel, string $type, string $audience, array $payload, ?int $user, ?string $op): void
    {
        $store = $this->store();
        try {
            $this->appDb()->transaction(static function () use ($store, $channel, $type, $audience, $payload, $user, $op): void {
                $store->record($channel, $type, $audience, $payload, $user, null, $op);
            });
            self::fail('InvalidArgumentException expected');
        } catch (\InvalidArgumentException) {
            self::assertSame(0, $this->rows('events'));
        }
    }

    public function testServerNoticeGoesToEverySessionNotEnded(): void
    {
        ['game' => $game] = $this->world();
        $running = (int) $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('play_sessions'));
        $lobby = $this->newSession((int) $game, 'lobby');
        $this->newSession((int) $game, 'ended');

        self::assertSame(2, $this->store()->serverNotice('maintenance', 'Mise à jour dans 5 min'));
        $rows = $this->db->fetchAll('SELECT `channel`, `type`, `audience`, `payload` FROM ' . $this->db->t('events') . ' ORDER BY `id`');
        self::assertSame(['session:' . $running, 'session:' . $lobby], array_column($rows, 'channel'));
        self::assertSame(['server.notice', 'server.notice'], array_column($rows, 'type'));
        self::assertSame(['all', 'all'], array_column($rows, 'audience'));
        self::assertSame(['kind' => 'maintenance', 'message' => 'Mise à jour dans 5 min'], json_decode((string) $rows[0]['payload'], true));

        self::assertSame(1, $this->store()->serverNotice('reload', 'x', ['map:9']));
        $this->expectException(\InvalidArgumentException::class);
        $this->store()->serverNotice('party', 'x');
    }
}
