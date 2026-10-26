<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Realtime\Timer;

/**
 * Simulated time for the real-time loops: sleep() advances the clock at once. onSleep($now) runs
 * after each sleep (the test writes events "while" the loop waits).
 */
final class FakeTimer extends Timer
{
    public float $time;
    public int $sleeps = 0;
    /** @var (\Closure(float): void)|null */
    public ?\Closure $onSleep = null;

    public function __construct(float $start = 1_000_000.0)
    {
        $this->time = $start;
    }

    public function now(): float
    {
        return $this->time;
    }

    public function sleep(int $microseconds): void
    {
        $this->sleeps++;
        $this->time += max(0, $microseconds) / 1_000_000;
        if ($this->onSleep !== null) {
            ($this->onSleep)($this->time);
        }
    }
}
