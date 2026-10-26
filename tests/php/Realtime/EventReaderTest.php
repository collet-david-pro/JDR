<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Core\Errors\GoneException;
use JDR\Realtime\Audience;
use JDR\Realtime\EventReader;
use JDR\Realtime\WireEvent;

/**
 * EventReader: id > since across channels, audience filter (projet.md 10.2), 500 limit,
 * cursor past invisible events, 410 events_gone.
 */
final class EventReaderTest extends RealtimeTestCase
{
    private const BOB = 7;
    private const DAN = 8;

    private function reader(): EventReader
    {
        return $this->app->container()->get(EventReader::class);
    }

    /**
     * One event of each audience on session:1 (+ one on another channel).
     *
     * @return array<string, int> type => id
     */
    private function mixed(): array
    {
        $ids = [];
        foreach ([
            ['session:1', 'e.all', Audience::ALL, null],
            ['session:1', 'e.gm', Audience::GM, null],
            ['session:1', 'e.players', Audience::PLAYERS, null],
            ['session:1', 'e.displays', Audience::DISPLAYS, null],
            ['session:1', 'e.user_bob', Audience::USER, self::BOB],
            ['session:1', 'e.user_dan', Audience::USER, self::DAN],
            ['session:2', 'e.other', Audience::ALL, null],
        ] as [$channel, $type, $audience, $user]) {
            $ids[$type] = $this->write([[$channel, $type, $audience, ['k' => $type], $user]]);
        }

        return $ids;
    }

    /**
     * @param list<WireEvent> $events
     * @return list<string>
     */
    private static function types(array $events): array
    {
        return array_map(static fn (WireEvent $e): string => $e->type, $events);
    }

    public function testGmReadsEverything(): void
    {
        $ids = $this->mixed();
        $result = $this->reader()->read(self::gmSub('session:1'), 0);
        self::assertSame(['e.all', 'e.gm', 'e.players', 'e.displays', 'e.user_bob', 'e.user_dan'], self::types($result->events));
        self::assertSame($ids['e.user_dan'], $result->lastId);
        self::assertFalse($result->more);
    }

    public function testPlayerReadsAllPlayersAndHisOwnUserEvents(): void
    {
        $this->mixed();
        $bob = $this->reader()->read(self::sub(self::BOB, ['session:1' => Audience::ROLE_PLAYER]), 0);
        self::assertSame(['e.all', 'e.players', 'e.user_bob'], self::types($bob->events));
        $dan = $this->reader()->read(self::sub(self::DAN, ['session:1' => Audience::ROLE_PLAYER]), 0);
        self::assertSame(['e.all', 'e.players', 'e.user_dan'], self::types($dan->events));
    }

    public function testDisplayReadsAllAndDisplays(): void
    {
        $this->mixed();
        $screen = $this->reader()->read(self::sub(null, ['session:1' => Audience::ROLE_DISPLAY]), 0);
        self::assertSame(['e.all', 'e.displays'], self::types($screen->events));
    }

    public function testAudienceRulesMatchTheSqlFilter(): void
    {
        foreach ([Audience::ROLE_GM, Audience::ROLE_PLAYER, Audience::ROLE_DISPLAY] as $role) {
            foreach (Audience::VALUES as $audience) {
                foreach ([null, self::BOB, self::DAN] as $target) {
                    if (($audience === Audience::USER) !== ($target !== null)) {
                        continue;
                    }
                    $expected = match ($role) {
                        Audience::ROLE_GM => true,
                        Audience::ROLE_PLAYER => in_array($audience, ['all', 'players'], true) || $target === self::BOB,
                        default => in_array($audience, ['all', 'displays'], true),
                    };
                    self::assertSame($expected, Audience::allows($role, self::BOB, $audience, $target), "$role / $audience / $target");
                }
            }
        }
        self::assertFalse(Audience::allows('stranger', 1, Audience::ALL, null));
    }

    public function testCursorAndChannelsAreRespected(): void
    {
        $ids = $this->mixed();
        $result = $this->reader()->read(self::gmSub('session:1', 'session:2'), $ids['e.players']);
        self::assertSame(['e.displays', 'e.user_bob', 'e.user_dan', 'e.other'], self::types($result->events));
        $ordered = array_map(static fn (WireEvent $e): int => $e->id, $result->events);
        $sorted = $ordered;
        sort($sorted);
        self::assertSame($sorted, $ordered);
        self::assertSame([], $this->reader()->read(self::gmSub('map:99'), 0)->events);
    }

