<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\GoneException;

/**
 * GET /events (projet.md 10.3, transports 2 and 3): answers at once when events are waiting or
 * when wait = 0 (short polling); otherwise waits up to `wait` seconds, testing the witnesses
 * every 250 ms and MySQL only when one changed (plus a safety read every 5 s), and answers at
 * the first visible event or with {events: [], last_id} at the deadline.
 */
final class LongPoll
{
    public const MAX_WAIT_S = 20;
    public const TICK_US = 250_000;

    public function __construct(
        private EventReader $reader,
        private ChannelSignal $signal,
        private Timer $timer,
        private LoopListeners $listeners,
    ) {
    }

    /**
     * @param int $wait seconds, 0..20
     * @throws GoneException 410 events_gone
     */
    public function poll(Subscription $sub, int $since, int $wait): ReadResult
    {
        $wait = max(0, min(self::MAX_WAIT_S, $wait));
        $watch = new ChannelWatch($this->signal, $this->timer, $sub->channels());
        $watch->start();
        $start = $this->timer->now();
        $this->listeners->tick($sub, $start);
        $result = $this->reader->read($sub, $since);
        if ($result->events !== [] || $wait === 0) {
            return $result;
        }
        $deadline = $start + $wait;
        while (true) {
            if (!$result->more) {
                $now = $this->timer->now();
                if ($now >= $deadline) {
                    break;
                }
                $this->timer->sleep((int) min(self::TICK_US, ceil(($deadline - $now) * 1_000_000)));
                $this->listeners->tick($sub, $this->timer->now());
                if (!$watch->shouldRead()) {
                    continue;
                }
            }
            $result = $this->reader->read($sub, $result->lastId);
            if ($result->events !== [] || ($result->more && $this->timer->now() >= $deadline)) {
                return $result;
            }
        }

        return $result;
    }
}
