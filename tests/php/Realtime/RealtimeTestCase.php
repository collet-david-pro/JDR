<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Core\Db;
use JDR\Migrate\Runner;
use JDR\Realtime\Audience;
use JDR\Realtime\Channel;
use JDR\Realtime\ChannelGrant;
use JDR\Realtime\EventStore;
use JDR\Realtime\Subscription;
use JDR\Realtime\Timer;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Maps\MapsTestCase;

/**
 * Real-time tests (P6a): schema 0001 + 0003 (event_seq), simulated Timer in the container, and
 * a small world: GM Alice, co-GM Carl, player Bob (in the session), kicked player Kim, member
 * Dan (not in the session), outsider Eve, one map and one session.
 */
abstract class RealtimeTestCase extends MapsTestCase
{
    protected FakeTimer $timer;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        $dir = self::makeMigrationsDir([
            '0001_initial.sql' => (string) file_get_contents(self::migrationsDir() . '/0001_initial.sql'),
            '0003_events_seq.sql' => (string) file_get_contents(self::migrationsDir() . '/0003_events_seq.sql'),
        ]);
        try {
            (new Runner(self::newDb(), $dir))->runAll();
        } finally {
            self::removeDir($dir);
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        // TRUNCATE emptied event_seq: put back the row of migration 0003.
        $this->db->execute('INSERT IGNORE INTO ' . $this->db->t('event_seq') . ' (`id`, `purged_upto`) VALUES (1, 0)');
        $this->timer = new FakeTimer();
        $this->app->container()->instance(Timer::class, $this->timer);
        self::emptyDir(self::storage() . '/cache/ch');
    }

    protected function appDb(): Db
    {
        return $this->app->container()->get(Db::class);
    }

    protected function store(): EventStore
    {
        return $this->app->container()->get(EventStore::class);
    }

    /**
     * Records events in one committed transaction; returns the last id.
     *
     * @param list<array{0: string, 1: string, 2: string, 3?: array<string, mixed>, 4?: ?int, 5?: bool}> $events
     *        [channel, type, audience, payload, audienceUserId, ephemeral]
     */
    protected function write(array $events): int
    {
        $store = $this->store();
        $this->appDb()->transaction(static function () use ($store, $events): void {
            foreach ($events as $e) {
                $store->record($e[0], $e[1], $e[2], $e[3] ?? [], $e[4] ?? null, null, null, $e[5] ?? false);
            }
        });

        return (int) $store->lastCommittedId();
    }

    protected function purgedUpto(int $value): void
    {
        $this->db->execute('UPDATE ' . $this->db->t('event_seq') . ' SET `purged_upto` = ? WHERE `id` = 1', [$value]);
    }

    /**
     * @return array{gm: ApiClient, game: string, map: string, session: string, channel: string, mapChannel: string}
     */
    protected function world(string $state = 'running'): array
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm)['id'];
        $map = $this->newMap($gm, $game)['id'];
        $this->addMember($gm, $game, 'Carl', 'co_gm');
        $this->addMember($gm, $game, 'Bob');
        $this->addMember($gm, $game, 'Kim');
        $this->addMember($gm, $game, 'Dan');
        $this->createUser('Eve');
        $session = $this->newSession((int) $game, $state);
        $this->addPlayer($session, 'Bob', 'connected');
        $this->addPlayer($session, 'Kim', 'kicked');

        return [
            'gm' => $gm,
            'game' => $game,
            'map' => $map,
            'session' => (string) $session,
            'channel' => Channel::session($session),
            'mapChannel' => Channel::map((int) $map),
        ];
    }

    protected function newSession(int $gameId, string $state = 'running'): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('play_sessions') . ' (`game_id`, `code`, `state`, `created_at`) VALUES (?, ?, ?, UTC_TIMESTAMP())',
            [$gameId, strtoupper(substr(bin2hex(random_bytes(4)), 0, 8)), $state],
        );

        return (int) $this->db->lastInsertId();
    }

    protected function addPlayer(int $sessionId, string $username, string $status): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('session_players') . ' (`session_id`, `user_id`, `status`, `joined_at`, `last_seen_at`) '
            . 'VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [$sessionId, $this->userId($username), $status],
        );
    }

    /**
     * Subscription built by hand (reader tests without the authorizer).
     *
     * @param array<string, string> $roles channel => role
     */
    protected static function sub(?int $userId, array $roles): Subscription
    {
        $grants = [];
        foreach ($roles as $channel => $role) {
            [$kind, $id] = Channel::parse($channel) ?? throw new \InvalidArgumentException($channel);
            $grants[] = new ChannelGrant($channel, $kind, $id, 1, $role);
        }

        return new Subscription($userId, $grants);
    }

    protected static function gmSub(string ...$channels): Subscription
    {
        return self::sub(1, array_fill_keys($channels, Audience::ROLE_GM));
    }
}
