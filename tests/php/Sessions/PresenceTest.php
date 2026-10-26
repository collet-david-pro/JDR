<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

use JDR\Core\Clock;
use JDR\Domain\Sessions\PresenceService;
use JDR\Domain\Sessions\SessionAccess;
use JDR\Domain\Sessions\SessionEvents;
use JDR\Domain\Sessions\SessionRepository;
use JDR\Realtime\LoopListeners;

/**
 * Presence (D6): POST /presence, last_seen_at from the real-time loops, sweep after 60 s,
 * return of a player, cron.
 */
final class PresenceTest extends SessionsTestCase
{
    private function age(string $sessionId, string $username, int $seconds): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('session_players') . ' SET `last_seen_at` = DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND) WHERE `session_id` = ? AND `user_id` = ?',
            [$seconds, (int) $sessionId, $this->userId($username)],
        );
    }

    private function seenAgo(string $sessionId, string $username): int
    {
        return (int) $this->db->fetchValue(
            'SELECT TIMESTAMPDIFF(SECOND, `last_seen_at`, UTC_TIMESTAMP()) FROM ' . $this->db->t('session_players') . ' WHERE `session_id` = ? AND `user_id` = ?',
            [(int) $sessionId, $this->userId($username)],
        );
    }

    /** PresenceService whose clock runs $offset seconds ahead. */
    private function presenceAt(int $offset): PresenceService
    {
        $c = $this->app->container();

        return new PresenceService(
            $this->appDb(),
            Clock::at(gmdate('Y-m-d H:i:s', time() + $offset)),
            $c->get(SessionRepository::class),
            $c->get(SessionEvents::class),
            $c->get(SessionAccess::class),
        );
    }

    public function testHeartbeatRefreshesLastSeen(): void
    {
        $w = $this->arena();
        $this->age($w['session'], 'Bob', 50);
        $before = $this->head();
        $this->ok($w['bob']->post('/presence', ['session_id' => $w['session']]), 204);
        self::assertLessThan(3, $this->seenAgo($w['session'], 'Bob'));
        self::assertSame($before, $this->head(), 'no event for a plain refresh');
        // The GM's heartbeat sweeps, the others are refused.
        $this->ok($w['gm']->post('/presence', ['session_id' => $w['session']]), 204);
        self::assertFieldErrors($w['bob']->post('/presence', []), ['session_id' => 'required']);
        self::assertFieldErrors($w['bob']->post('/presence', ['session_id' => 'x']), ['session_id' => 'invalid']);
        self::assertSame(404, $w['bob']->post('/presence', ['session_id' => '99999'])->status());
    }

    public function testSweepDisconnectsAfterSixtySeconds(): void
    {
        $w = $this->arena();
        $this->ok($w['bob']->post('/sessions/' . $w['session'] . '/ready', ['ready' => true]), 204);
        $before = $this->head();

        self::assertSame(0, $this->presenceAt(30)->sweep(), 'seen 30 s ago: still connected');
        self::assertSame(0, $this->presenceAt(59)->sweep());
        self::assertSame('connected', $this->playerStatus($w['session'], 'Bob'));

        self::assertSame(1, $this->presenceAt(90)->sweep(), 'Kim is kicked: only Bob');
        self::assertSame('disconnected', $this->playerStatus($w['session'], 'Bob'));
        self::assertSame('kicked', $this->playerStatus($w['session'], 'Kim'));
        self::assertFalse($this->isReady($w['session'], 'Bob'), 'the ready flag is cleared');
        self::assertSame(['player.left/players'], $this->kinds($before));
        $event = $this->events($before)[0];
        self::assertEquals(['user_id' => (string) $this->userId('Bob'), 'username' => 'Bob'], $event['payload']);
        self::assertNull($event['actor_user_id']);
        self::assertSame($w['channel'], $event['channel']);

        self::assertSame(0, $this->presenceAt(200)->sweep(), 'already disconnected');
        self::assertSame(1, count($this->kinds($before)));
    }

    public function testSweepSkipsEndedSessions(): void
    {
        $w = $this->arena();
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        $before = $this->head();
        self::assertSame(0, $this->presenceAt(500)->sweep());
        self::assertSame('connected', $this->playerStatus($w['session'], 'Bob'));
        self::assertSame($before, $this->head());
    }

    public function testReturnReconnectsAndWritesPlayerJoined(): void
    {
        $w = $this->arena();
        $this->presenceAt(90)->sweep();
        self::assertSame('disconnected', $this->playerStatus($w['session'], 'Bob'));
        $before = $this->head();

        $this->ok($w['bob']->post('/presence', ['session_id' => $w['session']]), 204);

        self::assertSame('connected', $this->playerStatus($w['session'], 'Bob'));
        self::assertSame(['player.joined/players'], $this->kinds($before));
        $this->ok($w['bob']->post('/presence', ['session_id' => $w['session']]), 204);
        self::assertSame(1, count($this->kinds($before)));
    }

    public function testTheLoopOfAGmSweepsEveryTenSecondsAndAPlayerLoopTouches(): void
    {
        $w = $this->arena();
        $presence = $this->app->container()->get(PresenceService::class);
        $gmSub = self::gmSub($w['channel']);
        $this->age($w['session'], 'Bob', 120);

        $presence->onLoopTick($gmSub, 100.0);
        self::assertSame('disconnected', $this->playerStatus($w['session'], 'Bob'));

        $this->ok($w['bob']->post('/presence', ['session_id' => $w['session']]), 204);
        $this->age($w['session'], 'Bob', 120);
        $presence->onLoopTick($gmSub, 105.0);
        self::assertSame('connected', $this->playerStatus($w['session'], 'Bob'), 'no sweep within 10 s');
        $presence->onLoopTick($gmSub, 110.5);
        self::assertSame('disconnected', $this->playerStatus($w['session'], 'Bob'));

        // The loop of a player refreshes last_seen_at (at most every 20 s) and brings him back.
        $playerSub = self::sub($this->userId('Bob'), [$w['channel'] => 'player']);
        $presence->onLoopTick($playerSub, 200.0);
        self::assertSame('connected', $this->playerStatus($w['session'], 'Bob'));
        $this->age($w['session'], 'Bob', 40);
        $presence->onLoopTick($playerSub, 210.0);
        self::assertGreaterThanOrEqual(39, $this->seenAgo($w['session'], 'Bob'), 'throttled to 20 s');
        $presence->onLoopTick($playerSub, 221.0);
        self::assertLessThan(3, $this->seenAgo($w['session'], 'Bob'));
    }

    public function testDbThrottleKeepsOneWritePer20Seconds(): void
    {
        $w = $this->arena();
        $presence = $this->app->container()->get(PresenceService::class);
        $this->age($w['session'], 'Bob', 10);
        $presence->touch((int) $w['session'], $this->userId('Bob'));
        self::assertGreaterThanOrEqual(9, $this->seenAgo($w['session'], 'Bob'), 'seen 10 s ago: not written again');
        $this->age($w['session'], 'Bob', 25);
        $presence->touch((int) $w['session'], $this->userId('Bob'));
        self::assertLessThan(3, $this->seenAgo($w['session'], 'Bob'));
    }

    public function testRealtimeRequestsDrivePresence(): void
    {
        $w = $this->arena();
        self::assertContains(PresenceService::class, LoopListeners::CLASSES);

        // Bob polls the events: his last_seen_at is refreshed.
        $this->age($w['session'], 'Bob', 30);
        $this->ok($w['bob']->get('/events?channels=' . $w['channel']));
        self::assertLessThan(3, $this->seenAgo($w['session'], 'Bob'));

        // The GM polls: the stale player is disconnected and the GM reads player.left at once.
        $this->age($w['session'], 'Bob', 120);
        $since = $this->head();
        $events = self::data($this->ok($w['gm']->get('/events?channels=' . $w['channel'] . '&since=' . $since)))['events'];
        self::assertSame(['player.left'], array_column($events, 'type'));
        self::assertSame('disconnected', $this->playerStatus($w['session'], 'Bob'));

        // Bob's next poll brings him back (the Every throttles live in the container: here shared by
        // the requests of the test, so the simulated time moves on).
        $this->timer->time += 100;
        $this->ok($w['bob']->get('/events?channels=' . $w['channel']));
        self::assertSame('connected', $this->playerStatus($w['session'], 'Bob'));
    }

    public function testCronTasksSweepAndPurge(): void
    {
        $w = $this->arena();
        $this->age($w['session'], 'Bob', 300);
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'), 409);
        $done = $this->app->container()->get(\JDR\Core\Cron::class)->runTasks(30.0);
        self::assertContains('presence', $done);
        self::assertContains('sessions', $done);
        self::assertSame('disconnected', $this->playerStatus($w['session'], 'Bob'));
    }
}
