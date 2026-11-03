<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Core\Db;
use JDR\Domain\Settings\Settings;
use JDR\Realtime\WaitSlots;

/**
 * Cap on waiting connections (P10e2a): MySQL named locks as slots, poll signal beyond the cap.
 * "Other processes" are a second MySQL connection holding the locks.
 */
final class WaitSlotsTest extends RealtimeTestCase
{
    private const SIGNAL = "event: transport\ndata: {\"mode\":\"poll\",\"retry_after_s\":120}\n\n";

    private ?Db $other = null;

    protected function tearDown(): void
    {
        $this->other?->fetchValue('SELECT RELEASE_ALL_LOCKS()');
        $this->other = null;
        parent::tearDown();
    }

    private function cap(int $max): void
    {
        $this->setSetting('realtime_max_waiting', $max);
        $this->app->container()->get(Settings::class)->refresh();
    }

    private function slots(): WaitSlots
    {
        return $this->app->container()->get(WaitSlots::class);
    }

    /** Takes slot $n from another connection (another PHP worker). */
    private function holdElsewhere(int $n): void
    {
        $this->other ??= self::newDb();
        self::assertSame(1, (int) $this->other->fetchValue('SELECT GET_LOCK(?, 0)', [$this->slots()->name($n)]));
    }

    private function freeElsewhere(int $n): void
    {
        $this->other?->fetchValue('SELECT RELEASE_LOCK(?)', [$this->slots()->name($n)]);
    }

    private function usedElsewhere(int $n): bool
    {
        $this->other ??= self::newDb();

        return $this->other->fetchValue('SELECT IS_USED_LOCK(?)', [$this->slots()->name($n)]) !== null;
    }

    public function testStreamBeyondTheCapGetsThePollSignalThenTheSlotIsReusable(): void
    {
        ['gm' => $gm, 'channel' => $ch] = $this->world();
        $this->cap(1);
        $this->holdElsewhere(1);
        self::assertSame(1, $this->slots()->used());

        $start = $this->timer->now();
        $full = $gm->get('/stream?channels=' . $ch . '&since=0');
        self::assertSame(200, $full->status());
        self::assertSame('text/event-stream; charset=utf-8', $full->header('Content-Type'));
        self::assertSame("retry: 120000\n\n" . self::SIGNAL, $full->body());
        self::assertSame(0.0, $this->timer->now() - $start);

        $this->freeElsewhere(1);
        $seen = false;
        $this->timer->onSleep = function () use (&$seen): void {
            $seen = $seen || $this->usedElsewhere(1);
        };
        $ok = $gm->get('/stream?channels=' . $ch . '&since=0');
        self::assertStringContainsString('event: ping', $ok->body());
        self::assertStringNotContainsString('event: transport', $ok->body());
        self::assertTrue($seen, 'the slot is held during the stream');
        self::assertFalse($this->usedElsewhere(1), 'the slot is given back at the end');
        self::assertSame(0, $this->slots()->used());
    }

    public function testSecondStreamOfTheSameProcessDoesNotReenterTheLock(): void
    {
        $this->cap(1);
        $slots = $this->slots();
        $first = $slots->acquire();
        self::assertSame(1, $first);
        self::assertNull($slots->acquire());
        $slots->release($first);
        self::assertSame(1, $slots->acquire());
        $slots->release(1);
        self::assertFalse($this->usedElsewhere(1));
    }

    public function testLongPollingWithoutSlotAnswersAtOnceWithTheSignal(): void
    {
        ['gm' => $gm, 'channel' => $ch] = $this->world();
        $this->cap(2);
        $this->holdElsewhere(1);
        $this->holdElsewhere(2);

        $start = $this->timer->now();
        $full = $gm->get('/events?channels=' . $ch . '&since=0&wait=20');
        self::assertSame(200, $full->status(), $full->body());
        self::assertSame(0.0, $this->timer->now() - $start);
        self::assertSame(
            ['events' => [], 'last_id' => '0', 'transport' => ['mode' => 'poll', 'retry_after_s' => 120]],
            $full->payload()['data'],
        );
        // Short polling never needs a slot.
        self::assertArrayNotHasKey('transport', $gm->get('/events?channels=' . $ch . '&since=0')->payload()['data']);

        $this->freeElsewhere(2);
        $waited = $gm->get('/events?channels=' . $ch . '&since=0&wait=20');
        self::assertArrayNotHasKey('transport', $waited->payload()['data']);
        self::assertEqualsWithDelta(20.0, $this->timer->now() - $start, 0.001);
        self::assertFalse($this->usedElsewhere(2));
    }

    public function testCapZeroMeansShortPollingOnly(): void
    {
        ['gm' => $gm, 'channel' => $ch] = $this->world();
        $this->cap(0);
        self::assertSame(self::SIGNAL, substr($gm->get('/stream?channels=' . $ch)->body(), -strlen(self::SIGNAL)));
        $data = $gm->get('/events?channels=' . $ch . '&wait=20')->payload()['data'];
        self::assertSame(['mode' => 'poll', 'retry_after_s' => 120], $data['transport']);
        self::assertSame(0, $this->slots()->used());
    }

    public function testDefaultCapIsFour(): void
    {
        self::assertSame(4, $this->slots()->max());
    }
}
