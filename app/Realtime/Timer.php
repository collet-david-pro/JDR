<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * Monotonic-enough time source and sleep of the real-time loops (long polling, SSE).
 * Not final on purpose: the tests replace it (container instance) with a simulated clock so
 * that a 20 s wait or a 25 s stream runs in a few milliseconds.
 */
class Timer
{
    /**
     * Current time in seconds (float).
     */
    public function now(): float
    {
        return microtime(true);
    }

    public function sleep(int $microseconds): void
    {
        if ($microseconds > 0) {
            usleep($microseconds);
        }
    }
}
