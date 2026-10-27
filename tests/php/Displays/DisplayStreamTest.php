<?php

declare(strict_types=1);

namespace JDR\Tests\Displays;

use JDR\Realtime\Audience;

/**
 * P7b D7: a paired screen reads the channel of its session (?as=display, audiences all +
 * displays) by GET /events and GET /stream; the loops revalidate the screen every 5 s (revoked,
 * moved, session ended => the read ends) and touch last_seen_at at most every 20 s.
 */
final class DisplayStreamTest extends DisplaysTestCase
{
    public function testTheScreenReadsAllAndDisplaysOfItsSessionOnly(): void
    {
        $w = $this->arena();
        [$screen] = $this->pairedScreen($w['gm'], $w['session']);
        $ch = $w['channel'];
        $from = $this->head();
        $this->write([
            [$ch, 't.all', Audience::ALL], [$ch, 't.gm', Audience::GM], [$ch, 't.players', Audience::PLAYERS],
            [$ch, 't.displays', Audience::DISPLAYS], [$ch, 't.user', Audience::USER, [], $this->userId('Bob')],
        ]);

        $data = self::data($this->ok($screen->get('/events?as=display&channels=' . $ch . '&since=' . $from)));
        self::assertSame(['t.all', 't.displays'], array_column($data['events'], 'type'));
        $sse = $this->ok($screen->get('/stream?as=display&channels=' . $ch . '&since=' . $from));
        self::assertSame('text/event-stream; charset=utf-8', $sse->header('Content-Type'));
        self::assertStringContainsString("event: t.all\n", $sse->body());
        self::assertStringContainsString("event: t.displays\n", $sse->body());
        foreach (['t.gm', 't.players', 't.user'] as $hidden) {
            self::assertStringNotContainsString('event: ' . $hidden . "\n", $sse->body());
        }

        $other = $this->newSession((int) $w['game'], 'lobby');
        foreach (['/events', '/stream'] as $path) {
            self::assertSame(404, $screen->get($path . '?as=display&channels=session:' . $other)->status(), $path . ' other session');
            self::assertSame(404, $screen->get($path . '?as=display&channels=' . $ch . ',session:' . $other)->status(), $path . ' one more session');
            self::assertSame(403, $screen->get($path . '?as=display&channels=map:' . $w['map'])->status(), $path . ' map channel');
            self::assertSame(401, $screen->get($path . '?channels=' . $ch)->status(), $path . ' without as=display: a user is required');
            self::assertSame(401, $this->screen()->get($path . '?as=display&channels=' . $ch)->status(), $path . ' unpaired browser');
        }

        $this->setState($w['session'], 'ended');
        foreach (['/events', '/stream'] as $path) {
            $r = $screen->get($path . '?as=display&channels=' . $ch);
            self::assertSame(409, $r->status(), $path . ' ended session');
            self::assertSame('session_not_running', self::errorCode($r));
        }
    }

    public function testARevokedScreenEndsItsLongPollingAndItsStream(): void
    {
        $w = $this->arena();
        foreach (['/events?wait=20&', '/stream?'] as $path) {
            [$screen, $d] = $this->pairedScreen($w['gm'], $w['session'], 'Écran ' . strlen($path));
            $start = $this->timer->now();
            $this->timer->onSleep = function (float $now) use ($start, $d): void {
                if ($now - $start >= 1.0 && $this->displayRow($d['id']) !== null) {
                    $this->db->execute('DELETE FROM ' . $this->db->t('session_displays') . ' WHERE `id` = ?', [(int) $d['id']]);
                }
            };
            $this->ok($screen->get($path . 'as=display&since=' . $this->head() . '&channels=' . $w['channel']));
            $this->timer->onSleep = null;
            $elapsed = $this->timer->now() - $start;
            self::assertGreaterThanOrEqual(5.0, $elapsed, $path);
            self::assertLessThan(6.0, $elapsed, $path . ': closed at the next check (5 s)');
            $again = $screen->get($path . 'as=display&channels=' . $w['channel']);
            self::assertSame(401, $again->status(), $path);
            self::assertSame('display_unpaired', self::errorCode($again));
        }
    }

    public function testAnEndedSessionOrAMovedScreenEndsTheRead(): void
    {
        $w = $this->arena();
        $this->startSession($w);
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $cases = [
            'ended' => fn () => $this->setState($w['session'], 'ended'),
            'moved' => fn () => $this->setDisplay($d['id'], 'session_id', $this->newSession((int) $w['game'], 'lobby')),
        ];
        foreach ($cases as $case => $change) {
            $start = $this->timer->now();
            $done = false;
            $this->timer->onSleep = static function (float $now) use ($start, $change, &$done): void {
                if (!$done && $now - $start >= 1.0) {
                    $done = true;
                    $change();
                }
            };
            $data = self::data($this->ok($screen->get('/events?as=display&wait=20&since=' . $this->head() . '&channels=' . $w['channel'])));
            $this->timer->onSleep = null;
            self::assertLessThan(6.0, $this->timer->now() - $start, $case);
            self::assertSame([], $data['events'], $case);
            $this->setState($w['session'], 'running');
        }
        self::assertSame(404, $screen->get('/events?as=display&channels=' . $w['channel'])->status(), 'moved: the old session is another one');
    }

    public function testTheLoopsTouchLastSeenAtMostEveryTwentySeconds(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $path = '/events?as=display&channels=' . $w['channel'];
        $seen = fn (): int => (int) strtotime((string) $this->displayRow($d['id'])['last_seen_at'] . ' UTC');

        $this->setDisplay($d['id'], 'last_seen_at', gmdate('Y-m-d H:i:s', time() - 10));
        $this->setDisplay($d['id'], 'last_ip', null);
        $this->ok($screen->get($path));
        self::assertEqualsWithDelta(time() - 10, $seen(), 3, 'not touched within 20 s');
        self::assertNull($this->displayRow($d['id'])['last_ip']);

        $this->setDisplay($d['id'], 'last_seen_at', gmdate('Y-m-d H:i:s', time() - 30));
        $this->ok($screen->get($path));
        self::assertEqualsWithDelta(time(), $seen(), 3, 'touched after 20 s');
        self::assertStringStartsWith('198.18.0.', (string) $this->displayRow($d['id'])['last_ip']);
    }
}