    public function testRolesArePerChannel(): void
    {
        $this->write([
            ['map:5', 'map.ops', Audience::GM, []],
            ['session:1', 'session.code', Audience::GM, []],
            ['session:1', 'session.state', Audience::ALL, []],
        ]);
        $sub = self::sub(self::BOB, ['map:5' => Audience::ROLE_GM, 'session:1' => Audience::ROLE_PLAYER]);
        self::assertSame(['map.ops', 'session.state'], self::types($this->reader()->read($sub, 0)->events));
    }

    public function testCursorMovesPastInvisibleEvents(): void
    {
        $ids = $this->mixed();
        $screen = self::sub(null, ['session:1' => Audience::ROLE_DISPLAY]);
        $result = $this->reader()->read($screen, $ids['e.displays']);
        self::assertSame([], $result->events);
        self::assertSame($ids['e.user_dan'], $result->lastId, 'head of session:1, not of session:2');
        self::assertSame(500, $this->reader()->read($screen, 500)->lastId, 'a cursor ahead stays');
    }

    public function testLimitAndMore(): void
    {
        $events = [];
        for ($i = 0; $i < 7; $i++) {
            $events[] = ['session:1', 'n.' . $i, Audience::ALL, []];
        }
        $this->write($events);
        $first = $this->reader()->read(self::gmSub('session:1'), 0, 3);
        self::assertSame(['n.0', 'n.1', 'n.2'], self::types($first->events));
        self::assertTrue($first->more);
        self::assertSame($first->events[2]->id, $first->lastId);
        $next = $this->reader()->read(self::gmSub('session:1'), $first->lastId, 3);
        self::assertSame(['n.3', 'n.4', 'n.5'], self::types($next->events));
        $last = $this->reader()->read(self::gmSub('session:1'), $next->lastId, 3);
        self::assertSame(['n.6'], self::types($last->events));
        self::assertFalse($last->more);
    }

    public function testWireFormat(): void
    {
        $store = $this->store();
        $this->appDb()->transaction(static function () use ($store): void {
            $store->record('session:12', 'maptoken.moved', Audience::ALL, ['uid' => 'tok-1', 'x' => 10.5, 'y' => 4.0, 'token_id' => 21], null, 5, 'op-77');
            $store->record('session:12', 'note.read_aloud', Audience::ALL, []);
        });
        $events = $this->reader()->read(self::gmSub('session:12'), 0)->events;
        $wire = json_decode($events[0]->toJson(), true);
        self::assertSame(['id', 'channel', 'type', 'payload', 'actor', 'client_op_id', 'at'], array_keys($wire));
        self::assertIsString($wire['id']);
        self::assertSame('session:12', $wire['channel']);
        self::assertSame('maptoken.moved', $wire['type']);
        self::assertEquals(['uid' => 'tok-1', 'x' => 10.5, 'y' => 4, 'token_id' => '21'], $wire['payload']);
        self::assertSame('5', $wire['actor']);
        self::assertSame('op-77', $wire['client_op_id']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $wire['at']);
        self::assertStringContainsString('"payload":{}', $events[1]->toJson(), 'an empty payload stays an object');
        self::assertNull(json_decode($events[1]->toJson(), true)['actor']);
        self::assertStringNotContainsString("\n", $events[0]->toJson());
    }

    public function testSinceBelowThePurgeMarkIsGone(): void
    {
        $this->mixed();
        $this->purgedUpto(3);
        try {
            $this->reader()->read(self::gmSub('session:1', 'map:2'), 2);
            self::fail('410 expected');
        } catch (GoneException $e) {
            self::assertSame(410, $e->status());
            self::assertSame('events_gone', $e->errorCode());
            self::assertSame(['channels' => 'session:1,map:2'], $e->fields());
        }
        self::assertCount(3, $this->reader()->read(self::gmSub('session:1', 'map:2'), 3)->events, 'since = mark is fine (ids 4-6)');
    }

    public function testHeadId(): void
    {
        self::assertSame(0, $this->reader()->headId());
        $last = $this->write([['session:1', 'x.y', Audience::GM, []]]);
        self::assertSame($last, $this->reader()->headId());
        $this->purgedUpto($last + 10);
        self::assertSame($last + 10, $this->reader()->headId(), 'never below the purge mark');
    }
}
