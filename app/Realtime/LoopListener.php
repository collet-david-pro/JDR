<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * Hook called by the real-time requests (GET /events, every iteration of the long-polling and
 * SSE loops, about every 250 ms) for a reader. P6b's PresenceService implements it (D6):
 * last_seen_at of the player at most every 20 s, sweep() from a GM loop every 10 s (use Every
 * to throttle). Must be cheap and must not throw (errors are logged and ignored).
 */
interface LoopListener
{
    /**
     * @param float $now Timer::now() (seconds)
     */
    public function onLoopTick(Subscription $sub, float $now): void;
}
