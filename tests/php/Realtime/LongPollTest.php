<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Core\Clock;
use JDR\Core\Errors\GoneException;
use JDR\Domain\Support\AppPaths;
use JDR\Realtime\Audience;
use JDR\Realtime\ChannelSignal;
use JDR\Realtime\EventStore;
use JDR\Realtime\LongPoll;
use JDR\Realtime\LoopListeners;

/**
 * Long polling with a simulated clock: witness every 250 ms, safety read every 5 s, answer at
 * the first visible event or at the deadline.
 */
final class LongPollTest extends RealtimeTestCase
{
    private function poll(): LongPoll
    {
        return $this->app->container()->get(LongPoll::class);
    }

    /**
     * Runs $fn once, the first time the simulated clock reaches start + $at seconds.
     */
    private function at(float $at, \Closure $fn): void
    {
        $start = $this->timer->now();
        $done = false;
        $this->timer->onSleep = static function (float $now) use ($start, $at, $fn, &$done): void {
            if (!$done && $now >= $start + $at) {
                $done = true;
                $fn();
            }
        };
    }

    public function testShortPollingAnswersAtOnce(): void
    {
        $result = $this->poll()->poll(self::gmSub('session:1'), 0, 0);
        self::assertSame([], $result->events);
        self::assertSame(0, $result->lastId);
        self::assertSame(0, $this->timer->sleeps);
    }

    public function testWaitingEventsAreReturnedAtOnce(): void
    {
        $id = $this->write([['session:1', 'a.b', Audience::ALL, []]]);
        $result = $this->poll()->poll(self::gmSub('session:1'), 0, 20);
        self::assertCount(1, $result->events);
        self::assertSame($id, $result->lastId);
        self::assertSame(0, $this->timer->sleeps);
    }

    public function testSignalledEventEndsTheWaitAtTheNextTick(): void
    {
        $start = $this->timer->now();
        $this->at(3.0, fn () => $this->write([['session:1', 'late', Audience::ALL, []]]));
        $result = $this->poll()->poll(self::gmSub('session:1'), 0, 20);
        self::assertSame(['late'], array_map(static fn ($e) => $e->type, $result->events));
        $elapsed = $this->timer->now() - $start;
        self::assertGreaterThanOrEqual(3.0, $elapsed);
        self::assertLessThanOrEqual(3.26, $elapsed);
    }

    public function testUnsignalledEventIsFoundByTheSafetyRead(): void
    {
        $root = self::$root;
        $silent = new EventStore($this->appDb(), new Clock(), new ChannelSignal(new AppPaths($root, $root . '/elsewhere', $root), false));
        $start = $this->timer->now();
        $this->at(1.0, function () use ($silent): void {
            $this->appDb()->transaction(static fn () => $silent->record('session:1', 'silent', Audience::ALL, []));
        });
        $result = $this->poll()->poll(self::gmSub('session:1'), 0, 20);
        self::assertSame(['silent'], array_map(static fn ($e) => $e->type, $result->events));
        $elapsed = $this->timer->now() - $start;
        self::assertGreaterThanOrEqual(5.0, $elapsed);
        self::assertLessThanOrEqual(5.26, $elapsed);
    }

    public function testDeadlineReturnsAnEmptyList(): void
    {
        $listener = new RecordingListener();
        $this->app->container()->get(LoopListeners::class)->add($listener);
        $start = $this->timer->now();
        $result = $this->poll()->poll(self::gmSub('session:1'), 42, 20);
        self::assertSame([], $result->events);
        self::assertSame(42, $result->lastId);
        self::assertEqualsWithDelta(20.0, $this->timer->now() - $start, 0.001);
        self::assertSame($start, $listener->ticks[0], 'tick at the start');
        self::assertCount(81, $listener->ticks, 'start + one per 250 ms');
        self::assertSame(['session:1'], $listener->last?->channels());
    }

    public function testWaitIsClampedTo20Seconds(): void
    {
        $start = $this->timer->now();
        $this->poll()->poll(self::gmSub('session:1'), 0, 600);
        self::assertEqualsWithDelta(20.0, $this->timer->now() - $start, 0.001);
    }

    public function testInvisibleEventsDoNotEndTheWaitButMoveTheCursor(): void
    {
        $gmOnly = 0;
        $this->at(2.0, function () use (&$gmOnly): void {
            $gmOnly = $this->write([['session:1', 'secret', Audience::GM, []]]);
        });
        $start = $this->timer->now();
        $result = $this->poll()->poll(self::sub(7, ['session:1' => Audience::ROLE_PLAYER]), 0, 10);
        self::assertSame([], $result->events);
        self::assertSame($gmOnly, $result->lastId);
        self::assertEqualsWithDelta(10.0, $this->timer->now() - $start, 0.001);
    }

    public function testPurgeDuringTheWaitIsGone(): void
    {
        $this->at(1.0, function (): void {
            $this->purgedUpto(10);
            $this->app->container()->get(ChannelSignal::class)->notify(['session:1' => 10]);
        });
        $this->expectException(GoneException::class);
        $this->poll()->poll(self::gmSub('session:1'), 3, 20);
    }

    public function testAFailingListenerIsIgnored(): void
    {
        $listener = new RecordingListener();
        $listener->throw = true;
        $this->app->container()->get(LoopListeners::class)->add($listener);
        $result = $this->poll()->poll(self::gmSub('session:1'), 0, 1);
        self::assertSame([], $result->events);
        self::assertGreaterThan(1, count($listener->ticks));
    }
}
