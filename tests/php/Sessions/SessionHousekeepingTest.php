<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

use JDR\Core\Cron;
use JDR\Domain\Sessions\SessionHousekeeping;

/**
 * Cron task "sessions" (D2): sessions ended for more than 90 days are deleted with their players
 * and assignments; the others stay.
 */
final class SessionHousekeepingTest extends SessionsTestCase
{
    private function endedDaysAgo(string $sessionId, int $days): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('play_sessions') . " SET `state` = 'ended', `ended_at` = DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) WHERE `id` = ?",
            [$days, (int) $sessionId],
        );
    }

    public function testPurgeOldEndedSessions(): void
    {
        $w = $this->arena();
        $token = $this->newToken($w['gm'], $w['game'], ['name' => 'Elfe', 'kind' => 'pc']);
        $this->ok($w['gm']->put('/sessions/' . $w['session'] . '/assignments/' . $token['id'], ['user_id' => (string) $this->userId('Bob')]));
        $old = $w['session'];
        $this->endedDaysAgo($old, 91);
        $recent = self::data($this->ok($w['gm']->post('/games/' . $w['game'] . '/sessions'), 201))['id'];
        $this->endedDaysAgo($recent, 89);
        $open = self::data($this->ok($w['gm']->post('/games/' . $w['game'] . '/sessions'), 201))['id'];
        self::assertSame(3, $this->rows('play_sessions'));

        $housekeeping = $this->app->container()->get(SessionHousekeeping::class);
        self::assertSame(1, $housekeeping->purgeEnded());

        self::assertSame(2, $this->rows('play_sessions'));
        self::assertSame(0, $this->rows('play_sessions', '`id` = ?', [(int) $old]));
        self::assertSame(0, $this->rows('session_players', '`session_id` = ?', [(int) $old]));
        self::assertSame(0, $this->rows('token_assignments', '`session_id` = ?', [(int) $old]));
        self::assertSame(1, $this->rows('play_sessions', '`id` = ?', [(int) $recent]));
        self::assertSame(1, $this->rows('play_sessions', '`id` = ?', [(int) $open]));
        self::assertSame(0, $housekeeping->purgeEnded());
        // The game and its members are untouched.
        self::assertSame(1, $this->rows('games'));
        self::assertSame(4, $this->rows('game_members'));
    }

    public function testCronRunsTheTask(): void
    {
        $w = $this->arena();
        $this->endedDaysAgo($w['session'], 120);
        $done = $this->app->container()->get(Cron::class)->runTasks(30.0);
        self::assertContains('sessions', $done);
        self::assertSame(0, $this->rows('play_sessions'));
    }
}
